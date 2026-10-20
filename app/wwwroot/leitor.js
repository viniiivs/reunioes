import { chamar, aoMudar, naWeb } from "./ponte.js";
import * as f from "./fmt.js";

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const base = q.get("b") || "";
const area = $("#texto");
const painelResumo = $("#resumo");
let falas = [];
let pessoa = null;
let resumo = null;
let estadoResumo = null;
let resumoAtivo = true;
let nomeEu = null;   // nome da pessoa (Configurações > Resumo); só muda o que aparece, o arquivo segue com "Eu"
const rotulo = (q) => (q === "Eu" && nomeEu ? nomeEu : q);

// O mic mudo faz o Whisper inventar "Obrigado." / "Tchau." soltos no canal "Eu".
const DUVIDOSA = /^(obrigad[oa]|tchau|valeu|e aí|legenda .*)[.!]*$/i;
const RE_FALA = /^\*\*\[(\d\d:\d\d:\d\d)\] (.+?):\*\*\s*(.*)$/;

// ---------------------------------------------------------------- abas

function abrirAba(qual) {
  const resumoAtivo = qual !== "texto";
  $("#aba-resumo").setAttribute("aria-selected", String(resumoAtivo));
  $("#aba-texto").setAttribute("aria-selected", String(!resumoAtivo));
  $("#painel-resumo").hidden = !resumoAtivo;
  $("#painel-texto").hidden = resumoAtivo;
}
$("#aba-resumo").addEventListener("click", () => abrirAba("resumo"));
$("#aba-texto").addEventListener("click", () => abrirAba("texto"));
$(".abas").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const outra = $("#aba-resumo").getAttribute("aria-selected") === "true" ? "texto" : "resumo";
  abrirAba(outra);
  $(outra === "texto" ? "#aba-texto" : "#aba-resumo").focus();
});
abrirAba(q.get("aba") || "resumo");

// ---------------------------------------------------------------- carregar

area.innerHTML = `<div class="esqueleto" aria-hidden="true">${"<div></div>".repeat(9)}</div>`;
painelResumo.innerHTML = `<div class="esqueleto" aria-hidden="true"><div class="grande"></div>${"<div></div>".repeat(6)}</div>`;

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
  } catch (e) {
    if (primeira) {
      area.innerHTML = `<div class="vazio"><h2>Não consegui abrir a transcrição</h2><p>${f.esc(e.message)}</p></div>`;
      painelResumo.innerHTML = "";
    }
  }
}

// Atualiza o resumo quando o Claude termina (o host avisa qualquer mudança na pasta).
aoMudar((m) => {
  if (m.evento === "aba") return abrirAba(m.aba);
  if (m.evento === "mudou" && (!resumo || estadoResumo?.estado === "gerando" || estadoResumo?.estado === "fila")) carregar(false);
});

// ---------------------------------------------------------------- resumo

function desenharResumo() {
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
  const acoes = (r.acoes || []).map((a) => {
    const meta = [a.pedido_por ? `Pedido por ${f.esc(a.pedido_por)}` : null, a.prazo ? `Prazo: ${f.esc(a.prazo)}` : null].filter(Boolean);
    return `<li><b>${f.esc(a.acao)}</b><small>${meta.join(". ")}${meta.length ? ". " : ""}${a.tempo ? `Trecho em <button class="tempo-link" data-tempo="${f.esc(a.tempo)}">${f.esc(a.tempo)}</button>` : ""}</small></li>`;
  }).join("");

  painelResumo.innerHTML = `
    <div class="veredito-topo${r.precisa_agir ? " agir" : ""}">
      <i class="ph ${r.precisa_agir ? "ph-flag" : "ph-check-circle"}" aria-hidden="true"></i>
      <div><strong>${f.esc(r.veredito)}</strong>
      <span>${r.precisa_agir ? "Segundo o Claude, você precisa agir." : "Segundo o Claude, nada depende de você."}</span></div>
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

$("#copiar").addEventListener("click", async () => {
  const txt = falas.map((x) => `[${x.tempo}] ${rotulo(x.quem)}: ${x.diz}`).join("\n");
  try { await chamar("copiar", { texto: txt }); avisar("Transcrição copiada."); }
  catch (e) { avisar(e.message); }
});
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
  else if (e.key === "Escape" && $("#procura").value) { $("#procura").value = ""; desenhar(); }
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
