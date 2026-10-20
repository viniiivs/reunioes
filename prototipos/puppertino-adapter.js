// Estilo "Puppertino": as MESMAS telas do app, com os componentes do Puppertino 2 (macOS 27),
// o switch de lente do Puppertino, a refração do rizroze/liquid-glass e ícones Remix.
// Converte a marcação do app na hora em que ela aparece (o app redesenha a lista a toda hora),
// sem mexer no código do app: os cliques continuam caindo nos mesmos botões de antes.
import { createLiquidGlass } from "/prototipos/vendor/rizroze-liquid-glass.js";

const ICONES = {
  "folder-open": "folder-open-line", folder: "folder-3-fill", "folder-simple": "folder-line", trash: "delete-bin-line",
  "file-text": "file-text-line", x: "close-line", waveform: "voiceprint-line", record: "record-circle-fill",
  stop: "stop-fill", check: "check-line", "arrows-clockwise": "refresh-line", "gear-six": "settings-3-line",
  "magnifying-glass": "search-line", users: "group-line", flag: "flag-fill", "check-circle": "checkbox-circle-line",
  sparkle: "sparkling-line", "circle-notch": "loader-4-line", hourglass: "hourglass-line", warning: "error-warning-line",
  lightning: "flashlight-fill", copy: "file-copy-line", "arrow-square-out": "external-link-line", "pencil-simple": "pencil-line",
  "text-align-left": "align-left", microphone: "mic-fill", cpu: "cpu-fill", info: "information-fill",
  "download-simple": "download-2-fill", "arrow-left": "arrow-left-s-line", keyboard: "keyboard-line",
  "arrow-circle-up": "arrow-up-circle-line", "hand-waving": "hand", "lock-simple": "lock-line", "x-circle": "close-circle-fill",
  circle: "checkbox-blank-circle-line",
};
// Barra lateral das Configurações: ícone cheio (branco no quadrado colorido).
const ICONES_LATERAL = { "text-align-left": "file-text-fill", record: "record-circle-fill", sparkle: "sparkling-fill", "arrows-clockwise": "refresh-fill" };

document.body.classList.add("p-type", "p-auto-dark-mode", "puppertino");
let mexendo = false;   // ignora as mutações que o próprio adaptador causa

// ---------------------------------------------------------------- ícones
function icones(raiz) {
  raiz.querySelectorAll("i.ph").forEach((i) => {
    const ph = [...i.classList].find((c) => c.startsWith("ph-"));
    if (!ph) return;
    const nome = ph.slice(3);
    const lateral = i.closest(".passo");
    i.classList.remove("ph", ph);
    i.classList.add("ri-" + ((lateral && ICONES_LATERAL[nome]) || ICONES[nome] || "question-line"));
    if (lateral) i.dataset.secao = nome;
  });
}

// ---------------------------------------------------------------- botões
function botoes(raiz) {
  raiz.querySelectorAll(".btn").forEach((b) => {
    const c = b.classList;
    const add = ["p-button"];
    if (c.contains("primario")) add.push("p-button-primary");
    else if (c.contains("perigo")) add.push("p-button-destructive");
    else if (c.contains("icone")) add.push("p-button-borderless", "p-button-icon-only");
    else add.push("p-button-default");
    if (c.contains("grande")) add.push("p-button-large");
    c.remove("btn", "primario", "perigo", "icone", "grande");
    c.add(...add);
  });
}

// ---------------------------------------------------------------- switch (lente do Puppertino)
// O botão do app continua sendo a fonte da verdade (aria-checked). O switch do Puppertino só
// espelha; quando a pessoa mexe nele, o adaptador clica no botão do app.
function switches(raiz) {
  raiz.querySelectorAll(".sw:not([data-p])").forEach((sw) => {
    sw.dataset.p = "1";
    const dono = sw.closest("[role=switch]");
    const rot = document.createElement("label");
    rot.className = "p-switch";
    rot.innerHTML = `<input type="checkbox" tabindex="-1"><span></span>`;
    const inp = rot.querySelector("input");
    inp.checked = dono.getAttribute("aria-checked") === "true";
    inp.disabled = dono.disabled;
    sw.hidden = true;                       // fica no DOM: o app ainda anima o <i> dele
    sw.before(rot);
    rot.addEventListener("click", (e) => e.stopPropagation());   // o clique do rótulo não chega no botão
    inp.addEventListener("change", () => {
      if (inp.checked !== (dono.getAttribute("aria-checked") === "true")) dono.click();
    });
    new MutationObserver(() => { inp.checked = dono.getAttribute("aria-checked") === "true"; inp.disabled = dono.disabled; })
      .observe(dono, { attributes: true, attributeFilter: ["aria-checked", "disabled"] });
  });
  window.PuppertinoLiquidGlass?.enhance(raiz);
}

// ---------------------------------------------------------------- busca
function buscas(raiz) {
  raiz.querySelectorAll("label.busca").forEach((l) => {
    l.classList.replace("busca", "p-search");
    l.querySelector("i")?.remove();
  });
}

// ---------------------------------------------------------------- abas do leitor -> segmentado
function segmentados(raiz) {
  raiz.querySelectorAll(".abas:not([data-p])").forEach((abas) => {
    abas.dataset.p = "1";
    const seg = document.createElement("div");
    seg.className = "p-segmented p-segmented-gray p-seg-leitor";   // cinza: alterna vistas, não liga/desliga
    const botoes = [...abas.querySelectorAll("[role=tab]")];
    seg.innerHTML = botoes.map((b, i) => `<label class="p-segment"><input type="radio" name="abas-p" value="${i}" ${b.getAttribute("aria-selected") === "true" ? "checked" : ""}><span>${b.textContent.trim()}</span></label>`).join("");
    abas.before(seg);
    abas.style.display = "none";   // [hidden] perde para o display do CSS do app
    seg.addEventListener("change", (e) => botoes[+e.target.value].click());
    botoes.forEach((b, i) => new MutationObserver(() => {
      if (b.getAttribute("aria-selected") === "true") seg.querySelectorAll("input")[i].checked = true;
    }).observe(b, { attributes: true, attributeFilter: ["aria-selected"] }));
  });
}

// ---------------------------------------------------------------- barra de ferramentas
function barra(raiz) {
  const f = raiz.querySelector(".topo .ferramentas:not([data-p])");
  if (!f) return;
  f.dataset.p = "1";
  const grupo = document.createElement("div");
  grupo.className = "p-toolbar-group";
  ["#atualizar", "#pasta", "#engrenagem"].forEach((s) => {
    const b = f.querySelector(s);
    if (!b) return;
    [...b.childNodes].forEach((n) => { if (n.nodeType === 3) n.remove(); });   // só o ícone, como na barra do macOS
    b.className = "p-toolbar-btn";
    b.title ||= b.getAttribute("aria-label") || "Pasta";
    grupo.append(b);
  });
  if (grupo.children.length) f.append(grupo);
}

// ---------------------------------------------------------------- barra lateral (Configurações)
function lateral(raiz) {
  const a = raiz.querySelector("aside.lateral");
  if (!a) return;
  a.classList.add("p-sidebar");
  a.querySelectorAll(".passo").forEach((p) => {
    p.classList.add("p-sidebar-row");
    p.classList.toggle("p-selected", ["true", "step"].includes(p.getAttribute("aria-current")));
    p.querySelector("i:not(.p-sidebar-icon)")?.classList.add("p-sidebar-icon");
  });
}

// ---------------------------------------------------------------- alerta (excluir)
function alerta(raiz) {
  // Alerta do macOS 27 (p-desktop-modal empilhado), não o do iPhone (p-alert).
  raiz.querySelectorAll("dialog:not([data-p])").forEach((d) => {
    d.dataset.p = "1";
    d.classList.add("p-desktop-modal", "p-desktop-modal--stacked", "active");
    const form = d.querySelector("form");
    form.classList.add("p-desktop-modal__surface");
    const corpo = document.createElement("div");
    corpo.className = "p-desktop-modal__body";
    const icone = document.createElement("img");
    icone.src = "reunioes.png"; icone.alt = ""; icone.className = "p-alerta-icone";
    const t = d.querySelector("h2"), m = d.querySelector("p");
    t.classList.add("p-desktop-modal__title");
    m.classList.add("p-desktop-modal__description");
    corpo.append(icone, t, m);
    form.prepend(corpo);
    const acoes = d.querySelector(".dialogo-acoes");
    acoes.className = "p-desktop-modal__actions";
    acoes.querySelectorAll("button").forEach((b) => {
      b.className = "p-desktop-modal__action " + (b.value === "sim" ? "p-desktop-modal__action--destructive" : "p-desktop-modal__action--secondary");
      b.querySelector("i")?.remove();
    });
    [...acoes.children].reverse().forEach((b) => acoes.append(b));   // ação principal em cima
  });
}
// ---------------------------------------------------------------- linhas: abrir pela linha, ações no hover e no botão direito
let menu;
function menuContexto() {
  if (menu) return menu;
  menu = document.createElement("div");
  menu.className = "p-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  document.body.append(menu);
  addEventListener("pointerdown", (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
  addEventListener("keydown", (e) => { if (e.key === "Escape") menu.hidden = true; });
  addEventListener("blur", () => (menu.hidden = true));
  return menu;
}
document.addEventListener("click", (e) => {
  const l = e.target.closest(".linha");
  if (!l || e.target.closest("button, a, input, label")) return;
  l.querySelector("[data-acao=ler]")?.click();   // a linha inteira abre, como no Mail
});
document.addEventListener("contextmenu", (e) => {
  const l = e.target.closest(".linha");
  if (!l) return;
  e.preventDefault();
  const m = menuContexto();
  const itens = [
    ["ler", "file-text-line", "Abrir"], ["resumo", "sparkling-line", "Ver resumo"], ["transcrever", "voiceprint-line", "Transcrever"],
    ["resumir", "sparkling-line", "Resumir"], ["cancelar", "close-line", "Cancelar"], ["-"], ["pasta", "folder-open-line", "Mostrar no Explorador"],
    ["-"], ["excluir", "delete-bin-line", "Mover para a Lixeira"],
  ].filter(([a]) => a === "-" || l.querySelector(`[data-acao=${a}]:not([disabled])`));
  m.innerHTML = itens.map(([a, ic, t]) => a === "-" ? `<div class="p-menu__separator"></div>`
    : `<div class="p-menu__item" role="menuitem" tabindex="-1" data-faz="${a}"><i class="p-menu__icon ri-${ic}"></i>${t}</div>`).join("")
    .replace(/^(<div class="p-menu__separator"><\/div>)+|(<div class="p-menu__separator"><\/div>)+$/g, "");
  m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(e.clientX, innerWidth - w - 8) + "px";
  m.style.top = Math.min(e.clientY, innerHeight - h - 8) + "px";
  m.onclick = (ev) => {
    const it = ev.target.closest("[data-faz]");
    if (!it) return;
    m.hidden = true;
    l.querySelector(`[data-acao=${it.dataset.faz}]`)?.click();
  };
});

// ---------------------------------------------------------------- refração ao vivo (rizroze)
const vidros = new WeakMap();
function vidro(el, opcoes) {
  if (!el || vidros.has(el)) return;
  const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 16;
  vidros.set(el, createLiquidGlass(el, { borderRadius: r, scale: -70, aberration: [0, 6, 12], blur: 9, ...opcoes }));
}
function refracao(raiz) {
  if (document.body.querySelector(".lista")) vidro(raiz.querySelector(".topo"), { scale: -40, aberration: [0, 3, 6], blur: 12 });
  raiz.querySelectorAll("dialog[open] .p-desktop-modal__surface").forEach((s) => vidro(s, { scale: -40, aberration: [0, 3, 6], blur: 14 }));
}

// ---------------------------------------------------------------- laço
function converter() {
  if (mexendo) return;
  mexendo = true;
  try {
    const r = document.body;
    icones(r); botoes(r); buscas(r); switches(r); segmentados(r); barra(r); lateral(r); alerta(r); refracao(r);
  } finally {
    mexendo = false;
  }
}
new MutationObserver(() => requestAnimationFrame(converter))
  .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-current", "open"] });
converter();
