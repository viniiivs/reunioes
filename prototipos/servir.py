"""Servidor local dos protótipos, sem cache (cada recarga pega os arquivos atuais).
Uso: py prototipos\\servir.py   (na raiz do projeto) e abra http://127.0.0.1:8767/prototipos/componentes.html"""
import http.server
import os

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class SemCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8767), SemCache).serve_forever()
