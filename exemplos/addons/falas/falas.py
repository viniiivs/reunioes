# Conta falas e palavras de cada pessoa. Entrada: JSON da reunião (stdin). Saída: markdown (stdout).
import json, re, sys

reuniao = json.load(sys.stdin)
conta = {}
for linha in reuniao["transcricao"].splitlines():
    m = re.match(r"^\*\*\[(\d\d:\d\d:\d\d)\] (.+?):\*\*\s*(.*)$", linha)
    if not m:
        continue
    tempo, quem, diz = m.groups()
    c = conta.setdefault(quem, {"falas": 0, "palavras": 0, "primeira": tempo})
    c["falas"] += 1
    c["palavras"] += len(diz.split())

total = sum(c["palavras"] for c in conta.values()) or 1
print("## Quem falou\n")
print("| Pessoa | Falas | Palavras | Parte da conversa | Primeira fala |")
print("|---|---|---|---|---|")
for quem, c in sorted(conta.items(), key=lambda x: -x[1]["palavras"]):
    print(f"| {quem} | {c['falas']} | {c['palavras']} | {100 * c['palavras'] / total:.0f}% | [{c['primeira']}] |")
