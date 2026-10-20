// Controles compartilhados: switch com mola elastica, avisos.

// Mola amortecida (0..1 com overshoot pequeno).
function mola(t, bounce) {
  if (t >= 1) return 1;
  const z = 1 - bounce * 0.72, w = 9.2;
  const wd = w * Math.sqrt(Math.max(0.0001, 1 - z * z));
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}

// A bolinha estica rumo ao destino (a frente parte antes da traseira) e assenta com um quique.
export function animaSw(knob, ligado, anima = true) {
  const CURSO = 16, x0 = ligado ? 0 : CURSO, x1 = ligado ? CURSO : 0;
  if (!anima || !knob.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    knob.getAnimations?.().forEach((a) => a.cancel());
    knob.style.transform = `translateX(${x1}px)`;
    return;
  }
  const N = 36, frames = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = mola(t, 0.3), b = mola(Math.max(0, t - 0.16) / 0.84, 0.3);
    const lead = x0 + (x1 - x0) * a, trail = x0 + (x1 - x0) * b;
    const est = Math.abs(lead - trail);
    frames.push({ transform: `translateX(${(lead + trail) / 2}px) scale(${1 + est / 16}, ${1 - Math.min(0.22, est / 40)})` });
  }
  knob.animate(frames, { duration: 420, easing: "linear", fill: "forwards" });
}

/** <button class="interruptor" role="switch"> com a bolinha; liga/desliga no clique. */
export function interruptor(id, ligado, rotulo, desc = "", desabilitado = false) {
  return `
    <button type="button" class="interruptor" role="switch" id="${id}" aria-checked="${ligado}" ${desabilitado ? "disabled" : ""}>
      <span class="sw" aria-hidden="true"><i style="transform:translateX(${ligado ? 16 : 0}px)"></i></span>
      <span class="interruptor-txt"><b>${rotulo}</b>${desc ? `<small>${desc}</small>` : ""}</span>
    </button>`;
}

export function ligarInterruptores(raiz, aoMudar) {
  raiz.addEventListener("click", (e) => {
    const b = e.target.closest(".interruptor");
    if (!b || b.disabled) return;
    const novo = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(novo));
    animaSw(b.querySelector(".sw i"), novo);
    aoMudar?.(b.id, novo);
  });
}

export const ligado = (id) => document.getElementById(id)?.getAttribute("aria-checked") === "true";

let tempoAviso;
export function avisar(msg, ms = 4200) {
  let a = document.getElementById("aviso");
  if (!a) {
    a = document.createElement("div");
    a.id = "aviso"; a.className = "aviso"; a.setAttribute("role", "status");
    document.body.append(a);
  }
  a.textContent = msg;
  a.classList.add("visivel");
  clearTimeout(tempoAviso);
  tempoAviso = setTimeout(() => a.classList.remove("visivel"), ms);
}
