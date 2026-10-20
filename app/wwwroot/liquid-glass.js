// Liquid Glass para web (aproximação, não é o material da Apple): cada peça de vidro ganha um
// filtro SVG próprio com um MAPA DE DESLOCAMENTO calculado para o tamanho e o raio dela.
// Na borda (bisel) o fundo é puxado para dentro como numa lente convexa = refração; cada canal
// de cor desloca um pouco diferente = aberração cromática. Só Chromium aplica SVG em
// backdrop-filter (o WebView2 do app é Chromium).
(() => {
  const NS = "http://www.w3.org/2000/svg";
  // Painéis grandes e fixos (barra lateral, rodapé das Configurações) ficam com o vidro fosco do tema:
  // sem nada passando por trás, a refração só desenhava uma linha colorida na borda.
  const ALVOS = ["body:has(.lista) .topo", ".faixa:not([hidden])", "dialog[open]", ".aviso.visivel", ".abas", ".auto", ".gravar"];
  let svg, seq = 0;
  const feitos = new WeakMap();   // elemento -> "LxA:raio" ja aplicado

  function garantirSvg() {
    if (svg && svg.isConnected) return svg;
    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
    svg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
    document.body.append(svg);
    return svg;
  }

  // Mapa de deslocamento: R = x, G = y (128 = parado). Distância assinada a um retângulo arredondado.
  function mapa(w, h, r, bisel) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    const hx = w / 2, hy = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - hx, py = y + 0.5 - hy;
        const qx = Math.abs(px) - (hx - r), qy = Math.abs(py) - (hy - r);
        const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
        const d = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;   // < 0 dentro
        let nx = 0, ny = 0;
        if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py); }
        else if (qx > qy) nx = Math.sign(px); else ny = Math.sign(py);
        const dentro = -d;                                        // distância até a borda
        const t = dentro < bisel ? 1 - Math.max(0, dentro) / bisel : 0;
        const m = t * t;                                          // lente convexa: cresce rápido junto da borda
        const i = (y * w + x) * 4;
        img.data[i] = 128 - nx * m * 127;                         // puxa o fundo para dentro
        img.data[i + 1] = 128 - ny * m * 127;
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  function filtro(w, h, r) {
    // Bisel estreito e deslocamento curto: só a borda curva entorta, o miolo fica nítido.
    // (Com o bisel ocupando a peça toda, tudo era puxado para a linha do meio e o vidro "sumia".)
    const id = "lg" + ++seq, bisel = Math.max(6, Math.min(r * 0.6, 16, Math.min(w, h) * 0.28));
    const escala = bisel * 1.3;   // deslocamento máximo = metade da escala, sempre dentro da peça
    const f = document.createElementNS(NS, "filter");
    f.id = id;
    f.setAttribute("x", "0"); f.setAttribute("y", "0"); f.setAttribute("width", w); f.setAttribute("height", h);
    f.setAttribute("filterUnits", "userSpaceOnUse");
    f.setAttribute("color-interpolation-filters", "sRGB");
    f.innerHTML = `
      <feImage href="${mapa(w, h, r, bisel)}" x="0" y="0" width="${w}" height="${h}" result="mapa"/>
      <feDisplacementMap in="SourceGraphic" in2="mapa" scale="${escala}" xChannelSelector="R" yChannelSelector="G" result="dR"/>
      <feDisplacementMap in="SourceGraphic" in2="mapa" scale="${escala * 0.92}" xChannelSelector="R" yChannelSelector="G" result="dG"/>
      <feDisplacementMap in="SourceGraphic" in2="mapa" scale="${escala * 0.84}" xChannelSelector="R" yChannelSelector="G" result="dB"/>
      <feColorMatrix in="dR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
      <feColorMatrix in="dG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
      <feColorMatrix in="dB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
      <feBlend in="r" in2="g" mode="screen" result="rg"/>
      <feBlend in="rg" in2="b" mode="screen"/>`;
    garantirSvg().append(f);
    return id;
  }

  function aplicar(el) {
    const b = el.getBoundingClientRect();
    const w = Math.round(b.width), h = Math.round(b.height);
    if (w < 8 || h < 8) return;
    const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, h / 2, w / 2);
    const chave = `${w}x${h}:${Math.round(r)}`;
    if (feitos.get(el) === chave) return;
    const velho = el.dataset.lg && document.getElementById(el.dataset.lg);
    velho?.remove();
    const id = filtro(w, h, r);
    el.dataset.lg = id;
    el.classList.add("vidro-liquido");
    el.style.backdropFilter = `url(#${id}) blur(1.2px) saturate(1.7) brightness(1.04)`;
    feitos.set(el, chave);
  }

  let pendente = false;
  function varrer() {
    if (pendente) return;
    pendente = true;
    requestAnimationFrame(() => {
      pendente = false;
      document.querySelectorAll(ALVOS.join(",")).forEach(aplicar);
    });
  }
  new MutationObserver(varrer).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "open", "hidden"] });
  new ResizeObserver(varrer).observe(document.body);
  addEventListener("resize", varrer);
  varrer();
})();
