import { chamar, aoMudar } from "./ponte.js";
import { interruptor, ligarInterruptores, ligado, animaSw, avisar } from "./controles.js";
import { esc } from "./fmt.js";

// Uma pagina, dois modos: ?modo=setup e o assistente da primeira execucao (uma secao por passo);
// sem isso e a tela de Configuracoes (todas as secoes, menu lateral, barra de salvar).
const SETUP = new URLSearchParams(location.search).get("modo") === "setup";
const $ = (s) => document.querySelector(s);
const conteudo = $("#conteudo");
const rodape = $("#rodape");

let cfg, sis, dev, tokenNovo = null, pendentes = [], atalhoOcupado = false;
let passo = 0, sujo = false, instalando = false, instalado = false;

const GITHUB = "https://github.com/viniiivs";
const REPO = "https://github.com/viniiivs/reunioes";
const HF_MODELO = "https://huggingface.co/pyannote/speaker-diarization-community-1";

const IDIOMAS = [["pt", "Português"], ["en", "English"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["it", "Italiano"]];
const QUALIDADES = [
  { id: "large-v3", nome: "Máxima", desc: "Melhor texto. Precisa de placa de vídeo NVIDIA para ficar rápido.", gb: 3.1 },
  { id: "medium", nome: "Equilibrada", desc: "Boa qualidade, metade do tamanho. Roda bem com placa de vídeo.", gb: 1.5 },
  { id: "small", nome: "Rápida", desc: "Para computadores sem placa de vídeo. Erra mais nomes e termos.", gb: 0.5 },
];
const ATALHOS = [["ctrl+alt+g", "Ctrl + Alt + G"], ["ctrl+alt+r", "Ctrl + Alt + R"], ["ctrl+shift+f9", "Ctrl + Shift + F9"], ["", "Nenhum"]];

// ---------------------------------------------------------------- secoes

const SECOES = [
  { id: "boasvindas", titulo: "Boas-vindas", icone: "hand-waving", so: "setup", render: rBoasVindas },
  { id: "pastas", titulo: "Pastas", icone: "folder", render: rPastas, ler: lPastas },
  { id: "transcricao", titulo: "Transcrição", icone: "text-align-left", render: rTranscricao, ler: lTranscricao },
  { id: "audio", titulo: "Áudio", icone: "microphone", render: rAudio, ler: lAudio },
  { id: "extras", titulo: "Gravação", icone: "record", render: rExtras, ler: lExtras },
  { id: "resumo", titulo: "Resumo com IA", icone: "sparkle", render: rResumo, ler: lResumo },
  { id: "instalar", titulo: "Instalação", icone: "download-simple", so: "setup", render: rInstalar },
  { id: "pronto", titulo: "Pronto", icone: "check", so: "setup", render: rPronto },
  { id: "motor", titulo: "Motor", icone: "cpu", so: "config", render: rMotor },
  { id: "atualizacoes", titulo: "Atualizações", icone: "arrows-clockwise", so: "config", render: rAtualizacoes, ler: lAtualizacoes },
  { id: "sobre", titulo: "Sobre", icone: "info", so: "config", render: rSobre },
];
const visiveis = () => SECOES.filter((s) => !s.so || s.so === (SETUP ? "setup" : "config"));

function rBoasVindas() {
  return `
    <h1>Bem-vindo ao Reuniões</h1>
    <p class="lead">Grava suas reuniões, transcreve e diz o que ficou para você fazer. Leva alguns minutos para configurar.</p>
    <ul class="recursos">
      <li><i class="ph ph-waveform"></i><div><b>Sua voz e a dos outros em faixas separadas</b><span>Grava o microfone e o som do computador ao mesmo tempo, sem perder qualidade.</span></div></li>
      <li><i class="ph ph-lock-simple"></i><div><b>Transcrição no seu computador</b><span>O áudio nunca sai da sua máquina. A IA de transcrição roda aqui mesmo.</span></div></li>
      <li><i class="ph ph-lightning"></i><div><b>Grava sozinho quando a reunião começa</b><span>Percebe quando um app de chamada (Teams, Meet, Discord, Zoom...) usa o microfone.</span></div></li>
      <li><i class="ph ph-sparkle"></i><div><b>Resumo com o que é seu</b><span>Opcional: o Claude lê a transcrição e lista as suas tarefas, com o trecho que comprova cada uma.</span></div></li>
    </ul>
    <p class="credito">Feito por Vinícius Vieira <span aria-hidden="true">·</span> <a data-link="${GITHUB}">github.com/viniiivs</a></p>`;
}

function rPastas() {
  const pasta = (id, rot, valor, ajuda) => `
    <label class="campo"><span>${rot}</span>
      <div class="pasta"><input id="${id}" value="${esc(valor)}" spellcheck="false">
        <button type="button" class="btn" data-escolher="${id}"><i class="ph ph-folder-open"></i> Escolher</button></div>
      <small>${ajuda} <span class="espaco" data-espaco="${id}"></span></small>
    </label>`;
  return `
    <h2>Onde guardar</h2>
    <p class="lead">As gravações ocupam cerca de 100 MB por hora. O motor de transcrição é grande e fica numa pasta separada.</p>
    <div class="pilha">
      ${pasta("pastaGravacoes", "Gravações e transcrições", cfg.pastaGravacoes, "Áudios, textos e resumos.")}
      ${pasta("pastaMotor", "Motor de transcrição", cfg.pastaMotor, `Precisa de cerca de <b id="precisa">${tamanhoTotal().toFixed(1).replace(".", ",")} GB</b>.`)}
    </div>`;
}
function lPastas() { cfg.pastaGravacoes = $("#pastaGravacoes").value.trim(); cfg.pastaMotor = $("#pastaMotor").value.trim(); }

function rTranscricao() {
  const gpu = sis.nvidia;
  const recomendada = gpu ? "large-v3" : "small";
  return `
    <h2>Transcrição</h2>
    <p class="lead">${gpu
      ? `Encontrei uma placa de vídeo NVIDIA (${esc(sis.gpus.find((g) => /nvidia/i.test(g)) || "")}). A transcrição vai ser rápida.`
      : "Não encontrei placa de vídeo NVIDIA. A transcrição vai usar o processador: funciona, mas demora mais que a duração da reunião."}</p>
    <div class="pilha">
      <label class="campo"><span>Idioma das reuniões</span>
        <select id="idioma">${IDIOMAS.map(([v, n]) => `<option value="${v}" ${cfg.idioma === v ? "selected" : ""}>${n}</option>`).join("")}</select>
      </label>
      <div class="campo"><span>Qualidade</span>
        <div class="opcoes" role="radiogroup" aria-label="Qualidade">
          ${QUALIDADES.map((q) => `
            <button type="button" class="opcao" role="radio" data-modelo="${q.id}" aria-checked="${cfg.modelo === q.id}">
              ${q.id === recomendada ? `<span class="selo">Recomendada</span>` : ""}
              <b>${q.nome}</b><small>${q.desc}</small><small>${q.gb.toString().replace(".", ",")} GB</small>
            </button>`).join("")}
        </div>
      </div>
      ${interruptor("usarGpu", gpu && cfg.usarGpu, "Usar a placa de vídeo", gpu ? "Bem mais rápido. Desligue só se der problema." : "Precisa de uma placa NVIDIA.", !gpu)}
      ${interruptor("separarVozes", cfg.separarVozes, "Separar as vozes de cada pessoa", "Em vez de “Outros”, mostra Falante 1, Falante 2... e você pode dar nome a cada um. Precisa de uma conta grátis no Hugging Face.")}
      <div class="revela" id="vozes" ${cfg.separarVozes ? "" : "hidden"}>
        <div class="guia">O modelo que separa as vozes é gratuito, mas o autor pede que cada pessoa aceite os termos de uso:
          <ol>
            <li>Crie uma conta em <button class="link-ext" data-link="https://huggingface.co/join">huggingface.co</button> (grátis).</li>
            <li>Abra a <button class="link-ext" data-link="${HF_MODELO}">página do modelo</button> e aceite os termos.</li>
            <li>Em <button class="link-ext" data-link="https://huggingface.co/settings/tokens">Access Tokens</button>, crie um token do tipo <b>Read</b> e cole abaixo.</li>
          </ol>
        </div>
        <label class="campo"><span>Token do Hugging Face</span>
          <div class="pasta"><input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="${cfg.temToken ? "Token salvo. Cole outro para trocar." : "hf_..."}">
            <button type="button" class="btn" id="testarToken">Testar</button></div>
          <div class="status-linha" id="tokenStatus" aria-live="polite">${cfg.temToken ? `<i class="ph ph-check"></i> Token salvo neste computador (cifrado).` : ""}</div>
        </label>
      </div>
    </div>`;
}
function lTranscricao() {
  cfg.idioma = $("#idioma").value;
  cfg.modelo = document.querySelector(".opcao[aria-checked=true]")?.dataset.modelo || cfg.modelo;
  cfg.usarGpu = ligado("usarGpu");
  cfg.separarVozes = ligado("separarVozes");
  const t = $("#token").value.trim();
  if (t) tokenNovo = t;
}

function rAudio() {
  const sel = (id, rot, lista, atual, ajuda) => `
    <label class="campo"><span>${rot}</span>
      <select id="${id}">
        <option value="">Padrão do Windows${(() => { const p = lista.find((d) => d.padrao); return p ? ` (agora: ${esc(p.nome)})` : ""; })()}</option>
        ${lista.map((d) => `<option value="${esc(d.nome)}" ${atual === d.nome ? "selected" : ""}>${esc(d.nome)}</option>`).join("")}
        ${atual && !lista.some((d) => d.nome === atual) ? `<option value="${esc(atual)}" selected>${esc(atual)} (desconectado)</option>` : ""}
      </select><small>${ajuda}</small>
    </label>`;
  return `
    <h2>Áudio</h2>
    <p class="lead">Grava duas faixas: o seu microfone e o que sai no seu fone ou caixa de som (a voz dos outros).</p>
    <div class="pilha">
      ${sel("mic", "Microfone", dev.mics, cfg.mic, "A sua voz.")}
      ${sel("saida", "Saída de som", dev.saidas, cfg.saida, "Onde você ouve a reunião. “Padrão do Windows” acompanha quando você troca de fone.")}
    </div>`;
}
function lAudio() { cfg.mic = $("#mic").value || null; cfg.saida = $("#saida").value || null; }

function rExtras() {
  return `
    <h2>Gravação</h2>
    <p class="lead">Você pode gravar pelo botão no app, pelo atalho de teclado ou deixar que ele perceba a reunião sozinho.</p>
    <div class="pilha">
      ${interruptor("gravarSozinho", cfg.gravarSozinho, "Gravar sozinho quando uma reunião começar", "Começa quando um app de chamada (Teams, Meet, Discord, Zoom...) usa o microfone e para quando ele solta. Toca um bipe ao começar e ao parar.")}
      <label class="campo"><span>Atalho para gravar e parar</span>
        <select id="atalho">${ATALHOS.map(([v, n]) => `<option value="${v}" ${(cfg.atalho || "") === v ? "selected" : ""}>${n}</option>`).join("")}</select>
        <small>Funciona com o app fechado.</small>
        ${atalhoOcupado && cfg.atalho ? `<div class="status-linha ruim"><i class="ph ph-warning"></i> Este atalho já é usado por outro programa. Escolha outro.</div>` : ""}
      </label>
      ${interruptor("iniciarComWindows", cfg.iniciarComWindows, "Iniciar com o Windows", "Necessário para o atalho e a gravação automática funcionarem sem abrir o app.")}
      ${SETUP ? interruptor("atualizarSozinho", cfg.atualizarSozinho, "Atualizar sozinho", "Baixa versões novas em segundo plano e avisa quando é só reiniciar.") : ""}
    </div>`;
}
function lExtras() {
  cfg.gravarSozinho = ligado("gravarSozinho");
  cfg.atalho = $("#atalho").value || null;
  cfg.iniciarComWindows = ligado("iniciarComWindows");
  if (SETUP) cfg.atualizarSozinho = ligado("atualizarSozinho");
}

function rResumo() {
  const r = cfg.resumo;
  return `
    <h2>Resumo com IA</h2>
    <p class="lead">Opcional. Depois de transcrever, o Claude lê o texto e diz se você precisa fazer alguma coisa.</p>
    <div class="pilha">
      ${sis.claude ? "" : `
        <div class="guia">Precisa do <b>Claude Code</b> instalado e com login feito neste computador. Ele usa a sua conta do Claude.
          <button class="link-ext" data-link="https://claude.com/product/claude-code">Como instalar</button>
          <span aria-hidden="true"> · </span><button class="link-ext" id="checarClaude">Já instalei, verificar de novo</button></div>`}
      ${interruptor("resumoAtivo", r.ativo && sis.claude, "Resumir as reuniões", "Só o texto da transcrição vai para o Claude. O áudio continua no seu computador.", !sis.claude)}
      <div class="revela" id="resumoCampos" ${r.ativo && sis.claude ? "" : "hidden"}>
        <label class="campo"><span>Seu nome</span><input id="rNome" value="${esc(r.nome)}" placeholder="Como você se apresenta"></label>
        <label class="campo"><span>Como te chamam <small>(opcional)</small></span><input id="rApelidos" value="${esc(r.apelidos)}" placeholder="Apelidos, separados por vírgula"></label>
        <label class="campo"><span>Sobre o seu trabalho <small>(opcional)</small></span>
          <textarea id="rContexto" placeholder="Cargo, equipe, projetos, quem são seus chefes. Ajuda a IA a entender o que é com você.">${esc(r.contexto)}</textarea></label>
      </div>
    </div>`;
}
function lResumo() {
  cfg.resumo = { ativo: ligado("resumoAtivo"), nome: $("#rNome").value.trim(), apelidos: $("#rApelidos").value.trim(), contexto: $("#rContexto").value.trim() };
}

function rInstalar() {
  const nomeQ = QUALIDADES.find((q) => q.id === cfg.modelo)?.nome;
  const gb = tamanhoTotal();
  return `
    <h2>Instalar o motor de transcrição</h2>
    <p class="lead">Vou baixar o Python, as bibliotecas de IA e os modelos. Com internet boa leva de 5 a 15 minutos. Pode deixar o computador trabalhando.</p>
    <dl class="resumo-inst">
      <dt>Download</dt><dd>cerca de ${gb.toFixed(1).replace(".", ",")} GB</dd>
      <dt>Pasta</dt><dd>${esc(cfg.pastaMotor)}</dd>
      <dt>Qualidade</dt><dd>${nomeQ}${cfg.usarGpu && sis.nvidia ? ", na placa de vídeo" : ", no processador"}</dd>
      <dt>Separar vozes</dt><dd>${cfg.separarVozes ? "sim" : "não"}</dd>
    </dl>
    <div id="instalacao">${etapasHtml()}</div>`;
}

function rPronto() {
  const at = ATALHOS.find(([v]) => v === (cfg.atalho || ""))?.[1];
  return `
    <i class="ph ph-check-circle grande-ok" aria-hidden="true"></i>
    <h1>Tudo pronto</h1>
    <p class="lead">${cfg.gravarSozinho ? "Na próxima reunião ele começa a gravar sozinho (você ouve um bipe). " : ""}${cfg.atalho ? `Para gravar na hora, use ${at} ou o botão Gravar no app.` : "Para gravar, use o botão Gravar no app."} Depois é só clicar em Transcrever.</p>`;
}

function rMotor() {
  const q = QUALIDADES.find((x) => x.id === cfg.modelo)?.nome || cfg.modelo;
  return `
    <h2>Motor de transcrição</h2>
    <p class="lead">${pendentes.length ? "Algumas configurações mudaram e o motor precisa baixar ou instalar coisas novas." : "Instalado e em dia com a configuração."}</p>
    <div class="pilha">
      <div class="info"><span>Qualidade</span><b>${esc(q)}, ${cfg.usarGpu && sis.nvidia ? "na placa de vídeo" : "no processador"}</b></div>
      <div class="info"><span>Idioma</span><b>${esc(IDIOMAS.find(([v]) => v === cfg.idioma)?.[1] || cfg.idioma)}</b></div>
      <div class="info"><span>Separar vozes</span><b>${cfg.separarVozes ? "Sim" : "Não"}</b></div>
      <div class="info"><span>Pasta</span><b class="caminho">${esc(cfg.pastaMotor)}</b></div>
    </div>
    <div id="instalacao">${pendentes.length ? etapasHtml() : ""}</div>
    <div class="botoes">
      ${pendentes.length ? `<button class="btn primario" id="instalarAgora"><i class="ph ph-download-simple"></i> Instalar agora</button>` : ""}
      <button class="btn" id="verLog"><i class="ph ph-file-text"></i> Registro da instalação</button>
    </div>`;
}
function rAtualizacoes() {
  return `
    <h2>Atualizações</h2>
    <p class="lead">Versão instalada: <b>${esc(sis.versao)}</b></p>
    <div class="pilha">
      <div id="atualizacao">${atualizacaoHtml(ultimoStatus)}</div>
      ${interruptor("atualizarSozinho", cfg.atualizarSozinho, "Atualizar sozinho", "Procura ao abrir o app, baixa em segundo plano e avisa quando é só reiniciar.")}
    </div>`;
}
function lAtualizacoes() { cfg.atualizarSozinho = ligado("atualizarSozinho"); }

function rSobre() {
  const comp = [["WhisperX", "https://github.com/m-bain/whisperX"], ["faster-whisper", "https://github.com/SYSTRAN/faster-whisper"], ["pyannote.audio", "https://github.com/pyannote/pyannote-audio"],
    ["PyTorch", "https://pytorch.org"], ["uv", "https://github.com/astral-sh/uv"], ["Velopack", "https://velopack.io"], ["Phosphor Icons", "https://phosphoricons.com"], ["NAudio", "https://github.com/naudio/NAudio"], ["Inter", "https://rsms.me/inter/"]];
  return `
    <h2>Sobre</h2>
    <p class="lead">Grava, transcreve e resume reuniões no seu próprio computador.</p>
    <div class="pilha">
      <div class="info"><span>Versão</span><b>${esc(sis.versao)}</b></div>
      <div class="info"><span>Feito por</span><b>Vinícius Vieira · <button class="link-ext" data-link="${GITHUB}">github.com/viniiivs</button></b></div>
      <div class="info"><span>Código aberto</span><b><button class="link-ext" data-link="${REPO}">github.com/viniiivs/reunioes</button> · licença MIT</b></div>
    </div>
    <h3>Privacidade</h3>
    <p class="nota">Gravação e transcrição acontecem no seu computador. Só sai daqui o download dos modelos e das atualizações, e o texto da transcrição enviado ao Claude quando o resumo está ligado.</p>
    <h3>Feito com</h3>
    <p class="nota">${comp.map(([n, u], i) => `<span class="junto"><button class="link-ext" data-link="${u}">${n}</button>${i < comp.length - 1 ? "," : "."}</span>`).join(" ")}</p>`;
}
// ---------------------------------------------------------------- tamanho e espaco

function tamanhoTotal() {
  const gpu = cfg.usarGpu && sis.nvidia;
  return 0.1 + (gpu ? 3.0 : 0.9) + (QUALIDADES.find((q) => q.id === cfg.modelo)?.gb || 3) + (cfg.idioma === "pt" ? 1.3 : 0.4) + (cfg.separarVozes ? 0.1 : 0);
}

async function espaco(id) {
  const el = document.querySelector(`[data-espaco="${id}"]`);
  if (!el) return;
  const livre = await chamar("livre", { pasta: $("#" + id).value }).catch(() => -1);
  if (livre < 0) { el.textContent = ""; return; }
  const precisa = id === "pastaMotor" ? tamanhoTotal() + 1 : 1;
  el.textContent = `${livre.toString().replace(".", ",")} GB livres no disco.`;
  el.classList.toggle("pouco", livre < precisa);
}

// ---------------------------------------------------------------- instalacao (progresso)

let estadoInst = {};   // etapa -> {estado, detalhe, pct}

function etapasHtml() {
  if (!pendentes.length) return `<p class="credito">Nada a instalar.</p>`;
  return `<ol class="etapas">${pendentes.map((e, i) => {
    const s = estadoInst[i + 1] || {};
    const est = s.estado || "espera";
    const ic = est === "ok" ? "ph-check-circle" : est === "erro" ? "ph-x-circle" : est === "rodando" ? "ph-circle-notch girando" : "ph-circle";
    const barra = est === "rodando" ? `<div class="barra ${s.pct == null ? "indeterminada" : ""}"><i style="${s.pct != null ? `transform:scaleX(${s.pct / 100})` : ""}"></i></div>` : "";
    return `<li class="etapa ${est}"><i class="ph ${ic} ic" aria-hidden="true"></i><div><b>${esc(e.titulo)}</b>${s.detalhe && est === "rodando" ? `<span class="det">${esc(s.detalhe)}</span>` : ""}${barra}</div></li>`;
  }).join("")}</ol>${estadoInst.erro ? `<div class="erro-caixa">${esc(estadoInst.erro)}</div>` : ""}`;
}

function redesenharInstalacao() {
  const el = $("#instalacao");
  if (el) el.innerHTML = etapasHtml();
}

aoMudar((m) => {
  if (m.evento === "instalacao") {
    for (let i = 1; i < m.etapa; i++) estadoInst[i] = { estado: "ok" };
    if (m.estado === "rodando") estadoInst[m.etapa] = { estado: "rodando", detalhe: m.detalhe, pct: m.pct };
    if (m.estado === "erro") { estadoInst[m.etapa] = { estado: "erro" }; estadoInst.erro = m.erro; instalando = false; }
    if (m.estado === "fim") {
      for (let i = 1; i <= m.total; i++) estadoInst[i] = { estado: "ok" };
      instalando = false; instalado = true;
      if (!SETUP) { pendentes = []; avisar("Motor atualizado."); setTimeout(() => desenharSecao("motor"), 800); }
    }
    redesenharInstalacao();
    desenharRodape();
    if (m.estado !== "rodando") desenharLateral();   // fim ou erro: libera (ou mantem travado) o menu
  } else if (m.evento === "atualizacao") {
    desenharAtualizacao(m.status);
  }
});

async function instalar() {
  instalando = true; estadoInst = {};
  redesenharInstalacao(); desenharRodape(); desenharLateral();   // trava os passos ja: voltar no meio regravaria a configuracao
  try { await chamar("instalar"); } catch (e) { instalando = false; estadoInst.erro = e.message; redesenharInstalacao(); desenharRodape(); desenharLateral(); }
}

// ---------------------------------------------------------------- atualizacoes

let ultimoStatus = null;   // mostra o último status na hora; o novo chega em seguida

function atualizacaoHtml(s) {
  if (!s) return `<div class="info"><span>Conferindo...</span></div>`;
  const txt = {
    dev: "Cópia de desenvolvimento: atualizações desligadas.",
    parado: "Ainda não procurou.", atual: "Você está na versão mais recente.", procurando: "Procurando...",
    disponivel: `Versão ${esc(s.nova)} disponível.`, baixando: `Baixando a versão ${esc(s.nova)}... ${s.pct}%`,
    pronta: `Versão ${esc(s.nova)} baixada. Reinicie para usar.`, erro: `Não deu para procurar: ${esc(s.erro || "")}`,
  }[s.estado] || "";
  const btn = s.estado === "pronta"
    ? `<button class="btn primario" id="aplicarAtualizacao">Reiniciar e atualizar</button>`
    : `<button class="btn" id="procurarAtualizacao" ${["dev", "procurando", "baixando"].includes(s.estado) ? "disabled" : ""}>Procurar agora</button>`;
  return `<div class="info"><span class="${s.estado === "erro" ? "ruim" : ""}">${txt}</span>${btn}</div>`;
}

function desenharAtualizacao(s) {
  ultimoStatus = s || ultimoStatus;
  const el = $("#atualizacao");
  if (el) el.innerHTML = atualizacaoHtml(ultimoStatus);
}
// ---------------------------------------------------------------- desenho e navegacao

function secaoHtml(s) { return `<section class="secao" id="s-${s.id}" data-secao="${s.id}">${s.render()}</section>`; }

function desenharSecao(id) {
  const s = SECOES.find((x) => x.id === id);
  const el = document.querySelector(`[data-secao="${id}"]`);
  if (s && el) el.innerHTML = s.render();
}

function desenharLateral() {
  const lista = visiveis();
  $("#passos").innerHTML = lista.map((s, i) => SETUP
    ? `<button class="passo ${i < passo ? "feito" : ""}" ${i === passo ? 'aria-current="step"' : ""} data-ir="${i}" ${i > passo || instalando || instalado && i < lista.findIndex((x) => x.id === "pronto") ? "disabled" : ""}>
         <span class="n">${i < passo ? '<i class="ph ph-check"></i>' : i + 1}</span>${s.titulo}</button>`
    : `<button class="passo" data-ir="${i}" data-rolar="${s.id}" ${i === passo ? 'aria-current="true"' : ""}><i class="ph ph-${s.icone}" aria-hidden="true"></i>${s.titulo}</button>`).join("");
}

function desenhar() {
  const lista = visiveis();
  // Uma seção por vez, nos dois modos (como os Ajustes do Sistema): o item clicado é o que aparece.
  conteudo.innerHTML = secaoHtml(lista[passo]);
  conteudo.scrollTop = 0;
  if (SETUP) conteudo.focus();
  else if (lista[passo].id === "atualizacoes") chamar("atualizacao").then(desenharAtualizacao).catch(() => {});
  desenharLateral();
  desenharRodape();
  ["pastaGravacoes", "pastaMotor"].forEach((id) => $("#" + id) && espaco(id));
}

function desenharRodape() {
  if (SETUP) {
    const lista = visiveis(), atual = lista[passo].id;
    let direita;
    if (atual === "instalar") {
      direita = instalado
        ? `<button class="btn primario grande" data-nav="prox">Continuar</button>`
        : instalando
          ? `<button class="btn grande" id="cancelarInst">Cancelar</button>`
          : `<button class="btn primario grande" id="instalarAgora"><i class="ph ph-download-simple"></i> ${estadoInst.erro ? "Tentar de novo" : "Instalar"}</button>`;
    } else if (atual === "pronto") {
      direita = `<button class="btn primario grande" id="concluir">Abrir o Reuniões</button>`;
    } else {
      direita = `<button class="btn primario grande" data-nav="prox">${atual === "boasvindas" ? "Começar" : "Próximo"}</button>`;
    }
    const voltar = passo > 0 && atual !== "pronto" && !instalando && !instalado ? `<button class="btn grande" data-nav="ant">Voltar</button>` : "";
    const log = atual === "instalar" && estadoInst.erro ? `<button class="btn grande" id="verLog">Ver registro</button>` : "";
    rodape.innerHTML = `<span class="dica">Passo ${passo + 1} de ${lista.length}</span><div class="acoes">${log}${voltar}${direita}</div>`;
  } else {
    rodape.innerHTML = sujo
      ? `<span class="dica">Alterações não salvas.</span><div class="acoes"><button class="btn" id="descartar">Descartar</button><button class="btn primario" id="salvar">Salvar</button></div>`
      : "";
  }
}

function lerTudo() {
  for (const s of visiveis()) if (s.ler && document.querySelector(`[data-secao="${s.id}"]`)) s.ler();
}

function validar(id) {
  if (id === "pastas" && (!cfg.pastaGravacoes || !cfg.pastaMotor)) return "Escolha as duas pastas.";
  if (id === "transcricao" && cfg.separarVozes && !cfg.temToken && !tokenNovo) return "Cole o token do Hugging Face ou desligue “Separar as vozes”.";
  if (id === "resumo" && cfg.resumo.ativo && !cfg.resumo.nome) return "Escreva seu nome para a IA saber quem é você na reunião.";
  return null;
}

async function salvar() {
  lerTudo();
  for (const s of visiveis()) { const e = validar(s.id); if (e) { avisar(e); return false; } }
  try {
    pendentes = await chamar("salvarConfig", { config: cfg, token: tokenNovo });
    if (tokenNovo) { cfg.temToken = true; tokenNovo = null; }
    return true;
  } catch (e) { avisar(e.message); return false; }
}

// ---------------------------------------------------------------- eventos

ligarInterruptores(conteudo, (id, v) => {
  if (id === "separarVozes") { $("#vozes").hidden = !v; }
  if (id === "resumoAtivo") { $("#resumoCampos").hidden = !v; }
  if (id === "usarGpu" || id === "separarVozes") { cfg[id] = v; atualizarTamanho(); }
  marcarSujo();
});

function atualizarTamanho() {
  const p = $("#precisa");
  if (p) p.textContent = `${tamanhoTotal().toFixed(1).replace(".", ",")} GB`;
}

function marcarSujo() { if (!SETUP && !sujo) { sujo = true; desenharRodape(); } }
conteudo.addEventListener("input", marcarSujo);
conteudo.addEventListener("change", (e) => {
  marcarSujo();
  if (e.target.id === "pastaMotor" || e.target.id === "pastaGravacoes") espaco(e.target.id);
});

conteudo.addEventListener("click", async (e) => {
  const t = e.target;
  const link = t.closest("[data-link]");
  if (link) { e.preventDefault(); return chamar("abrirLink", { url: link.dataset.link }); }
  const esc_ = t.closest("[data-escolher]");
  if (esc_) {
    const id = esc_.dataset.escolher;
    const p = await chamar("escolherPasta", { atual: $("#" + id).value, titulo: id === "pastaMotor" ? "Pasta do motor de transcrição" : "Pasta das gravações" });
    if (p) { $("#" + id).value = id === "pastaMotor" && !/reunioes-motor$/i.test(p) ? p.replace(/\\$/, "") + "\\Reunioes-motor" : p; espaco(id); marcarSujo(); }
    return;
  }
  const op = t.closest(".opcao");
  if (op) {
    document.querySelectorAll(".opcao").forEach((o) => o.setAttribute("aria-checked", String(o === op)));
    cfg.modelo = op.dataset.modelo; atualizarTamanho(); marcarSujo();
    return;
  }
  if (t.closest("#testarToken")) {
    const st = $("#tokenStatus");
    st.className = "status-linha"; st.innerHTML = `<i class="ph ph-circle-notch girando"></i> Testando...`;
    const r = await chamar("testarToken", { token: $("#token").value.trim() || null });
    st.className = "status-linha " + (r.ok ? "ok" : "ruim");
    st.innerHTML = `<i class="ph ${r.ok ? "ph-check" : "ph-warning"}"></i> ${esc(r.msg)}`;
    return;
  }
  if (t.closest("#checarClaude")) { sis = await chamar("sistema"); desenharSecao("resumo"); return; }
  if (t.closest("#instalarAgora")) {
    if (!SETUP && sujo && !(await salvar())) return;
    return instalar();
  }
  if (t.closest("#verLog")) return chamar("abrirLog").catch((er) => avisar(er.message));
  if (t.closest("#procurarAtualizacao")) { desenharAtualizacao(await chamar("procurarAtualizacao")); return; }
  if (t.closest("#aplicarAtualizacao")) { try { await chamar("aplicarAtualizacao"); } catch (er) { avisar(er.message); } }
});

rodape.addEventListener("click", async (e) => {
  const t = e.target;
  const nav = t.closest("[data-nav]")?.dataset.nav;
  const lista = visiveis();
  if (nav === "prox") {
    const s = lista[passo];
    s.ler?.();
    const erro = validar(s.id);
    if (erro) return avisar(erro);
    if (lista[passo + 1]?.id === "instalar") {
      if (!(await salvar())) return;
      if (!pendentes.length) instalado = true;
    }
    passo++; desenhar();
  } else if (nav === "ant") {
    lista[passo].ler?.(); passo--; desenhar();
  } else if (t.closest("#instalarAgora")) {
    instalar();
  } else if (t.closest("#cancelarInst")) {
    chamar("cancelarInstalacao");
  } else if (t.closest("#verLog")) {
    chamar("abrirLog").catch((er) => avisar(er.message));
  } else if (t.closest("#concluir")) {
    await chamar("concluir");
    location.href = "index.html";
  } else if (t.closest("#salvar")) {
    if (await salvar()) {
      sujo = false; desenharRodape(); desenharSecao("motor");
      avisar(pendentes.length ? "Salvo. O motor precisa instalar coisas novas: veja em Motor." : "Configurações salvas.");
      if (pendentes.length) irPara("motor");
    }
  } else if (t.closest("#descartar")) {
    cfg = await chamar("config"); tokenNovo = null; sujo = false; desenhar();
  }
});

$("#passos").addEventListener("click", (e) => {
  const b = e.target.closest(".passo");
  if (!b || b.disabled || (SETUP && (instalando || instalado))) return;
  visiveis()[passo].ler?.();   // guarda o que foi digitado antes de trocar de seção
  passo = +b.dataset.ir;
  desenhar();
});

function irPara(id) {
  const i = visiveis().findIndex((s) => s.id === id);
  if (i < 0 || i === passo) return;
  visiveis()[passo].ler?.();
  passo = i;
  desenhar();
}

// ---------------------------------------------------------------- embutida na lista (abre por cima, sem recarregar)

$("#voltar").addEventListener("click", () => {
  if (sujo) { avisar("Salve ou descarte as alterações antes de voltar."); return; }
  if (window.parent !== window && window.parent.fecharConfiguracoes) window.parent.fecharConfiguracoes();
  else location.href = "index.html";
});

// A lista chama ao abrir de novo: relê o que pode ter mudado fora daqui (ex.: "Gravar sozinho" no topo).
async function abrirSecao(id) {
  if (!sujo) {
    [cfg, pendentes] = await Promise.all([chamar("config"), chamar("pendentes")]);
    const e = await chamar("estado").catch(() => null);
    atalhoOcupado = !!e?.servico?.rodando && e.servico.atalhoOk === false;
  }
  if (id) { const i = visiveis().findIndex((s) => s.id === id); if (i >= 0) passo = i; }
  desenhar();
}
addEventListener("keydown", (e) => { if (e.key === "Escape" && !SETUP && !e.defaultPrevented) $("#voltar").click(); });

addEventListener("beforeunload", (e) => { if (sujo || instalando) e.preventDefault(); });

// ---------------------------------------------------------------- inicio

[cfg, sis, dev] = await Promise.all([chamar("config"), chamar("sistema"), chamar("dispositivos")]);
if (SETUP && !sis.nvidia) { cfg.usarGpu = false; if (cfg.modelo === "large-v3") cfg.modelo = "small"; }
if (!SETUP) {
  pendentes = await chamar("pendentes");
  const e = await chamar("estado").catch(() => null);
  atalhoOcupado = !!e?.servico?.rodando && e.servico.atalhoOk === false;
}
$("#versao").textContent = "versão " + sis.versao;
$("#voltar").hidden = SETUP;
document.title = SETUP ? "Configurar o Reuniões" : "Configurações";
desenhar();
if (!SETUP && location.hash) irPara(location.hash.replace("#s-", "").replace("#", ""));
// só agora a lista pode abrir esta tela: os dados já chegaram
window.abrirSecao = abrirSecao;
