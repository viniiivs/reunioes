"""Configuracao compartilhada pelos scripts do motor.

O app grava %APPDATA%\\Reunioes\\config.json; os scripts so leem. REUNIOES_CONFIG troca o caminho
(util para testes). Nada aqui conhece pastas fixas: tudo sai da configuracao.
"""
import io
import json
import os
import sys

DIR_APP = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "Reunioes")
ARQ_CONFIG = os.environ.get("REUNIOES_CONFIG") or os.path.join(DIR_APP, "config.json")
PESSOAS = os.path.join(DIR_APP, "pessoas.json")          # vozes memorizadas (nomear.py)
ESTADO_SERVICO = os.path.join(DIR_APP, "servico.estado.json")

PADRAO = {
    "pastaGravacoes": os.path.join(os.path.expanduser("~"), "Documents", "Reunioes"),
    "idioma": "pt",
    "modelo": "large-v3",
    "usarGpu": True,
    "separarVozes": False,
    "mic": None,
    "saida": None,
    "gravarSozinho": True,
    "atalho": "ctrl+alt+g",
}


def config():
    c = dict(PADRAO)
    try:
        with open(ARQ_CONFIG, encoding="utf-8-sig") as f:
            c.update({k: v for k, v in json.load(f).items() if v is not None or k in ("mic", "saida")})
    except (OSError, ValueError):
        pass
    return c


def pasta_gravacoes():
    p = config()["pastaGravacoes"]
    os.makedirs(p, exist_ok=True)
    return p


def base_de(nome, criar=False):
    """Caminho base dos arquivos de uma gravacao: <pasta>/<nome>/<nome> (uma subpasta por gravacao).
    Gravacoes antigas, soltas na raiz (<pasta>/<nome>.*), continuam funcionando ate o app migrar."""
    raiz = pasta_gravacoes()
    sub = os.path.join(raiz, nome)
    if criar:
        os.makedirs(sub, exist_ok=True)
    elif not os.path.isdir(sub) and os.path.exists(os.path.join(raiz, nome + ".eu.flac")):
        return os.path.join(raiz, nome)
    return os.path.join(sub, nome)


def gravacoes_abertas():
    """Bases das gravacoes sem .sha256 (= o gravador ainda esta escrevendo)."""
    raiz = pasta_gravacoes()
    r = []
    for n in os.listdir(raiz):
        cand = [os.path.join(raiz, n, n)] if os.path.isdir(os.path.join(raiz, n)) else (
            [os.path.join(raiz, n[:-len(".eu.flac")])] if n.endswith(".eu.flac") else [])
        r += [b for b in cand if os.path.exists(b + ".eu.flac") and not os.path.exists(b + ".sha256")]
    return r


ALINHAMENTO_HF = {  # o whisperx baixa do Hugging Face para estes idiomas (os demais vem do torchaudio)
    "pt": "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese",
    "ja": "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",
    "zh": "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn",
    "nl": "jonatasgrosman/wav2vec2-large-xlsr-53-dutch",
    "uk": "Yehor/wav2vec2-xls-r-300m-uk-with-small-lm",
    "ru": "jonatasgrosman/wav2vec2-large-xlsr-53-russian",
    "pl": "jonatasgrosman/wav2vec2-large-xlsr-53-polish",
}
# So o que o transformers usa. Esses repos tem o peso em 3 formatos (+1,2 GB de modelo de linguagem).
PADROES_ALINHAMENTO = ["*.json", "pytorch_model.bin"]


def alinhamento_local(idioma):
    """Pasta local do modelo de alinhamento, se ja baixado. Carregar pela pasta (e nao pelo nome do
    repo) impede o transformers de baixar de novo uma copia convertida em safetensors (+1,2 GB)."""
    repo = ALINHAMENTO_HF.get(idioma)
    if not repo:
        return None
    try:
        from huggingface_hub import snapshot_download
        return snapshot_download(repo, allow_patterns=PADROES_ALINHAMENTO, local_files_only=True)
    except Exception:  # noqa: BLE001
        return None


def utf8_stdout():
    """Saida em UTF-8 mesmo quando o app le pelo pipe (o console do Windows usaria cp1252)."""
    if sys.stdout is not None:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
