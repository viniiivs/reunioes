// Service worker da versão web:
// 1. Funciona offline: as páginas vêm da rede quando há (versão nova chega sozinha) e do cache quando não.
//    A biblioteca de IA (CDN, URL com versão fixa) vem do cache primeiro.
// 2. Isola a página (COOP/COEP): libera várias threads no WebAssembly, o que deixa a transcrição
//    pelo processador várias vezes mais rápida. O GitHub Pages não deixa configurar esses cabeçalhos.
const CACHE = "reunioes-1.0.9";
const CDN = "https://cdn.jsdelivr.net/";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function isolar(r) {
  if (!r || r.status === 0 || r.type === "opaque") return r;
  const h = new Headers(r.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "credentialless");
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const r = await fetch(req, { cache: "no-cache" });
        if (r.ok) cache.put(req, r.clone());
        return isolar(r);
      } catch {
        const c = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
        return c ? isolar(c) : Response.error();
      }
    })());
  } else if (req.url.startsWith(CDN)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const c = await cache.match(req);
      if (c) return c;
      const r = await fetch(req);
      if (r.ok) cache.put(req, r.clone());
      return r;
    })());
  }
});
