import { chamar, aoMudar } from "./ponte.js";
import * as f from "./fmt.js";
import { animaSw } from "./controles.js";

const $ = (s) => document.querySelector(s);
const linhas = $("#linhas");
const filtro = $("#filtro");
let dados = [];
let carregou = false;

// ---------------------------------------------------------------- carregar

let emVoo = null;
async function carregar() {
  if (emVoo) return emVoo;
  emVoo = (async () => {
    try {
      dados = await chamar("listar");
      carregou = true;
      desenhar();
    } catch (e) {
      if (!carregou) erroGeral(e);
      else avisar("Não consegui atualizar a lista: " + e.message);
    } finally {
      $("#lista").setAttribute("aria-busy", "false");
      emVoo = null;
    }
  })();
  return emVoo;
}

function esqueleto() {
  linhas.innerHTML = `<div class="esqueleto" aria-hidden="true">${"<div></div>".repeat(6)}</div>`;
}

function erroGeral(e) {
  linhas.innerHTML = `
    <div class="vazio">
      <h2>Não consegui ler as gravações</h2>
      <p>${f.esc(e.message)}</p>
      <button class="btn" data-acao="recarregar"><i class="ph ph-arrows-clockwise" aria-hidden="true"></i> Tentar de novo</button>
    </div>`;
}

// ---------------------------------------------------------------- desenhar

function bate(g, termo) {
  if (!termo) return true;
  const d = new Date(g.inicio);
  const alvo = [
    f.dia(d), f.diaCurto(d), f.hora(d), g.base, g.rotulo || "",
    ...(g.apps || []).map((a) => f.nomeApp(a.exe)),
    ...(g.falantes || []),
  ].join(" ").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return termo.split(/\s+/).every((t) => alvo.includes(t));
}

function desenhar() {
  const termo = filtro.value.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const total = dados.reduce((s, g) => s + g.bytes, 0);
  $("#resumo").textContent = dados.length
    ? `${f.plural(dados.length, "gravação", "gravações")}, ${f.tamanho(total)}`
    : "";

  if (!dados.length) {
    linhas.innerHTML = `
      <div class="vazio">
        <h2>Nenhuma gravação ainda</h2>
        <p>Clique em Gravar no topo${est?.atalho ? `, use ${est.atalho.split("+").map((k) => `<kbd>${f.esc(k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1))}</kbd>`).join(" ")}` : ""} ou entre numa chamada com “Gravar sozinho” ligado. As gravações aparecem aqui sozinhas.</p>
      </div>`;
    return;
  }

  const visiveis = dados.filter((g) => bate(g, termo));
  if (!visiveis.length) {
    linhas.innerHTML = `
      <div class="vazio">
        <h2>Nada encontrado</h2>
        <p>Nenhuma gravação bate com “${f.esc(filtro.value.trim())}”.</p>
        <button class="btn" data-acao="limpar">Limpar filtro</button>
      </div>`;
    return;
  }

  linhas.innerHTML = visiveis.map((g) => linha(g, new Date(g.inicio))).join("");
}

function linha(g, d) {
  const curta = g.duracao != null && g.duracao < 60;
  const fim = g.duracao != null ? new Date(d.getTime() + g.duracao * 1000) : null;
  const b = f.esc(g.base);

  const apps = g.apps == null
    ? `<span class="apagado" title="Gravada antes de o gravador registrar os apps">não registrado</span>`
    : g.apps.length === 0
      ? `<span class="apagado">nenhum app tocou som</span>`
      : `<span class="apps" title="${f.esc(g.apps.map((a) => `${f.nomeApp(a.exe)}: ${f.duracao(a.segundos)}`).join("\n"))}">${
          g.apps.slice(0, 3).map((a) => `<span class="app">${f.esc(f.nomeApp(a.exe))}</span>`).join("")}</span>`;

  // sem separar vozes os outros viram um bloco so ("Outros"): contar nao diz nada
  const falantes = g.falantes && g.vozes
    ? `<span class="falantes" title="${f.esc(g.falantes.join(", "))}"><i class="ph ph-users" aria-hidden="true"></i>${g.falantes.length}</span>`
    : `<span class="apagado sr">sem transcrição</span>`;

  return `
    <div class="linha${curta ? " curta" : ""}" data-base="${b}" role="row">
      <span class="cel data" title="${f.esc(f.dia(d))}">${f.esc(f.diaTabela(d))}</span>
      <div class="quando" title="${f.esc(g.base)}${g.auto ? `\nGravada sozinha: ${f.esc(g.auto)} pegou o microfone` : ""}">
        <span class="hora">${f.hora(d)}</span>
        ${fim ? `<span class="ate">até ${f.hora(fim)}</span>` : ""}
        ${g.auto ? `<i class="ph ph-lightning raio" aria-label="gravada sozinha"></i>` : ""}
      </div>
      <span class="num cel">${g.duracao != null ? f.duracao(g.duracao) : `<span class="apagado">?</span>`}</span>
      <span class="num cel col-tam">${f.tamanho(g.bytes)}</span>
      <span class="cel col-apps">${apps}</span>
      <span class="num">${falantes}</span>
      <span class="cel">${estado(g)}</span>
      <span class="cel">${paraVoce(g)}</span>
      <div class="acoes">${acoes(g)}</div>
    </div>`;
}

function estado(g) {
  switch (g.estado) {
    case "pronta": return `<span class="estado pronta"><i class="ph ph-check" aria-hidden="true"></i>Transcrita</span>`;
    case "transcrevendo": return `<span class="estado transcrevendo" title="${f.esc(g.etapa || "")}"><i class="ph ph-circle-notch girando" aria-hidden="true"></i><span class="etapa">${f.esc(etapaCurta(g.etapa))}</span></span>`;
    case "fila": return `<span class="estado fila"><i class="ph ph-hourglass" aria-hidden="true"></i>Na fila</span>`;
    case "gravando": return `<span class="estado gravando"><i class="ph ph-record" aria-hidden="true"></i>Gravando agora</span>`;
    case "incompleta": return `<span class="estado incompleta" title="O gravador foi interrompido e o arquivo FLAC ficou sem o fim. Precisa ser reparado antes de transcrever."><i class="ph ph-warning" aria-hidden="true"></i>Áudio incompleto</span>`;
    default: return `<span class="estado sem">Não transcrita</span>`;
  }
}

// Coluna "Para você": o veredito do resumo do Claude.
function paraVoce(g) {
  if (g.estado !== "pronta") return "";
  const r = g.resumo;
  if (!r && est && !est.resumoAtivo) return "";
  if (!r) return `<button class="link" data-acao="resumir" title="Pedir ao Claude um resumo com o que você precisa fazer"><i class="ph ph-sparkle" aria-hidden="true"></i>Resumir</button>`;
  switch (r.estado) {
    case "gerando": return `<span class="veredito espera"><i class="ph ph-circle-notch girando" aria-hidden="true"></i>Resumindo…</span>`;
    case "fila": return `<span class="veredito espera"><i class="ph ph-hourglass" aria-hidden="true"></i>Na fila do resumo</span>`;
    case "erro": return `<button class="link erro" data-acao="resumir" title="${f.esc(r.erro || "")}"><i class="ph ph-warning" aria-hidden="true"></i>Resumo falhou, tentar de novo</button>`;
    default: return r.precisaAgir
      ? `<button class="veredito agir" data-acao="resumo" title="${f.esc(r.veredito)}"><i class="ph ph-flag" aria-hidden="true"></i><span>${f.esc(r.veredito)}</span></button>`
      : `<button class="veredito nada" data-acao="resumo" title="${f.esc(r.veredito)}"><i class="ph ph-check-circle" aria-hidden="true"></i><span>${f.esc(r.veredito)}</span></button>`;
  }
}

function etapaCurta(e) {
  if (!e) return "Transcrevendo";
  const m = e.match(/^(\d)\/(\d) (.*)$/);
  if (!m) return "Transcrevendo, " + e;
  return `Transcrevendo ${m[1]}/${m[2]}`;
}

function acoes(g) {
  let principal;
  if (g.estado === "pronta") principal = `<button class="btn" data-acao="ler"><i class="ph ph-file-text acento" aria-hidden="true"></i> Ler</button>`;
  else if (g.estado === "transcrevendo" || g.estado === "fila") principal = `<button class="btn" data-acao="cancelar"><i class="ph ph-x" aria-hidden="true"></i> Cancelar</button>`;
  else if (g.estado === "sem") principal = `<button class="btn" data-acao="transcrever"><i class="ph ph-waveform" aria-hidden="true"></i> Transcrever</button>`;
  else principal = `<button class="btn" disabled><i class="ph ph-waveform" aria-hidden="true"></i> Transcrever</button>`;
  const ocupada = g.estado === "gravando" || g.estado === "transcrevendo" || g.estado === "fila";
  return `${principal}
    <button class="btn icone" data-acao="pasta" title="Mostrar os arquivos na pasta" aria-label="Mostrar os arquivos na pasta"><i class="ph ph-folder-open" aria-hidden="true"></i></button>
    <button class="btn icone perigo-hover" data-acao="excluir" ${ocupada ? "disabled" : ""} title="${ocupada ? "Não dá para excluir agora" : "Excluir (vai para a Lixeira)"}" aria-label="Excluir gravação"><i class="ph ph-trash" aria-hidden="true"></i></button>`;
}

// ---------------------------------------------------------------- acoes

function titulo(g) {
  const d = new Date(g.inicio);
  return `${f.diaCurto(d)} às ${f.hora(d)}`;
}

async function agir(acao, g, botao) {
  try {
    switch (acao) {
      case "ler":
      case "resumo":
        return await chamar("abrirLeitor", { base: g.base, titulo: `Reunião de ${titulo(g)}`, aba: acao === "ler" ? "texto" : "resumo" });
      case "resumir":
        botao.disabled = true;
        await chamar("resumir", { base: g.base });
        return carregar();
      case "transcrever":
        botao.disabled = true;
        await chamar("transcrever", { base: g.base });
        avisar(`Transcrição de ${titulo(g)} começou. Leva mais ou menos o tempo do áudio.`);
        return carregar();
      case "cancelar":
        botao.disabled = true;
        await chamar("cancelar", { base: g.base });
        return carregar();
      case "pasta":
        return await chamar("pasta", { base: g.base });
      case "excluir": {
        const tem = g.estado === "pronta" ? "o áudio e a transcrição" : "o áudio";
        $("#conf-titulo").textContent = `Excluir a gravação de ${titulo(g)}?`;
        $("#conf-texto").textContent = `Os arquivos (${tem}, ${f.tamanho(g.bytes)}) vão para a Lixeira do Windows.`;
        const dlg = $("#confirmar");
        dlg.returnValue = "";
        dlg.showModal();
        const r = await new Promise((ok) => dlg.addEventListener("close", () => ok(dlg.returnValue), { once: true }));
        if (r !== "sim") return;
        await chamar("excluir", { base: g.base });
        avisar(`Gravação de ${titulo(g)} enviada para a Lixeira.`);
        return carregar();
      }
    }
  } catch (e) {
    if (botao) botao.disabled = false;
    avisar(e.message);
  }
}

linhas.addEventListener("click", (e) => {
  const botao = e.target.closest("[data-acao]");
  if (!botao) return;
  const acao = botao.dataset.acao;
  if (acao === "recarregar") { esqueleto(); return carregar(); }
  if (acao === "limpar") { filtro.value = ""; desenhar(); return filtro.focus(); }
  const base = botao.closest(".linha")?.dataset.base;
  const g = dados.find((x) => x.base === base);
  if (g) agir(acao, g, botao);
});

linhas.addEventListener("dblclick", (e) => {
  if (e.target.closest("button")) return;
  const base = e.target.closest(".linha")?.dataset.base;
  const g = dados.find((x) => x.base === base);
  if (g?.estado === "pronta") agir("ler", g);
});

$("#pasta").addEventListener("click", () => chamar("pasta").catch((e) => avisar(e.message)));
$("#atualizar").addEventListener("click", () => carregar());
filtro.addEventListener("input", desenhar);

document.addEventListener("keydown", (e) => {
  if (e.key === "F5") { e.preventDefault(); carregar(); }
  else if ((e.ctrlKey && e.key.toLowerCase() === "f") || (e.key === "/" && document.activeElement !== filtro)) {
    e.preventDefault(); filtro.focus(); filtro.select();
  } else if (e.key === "Escape" && document.activeElement === filtro && filtro.value) {
    filtro.value = ""; desenhar();
  }
});

let tempoAviso;
function avisar(msg) {
  const a = $("#aviso");
  a.textContent = msg;
  a.classList.add("visivel");
  clearTimeout(tempoAviso);
  tempoAviso = setTimeout(() => a.classList.remove("visivel"), 4200);
}


// ---------------------------------------------------------------- estado geral: gravar, servico, avisos

const botaoAuto = $("#auto");
const botaoGravar = $("#gravar");
let est = null;
const ATALHO_NOME = (a) => (a || "").split("+").map((p) => p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)).join(" + ");

async function lerEstado() {
  try { est = await chamar("estado"); } catch { return; }
  if (!est) return;

  botaoGravar.classList.toggle("ativo", est.gravando);
  botaoGravar.querySelector("i").className = `ph ${est.gravando ? "ph-stop" : "ph-record"}`;
  botaoGravar.querySelector("span").textContent = est.gravando ? "Parar" : "Gravar";
  botaoGravar.title = est.gravando ? "Para a gravação" : `Começa a gravar agora${est.atalho ? ` (${ATALHO_NOME(est.atalho)})` : ""}`;

  const on = est.gravarSozinho && est.servico.rodando;
  const mudou = botaoAuto.getAttribute("aria-checked") !== String(est.gravarSozinho);
  botaoAuto.setAttribute("aria-checked", String(est.gravarSozinho));
  if (mudou) animaSw(botaoAuto.querySelector(".sw i"), est.gravarSozinho, false);
  botaoAuto.classList.toggle("alerta", est.gravarSozinho && !est.servico.rodando);
  botaoAuto.classList.toggle("no-mic", on && !!est.servico.app);
  $("#auto-status").textContent = est.gravarSozinho && !est.servico.rodando ? "serviço parado"
    : on && est.servico.app ? `${est.servico.app} no microfone`
    : on ? "ao entrar numa chamada" : "desligado";

  // faixa de aviso: motor pendente tem prioridade sobre atualizacao pronta
  const faixa = $("#faixa");
  if (!est.motorPronto) {
    faixa.innerHTML = `<i class="ph ph-warning" aria-hidden="true"></i><span>O motor de transcrição precisa ser instalado ou atualizado.</span><a class="btn" href="config.html#s-motor">Abrir Configurações</a>`;
    faixa.hidden = false;
  } else if (est.atualizacao?.estado === "pronta") {
    faixa.innerHTML = `<i class="ph ph-arrow-circle-up" aria-hidden="true"></i><span>A versão ${f.esc(est.atualizacao.nova)} está pronta.</span><button class="btn primario" data-acao="atualizar">Reiniciar e atualizar</button>`;
    faixa.hidden = false;
  } else if (est.atalho && est.servico.rodando && est.servico.atalhoOk === false) {
    faixa.innerHTML = `<i class="ph ph-keyboard" aria-hidden="true"></i><span>O atalho ${f.esc(ATALHO_NOME(est.atalho))} já é usado por outro programa. Escolha outro.</span><a class="btn" href="config.html#s-extras">Trocar atalho</a>`;
    faixa.hidden = false;
  } else faixa.hidden = true;
  if (carregou && !dados.length && !filtro.value) desenhar();   // o vazio mostra o atalho
}

botaoAuto.addEventListener("click", async () => {
  const ligar = botaoAuto.getAttribute("aria-checked") !== "true";
  botaoAuto.setAttribute("aria-checked", String(ligar));
  animaSw(botaoAuto.querySelector(".sw i"), ligar, true);
  try {
    await chamar("gravarSozinho", { ligado: ligar });
    avisar(ligar ? "Gravação automática ligada." : `Gravação automática desligada.${est?.atalho ? ` Use ${ATALHO_NOME(est.atalho)} para gravar na mão.` : ""}`);
  } catch (e) { avisar(e.message); }
  setTimeout(lerEstado, 1500);
});

botaoGravar.addEventListener("click", async () => {
  botaoGravar.disabled = true;
  try {
    await chamar("gravar");
    avisar(est?.gravando ? "Gravação parada." : "Gravando. Clique em Parar quando a reunião acabar.");
  } catch (e) { avisar(e.message); }
  setTimeout(() => { botaoGravar.disabled = false; lerEstado(); carregar(); }, 1500);
});

$("#faixa").addEventListener("click", async (e) => {
  if (!e.target.closest("[data-acao=atualizar]")) return;
  try { await chamar("aplicarAtualizacao"); } catch (er) { avisar(er.message); }
});

lerEstado();
setInterval(lerEstado, 3000);

aoMudar((m) => { if (m.evento === "mudou") carregar(); else if (m.evento === "atualizacao") lerEstado(); });
esqueleto();
carregar();
