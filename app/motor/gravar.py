#!/usr/bin/env python3
"""Grava uma reuniao em dois arquivos separados, direto em FLAC (sem perda):

  <nome>.eu.flac     -> seu microfone        (tudo aqui e voce)
  <nome>.outros.flac -> audio do sistema     (loopback: o que o app da reuniao toca)

Para quando aparece <nome>.parar na pasta (o app e o atalho fazem isso) ou com Ctrl+C.
Ao parar, gera <nome>.sha256 com o hash dos dois arquivos e <nome>.apps.json.

Uso:  gravar.py [nome]          (padrao: data-hora)
      gravar.py --listar        (mostra os dispositivos)
      gravar.py --mic "USB" --saida "Fone"   (parte do nome; padrao: o da configuracao do app,
                                              senao o dispositivo padrao do Windows)

A pasta das gravacoes vem da configuracao do app (comum.py).
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import queue
import sys
import threading
import time

import numpy as np
import pyaudiowpatch as pa
import soundfile as sf

import comum  # noqa: E402


class Canal:
    """Um dispositivo -> um FLAC mono. O loopback do WASAPI nao entrega nada enquanto o
    sistema esta em silencio; para os dois arquivos ficarem alinhados no tempo, os buracos
    sao preenchidos com zeros pelo relogio de parede."""

    def __init__(self, p, info, caminho):
        self.taxa = int(info["defaultSampleRate"])
        self.canais = max(1, min(2, info["maxInputChannels"]))
        self.fila = queue.Queue()
        self.arq = sf.SoundFile(caminho, "w", samplerate=self.taxa, channels=1,
                                format="FLAC", subtype="PCM_16")
        self.escrito = 0
        self.pico = 0
        self.stream = p.open(format=pa.paInt16, channels=self.canais, rate=self.taxa,
                             input=True, input_device_index=info["index"],
                             frames_per_buffer=self.taxa // 20, stream_callback=self._cb)

    def _cb(self, dados, n, _t, _s):
        self.fila.put(dados)
        return (None, pa.paContinue)

    def bombear(self, decorrido):
        veio = False
        while True:
            try:
                d = self.fila.get_nowait()
            except queue.Empty:
                break
            x = np.frombuffer(d, dtype=np.int16).reshape(-1, self.canais)
            x = x.mean(axis=1).astype(np.int16) if self.canais > 1 else x[:, 0]
            self.arq.write(x)
            self.escrito += len(x)
            self.pico = max(self.pico, int(np.abs(x.astype(np.int32)).max(initial=0)))
            veio = True
        falta = int(decorrido * self.taxa) - self.escrito
        if not veio and falta > self.taxa * 0.3:  # silencio de verdade, nao so atraso
            z = falta - self.taxa // 10
            self.arq.write(np.zeros(z, dtype=np.int16))
            self.escrito += z

    def fechar(self):
        self.stream.stop_stream()
        self.stream.close()
        self.bombear(self.escrito / self.taxa)
        self.arq.close()


class MonitorApps(threading.Thread):
    """Anota quais apps estao tocando som enquanto grava (o loopback mistura tudo, entao
    depois nao da para separar). A cada 2 s le o medidor de pico de cada sessao de audio
    do Windows; app com pico > 0 soma 2 s. Qualquer falha aqui e engolida: nunca pode
    derrubar a gravacao."""

    PASSO = 2.0

    def __init__(self):
        super().__init__(daemon=True)
        self.segundos = {}
        self.parar = threading.Event()

    def run(self):
        try:
            import comtypes
            from pycaw.pycaw import AudioUtilities, IAudioMeterInformation
            comtypes.CoInitialize()
        except Exception:
            return
        while not self.parar.wait(self.PASSO):
            try:
                for s in AudioUtilities.GetAllSessions():
                    if not s.Process or s.Process.pid == os.getpid():  # o proprio gravador
                        continue
                    pico = s._ctl.QueryInterface(IAudioMeterInformation).GetPeakValue()
                    if pico > 0.001:
                        nome = s.Process.name()
                        self.segundos[nome] = self.segundos.get(nome, 0) + self.PASSO
            except Exception:
                pass

    def salvar(self, caminho):
        self.parar.set()
        try:
            apps = sorted(({"exe": k, "segundos": int(v)} for k, v in self.segundos.items()),
                          key=lambda a: -a["segundos"])
            with open(caminho, "w", encoding="utf-8") as f:
                json.dump({"apps": apps}, f, ensure_ascii=False, indent=1)
        except Exception:
            pass


def achar(lista, trecho, padrao):
    if not trecho:
        return padrao
    for d in lista:
        if trecho.lower() in d["name"].lower():
            return d
    raise SystemExit(f"[erro] dispositivo com '{trecho}' nao encontrado. Use --listar.")


def achar_ou_padrao(lista, trecho, padrao):
    try:
        return achar(lista, trecho, padrao)
    except SystemExit:
        print(f"[aviso] '{trecho}' nao esta conectado; usando o padrao do Windows", flush=True)
        return padrao


def sha256(caminho):
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("nome", nargs="?")
    ap.add_argument("--mic", help="parte do nome do microfone")
    ap.add_argument("--saida", help="parte do nome da saida de audio a capturar")
    ap.add_argument("--duracao", type=float, help="para sozinho apos N segundos")
    ap.add_argument("--listar", action="store_true")
    a = ap.parse_args()
    comum.utf8_stdout()
    cfg = comum.config()

    p = pa.PyAudio()
    w = p.get_host_api_info_by_type(pa.paWASAPI)
    todos = [p.get_device_info_by_index(i) for i in range(p.get_device_count())]
    mics = [d for d in todos if d["hostApi"] == w["index"] and d["maxInputChannels"] > 0
            and not d.get("isLoopbackDevice")]
    loops = list(p.get_loopback_device_info_generator())
    mic_pad = p.get_device_info_by_index(w["defaultInputDevice"])
    saida_pad = p.get_device_info_by_index(w["defaultOutputDevice"])
    loop_pad = next((d for d in loops if d["name"].startswith(saida_pad["name"])), None)

    if a.listar:
        print("Microfones:")
        for d in mics:
            print("  ", d["name"])
        print("Saidas (loopback):")
        for d in loops:
            print("  ", d["name"].replace(" [Loopback]", ""))
        print(f"\nPadrao: mic='{mic_pad['name']}'  saida='{saida_pad['name']}'")
        return

    # Dispositivo da configuracao que sumiu (fone desplugado) cai no padrao do Windows em vez de falhar.
    mic = achar(mics, a.mic, mic_pad) if a.mic else achar_ou_padrao(mics, cfg.get("mic"), mic_pad)
    loop = achar(loops, a.saida, loop_pad) if a.saida else achar_ou_padrao(loops, cfg.get("saida"), loop_pad)
    if loop is None:
        raise SystemExit("[erro] saida padrao sem loopback. Use --saida.")

    pasta = comum.pasta_gravacoes()
    nome = a.nome or dt.datetime.now().strftime("%Y-%m-%d_%H-%M")
    base = os.path.join(pasta, nome)
    arq_eu, arq_outros = base + ".eu.flac", base + ".outros.flac"
    if os.path.exists(arq_eu):
        raise SystemExit(f"[erro] ja existe: {arq_eu}")

    print(f"[mic]   {mic['name']}\n[saida] {loop['name']}\n[grava] {base}.*.flac")
    canais = [Canal(p, mic, arq_eu), Canal(p, loop, arq_outros)]
    apps = MonitorApps()
    apps.start()
    inicio = dt.datetime.now().astimezone()
    t0 = time.monotonic()
    print(f"[inicio] {inicio.isoformat(timespec='seconds')}  --  Ctrl+C para parar\n")
    try:
        while True:
            time.sleep(0.1)
            dec = time.monotonic() - t0
            for c in canais:
                c.bombear(dec)
            if (a.duracao and dec >= a.duracao) or os.path.exists(base + ".parar"):
                break
            s = int(dec)
            if s % 10 == 0 and int(dec - 0.1) != s:  # a cada 10 s: tempo + pico de cada canal
                niveis = "  ".join(f"{n}={c.pico * 100 // 32767}%" for n, c in zip(("eu", "outros"), canais))
                print(f"  {s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}  {niveis}", flush=True)
                for c in canais:
                    c.pico = 0
    except KeyboardInterrupt:
        pass
    for c in canais:
        c.fechar()
    p.terminate()
    apps.salvar(base + ".apps.json")
    if os.path.exists(base + ".parar"):
        os.remove(base + ".parar")
    fim = dt.datetime.now().astimezone()

    with open(base + ".sha256", "w", encoding="utf-8") as f:
        f.write(f"# inicio {inicio.isoformat(timespec='seconds')}  fim {fim.isoformat(timespec='seconds')}\n")
        f.write(f"# mic: {mic['name']} | saida: {loop['name']}\n")
        for arq in (arq_eu, arq_outros):
            f.write(f"{sha256(arq)}  {os.path.basename(arq)}\n")
    print(f"\n[pronto] {base}.eu.flac / .outros.flac / .sha256")


if __name__ == "__main__":
    sys.exit(main())
