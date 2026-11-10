r"""Prints do README (docs/*.png) com os dados fictícios do simulador da ponte.
Uso: py build\prints.py [versão]   (padrão: a última tag vX.Y.Z do git)"""
import sys, http.server, threading, os, subprocess
from playwright.sync_api import sync_playwright
AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.join(AQUI, "..", "app", "wwwroot"); OUT = os.path.join(AQUI, "..", "docs")
VERSAO = sys.argv[1] if len(sys.argv) > 1 else subprocess.run(
    ["git", "describe", "--tags", "--abbrev=0"], capture_output=True, text=True, cwd=AQUI).stdout.strip().lstrip("v")
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=RAIZ, **k)
    def log_message(s, *a): pass
    def do_GET(s):
        if s.path.split("?")[0] == "/ponte.js":   # simulador mostra a versão publicada (sem mexer no repo)
            d = open(os.path.join(RAIZ, "ponte.js"), encoding="utf-8").read().replace('"1.0.0"', f'"{VERSAO}"').encode()
            s.send_response(200); s.send_header("Content-Type", "text/javascript"); s.send_header("Content-Length", len(d)); s.end_headers(); s.wfile.write(d); return
        super().do_GET()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
U = "http://127.0.0.1:8765/"
with sync_playwright() as p:
    b = p.chromium.launch()
    pag = lambda w, h: b.new_page(viewport={"width": w, "height": h}, color_scheme="dark")
    pg = pag(1260, 440); pg.goto(U + "index.html"); pg.wait_for_timeout(1500); pg.screenshot(path=f"{OUT}/lista.png")
    def leitor(aba, nome, h):
        pg = pag(1260, h); pg.goto(U + "index.html?addons"); pg.wait_for_timeout(1500)
        pg.locator("button", has_text="Ler").first.click(); pg.wait_for_timeout(1200)
        fr = next(f for f in pg.frames if "leitor.html" in f.url)
        fr.get_by_role("tab", name=aba).or_(fr.locator("button", has_text=aba)).first.click(); pg.wait_for_timeout(1000)
        pg.screenshot(path=f"{OUT}/{nome}.png")
    leitor("Resumo", "resumo", 720)
    leitor("Ata formal", "addon", 760)
    pg = pag(1100, 700); pg.goto(U + "config.html?modo=setup"); pg.wait_for_timeout(1500); pg.screenshot(path=f"{OUT}/assistente.png")
    b.close()
srv.shutdown()
