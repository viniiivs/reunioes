#!/usr/bin/env python3
"""Servico de fundo do Reunioes (roda escondido desde o login, via pythonw).

1. Gravar sozinho: comeca a gravar quando um app de reuniao pega o microfone e para
   quando ele solta. Como sabe: pergunta ao Windows (WASAPI) quais processos estao com
   uma sessao de CAPTURA ativa em algum microfone. Apps de chamada so capturam durante a
   chamada; navegador captura para muita coisa, entao so conta se alguma janela dele tiver
   o nome do servico de reuniao no titulo.
     - comeca: app de reuniao capturando por >= INICIO s e nenhuma gravacao rodando
     - para:   o app soltou o mic por >= FIM s (so a gravacao que o servico comecou)
     - se a gravacao automatica for parada na mao, nao religa ate o app soltar o mic
2. Atalho global (padrao Ctrl+Alt+G): grava / para, de qualquer lugar.

Tudo vem da configuracao do app (comum.py) e e relido a cada volta.
Estado para o app em servico.estado.json; log em servico.log.
"""
import ctypes
import ctypes.wintypes as wt
import datetime as dt
import json
import logging
import logging.handlers
import os
import re
import subprocess
import sys
import threading
import time
import winsound

import comtypes
import psutil
from comtypes import CLSCTX_ALL
from pycaw.constants import CLSID_MMDeviceEnumerator, DEVICE_STATE, EDataFlow
from pycaw.pycaw import IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator

import comum

AQUI = os.path.dirname(os.path.abspath(__file__))
PYTHON = os.path.join(os.path.dirname(sys.executable), "python.exe")  # gravar.py escreve no console: python, nao pythonw

PASSO = 3
INICIO = 10
FIM = 45

APPS = {
    "ms-teams.exe": "Teams", "teams.exe": "Teams", "msteams.exe": "Teams",
    "discord.exe": "Discord", "zoom.exe": "Zoom", "slack.exe": "Slack",
    "webex.exe": "Webex", "ciscocollabhost.exe": "Webex", "skype.exe": "Skype",
}
NAVEGADORES = {"chrome.exe": "Chrome", "msedge.exe": "Edge", "firefox.exe": "Firefox",
               "brave.exe": "Brave", "opera.exe": "Opera", "vivaldi.exe": "Vivaldi"}
TITULO_REUNIAO = re.compile(r"\bMeet\b|Microsoft Teams|Discord|Zoom|Webex|Jitsi|Whereby", re.I)

# Para testar sem reuniao: REUNIOES_EXTRA="ffmpeg.exe=Teste" REUNIOES_TEMPOS="4,8"
for par in filter(None, os.environ.get("REUNIOES_EXTRA", "").split(";")):
    exe, _, nome = par.partition("=")
    APPS[exe.lower()] = nome or exe
if os.environ.get("REUNIOES_TEMPOS"):
    INICIO, FIM = (int(x) for x in os.environ["REUNIOES_TEMPOS"].split(","))

log = logging.getLogger("servico")
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
_mutex = None


# ------------------------------------------------------------------ quem esta no microfone

def sessoes_ativas(fluxo):
    """Executaveis (minusculos) com sessao de audio ATIVA. fluxo: eCapture (microfone) ou eRender (som)."""
    enum = comtypes.CoCreateInstance(CLSID_MMDeviceEnumerator, IMMDeviceEnumerator, comtypes.CLSCTX_INPROC_SERVER)
    devs = enum.EnumAudioEndpoints(fluxo.value, DEVICE_STATE.ACTIVE.value)
    exes = set()
    for i in range(devs.GetCount()):
        try:
            mgr = devs.Item(i).Activate(IAudioSessionManager2._iid_, CLSCTX_ALL, None).QueryInterface(IAudioSessionManager2)
            it = mgr.GetSessionEnumerator()
            for j in range(it.GetCount()):
                s = it.GetSession(j).QueryInterface(IAudioSessionControl2)
                if s.GetState() != 1:  # AudioSessionStateActive
                    continue
                pid = s.GetProcessId()
                if pid:
                    try:
                        exes.add(psutil.Process(pid).name().lower())
                    except psutil.Error:
                        pass
        except comtypes.COMError:
            continue
    return exes


def capturando():
    return sessoes_ativas(EDataFlow.eCapture)

EnumWindowsProc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)


def titulos_por_exe():
    r = {}

    def cb(h, _):
        if not user32.IsWindowVisible(h):
            return True
        n = user32.GetWindowTextLengthW(h)
        if n == 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(h, buf, n + 1)
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(h, ctypes.byref(pid))
        try:
            r.setdefault(psutil.Process(pid.value).name().lower(), []).append(buf.value)
        except psutil.Error:
            pass
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return r


def titulo_de_reuniao(exe, titulos=None):
    tit = titulos if titulos is not None else titulos_por_exe()
    for t in tit.get(exe, []):
        m = TITULO_REUNIAO.search(t)
        if m:
            return "Meet" if m.group(0).lower() == "meet" else m.group(0)
    return None


def em_reuniao():
    """(nome para mostrar, exe) do app de reuniao que esta no microfone agora, ou (None, None)."""
    exes = capturando()
    for exe in exes:
        if exe in APPS:
            return APPS[exe], exe
    navs = exes & NAVEGADORES.keys()
    if navs:
        tit = titulos_por_exe()
        for exe in navs:
            nome = titulo_de_reuniao(exe, tit)
            if nome:
                return f"{nome} ({NAVEGADORES[exe]})", exe
    return None, None


def ainda_na_chamada(exe):
    """A chamada continua se o app segura o microfone OU ainda toca o audio da chamada.
    Alguns apps fecham o microfone quando voce muta; o audio dos outros continua aberto
    enquanto a chamada existir, entao mutar nao encerra a gravacao."""
    if exe in capturando():
        return True
    if exe in sessoes_ativas(EDataFlow.eRender):
        # navegador toca som de tudo (video, musica): so vale se a aba da reuniao ainda existe
        return exe not in NAVEGADORES or titulo_de_reuniao(exe) is not None
    return False

# ------------------------------------------------------------------ gravador

def gravando():
    for p in psutil.process_iter(["name", "cmdline"]):
        try:
            if (p.info["name"] or "").lower().startswith("python") and any("gravar.py" in c for c in p.info["cmdline"] or []):
                return True
        except psutil.Error:
            continue
    return False


def abertas():
    return comum.gravacoes_abertas()


def iniciar(app=None):
    nome = dt.datetime.now().strftime("%Y-%m-%d_%H-%M")
    if os.path.exists(comum.base_de(nome) + ".eu.flac"):
        nome = dt.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    base = comum.base_de(nome, criar=True)   # uma subpasta por gravacao
    subprocess.Popen([PYTHON, os.path.join(AQUI, "gravar.py"), nome], cwd=AQUI,
                     creationflags=subprocess.CREATE_NO_WINDOW,
                     stdout=open(base + ".gravar.log", "w", encoding="utf-8"), stderr=subprocess.STDOUT)
    if app:
        with open(base + ".origem.json", "w", encoding="utf-8") as f:
            json.dump({"auto": True, "app": app, "inicio": dt.datetime.now().isoformat(timespec="seconds")}, f, ensure_ascii=False)
    winsound.Beep(440, 200); winsound.Beep(660, 300)   # subindo = gravando
    return base


def parar_todas():
    for b in abertas():
        open(b + ".parar", "w").close()
    winsound.Beep(660, 200); winsound.Beep(440, 300)   # descendo = parou


def salvar_estado(**k):
    try:
        os.makedirs(os.path.dirname(comum.ESTADO_SERVICO), exist_ok=True)
        with open(comum.ESTADO_SERVICO, "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "quando": dt.datetime.now().isoformat(timespec="seconds"), **k}, f, ensure_ascii=False)
    except OSError:
        pass


# ------------------------------------------------------------------ atalho global

MODS = {"ctrl": 0x2, "alt": 0x1, "shift": 0x4, "win": 0x8}
MOD_NOREPEAT = 0x4000
WM_HOTKEY = 0x0312


def tecla(atalho):
    """'ctrl+alt+g' -> (mods, vk). None se invalido."""
    partes = [p.strip().lower() for p in (atalho or "").split("+") if p.strip()]
    if len(partes) < 2:
        return None
    mods = 0
    for p in partes[:-1]:
        if p not in MODS:
            return None
        mods |= MODS[p]
    k = partes[-1]
    if len(k) == 1 and k.isalnum():
        vk = ord(k.upper())
    elif re.fullmatch(r"f([1-9]|1[0-2])", k):
        vk = 0x6F + int(k[1:])
    else:
        return None
    return mods | MOD_NOREPEAT, vk


class Atalho(threading.Thread):
    def __init__(self, atalho, acao):
        super().__init__(daemon=True)
        self.atalho, self.acao = atalho, acao
        self.ok = None

    def run(self):
        t = tecla(self.atalho)
        if not t or not user32.RegisterHotKey(None, 1, t[0], t[1]):
            self.ok = False
            log.info("atalho %s indisponivel (invalido ou ja usado por outro programa)", self.atalho)
            return
        self.ok = True
        log.info("atalho %s registrado", self.atalho)
        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == WM_HOTKEY:
                try:
                    self.acao()
                except Exception:  # noqa: BLE001
                    log.exception("erro no atalho")


# ------------------------------------------------------------------ laco

class Servico:
    def __init__(self):
        self.visto_desde = None
        self.sumiu_desde = None
        self.minha = None          # base da gravacao que o servico comecou
        self.minha_app = None      # nome para mostrar ("Teams", "Meet (Chrome)")
        self.minha_exe = None      # executavel que define se a chamada continua
        self.suprimido = None      # exe cuja chamada voce parou na mao: nao religo ate ela acabar
        self.parando_em = None     # segundos ate parar sozinho (para o app mostrar)
        self.trava = threading.Lock()

    def alternar(self):
        """Atalho: para o que estiver gravando, ou comeca uma gravacao manual."""
        with self.trava:
            if gravando():
                log.info("atalho: parando")
                if self.minha:
                    self.suprimido, self.minha = self.minha_exe, None
                parar_todas()
            else:
                log.info("atalho: gravando %s", os.path.basename(iniciar()))

    def passo(self):
        self.parando_em = None
        if not comum.config()["gravarSozinho"]:
            self.visto_desde = None
            return None
        agora = time.monotonic()
        with self.trava:
            rodando = gravando()
            if self.minha:
                # Gravando por conta propria: so para quando o app que comecou sai da chamada.
                if not rodando:
                    log.info("gravacao %s parada na mao; nao religo ate %s sair da chamada", os.path.basename(self.minha), self.minha_app)
                    self.suprimido, self.minha = self.minha_exe, None
                elif ainda_na_chamada(self.minha_exe):
                    self.sumiu_desde = None
                else:
                    if self.sumiu_desde is None:
                        self.sumiu_desde = agora
                    falta = FIM - (agora - self.sumiu_desde)
                    if falta > 0:
                        self.parando_em = int(falta + 0.5)
                    else:
                        log.info("%s saiu da chamada ha %ss: parando %s", self.minha_app, FIM, os.path.basename(self.minha))
                        open(self.minha + ".parar", "w").close()
                        winsound.Beep(660, 200); winsound.Beep(440, 300)
                        self.minha = self.sumiu_desde = None
                return self.minha_app

            if self.suprimido:
                if ainda_na_chamada(self.suprimido):
                    return None
                self.suprimido = None
            app, exe = em_reuniao()
            if not app:
                self.visto_desde = None
                return None
            if self.visto_desde is None:
                self.visto_desde = agora
            if not rodando and agora - self.visto_desde >= INICIO:
                self.minha, self.minha_app, self.minha_exe = iniciar(app), app, exe
                self.sumiu_desde = None
                log.info("%s no microfone: gravando %s", app, os.path.basename(self.minha))
            return app


def main():
    global _mutex
    os.makedirs(comum.DIR_APP, exist_ok=True)
    h = logging.handlers.RotatingFileHandler(os.path.join(comum.DIR_APP, "servico.log"), maxBytes=200_000, backupCount=1, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(message)s", "%d/%m %H:%M:%S"))
    log.addHandler(h)
    log.setLevel(logging.INFO)

    _mutex = kernel32.CreateMutexW(None, False, "Local\\Reunioes.Servico")
    if kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        log.info("ja tem um servico rodando; saindo")
        return

    comtypes.CoInitialize()
    s = Servico()
    cfg = comum.config()
    atalho = Atalho(cfg.get("atalho"), s.alternar) if cfg.get("atalho") else None
    if atalho:
        atalho.start()
    log.info("servico iniciado")
    while True:
        try:
            app = s.passo()
            salvar_estado(gravarSozinho=comum.config()["gravarSozinho"], app=app, parandoEm=s.parando_em,
                          gravando=bool(s.minha) or gravando(), atalhoOk=atalho.ok if atalho else None)
        except Exception as e:  # noqa: BLE001  (erro passageiro de COM/processo nao pode derrubar o servico)
            log.exception("erro no laco: %s", e)
        time.sleep(PASSO)


if __name__ == "__main__":
    sys.exit(main())
