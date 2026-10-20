#!/usr/bin/env python3
"""Baixa os modelos que a transcricao usa e confere que tudo carrega. Roda no fim da instalacao
do motor (o app chama) e pode rodar de novo a qualquer hora: o que ja foi baixado e pulado.

Linhas que o app interpreta:
  [etapa] texto                 comecou uma etapa
  [progresso] feito total       bytes baixados / total da etapa atual
  [ok] texto | [erro] texto     resultado

Requer HF_HOME (pasta dos modelos) e, para separar vozes, HF_TOKEN.
"""
import os
import sys
import threading
import time

import comum

comum.utf8_stdout()
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")


def tamanho_pasta(p):
    t = 0
    for raiz, _, arqs in os.walk(p):
        for a in arqs:
            try:
                t += os.path.getsize(os.path.join(raiz, a))
            except OSError:
                pass
    return t


def baixar_com_progresso(repo, total_estimado=None, token=None, padroes=None):
    """snapshot_download numa thread; mede a pasta de cache para mostrar progresso.
    padroes limita os arquivos (repos de modelo costumam trazer o mesmo peso em 3 ou 4 formatos)."""
    from fnmatch import fnmatch

    from huggingface_hub import HfApi, snapshot_download

    try:
        info = HfApi().model_info(repo, files_metadata=True, token=token)
        total = sum((s.size or 0) for s in info.siblings
                    if not padroes or any(fnmatch(s.rfilename, p) for p in padroes)) or total_estimado
    except Exception:  # noqa: BLE001
        total = total_estimado
    pasta = os.path.join(os.environ["HF_HOME"], "hub", "models--" + repo.replace("/", "--"))
    antes = tamanho_pasta(pasta)
    erro = []

    def tarefa():
        try:
            snapshot_download(repo, token=token, allow_patterns=padroes)
        except Exception as e:  # noqa: BLE001
            erro.append(e)

    t = threading.Thread(target=tarefa, daemon=True)
    t.start()
    while t.is_alive():
        t.join(1.5)
        if total:
            feito = min(total, max(0, tamanho_pasta(pasta) - antes) if antes < total else total)
            print(f"[progresso] {feito} {total}", flush=True)
    if erro:
        raise erro[0]


ALINHAMENTO_HF = {  # o whisperx baixa do Hugging Face para estes idiomas (os demais vem do torchaudio)
    "pt": "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese",
    "ja": "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",
    "zh": "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn",
    "nl": "jonatasgrosman/wav2vec2-large-xlsr-53-dutch",
    "uk": "Yehor/wav2vec2-xls-r-300m-uk-with-small-lm",
    "ru": "jonatasgrosman/wav2vec2-large-xlsr-53-russian",
    "pl": "jonatasgrosman/wav2vec2-large-xlsr-53-polish",
}


def main():
    cfg = comum.config()
    token = os.environ.get("HF_TOKEN")

    print("[etapa] Conferindo o PyTorch", flush=True)
    import torch
    gpu = torch.cuda.is_available()
    print(f"[ok] PyTorch {torch.__version__}" + (f", GPU: {torch.cuda.get_device_name(0)}" if gpu else ", sem GPU (vai usar o processador)"), flush=True)

    print(f"[etapa] Baixando o modelo de transcrição ({cfg['modelo']})", flush=True)
    baixar_com_progresso(f"Systran/faster-whisper-{cfg['modelo']}")
    print("[ok] Modelo de transcrição pronto", flush=True)

    print("[etapa] Baixando o modelo de alinhamento de palavras", flush=True)
    import whisperx
    repo = ALINHAMENTO_HF.get(cfg["idioma"])
    if repo:
        # so o que o transformers carrega: pesos em safetensors + configuracoes/vocabulario
        baixar_com_progresso(repo, padroes=["*.json", "model.safetensors"])
    try:
        whisperx.load_align_model(language_code=cfg["idioma"], device="cpu")
        print("[ok] Alinhamento pronto", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[ok] Este idioma não tem alinhamento por palavra ({str(e).splitlines()[0][:80]}); a transcrição funciona igual", flush=True)

    if cfg["separarVozes"]:
        print("[etapa] Baixando o modelo que separa as vozes", flush=True)
        if not token:
            print("[erro] Falta o token do Hugging Face para separar as vozes", flush=True)
            return 2
        from whisperx.diarize import DiarizationPipeline
        DiarizationPipeline(token=token, device="cpu", cache_dir=os.environ.get("HF_HOME"))
        print("[ok] Separação de vozes pronta", flush=True)

    print("[etapa] Conferindo a gravação de áudio", flush=True)
    import pyaudiowpatch  # noqa: F401
    import pycaw  # noqa: F401
    print("[ok] Tudo pronto", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print(f"[erro] {type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}", flush=True)
        sys.exit(1)
