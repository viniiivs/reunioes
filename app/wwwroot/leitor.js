import { chamar, aoMudar, naWeb } from "./ponte.js";
import * as f from "./fmt.js";

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const base = q.get("b") || "";
const area = $("#texto");
const painelResumo = $("#resumo");
const painelChecagem = $("#checagem");
let falas = [];
let pessoa = null;
let resumo = null;
let estadoResumo = null;
let resumoAtivo = true;
let checagem = null;       // { itens, gerado_em, modelo, reuniao_checada }
let checando = false;
let checagemErro = null;
let podeChecar = true;
let filtroVeredito = null;   // chip escolhido na aba Fato ou fake (null = todas)
let trechoEscolhido = null;   // { trecho, quem, tempo } da seleção na transcrição
let nomeEu = null;   // nome da pessoa (Configurações > Resumo); só muda o que aparece, o arquivo segue com "Eu"
const rotulo = (q) => (q === "Eu" && nomeEu ? nomeEu : q);

// O mic mudo faz o Whisper inventar "Obrigado." / "Tchau." soltos no canal "Eu".
const DUVIDOSA = /^(obrigad[oa]|tchau|valeu|e aí|legenda .*)[.!]*$/i;
const RE_FALA = /^\*\*\[(\d\d:\d\d:\d\d)\] (.+?):\*\*\s*(.*)$/;

// ---------------------------------------------------------------- abas

const ABAS = ["resumo", "texto", "checagem"];
let aba = "resumo";
function abrirAba(qual) {
  aba = ABAS.includes(qual) ? qual : "resumo";
  for (const a of ABAS) {
    $(`#aba-${a}`).setAttribute("aria-selected", String(a === aba));
    $(`#painel-${a}`).hidden = a !== aba;
  }
  if (aba !== "texto") esconderChecarTrecho();
  botaoCopiar();
}
// o Copiar do topo copia o resumo ou a checagem; a transcrição tem o dela na barra de busca
function botaoCopiar() {
  const b = $("#copiar-resumo");
  b.hidden = !(aba === "resumo" ? resumo : aba === "checagem" ? checagem?.itens?.length : false);
  const t = aba === "checagem" ? "Copiar a checagem (veredito, explicação e fonte)" : "Copiar o resumo (veredito, ações e tópicos)";
  b.title = t; b.setAttribute("aria-label", t);
}
for (const a of ABAS) $(`#aba-${a}`).addEventListener("click", () => abrirAba(a));
$(".abas").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const outra = ABAS[(ABAS.indexOf(aba) + (e.key === "ArrowRight" ? 1 : ABAS.length - 1)) % ABAS.length];
  abrirAba(outra);
  $(`#aba-${outra}`).focus();
});
abrirAba(q.get("aba") || "resumo");

// ---------------------------------------------------------------- carregar

area.innerHTML = `<div class="esqueleto" aria-hidden="true">${"<div></div>".repeat(9)}</div>`;
painelResumo.innerHTML = `<div class="esqueleto" aria-hidden="true"><div class="grande"></div>${"<div></div>".repeat(6)}</div>`;
painelChecagem.innerHTML = painelResumo.innerHTML;

async function carregar(primeira) {
  try {
    const r = await chamar("ler", { base });
    const g = r.gravacao;
    temVozes = !!g?.vozes;
    nomeEu = r.nome || null;
    if (primeira) {
      falas = r.texto.split(/\r?\n/).map((l) => l.match(RE_FALA)).filter(Boolean)
        .map(([, tempo, quem, diz]) => ({ tempo, quem, diz, duvidosa: quem === "Eu" && DUVIDOSA.test(diz.trim()) }));
      if (g) {
        const d = new Date(g.inicio);
        const t = `Reunião de ${f.diaCurto(d)} às ${f.hora(d)}`;
        $("#titulo").textContent = t;
        document.title = t;
        $("#meta").textContent = [f.dia(d), g.duracao != null ? f.duracao(g.duracao) : null,
          g.falantes ? f.plural(g.falantes.length, "falante", "falantes") : null].filter(Boolean).join(", ");
      }
      pessoas();
      desenhar();
      area.setAttribute("aria-busy", "false");
    }
    resumo = r.resumo;
    resumoAtivo = r.resumoAtivo;
    estadoResumo = g?.resumo || null;
    desenharResumo();
    checagem = r.checagem || null;
    checando = !!r.checando;
    checagemErro = r.checagemErro || null;
    podeChecar = r.podeChecar !== false;
    desenharChecagem();
  } catch (e) {
    if (primeira) {
      area.innerHTML = `<div class="vazio"><h2>Não consegui abrir a transcrição</h2><p>${f.esc(e.message)}</p></div>`;
      painelResumo.innerHTML = "";
      painelChecagem.innerHTML = "";
    }
  }
}

// Atualiza o resumo quando o Claude termina (o host avisa qualquer mudança na pasta).
aoMudar((m) => {
  if (m.evento === "aba") return abrirAba(m.aba);
  if (m.evento === "mudou" && (!resumo || checando || estadoResumo?.estado === "gerando" || estadoResumo?.estado === "fila")) carregar(false);
});

// ---------------------------------------------------------------- resumo

function desenharResumo() {
  botaoCopiar();
  const est = estadoResumo?.estado;
  if (est === "gerando" || est === "fila") {
    painelResumo.innerHTML = `
      <div class="veredito-topo"><i class="ph ph-circle-notch girando" aria-hidden="true"></i>
        <div><strong>${est === "fila" ? "Na fila do resumo" : "O Claude está lendo a transcrição"}</strong>
        <span>Costuma levar uns 15 segundos. Esta aba atualiza sozinha.</span></div></div>`;
    return;
  }
  if (!resumo && !resumoAtivo) {
    painelResumo.innerHTML = `
      <div class="vazio"><h2>Resumo com IA desligado</h2>
        <p>Ligue em Configurações, na seção Resumo com IA${naWeb ? " (precisa de uma chave da API da Anthropic)" : ""}. O Claude lê a transcrição e diz se ficou alguma tarefa para você.</p></div>`;
    return;
  }
  if (!resumo) {
    const erro = est === "erro" ? `<p>O último pedido falhou: ${f.esc(estadoResumo.erro || "")}</p>` : `<p>O Claude lê a transcrição e diz se você precisa fazer alguma coisa.</p>`;
    painelResumo.innerHTML = `
      <div class="vazio"><h2>${est === "erro" ? "O resumo falhou" : "Sem resumo ainda"}</h2>${erro}
        <button class="btn primario" data-acao="resumir"><i class="ph ph-sparkle" aria-hidden="true"></i> ${est === "erro" ? "Tentar de novo" : "Resumir"}</button></div>`;
    return;
  }

  const r = resumo;
  const quando = r.gerado_em ? new Date(r.gerado_em) : null;
  const lista = r.acoes || [];
  const feitas = lista.filter((a) => a.feita).length;
  const tudoFeito = lista.length > 0 && feitas === lista.length;
  const acoes = lista.map((a, i) => {
    const meta = [a.pedido_por ? `Pedido por ${f.esc(a.pedido_por)}` : null, a.prazo ? `Prazo: ${f.esc(a.prazo)}` : null].filter(Boolean);
    return `<li class="${a.feita ? "feita" : ""}"><button class="marcar" role="checkbox" aria-checked="${!!a.feita}" data-marcar="${i}" title="${a.feita ? "Marcar como não feita" : "Marcar como feita"}" aria-label="Feita: ${f.esc(a.acao)}"><i class="ph ph-check" aria-hidden="true"></i></button><b>${f.esc(a.acao)}</b><small>${meta.join(". ")}${meta.length ? ". " : ""}${a.tempo ? `Trecho em <button class="tempo-link" data-tempo="${f.esc(a.tempo)}">${f.esc(a.tempo)}</button>` : ""}</small></li>`;
  }).join("");

  painelResumo.innerHTML = `
    <div class="veredito-topo${r.precisa_agir && !tudoFeito ? " agir" : ""}">
      <i class="ph ${r.precisa_agir && !tudoFeito ? "ph-flag" : "ph-check-circle"}" aria-hidden="true"></i>
      <div><strong>${f.esc(r.veredito)}</strong>
      <span>${!r.precisa_agir ? "Segundo o Claude, nada depende de você."
        : lista.length && feitas === lista.length ? "Você marcou tudo como feito."
        : feitas ? `Segundo o Claude, você precisa agir. ${feitas} de ${lista.length} feitas.` : "Segundo o Claude, você precisa agir."}</span></div>
    </div>
    ${acoes ? `<h2>O que você precisa fazer</h2><ol class="acoes-lista">${acoes}</ol>` : ""}
    ${r.atencao?.length ? `<h2>Fique sabendo</h2><ul>${r.atencao.map((x) => `<li>${f.esc(x)}</li>`).join("")}</ul>` : ""}
    ${r.resumo?.length ? `<h2>Do que se falou</h2><ul>${r.resumo.map((x) => `<li>${f.esc(x)}</li>`).join("")}</ul>` : ""}
    <div class="rodape-resumo">
      <span>Gerado pelo Claude${r.modelo ? ` (${f.esc(r.modelo)})` : ""}${quando ? ` em ${f.diaCurto(quando)} às ${f.hora(quando)}` : ""}. Pode errar: confira no texto.</span>
      <button class="btn" data-acao="resumir"><i class="ph ph-arrows-clockwise" aria-hidden="true"></i> Gerar de novo</button>
    </div>`;
}

painelResumo.addEventListener("click", async (e) => {
  const m = e.target.closest("[data-marcar]");
  if (m) return marcar(+m.dataset.marcar);
  const t = e.target.closest("[data-tempo]");
  if (t) return irPara(t.dataset.tempo);
  const b = e.target.closest("[data-acao=resumir]");
  if (!b) return;
  b.disabled = true;
  try {
    await chamar("resumir", { base });
    resumo = null;
    estadoResumo = { estado: "gerando" };
    desenharResumo();
  } catch (err) { b.disabled = false; avisar(err.message); }
});

// Marca na hora e grava em seguida; se falhar, desfaz e avisa.
async function marcar(i) {
  const a = resumo?.acoes?.[i];
  if (!a) return;
  a.feita = !a.feita;
  desenharResumo();
  painelResumo.querySelector(`[data-marcar="${i}"]`)?.focus();
  try { await chamar("marcarAcao", { base, i, feita: a.feita }); }
  catch (err) { a.feita = !a.feita; desenharResumo(); avisar(err.message); }
}

// Pula para o trecho citado numa acao e pisca a fala.
function irPara(tempo) {
  pessoa = null; $("#procura").value = "";
  document.querySelectorAll(".pessoa").forEach((p) => p.setAttribute("aria-pressed", "false"));
  desenhar();
  abrirAba("texto");
  const alvo = [...area.querySelectorAll(".fala")].find((p) => p.dataset.tempo >= tempo);
  if (!alvo) return;
  alvo.scrollIntoView({ block: "center" });
  alvo.classList.add("destaque");
  setTimeout(() => alvo.classList.remove("destaque"), 1200);
}

// ---------------------------------------------------------------- fato ou fake

const VEREDITOS = {
  fato: { txt: "Fato", ic: "ph-check-circle" },
  fake: { txt: "Fake", ic: "ph-x-circle" },
  impreciso: { txt: "Impreciso", ic: "ph-warning-circle" },
  sem_dados: { txt: "Sem dados", ic: "ph-question" },
};
const dominio = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

function itemChecado(x) {
  const v = VEREDITOS[x.veredito] || VEREDITOS.sem_dados;
  const meta = [x.quem ? f.esc(rotulo(x.quem)) : null,
    x.tempo ? `<button class="tempo-link" data-tempo="${f.esc(x.tempo)}" title="Ver na transcrição">${f.esc(x.tempo)}</button>` : null].filter(Boolean).join(" em ");
  const fontes = (x.fontes || []).map((fo) =>
    `<a class="fonte" href="${f.esc(fo.url)}" target="_blank" rel="noopener noreferrer" title="${f.esc(fo.titulo || fo.url)}"><i class="ph ph-link-simple" aria-hidden="true"></i><span>${f.esc(dominio(fo.url))}</span></a>`).join("");
  return `<li class="checado">
    <div class="checado-topo"><span class="selo ${x.veredito in VEREDITOS ? x.veredito : "sem_dados"}"><i class="ph ${v.ic}" aria-hidden="true"></i>${v.txt}</span>${meta ? `<small>${meta}</small>` : ""}</div>
    <b>${f.esc(x.afirmacao)}</b>
    <p>${f.esc(x.explicacao)}</p>
    ${fontes ? `<div class="fontes">${fontes}</div>` : ""}
  </li>`;
}

function desenharChecagem() {
  botaoCopiar();
  const itens = checagem?.itens || [];
  const trechos = itens.filter((x) => x.origem === "trecho");
  const daReuniao = itens.filter((x) => x.origem !== "trecho");
  const erro = checagemErro ? `<p class="erro-linha"><i class="ph ph-warning" aria-hidden="true"></i> A última checagem falhou: ${f.esc(checagemErro)}</p>` : "";
  const pesquisando = checando ? `
    <div class="veredito-topo"><i class="ph ph-circle-notch girando" aria-hidden="true"></i>
      <div><strong>O Claude está pesquisando na web</strong>
      <span>Confere cada afirmação, uma a uma: leva de 30 segundos a alguns minutos, conforme o tamanho da reunião. Esta aba atualiza sozinha.</span></div></div>` : "";

  if (!itens.length && !checagem?.reuniao_checada) {
    const falta = !podeChecar ? (naWeb ? "Precisa de uma chave da API da Anthropic: cole em Configurações, na seção Resumo com IA." : "Precisa do Claude Code instalado neste computador.") : "";
    painelChecagem.innerHTML = pesquisando || `
      <div class="vazio"><h2>Fato ou fake</h2>
        <p>O Claude confere tudo o que dá para verificar na reunião (números, datas, leis, notícias), cada frase no contexto da conversa, pesquisa na web e diz se é fato ou fake, com a fonte.</p>
        <p>Para checar só uma frase, selecione o trecho na transcrição.</p>
        ${erro}${falta ? `<p>${falta}</p>` : ""}
        <button class="btn primario" data-acao="checar"${podeChecar ? "" : " disabled"}><i class="ph ph-seal-check" aria-hidden="true"></i> Checar a reunião</button></div>`;
    return;
  }

  const conta = (v) => itens.filter((x) => x.veredito === v).length;
  const partes = [["fake", "fake", "fakes"], ["impreciso", "imprecisa", "imprecisas"], ["fato", "fato", "fatos"], ["sem_dados", "sem dados", "sem dados"]]
    .map(([v, um, varios]) => { const n = conta(v); return n ? `${n} ${n === 1 ? um : varios}` : null; }).filter(Boolean);
  const alerta = conta("fake") + conta("impreciso") > 0;
  const quando = checagem.gerado_em ? new Date(checagem.gerado_em) : null;
  // muitas afirmações: chips para filtrar por veredito (mesmo componente do filtro de pessoas)
  const FILTROS = [["fake", "Fake"], ["impreciso", "Imprecisas"], ["fato", "Fatos"], ["sem_dados", "Sem dados"]];
  if (filtroVeredito && !conta(filtroVeredito)) filtroVeredito = null;
  const chips = itens.length > 5 ? `<nav class="pessoas filtros-checagem" aria-label="Filtrar por veredito">${
    [[null, "Todas", itens.length], ...FILTROS.map(([v, t]) => [v, t, conta(v)]).filter(([, , n]) => n)].map(([v, t, n]) =>
      `<button class="pessoa" aria-pressed="${filtroVeredito === v}" data-filtro="${v || ""}">${t} <b>${n}</b></button>`).join("")}</nav>` : "";
  const filtra = (xs) => (filtroVeredito ? xs.filter((x) => x.veredito === filtroVeredito) : xs);
  const lista = (t, xs) => (xs = filtra(xs)).length ? `${t ? `<h2>${t}</h2>` : ""}<ol class="checagem-lista">${xs.map(itemChecado).join("")}</ol>` : "";
  const dois = filtra(trechos).length && filtra(daReuniao).length;
  painelChecagem.innerHTML = `
    ${pesquisando || `<div class="veredito-topo${alerta ? " alerta" : ""}">
      <i class="ph ${alerta ? "ph-seal-warning" : "ph-seal-check"}" aria-hidden="true"></i>
      <div><strong>${itens.length ? f.plural(itens.length, "afirmação checada", "afirmações checadas") : "Nada para checar"}</strong>
      <span>${itens.length ? partes.join(", ") : "A reunião não tem afirmações que dê para verificar em fontes públicas."}</span></div></div>`}
    ${erro}
    ${chips}
    ${lista(dois ? "Trechos que você escolheu" : "", trechos)}
    ${lista(dois ? "Da reunião" : "", daReuniao)}
    <div class="rodape-resumo">
      <span>Checado pelo Claude com busca na web${quando ? ` em ${f.diaCurto(quando)} às ${f.hora(quando)}` : ""}. Pode errar: abra a fonte.</span>
      <button class="btn" data-acao="checar"${checando || !podeChecar ? " disabled" : ""}><i class="ph ph-arrows-clockwise" aria-hidden="true"></i> ${checagem.reuniao_checada ? "Checar de novo" : "Checar a reunião"}</button>
    </div>`;
}

async function pedirChecagem(args, botao) {
  if (botao) botao.disabled = true;
  try {
    await chamar("checar", { base, ...args });
    checando = true;
    checagemErro = null;
    abrirAba("checagem");
    desenharChecagem();
    $("#painel-checagem .resumo").scrollTop = 0;
  } catch (err) { if (botao) botao.disabled = false; avisar(err.message); }
}

painelChecagem.addEventListener("click", (e) => {
  const fi = e.target.closest("[data-filtro]");
  if (fi) {
    filtroVeredito = filtroVeredito === (fi.dataset.filtro || null) ? null : fi.dataset.filtro || null;
    desenharChecagem();
    return painelChecagem.querySelector(`[data-filtro="${filtroVeredito || ""}"]`)?.focus();
  }
  const t = e.target.closest("[data-tempo]");
  if (t) return irPara(t.dataset.tempo);
  const a = e.target.closest("a.fonte");
  // no app de Windows o link abre no navegador padrão, não numa janela do WebView
  if (a && !naWeb) { e.preventDefault(); chamar("abrirLink", { url: a.href }).catch((er) => avisar(er.message)); return; }
  const b = e.target.closest("[data-acao=checar]");
  if (b) pedirChecagem({}, b);
});

// Selecionar um trecho na transcrição mostra "Checar trecho" junto da seleção.
function esconderChecarTrecho() { $("#checar-trecho").hidden = true; trechoEscolhido = null; }
function seguirSelecao() {
  const sel = getSelection();
  const txt = sel?.toString().replace(/\s+/g, " ").trim() || "";
  if (aba !== "texto" || !sel.rangeCount || txt.length < 8 || !area.contains(sel.anchorNode) || !area.contains(sel.focusNode)) return esconderChecarTrecho();
  const fala = (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest(".fala");
  const dado = fala ? falas.find((x) => x.tempo === fala.dataset.tempo) : null;
  trechoEscolhido = { trecho: txt.slice(0, 2000), quem: dado?.quem || null, tempo: dado?.tempo || null };
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const b = $("#checar-trecho");
  b.hidden = false;
  const w = b.offsetWidth, h = b.offsetHeight;
  // no toque o menu do sistema fica em cima da seleção: o botão vai embaixo
  const embaixo = matchMedia("(pointer: coarse)").matches || r.top - h - 8 < area.getBoundingClientRect().top;
  b.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  b.style.top = `${Math.min(innerHeight - h - 8, embaixo ? r.bottom + 8 : r.top - h - 8)}px`;
}
let quadroSelecao = 0;
document.addEventListener("selectionchange", () => { cancelAnimationFrame(quadroSelecao); quadroSelecao = requestAnimationFrame(seguirSelecao); });
area.addEventListener("scroll", () => { if (trechoEscolhido) seguirSelecao(); }, { passive: true });
$("#checar-trecho").addEventListener("pointerdown", (e) => e.preventDefault());   // não perde a seleção ao clicar
$("#checar-trecho").addEventListener("click", () => {
  const t = trechoEscolhido;
  if (!t) return;
  getSelection().removeAllRanges();
  esconderChecarTrecho();
  pedirChecagem(t);
});

// ---------------------------------------------------------------- transcricao

let temVozes = false;

function pessoas() {
  const conta = new Map();
  for (const x of falas) conta.set(x.quem, (conta.get(x.quem) || 0) + 1);
  if (conta.size < 2) { $("#pessoas").innerHTML = ""; return; }
  $("#pessoas").innerHTML = [...conta].sort((a, b) => b[1] - a[1]).map(([nome, n]) => {
    const renomeavel = temVozes && nome !== "Eu" && nome !== "Outros" && nome !== "Desconhecido";
    return `<span class="pessoa-grupo"><button class="pessoa" aria-pressed="${nome === pessoa}" data-nome="${f.esc(nome)}" title="Mostrar só as falas de ${f.esc(rotulo(nome))}">${f.esc(rotulo(nome))} <b>${n}</b></button>${
      renomeavel ? `<button class="renomear" data-renomear="${f.esc(nome)}" title="Dar nome a esta voz (fica memorizada para as próximas reuniões)" aria-label="Renomear ${f.esc(nome)}"><i class="ph ph-pencil-simple"></i></button>` : ""}</span>`;
  }).join("");
}

$("#pessoas").addEventListener("click", (e) => {
  const r = e.target.closest("[data-renomear]");
  if (!r) return;
  const de = r.dataset.renomear;
  const grupo = r.closest(".pessoa-grupo");
  grupo.innerHTML = `<input class="pessoa-input" value="${/^Falante \d+$/.test(de) ? "" : f.esc(de)}" placeholder="Nome de ${f.esc(de)}" maxlength="60" aria-label="Novo nome para ${f.esc(de)}">`;
  const inp = grupo.querySelector("input");
  inp.focus();
  let feito = false;
  const fim = async (salvar) => {
    if (feito) return;
    feito = true;
    const para = inp.value.trim();
    if (!salvar || !para || para === de) return pessoas();
    try {
      await chamar("nomear", { base, de, para });
      avisar(`${de} agora é ${para}. A voz fica memorizada para as próximas reuniões.`);
      if (pessoa === de) pessoa = para;
      await carregar(true);
    } catch (er) { avisar(er.message); pessoas(); }
  };
  inp.addEventListener("keydown", (k) => { if (k.key === "Enter") fim(true); else if (k.key === "Escape") fim(false); });
  inp.addEventListener("blur", () => fim(true));
});

function desenhar() {
  const termo = $("#procura").value.trim();
  const re = termo ? new RegExp(termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  const reEsc = termo ? new RegExp(f.esc(termo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : null;
  let anterior = null, html = "", n = 0;
  for (const x of falas) {
    if ((pessoa && x.quem !== pessoa) || (re && !re.test(x.diz))) { anterior = null; continue; }
    const nova = x.quem !== anterior;
    anterior = x.quem;
    const diz = reEsc ? f.esc(x.diz).replace(reEsc, (m) => `<mark>${m}</mark>`) : f.esc(x.diz);
    html += `<p class="fala${nova ? " nova" : ""}${x.duvidosa ? " duvidosa" : ""}" data-tempo="${x.tempo}"${x.duvidosa ? ` title="Provável alucinação do Whisper com o microfone mudo"` : ""}>
      <span class="tempo">${x.tempo}</span><span class="quem${x.quem === "Eu" ? " eu" : ""}">${f.esc(rotulo(x.quem))}</span><span class="diz">${diz}</span></p>`;
    n++;
  }
  area.innerHTML = n ? html : `<div class="vazio"><h2>Nada encontrado</h2><p>${falas.length ? "Nenhuma fala bate com o filtro." : "A transcrição está vazia."}</p></div>`;
}

$("#procura").addEventListener("input", desenhar);
$("#pessoas").addEventListener("click", (e) => {
  const b = e.target.closest(".pessoa");
  if (!b) return;
  pessoa = pessoa === b.dataset.nome ? null : b.dataset.nome;
  document.querySelectorAll(".pessoa").forEach((p) => p.setAttribute("aria-pressed", String(p.dataset.nome === pessoa)));
  desenhar();
});

// Na versão web o leitor fica num quadro: copia daqui mesmo (a área de transferência pede o foco da página).
async function copiar(texto, msg) {
  try { await (naWeb ? navigator.clipboard.writeText(texto) : chamar("copiar", { texto })); avisar(msg); }
  catch (e) { avisar(e.message); }
}
$("#copiar").addEventListener("click", () =>
  copiar(falas.map((x) => `[${x.tempo}] ${rotulo(x.quem)}: ${x.diz}`).join("\n"), "Transcrição copiada."));

// Texto simples, para colar em e-mail, chat ou nota: as ações viram uma lista de tarefas.
$("#copiar-resumo").addEventListener("click", () => {
  if (aba === "checagem") return copiarChecagem();
  const r = resumo;
  if (!r) return;
  const lista = (t, itens) => itens?.length ? [`${t}:`, ...itens, ""] : [];
  const txt = [
    $("#titulo").textContent, $("#meta").textContent, "",
    r.veredito, "",
    ...lista("O que você precisa fazer", (r.acoes || []).map((a) => {
      const meta = [a.pedido_por ? `pedido por ${a.pedido_por}` : null, a.prazo ? `prazo: ${a.prazo}` : null, a.tempo ? `em ${a.tempo}` : null].filter(Boolean);
      return `[${a.feita ? "x" : " "}] ${a.acao}${meta.length ? ` (${meta.join(", ")})` : ""}`;
    })),
    ...lista("Fique sabendo", r.atencao?.map((x) => `- ${x}`)),
    ...lista("Do que se falou", r.resumo?.map((x) => `- ${x}`)),
  ].join("\n").trim();
  copiar(txt, "Resumo copiado.");
});

function copiarChecagem() {
  const itens = checagem?.itens || [];
  if (!itens.length) return;
  const txt = [
    `Fato ou fake: ${$("#titulo").textContent}`, "",
    ...itens.map((x) => {
      const quem = [x.quem ? rotulo(x.quem) : null, x.tempo].filter(Boolean).join(" em ");
      return [`[${(VEREDITOS[x.veredito] || VEREDITOS.sem_dados).txt.toUpperCase()}] ${x.afirmacao}${quem ? ` (${quem})` : ""}`,
        x.explicacao, ...(x.fontes || []).map((fo) => `Fonte: ${fo.url}`), ""].join("\n");
    }),
  ].join("\n").trim();
  copiar(txt, "Checagem copiada.");
}

// ‹ Reuniões: dentro da lista fecha o quadro; aberto sozinho (janela própria) não tem para onde voltar.
const embutido = window.parent !== window && !!window.parent.fecharLeitor;
const voltar = () => window.parent.fecharLeitor();
$("#voltar").hidden = !embutido;
if (embutido) {
  $("#voltar").addEventListener("click", voltar);
  // botão de voltar do mouse: sem preventDefault o navegador também voltaria, duas vezes
  addEventListener("mouseup", (e) => { if (e.button === 3) { e.preventDefault(); voltar(); } });
}
$("#abrir").addEventListener("click", () => chamar("abrirArquivo", { base, ext: "transcricao.md" }).catch((e) => avisar(e.message)));
$("#pasta").addEventListener("click", () => chamar(naWeb ? "baixar" : "pasta", { base }).catch((e) => avisar(e.message)));
if (naWeb) {
  // no navegador não há pasta nem editor: os dois botões baixam
  const p = $("#pasta"), a = $("#abrir");
  p.title = "Baixar o áudio e a transcrição"; p.setAttribute("aria-label", p.title);
  p.querySelector("i").className = "ph ph-download-simple";
  a.title = "Baixar a transcrição (.md)"; a.setAttribute("aria-label", a.title);
  a.querySelector("i").className = "ph ph-file-arrow-down";
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "f") { e.preventDefault(); abrirAba("texto"); $("#procura").focus(); $("#procura").select(); }
  else if (e.key === "Escape" && !e.target.closest?.(".pessoa-input")) {
    if ($("#procura").value) { $("#procura").value = ""; desenhar(); }
    else if (embutido) voltar();
  }
});

let tempoAviso;
function avisar(msg) {
  const a = $("#aviso");
  a.textContent = msg;
  a.classList.add("visivel");
  clearTimeout(tempoAviso);
  tempoAviso = setTimeout(() => a.classList.remove("visivel"), 3000);
}

carregar(true);
