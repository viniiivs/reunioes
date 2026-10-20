// Carregado antes de tudo nas páginas da versão web (o build/web.ps1 injeta).
window.REUNIOES_WEB = true;

if ("serviceWorker" in navigator && window.parent === window) {
  navigator.serviceWorker.register("sw.js").then(() => {
    // Na primeira visita a página ainda não está isolada (o service worker acabou de chegar):
    // recarrega uma vez para ganhar as várias threads. Nunca em laço.
    if (!crossOriginIsolated && navigator.serviceWorker.controller === null) {
      navigator.serviceWorker.ready.then(() => {
        try {
          if (sessionStorage.getItem("reunioes.recarregou")) return;
          sessionStorage.setItem("reunioes.recarregou", "1");
        } catch { return; }
        location.reload();
      });
    }
  }).catch(() => {});
}
