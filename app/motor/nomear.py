#!/usr/bin/env python3
"""Da nome as vozes de uma reuniao e memoriza a voz para as proximas.

Uso:  nomear.py <nome-da-reuniao> "Falante 1=Ana" "Falante 2=Bruno"

- troca o rotulo na .transcricao.md / .json desta reuniao
- guarda o embedding da voz em pessoas.json (cada reuniao nomeada melhora o reconhecimento)
"""
import json
import os
import re
import sys

import comum


def main():
    comum.utf8_stdout()
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    base = comum.base_de(sys.argv[1])
    fal = json.load(open(base + ".falantes.json", encoding="utf-8"))
    rotulo_para_spk = {v: k for k, v in fal["nomes"].items()}
    try:
        pessoas = json.load(open(comum.PESSOAS, encoding="utf-8"))
    except (OSError, ValueError):
        pessoas = {}

    trocas = {}
    for arg in sys.argv[2:]:
        antigo, _, novo = (x.strip() for x in arg.partition("="))
        spk = rotulo_para_spk.get(antigo)
        if not spk or not novo:
            raise SystemExit(f"[erro] '{arg}': rotulos desta reuniao sao {list(rotulo_para_spk)}")
        trocas[antigo] = novo
        fal["nomes"][spk] = novo
        if spk in fal["embeddings"]:
            pessoas.setdefault(novo, []).append(fal["embeddings"][spk])
            pessoas[novo] = pessoas[novo][-10:]  # guarda as 10 amostras mais recentes
        print(f"  {antigo} -> {novo}")

    os.makedirs(os.path.dirname(comum.PESSOAS), exist_ok=True)
    json.dump(pessoas, open(comum.PESSOAS, "w", encoding="utf-8"))
    json.dump(fal, open(base + ".falantes.json", "w", encoding="utf-8"))

    padrao = "|".join(re.escape(k) for k in sorted(trocas, key=len, reverse=True))
    for ext in (".transcricao.md", ".transcricao.json"):
        p = base + ext
        if os.path.exists(p):
            txt = open(p, encoding="utf-8").read()
            # so troca rotulos inteiros ("Falante 1" nao pode virar parte de "Falante 10")
            txt = re.sub(r"(?<![\w])(" + padrao + r")(?![\w])", lambda m: trocas[m.group(1)], txt)
            open(p, "w", encoding="utf-8").write(txt)
    print(f"[pronto] {len(trocas)} voz(es) memorizada(s)")


if __name__ == "__main__":
    main()
