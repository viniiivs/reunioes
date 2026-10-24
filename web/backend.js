// Versão web: implementa no navegador os mesmos comandos que o app de Windows atende em C#
// (Nucleo.cs), para as telas serem as mesmas. Gravações no IndexedDB, transcrição com Whisper
// no próprio navegador, resumo opcional com a chave da API da Anthropic da pessoa.
import * as db from "./armazem.js";
import * as motor from "./motor.js";
import { Gravacao } from "./gravador.js";
import { VERSAO } from "./versao.js";
import { montarPrompt, ESQUEMA } from "./resumo.js";
import * as checagem from "./checagem.js";

const MODELO_RESUMO = "claude-sonnet-5-5";
const canal = new BroadcastChannel("reunioes");
const ouvintes = new Set();
let gravacao = null;
const cancelados = new Set();
const voltarParaFila = new Map();   // base pausada por "Primeiro" -> prioridade com que volta para a fila

export function ligar(f) { ouvintes.add(f); }
function emitir(m, outrasAbas = true) {
  ouvintes.forEach((f) => f(m));
  if (outrasAbas) canal.postMessage(m);
}
canal.onmessage = ({ data: m }) => {
  if (m.tipo === "cancelar") {
    cancelados.add(m.base);
    if (m.voltar != null) voltarParaFila.set(m.base, m.voltar);
    if (emAndamento === m.base) motor.abortar();
    return;
  }
  if (m.tipo === "fila") return rodarFila();
  ouvintes.forEach((f) => f(m));
};
const mudou = () => emitir({ evento: "mudou" });

// ---------------------------------------------------------------- utilidades

const dois = (n) => String(n).padStart(2, "0");
function nomeBase(d) {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}_${dois(d.getHours())}-${dois(d.getMinutes())}-${dois(d.getSeconds())}`;
}
function baixar(blob, nome) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const extDe = (tipo) => (/ogg/.test(tipo) ? "ogg" : /mp4|m4a|aac/.test(tipo) ? "m4a" : /mpeg|mp3/.test(tipo) ? "mp3" : /wav/.test(tipo) ? "wav" : "webm");
const ORIGEM = { browser: "Aba do navegador", window: "Janela", monitor: "Tela inteira" };

function paraLista(g) {
  const { texto, resumoDados, faixas, parcial, checagem, checagemErro, ...resto } = g;
  return resto;
}

async function precisa(base) {
  const g = await db.gravacoes.uma(base);
  if (!g) throw new Error("Essa gravação não existe mais.");
  return g;
}

// ---------------------------------------------------------------- gravar

async function gravarOuParar() {
  if (gravacao?.ativa) return parar();
  const cfg = db.config();
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Este navegador não grava o som de outras abas. Use o Chrome ou o Edge no computador, ou importe o áudio.");
  gravacao = new Gravacao();
  gravacao.aoEncerrarPeloNavegador = () => gravacao?.ativa && parar().catch(() => {});
  await gravacao.iniciar(cfg.mic);
  navigator.storage?.persist?.();
  relogio = setInterval(() => emitir({ evento: "mudou" }, false), 5000);
  mudou();
}

let relogio;
async function parar() {
  clearInterval(relogio);
  const r = await gravacao.parar();
  const sup = r?.superficie;
  gravacao = null;
  if (!r) return;
  const base = nomeBase(r.inicio);
  await db.audios.salvar(`${base}/eu`, r.eu);
  await db.audios.salvar(`${base}/outros`, r.outros);
  await db.gravacoes.salvar({
    base, inicio: r.inicio.toISOString(), duracao: r.duracao, bytes: r.eu.size + r.outros.size,
    estado: "sem", falantes: null, vozes: false, apps: [{ exe: ORIGEM[sup] || "Compartilhamento", segundos: r.duracao }],
    faixas: { eu: `${base}/eu`, outros: `${base}/outros` },
  });
  mudou();
  transcrever(base);   // como o app: grava e já transcreve
}

addEventListener("beforeunload", (e) => { if (gravacao?.ativa || emAndamento) e.preventDefault(); });

// ---------------------------------------------------------------- importar

async function importar(arquivo) {
  if (!arquivo) return;
  if (!/^(audio|video)\//.test(arquivo.type) && !/\.(mp3|m4a|wav|ogg|opus|webm|flac|aac|mp4|mkv|mov)$/i.test(arquivo.name)) throw new Error("Esse arquivo não parece ser de áudio ou vídeo.");
  const quando = new Date(arquivo.lastModified || Date.now());
  let base = nomeBase(quando);
  while (await db.gravacoes.uma(base)) base += "_";
  let duracao = null;
  try { duracao = (await motor.decodificar(arquivo)).length / 16000; } catch { throw new Error("Não consegui ler o áudio desse arquivo. Tente MP3, M4A, WAV ou WEBM."); }
  await db.audios.salvar(`${base}/audio`, arquivo);
  await db.gravacoes.salvar({
    base, inicio: quando.toISOString(), duracao, bytes: arquivo.size, estado: "sem", falantes: null, vozes: false,
    apps: [{ exe: "Arquivo importado", segundos: duracao }], rotulo: arquivo.name, faixas: { audio: `${base}/audio` },
  });
  mudou();
  transcrever(base);
  return base;
}

// ---------------------------------------------------------------- transcrever (fila)

let emAndamento = null;

async function transcrever(base) {
  const g = await precisa(base);
  if (g.estado === "fila" || g.estado === "transcrevendo") return;
  cancelados.delete(base);
  g.estado = "fila"; g.etapa = null; g.pct = null; g.prioridade = 0;
  await db.gravacoes.salvar(g);
  mudou();
  rodarFila();
  canal.postMessage({ tipo: "fila" });
}

// Uma fila só para todas as abas: quem pega a trava processa; se a aba fechar, a trava solta.
function rodarFila() {
  if (!navigator.locks) return processarFila();
  navigator.locks.request("reunioes-fila", { ifAvailable: true }, async (trava) => { if (trava) await processarFila(); });
}

async function processarFila() {
  for (;;) {
    // "Primeiro" dá prioridade; no resto, a ordem de chegada
    const fila = (await db.gravacoes.todas()).filter((g) => g.estado === "fila")
      .sort((a, b) => (b.prioridade || 0) - (a.prioridade || 0) || a.inicio.localeCompare(b.inicio));
    if (!fila.length) return;
    await transcreverUma(fila[0]);
  }
}

// pct: quanto da transcrição inteira (todas as faixas) já foi, para a lista mostrar "Transcrevendo 42%"
async function etapa(g, txt, pct = null) { g.etapa = txt; g.pct = pct; await db.gravacoes.salvar(g); mudou(); }

async function transcreverUma(g) {
  const base = g.base;
  emAndamento = base;
  const cancelado = () => cancelados.has(base);
  try {
    g.estado = "transcrevendo";
    await etapa(g, "carregando modelos");
    const cfg = db.config();
    const p = await motor.plano(cfg);
    await motor.preparar(p, ({ carregado, total }) => total && etapa(g, `baixando o modelo ${Math.round((carregado / total) * 100)}%`).catch(() => {}));
    const lista = Object.entries(g.faixas || {});
    const resultado = [];
    // Pausada antes? Retoma do que ficou guardado, se o modelo e o idioma forem os mesmos.
    const chaveParcial = `${cfg.modelo}|${cfg.idioma}`;
    if (g.parcial?.chave !== chaveParcial) g.parcial = { chave: chaveParcial, faixas: {} };
    for (let i = 0; i < lista.length; i++) {
      const [nome, chave] = lista[i];
      if (cancelado()) throw new Error("cancelado");
      const quem = nome === "eu" ? "Eu" : nome === "outros" ? "Outros" : "Áudio";
      const blob = await db.audios.ler(chave);
      if (!blob) continue;
      const audio = await motor.decodificar(blob);
      const rot = nome === "eu" ? "você" : nome === "outros" ? "os outros" : "o áudio";
      let ultimo = 0;
      const frases = await motor.transcreverFaixa(audio, cfg.idioma, (fr) => {
        const pct = Math.round(fr * 100);
        if (pct - ultimo >= 2 || pct === 100) {
          ultimo = pct;
          etapa(g, `${i + 1}/${lista.length} transcrevendo ${rot}`, Math.min(99, Math.floor(((i + fr) / lista.length) * 100))).catch(() => {});
        }
      }, cancelado, g.parcial.faixas[nome], async (de) => {
        g.parcial.faixas[nome] = { ...de, pct: Math.round((de.ate / audio.length) * 100), rot };
        await db.gravacoes.salvar(g);
      });
      resultado.push({ quem, frases });
    }
    const d = new Date(g.inicio);
    const titulo = `Reunião de ${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    const atual = await precisa(base);
    atual.texto = motor.montarMd(titulo, resultado);
    atual.falantes = resultado.filter((r) => r.frases.length).map((r) => r.quem);
    atual.estado = "pronta"; atual.etapa = null; atual.pct = null; delete atual.parcial;
    await db.gravacoes.salvar(atual);
    mudou();
    if (cfg.resumo.ativo && db.chaveApi.ler()) resumir(base).catch(() => {});
  } catch (e) {
    const atual = await db.gravacoes.uma(base);
    if (atual) {
      // pausar guarda o progresso: fica "pausada" (ou volta para a fila, se outra passou na frente)
      const feito = Object.values(atual.parcial?.faixas || {}).filter((x) => x.frases);
      // "já tem sua voz e 40% dos outros"
      const inteira = { "você": "sua voz", "os outros": "a voz dos outros", "o áudio": "o áudio" };
      const parte = { "você": "da sua voz", "os outros": "dos outros", "o áudio": "do áudio" };
      atual.etapa = feito.length ? "já tem " + feito.map((x) => (x.pct >= 100 ? inteira[x.rot] : `${x.pct}% ${parte[x.rot]}`)).join(" e ") : null;
      atual.pct = null;
      atual.estado = voltarParaFila.has(base) ? "fila" : feito.length ? "pausada" : "sem";
      if (voltarParaFila.has(base)) { atual.prioridade = voltarParaFila.get(base); voltarParaFila.delete(base); }
      if (!cancelado() && e.message !== "cancelado") atual.erro = e.message;
      await db.gravacoes.salvar(atual);
      mudou();
      if (!cancelado() && e.message !== "cancelado") emitir({ evento: "aviso", msg: "A transcrição falhou: " + e.message });
    }
  } finally {
    cancelados.delete(base);
    emAndamento = null;
  }
}

async function cancelar(base) {
  cancelados.add(base);
  canal.postMessage({ tipo: "cancelar", base });
  if (emAndamento === base) motor.abortar();
  const g = await db.gravacoes.uma(base);
  if (g && g.estado === "fila") { g.estado = g.parcial ? "pausada" : "sem"; await db.gravacoes.salvar(g); }
  mudou();
}

// "Transcrever esta primeiro": pausa a que está rodando (ela volta logo depois, de onde parou).
async function priorizar(base) {
  const g = await precisa(base);
  if (g.estado === "transcrevendo") return;
  const agora = Date.now();
  g.estado = "fila"; g.prioridade = agora;
  await db.gravacoes.salvar(g);
  const rodando = (await db.gravacoes.todas()).find((x) => x.estado === "transcrevendo");
  if (rodando) {
    cancelados.add(rodando.base);
    voltarParaFila.set(rodando.base, agora - 1);
    canal.postMessage({ tipo: "cancelar", base: rodando.base, voltar: agora - 1 });
    if (emAndamento === rodando.base) motor.abortar();
  }
  mudou();
  rodarFila();
  canal.postMessage({ tipo: "fila" });
}

// Abriu a página e nenhuma aba está transcrevendo: o que ficou "transcrevendo" morreu com a aba.
async function arrumarOrfas() {
  const presas = (await db.gravacoes.todas()).filter((g) => g.estado === "transcrevendo" || g.estado === "fila");
  if (!presas.length) return;
  if (navigator.locks) {
    const q = await navigator.locks.query();
    if (q.held.some((l) => l.name === "reunioes-fila")) return;
  }
  for (const g of presas) {
    if (g.estado === "transcrevendo") { g.estado = "fila"; g.etapa = null; g.pct = null; await db.gravacoes.salvar(g); }
  }
  rodarFila();
}

// ---------------------------------------------------------------- resumo

async function resumir(base) {
  const chave = db.chaveApi.ler();
  if (!chave) throw new Error("Cole a sua chave da API da Anthropic em Configurações, na seção Resumo com IA.");
  const g = await precisa(base);
  if (!g.texto) throw new Error("Transcreva antes de resumir.");
  g.resumo = { estado: "gerando" };
  await db.gravacoes.salvar(g);
  mudou();
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({
        model: MODELO_RESUMO, max_tokens: 4096, system: montarPrompt(db.config().resumo),
        tools: [{ name: "registrar_resumo", description: "Registra o resumo da reunião.", input_schema: ESQUEMA }],
        tool_choice: { type: "tool", name: "registrar_resumo" },
        messages: [{ role: "user", content: g.texto }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 401 ? "A chave da API foi recusada. Confira em Configurações." : j.error?.message || `Erro ${r.status} da API.`);
    const dados = j.content?.find((c) => c.type === "tool_use")?.input;
    if (!dados) throw new Error("O Claude não devolveu o resumo.");
    const atual = await precisa(base);
    atual.resumoDados = { ...dados, gerado_em: new Date().toISOString(), modelo: j.model || MODELO_RESUMO };
    atual.resumo = { estado: "pronto", veredito: dados.veredito, precisaAgir: dados.precisa_agir, acoes: dados.acoes?.length || 0, feitas: 0 };
    await db.gravacoes.salvar(atual);
  } catch (e) {
    const atual = await db.gravacoes.uma(base);
    if (atual) { atual.resumo = { estado: "erro", erro: e.message === "Failed to fetch" ? "Sem conexão com a API." : e.message }; await db.gravacoes.salvar(atual); }
  }
  mudou();
}

// ---------------------------------------------------------------- fato ou fake

const checando = new Set();

// Busca na web pela API (web_search) e devolve o resultado pela ferramenta registrar_checagem.
// A API pode pausar uma busca longa (pause_turn): manda a conversa de volta e continua.
async function checar(base, trecho, quem, tempo) {
  const chave = db.chaveApi.ler();
  if (!chave) throw new Error("Cole a sua chave da API da Anthropic em Configurações, na seção Resumo com IA.");
  const g = await precisa(base);
  if (!g.texto) throw new Error("Transcreva antes de checar.");
  trecho = trecho?.trim() || null;
  if (trecho && trecho.length > 2000) throw new Error("Escolha um trecho menor (até umas 300 palavras).");
  if (checando.has(base)) throw new Error("Já estou checando esta reunião. Espere terminar.");
  checando.add(base);
  g.checagemErro = null;
  await db.gravacoes.salvar(g);
  mudou();
  (async () => {
    try {
      const msgs = [{ role: "user", content: checagem.mensagem(new Date(g.inicio), g.texto, trecho, quem, tempo) }];
      const ferramentas = [
        { type: "web_search_20250305", name: "web_search", max_uses: 8 },
        { name: "registrar_checagem", description: "Registra o resultado da checagem.", input_schema: checagem.ESQUEMA },
      ];
      let dados = null;
      for (let volta = 0; volta < 6 && !dados; volta++) {
        const forcar = volta > 0 && msgs.at(-1).role === "user" && typeof msgs.at(-1).content === "string" && msgs.at(-1).content.startsWith("Registre");
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({
            model: MODELO_RESUMO, max_tokens: 4096, system: checagem.SISTEMA, tools: ferramentas, messages: msgs,
            ...(forcar ? { tool_choice: { type: "tool", name: "registrar_checagem" } } : {}),
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(r.status === 401 ? "A chave da API foi recusada. Confira em Configurações." : j.error?.message || `Erro ${r.status} da API.`);
        dados = j.content?.find((c) => c.type === "tool_use" && c.name === "registrar_checagem")?.input || null;
        if (dados) break;
        msgs.push({ role: "assistant", content: j.content });
        if (j.stop_reason !== "pause_turn") msgs.push({ role: "user", content: "Registre o resultado com registrar_checagem." });
      }
      if (!dados) throw new Error("O Claude não devolveu a checagem.");
      const agora = new Date().toISOString();
      const origem = trecho ? "trecho" : "reuniao";
      const novos = (dados.itens || []).map((x) => ({
        ...x, fontes: (x.fontes || []).filter((f) => /^https:///.test(f.url)), origem, checado_em: agora,
      }));
      const atual = await precisa(base);
      const antigos = atual.checagem?.itens || [];
      atual.checagem = {
        itens: trecho ? [...novos, ...antigos] : [...antigos.filter((x) => x.origem === "trecho"), ...novos],
        reuniao_checada: !trecho || !!atual.checagem?.reuniao_checada,
        gerado_em: agora, modelo: MODELO_RESUMO,
      };
      await db.gravacoes.salvar(atual);
    } catch (e) {
      const atual = await db.gravacoes.uma(base);
      if (atual) { atual.checagemErro = e.message === "Failed to fetch" ? "Sem conexão com a API." : e.message; await db.gravacoes.salvar(atual); }
    } finally {
      checando.delete(base);
      mudou();
    }
  })();
}

// ---------------------------------------------------------------- comandos

async function dispositivos() {
  const lista = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || [];
  const mics = lista.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
  return { mics: mics.map((d, i) => ({ id: d.deviceId, nome: d.label || `Microfone ${i + 1}`, padrao: false })), saidas: [], semNomes: mics.some((d) => !d.label) };
}

async function pendentes() {
  const p = await motor.plano(db.config());
  return (await motor.baixado(p)) ? [] : [{ id: "modelos", titulo: `Baixando o modelo de transcrição (${p.q.nome.toLowerCase()}, cerca de ${p.gb < 1 ? Math.round(p.gb * 1024) + " MB" : p.gb.toFixed(1).replace(".", ",") + " GB"})` }];
}

async function instalar() {
  const p = await motor.plano(db.config());
  const titulo = (await pendentes())[0]?.titulo || "Carregando o modelo";
  const mb = (b) => (b / 1048576).toFixed(0);
  emitir({ evento: "instalacao", etapa: 1, total: 1, titulo, estado: "rodando", pct: null, detalhe: "Começando" }, false);
  motor.preparar(p, ({ carregado, total }) => emitir({ evento: "instalacao", etapa: 1, total: 1, titulo, estado: "rodando",
    pct: total ? (carregado / total) * 100 : null, detalhe: total ? `${mb(carregado)} de ${mb(total)} MB` : "" }, false))
    .then(() => { emitir({ evento: "instalacao", etapa: 1, total: 1, estado: "fim" }, false); mudou(); })
    .catch((e) => emitir({ evento: "instalacao", etapa: 1, total: 1, estado: "erro",
      erro: e.message === "cancelado" ? "Download cancelado." : "Não deu para baixar o modelo: " + e.message }, false));
  return null;
}

async function testarChave(chave) {
  chave = chave || db.chaveApi.ler();
  if (!chave) return { ok: false, msg: "Cole a chave primeiro." };
  try {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } });
    if (r.ok) return { ok: true, msg: "A chave funciona." };
    return { ok: false, msg: r.status === 401 ? "Chave recusada. Confira se copiou inteira." : `A API respondeu ${r.status}.` };
  } catch { return { ok: false, msg: "Sem conexão com a API da Anthropic." }; }
}

const comandos = {
  async listar() {
    const lista = (await db.gravacoes.todas()).map(paraLista);
    if (gravacao?.ativa) lista.push({ base: "agora", inicio: gravacao.inicio.toISOString(), duracao: (Date.now() - gravacao.inicio) / 1000, bytes: gravacao.bytes, estado: "gravando", falantes: null, apps: [{ exe: ORIGEM[gravacao.superficie] || "Compartilhamento", segundos: 0 }] });
    return lista.sort((a, b) => b.inicio.localeCompare(a.inicio));
  },
  async ler({ base }) {
    const g = await precisa(base);
    const cfg = db.config();
    return {
      texto: g.texto || "", gravacao: paraLista(g), resumo: g.resumoDados || null, resumoAtivo: cfg.resumo.ativo && !!db.chaveApi.ler(), nome: cfg.resumo.nome || null,
      checagem: g.checagem || null, checando: checando.has(base), checagemErro: g.checagemErro || null, podeChecar: !!db.chaveApi.ler(),
    };
  },
  gravar: gravarOuParar,
  importar: ({ arquivo }) => importar(arquivo),
  transcrever: ({ base }) => transcrever(base),
  cancelar: ({ base }) => cancelar(base),
  priorizar: ({ base }) => priorizar(base),
  async marcarAcao({ base, i, feita }) {
    const g = await precisa(base);
    const a = g.resumoDados?.acoes?.[i];
    if (!a) throw new Error("Ação não encontrada.");
    a.feita = !!feita;
    if (g.resumo) g.resumo.feitas = g.resumoDados.acoes.filter((x) => x.feita).length;
    await db.gravacoes.salvar(g);
    mudou();
  },
  async excluir({ base }) {
    const g = await precisa(base);
    for (const k of Object.values(g.faixas || {})) await db.audios.apagar(k);
    await db.gravacoes.apagar(base);
    mudou();
  },
  resumir: ({ base }) => { resumir(base); },
  checar: ({ base, trecho, quem, tempo }) => checar(base, trecho, quem, tempo),
  async baixar({ base, ext }) {
    const g = await precisa(base);
    if (ext === "transcricao.md") {
      if (!g.texto) throw new Error("Ainda não tem transcrição.");
      return baixar(new Blob([g.texto], { type: "text/markdown" }), `${base}.transcricao.md`);
    }
    for (const [nome, chave] of Object.entries(g.faixas || {})) {
      const b = await db.audios.ler(chave);
      if (b) baixar(b, `${base}.${nome}.${extDe(b.type)}`);
    }
    if (g.texto) baixar(new Blob([g.texto], { type: "text/markdown" }), `${base}.transcricao.md`);
  },
  abrirArquivo: (a) => comandos.baixar(a),
  async copiar({ texto }) { await navigator.clipboard.writeText(texto); },
  abrirLeitor({ base, aba }) {
    const w = window.open(`leitor.html?b=${encodeURIComponent(base)}&aba=${aba || "resumo"}`, "leitor-" + base);
    if (!w) throw new Error("O navegador bloqueou a nova aba. Permita pop-ups para este site.");
    w.focus();
  },
  abrirLink({ url }) { window.open(url, "_blank", "noopener"); },
  async estado() {
    const cfg = db.config();
    return {
      gravando: !!gravacao?.ativa, servico: { rodando: false }, gravarSozinho: false, atalho: null,
      motorPronto: !(await pendentes()).length, atualizacao: null, resumoAtivo: cfg.resumo.ativo && !!db.chaveApi.ler(),
    };
  },
  config() {
    const c = db.config();
    return { ...c, temToken: !!db.chaveApi.ler() };
  },
  async salvarConfig({ config, token }) {
    const { temToken, ...c } = config;
    db.salvarConfig({ ...db.config(), ...c });
    if (token) db.chaveApi.salvar(token);
    mudou();
    return pendentes();
  },
  async sistema() {
    const g = await motor.gpu();
    return { versao: VERSAO, webgpu: g.webgpu, f16: g.f16, gpuNome: g.nome, gravaTela: !!navigator.mediaDevices?.getDisplayMedia, claude: true };
  },
  dispositivos,
  async pedirMicrofone() {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return dispositivos();
  },
  async livre() { const e = await db.espaco(); return e.cota ? +((e.cota - e.usado) / 1073741824).toFixed(1) : -1; },
  async armazenamento() {
    const e = await db.espaco();
    return { ...e, persistente: (await navigator.storage?.persisted?.()) || false };
  },
  pendentes,
  instalar,
  cancelarInstalacao() { motor.abortar(); },
  async concluir() {
    db.salvarConfig({ ...db.config(), configuracaoConcluida: true });
    await navigator.storage?.persist?.().catch(() => {});
  },
  testarToken: ({ token }) => testarChave(token),
  async apagarTudo() {
    for (const g of await db.gravacoes.todas()) await comandos.excluir({ base: g.base });
    await caches.delete("transformers-cache").catch(() => {});
    mudou();
  },
  pasta() {}, abrirLog() {}, atualizacao: () => null, procurarAtualizacao: () => null, gravarSozinho() {},
};

export async function chamar(cmd, args = {}) {
  const f = comandos[cmd];
  if (!f) throw new Error(`Comando desconhecido: ${cmd}`);
  return f(args);
}

arrumarOrfas().catch(() => {});
