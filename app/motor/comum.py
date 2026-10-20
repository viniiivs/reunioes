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


def utf8_stdout():
    """Saida em UTF-8 mesmo quando o app le pelo pipe (o console do Windows usaria cp1252)."""
    if sys.stdout is not None:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
