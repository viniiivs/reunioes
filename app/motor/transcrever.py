#!/usr/bin/env python3
"""Transcreve uma reuniao gravada pelo gravar.py, 100% local.

  <nome>.eu.flac     -> transcrito e rotulado "Eu" (sem separar vozes: o canal ja e seu)
  <nome>.outros.flac -> transcrito; com "separar vozes" ligado, cada pessoa vira um falante
                        (pyannote community-1) e vozes ja nomeadas sao reconhecidas

Saidas na pasta das gravacoes:
  <nome>.transcricao.md   linha do tempo legivel "**[hh:mm:ss] Quem:** fala"
  <nome>.transcricao.json falas + segmentos com tempo e falante
  <nome>.falantes.json    embedding de cada falante desta reuniao (usado pelo nomear.py)

Pausar = matar o processo. Cada etapa pronta fica em <nome>.parcial.<etapa>.json; rodar de novo
retoma dali (se o modelo e o idioma forem os mesmos) e os parciais somem quando termina.

Uso:  transcrever.py <nome> [--falantes N]
Idioma, modelo, GPU e separacao de vozes vem da configuracao do app. O token do
Hugging Face (para separar vozes) vem da variavel HF_TOKEN, que o app passa.
"""
import argparse
import gc
import json
import os
import subprocess
import threading
import time

import comum

comum.utf8_stdout()
comum.log_proprio()
LIMIAR = 0.55  # similaridade de cosseno minima para reconhecer uma voz conhecida

import numpy as np  # noqa: E402
import torch  # noqa: E402  (importar antes do whisperx expoe cublas/cudnn do torch ao ctranslate2)
import whisperx  # noqa: E402
from huggingface_hub.errors import LocalEntryNotFoundError  # noqa: E402


def hms(s):
    s = int(s)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def liberar():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


class Progresso:
    """Porcentagem da transcricao inteira (todas as etapas), para a lista mostrar "Transcrevendo 42%".
    Cada etapa pesa o quanto costuma demorar; etapa ja pronta (retomada) conta como feita.
    Imprime "[pct] N" so quando o numero sobe."""

    def __init__(self, pesos):
        self.total, self.feito, self.ultimo = sum(pesos), 0.0, -1

    def etapa(self, peso):
        """Reserva o peso da etapa e devolve o callback dela, que recebe a fracao feita (0 a 1)."""
        ini = self.feito
        self.feito += peso
        return lambda f: self._mostrar(ini + peso * min(max(f, 0.0), 1.0))

    def _mostrar(self, v):
        n = min(99, int(v / self.total * 100))   # 100 so quando o arquivo final estiver escrito
        if n > self.ultimo:
            self.ultimo = n
            print(f"[pct] {n}", flush=True)


PESO_ASR, PESO_VOZES = 1.0, 0.5   # cada canal transcrito; separar as vozes (pyannote) leva cerca da metade
FATIA_ALINHAR = 0.2               # dentro de uma transcricao: 80% reconhecer a fala, 20% alinhar as palavras


def carregar(modelo, device, ct, idioma):
    """Usa o modelo ja baixado sem consultar o Hugging Face (a consulta online levava ~2 min por carga).
    So vai a internet se ele ainda nao estiver na pasta de modelos."""
    kw = {"compute_type": ct, "language": idioma, "asr_options": {"beam_size": 5}}
    try:
        return whisperx.load_model(modelo, device, local_files_only=True, **kw)
    except LocalEntryNotFoundError:
        return whisperx.load_model(modelo, device, **kw)


class Transbordou(Exception):
    """A placa passou a usar a memoria do PC: o modo atual nao cabe mais."""


class Vigia:
    """Sem folga na placa, o driver da NVIDIA empresta a memoria do PC em vez de dar erro, e tudo fica
    dezenas de vezes mais lento (parece travado). De 20 em 20 s, mede quanto este processo pegou
    emprestado (contador "GPU Process Memory" do Windows); duas medidas seguidas acima do limite =
    transbordou, e conferir() interrompe a etapa para ela continuar num modo mais leve."""

    LIMITE_GB = 1.0   # normal fica abaixo de 0,2 GB; transbordando passou de 2,5 GB

    def __init__(self):
        self.emprestado, self.seguidas = 0.0, 0
        if os.name == "nt":
            threading.Thread(target=self._rodar, daemon=True).start()

    def medir(self):
        cmd = (f"$s = (Get-Counter '\\GPU Process Memory(pid_{os.getpid()}_*)\\Shared Usage' -EA Stop).CounterSamples;"
               " [int64](($s | Measure-Object CookedValue -Sum).Sum)")
        try:
            out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd], capture_output=True,
                                 text=True, timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
            gb = int(out.strip() or 0) / 2**30
        except (OSError, ValueError, subprocess.SubprocessError):
            gb = 0.0   # sem contador (outro Windows, sem permissao): nao vigia
        self.emprestado = gb
        self.seguidas = self.seguidas + 1 if gb > self.LIMITE_GB else 0
        return gb

    def _rodar(self):
        while True:
            time.sleep(20)
            self.medir()

    def conferir(self):
        if self.seguidas >= 2:
            self.seguidas = 0
            raise Transbordou(f"a placa pegou {self.emprestado:.1f} GB da memoria do PC")

    def zerar(self):
        self.seguidas = 0


vigia = Vigia()


def modos(device):
    """(device, compute_type, lote) em ordem de preferencia, pela memoria livre na placa agora; o ultimo
    e sempre o processador (lento, mas nunca trava). Medido numa GTX 1660 SUPER de 6 GB com ~3 GB livres
    (26/10/2026), 5 min de audio: float16 lote 8 transbordou e nao terminou em 6 min; int8_float16
    lote 4 levou 40 s, mesmo texto. REUNIOES_MODOS="float16:8,int8_float16:4" forca a lista (testes)."""
    forcado = os.environ.get("REUNIOES_MODOS")
    if forcado:
        return [(device, ct, int(lote)) for ct, lote in (x.split(":") for x in forcado.split(","))] + [("cpu", "int8", 4)]
    if device != "cuda":
        return [("cpu", "int8", 4)]
    livre = torch.cuda.mem_get_info()[0] / 2**30
    if livre >= 8:
        gpu = [("float16", 8), ("int8_float16", 4), ("int8", 2)]
    elif livre >= 6:
        gpu = [("int8_float16", 8), ("int8_float16", 4), ("int8", 2)]
    else:
        gpu = [("int8_float16", 4), ("int8", 2)]
    return [("cuda", ct, lote) for ct, lote in gpu] + [("cpu", "int8", 4)]


def na_placa_ou_no_processador(device, fazer, nome):
    """Roda fazer(device); se a placa transbordar no meio, refaz no processador."""
    try:
        return fazer(device)
    except Transbordou as e:
        if device == "cpu":
            raise
        print(f"  [aviso] {nome}: {e}; continuando no processador", flush=True)
        liberar()
        vigia.zerar()
        return fazer("cpu")


def asr(audio, modelo, device, idioma, avancar=lambda f: None):
    """Transcreve + alinha palavra a palavra. Escolhe o modo que cabe na placa e passa para o seguinte
    se a GPU reclamar ou transbordar. avancar(f) recebe o andamento desta transcricao, de 0 a 1."""
    avancar(0)
    tentativas = modos(device)
    r = None

    def andou(p):
        vigia.conferir()
        avancar(p / 100 * (1 - FATIA_ALINHAR))

    for i, (dev, ct, lote) in enumerate(tentativas):
        m = None
        try:
            vigia.zerar()
            m = carregar(modelo, dev, ct, idioma)
            if dev == "cuda" and vigia.medir() > Vigia.LIMITE_GB:   # ja carregou transbordando
                raise Transbordou(f"o modelo nao coube na placa ({vigia.emprestado:.1f} GB na memoria do PC)")
            r = m.transcribe(audio, batch_size=lote, language=idioma, progress_callback=andou)
            print(f"  [asr] {modelo} / {dev} / {ct} / lote {lote}", flush=True)
            break
        except Exception as e:  # noqa: BLE001
            if i == len(tentativas) - 1:
                raise
            print(f"  [aviso] {dev} {ct} lote {lote} falhou ({str(e).splitlines()[0][:100]}), tentando o proximo", flush=True)
        finally:
            del m
            liberar()

    def alinhar(dev):
        vigia.zerar()
        al, meta = whisperx.load_align_model(language_code=idioma, device=dev, model_name=comum.alinhamento_local(idioma))

        def andou_al(p):
            vigia.conferir()
            avancar(1 - FATIA_ALINHAR + p / 100 * FATIA_ALINHAR)
        try:
            return whisperx.align(r["segments"], al, meta, audio, dev, return_char_alignments=False,
                                  progress_callback=andou_al)
        finally:
            del al
            liberar()
    try:
        r = na_placa_ou_no_processador(device, alinhar, "alinhamento")
    except Exception as e:  # noqa: BLE001  (idioma sem modelo de alinhamento: fica sem tempo por palavra)
        print(f"  [aviso] sem alinhamento por palavra: {str(e).splitlines()[0][:100]}", flush=True)
    liberar()
    avancar(1)
    return r


def ler_parcial(base, etapa, chave):
    """Resultado de uma etapa ja feita numa execucao anterior (pausada), ou None."""
    try:
        with open(f"{base}.parcial.{etapa}.json", encoding="utf-8") as f:
            d = json.load(f)
        return d["r"] if d.get("chave") == chave else None
    except (OSError, ValueError, KeyError):
        return None


def salvar_parcial(base, etapa, chave, r):
    tmp = f"{base}.parcial.{etapa}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"chave": chave, "r": r}, f, ensure_ascii=False, default=float)
    os.replace(tmp, f"{base}.parcial.{etapa}.json")   # atomico: pausar no meio da escrita nao corrompe


def cos(a, b):
    a, b = np.asarray(a), np.asarray(b)
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def reconhecer(embeddings):
    """SPEAKER_00 -> nome, comparando com as vozes ja nomeadas (pessoas.json)."""
    try:
        conhecidas = json.load(open(comum.PESSOAS, encoding="utf-8"))
    except (OSError, ValueError):
        conhecidas = {}
    nomes, usados = {}, set()
    pares = sorted(((cos(e, ref), spk, nome)
                    for spk, e in embeddings.items()
                    for nome, refs in conhecidas.items() for ref in refs), reverse=True)
    for sim, spk, nome in pares:
        if sim < LIMIAR:
            break
        if spk not in nomes and nome not in usados:
            nomes[spk] = nome
            usados.add(nome)
            print(f"  [voz] {spk} reconhecido como {nome} (sim={sim:.2f})", flush=True)
    n = 0
    for spk in sorted(embeddings):
        if spk not in nomes:
            n += 1
            nomes[spk] = f"Falante {n}"
    return nomes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("nome")
    ap.add_argument("--falantes", type=int, help="quantas pessoas ALEM de voce (se souber)")
    a = ap.parse_args()
    cfg = comum.config()

    base = comum.base_de(a.nome)
    arq_eu, arq_outros = base + ".eu.flac", base + ".outros.flac"
    if not os.path.exists(arq_outros):
        raise SystemExit(f"[erro] nao achei {arq_outros}")

    idioma = cfg["idioma"]
    modelo = cfg["modelo"]
    device = "cuda" if cfg["usarGpu"] and torch.cuda.is_available() else "cpu"
    print(f"[device] {device}" + (f" ({torch.cuda.get_device_name(0)})" if device == "cuda" else ""), flush=True)

    token = os.environ.get("HF_TOKEN")
    separar = cfg["separarVozes"] and bool(token)
    if cfg["separarVozes"] and not token:
        print("[aviso] separar vozes esta ligado mas falta o token do Hugging Face; todos viram 'Outros'", flush=True)
    etapas = 3 if separar else 2

    chave = {"modelo": modelo, "idioma": idioma}
    tem_eu = os.path.exists(arq_eu)
    prog = Progresso([PESO_ASR] * (2 if tem_eu else 1) + ([PESO_VOZES] if separar else []))
    falas = []  # (inicio, fim, quem, texto)
    if tem_eu:
        avancar = prog.etapa(PESO_ASR)
        eu = ler_parcial(base, "eu", chave)
        if eu is None:
            print(f"[1/{etapas}] transcrevendo seu microfone", flush=True)
            r = asr(whisperx.load_audio(arq_eu), modelo, device, idioma, avancar)
            eu = [[s["start"], s["end"], s["text"].strip()] for s in r["segments"]]
            salvar_parcial(base, "eu", chave, eu)
        else:
            print(f"[1/{etapas}] seu microfone (ja estava pronto)", flush=True)
            avancar(1)
        falas += [(i, e, "Eu", t) for i, e, t in eu]

    audio = whisperx.load_audio(arq_outros)
    avancar = prog.etapa(PESO_ASR)
    r = ler_parcial(base, "outros", chave)
    if r is None:
        print(f"[2/{etapas}] transcrevendo os outros", flush=True)
        r = asr(audio, modelo, device, idioma, avancar)
        salvar_parcial(base, "outros", chave, r)
    else:
        print(f"[2/{etapas}] os outros (ja estava pronto)", flush=True)
        avancar(1)

    nomes, emb = {}, {}
    if separar:
        print(f"[3/{etapas}] separando as vozes", flush=True)
        avancar = prog.etapa(PESO_VOZES)
        avancar(0)
        from whisperx.diarize import DiarizationPipeline
        kw = {"num_speakers": a.falantes} if a.falantes else {}

        def separar_vozes(dev):
            vigia.zerar()
            dz = DiarizationPipeline(token=token, device=dev, cache_dir=os.environ.get("HF_HOME"))

            def andou(p):
                vigia.conferir()
                avancar(p / 100)
            try:
                return dz(audio, return_embeddings=True, progress_callback=andou, **kw)
            finally:
                del dz
                liberar()
        df, emb = na_placa_ou_no_processador(device, separar_vozes, "separar vozes")
        r = whisperx.assign_word_speakers(df, r)
        emb = emb or {}
        nomes = reconhecer(emb)
    for s in r["segments"]:
        quem = nomes.get(s.get("speaker"), "Desconhecido") if separar else "Outros"
        s["quem"] = quem
        falas.append((s["start"], s["end"], quem, s["text"].strip()))

    falas.sort()
    # junta falas consecutivas da mesma pessoa
    blocos = []
    for ini, fim, quem, txt in falas:
        if not txt:
            continue
        if blocos and blocos[-1][2] == quem and ini - blocos[-1][1] < 2.0:
            blocos[-1][1], blocos[-1][3] = fim, blocos[-1][3] + " " + txt
        else:
            blocos.append([ini, fim, quem, txt])

    with open(base + ".transcricao.md", "w", encoding="utf-8") as f:
        f.write(f"# Reuniao {a.nome}\n\n")
        for ini, _, quem, txt in blocos:
            f.write(f"**[{hms(ini)}] {quem}:** {txt}\n\n")
    with open(base + ".transcricao.json", "w", encoding="utf-8") as f:
        json.dump({"falas": [dict(inicio=i, fim=e, quem=q, texto=t) for i, e, q, t in blocos],
                   "outros_segmentos": r["segments"], "nomes": nomes}, f, ensure_ascii=False, indent=1,
                  default=float)
    if separar:
        with open(base + ".falantes.json", "w", encoding="utf-8") as f:
            json.dump({"nomes": nomes, "embeddings": emb}, f)
    for etapa in ("eu", "outros"):
        try:
            os.remove(f"{base}.parcial.{etapa}.json")
        except OSError:
            pass

    print(f"\n[pronto] {base}.transcricao.md", flush=True)


if __name__ == "__main__":
    main()
