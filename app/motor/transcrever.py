#!/usr/bin/env python3
"""Transcreve uma reuniao gravada pelo gravar.py, 100% local.

  <nome>.eu.flac     -> transcrito e rotulado "Eu" (sem separar vozes: o canal ja e seu)
  <nome>.outros.flac -> transcrito; com "separar vozes" ligado, cada pessoa vira um falante
                        (pyannote community-1) e vozes ja nomeadas sao reconhecidas

Saidas na pasta das gravacoes:
  <nome>.transcricao.md   linha do tempo legivel "**[hh:mm:ss] Quem:** fala"
  <nome>.transcricao.json falas + segmentos com tempo e falante
  <nome>.falantes.json    embedding de cada falante desta reuniao (usado pelo nomear.py)

Uso:  transcrever.py <nome> [--falantes N]
Idioma, modelo, GPU e separacao de vozes vem da configuracao do app. O token do
Hugging Face (para separar vozes) vem da variavel HF_TOKEN, que o app passa.
"""
import argparse
import gc
import json
import os

import comum

comum.utf8_stdout()
LIMIAR = 0.55  # similaridade de cosseno minima para reconhecer uma voz conhecida

import numpy as np  # noqa: E402
import torch  # noqa: E402  (importar antes do whisperx expoe cublas/cudnn do torch ao ctranslate2)
import whisperx  # noqa: E402


def hms(s):
    s = int(s)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def liberar():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def asr(audio, modelo, device, idioma):
    """Transcreve + alinha palavra a palavra. Tenta float16 e cai para int8 se a GPU reclamar."""
    tipos = ("float16", "int8_float16", "int8") if device == "cuda" else ("int8",)
    r = None
    for i, ct in enumerate(tipos):
        m = None
        try:
            m = whisperx.load_model(modelo, device, compute_type=ct, language=idioma,
                                    asr_options={"beam_size": 5})
            r = m.transcribe(audio, batch_size=8 if device == "cuda" else 4, language=idioma)
            print(f"  [asr] {modelo} / {device} / {ct}", flush=True)
            break
        except Exception as e:  # noqa: BLE001
            if i == len(tipos) - 1:
                raise
            print(f"  [aviso] {ct} falhou ({str(e).splitlines()[0][:100]}), tentando o proximo", flush=True)
        finally:
            del m
            liberar()
    try:
        al, meta = whisperx.load_align_model(language_code=idioma, device=device)
        r = whisperx.align(r["segments"], al, meta, audio, device, return_char_alignments=False)
        del al
    except Exception as e:  # noqa: BLE001  (idioma sem modelo de alinhamento: fica sem tempo por palavra)
        print(f"  [aviso] sem alinhamento por palavra: {str(e).splitlines()[0][:100]}", flush=True)
    liberar()
    return r


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

    base = os.path.join(comum.pasta_gravacoes(), a.nome)
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

    falas = []  # (inicio, fim, quem, texto)
    if os.path.exists(arq_eu):
        print(f"[1/{etapas}] transcrevendo seu microfone", flush=True)
        r = asr(whisperx.load_audio(arq_eu), modelo, device, idioma)
        falas += [(s["start"], s["end"], "Eu", s["text"].strip()) for s in r["segments"]]

    print(f"[2/{etapas}] transcrevendo os outros", flush=True)
    audio = whisperx.load_audio(arq_outros)
    r = asr(audio, modelo, device, idioma)

    nomes, emb = {}, {}
    if separar:
        print(f"[3/{etapas}] separando as vozes", flush=True)
        from whisperx.diarize import DiarizationPipeline
        dz = DiarizationPipeline(token=token, device=device, cache_dir=os.environ.get("HF_HOME"))
        kw = {"num_speakers": a.falantes} if a.falantes else {}
        df, emb = dz(audio, return_embeddings=True, **kw)
        del dz
        liberar()
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

    print(f"\n[pronto] {base}.transcricao.md", flush=True)


if __name__ == "__main__":
    main()
