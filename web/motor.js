// Motor de transcrição da versão web: escolhe o modelo, baixa (fica no cache do navegador),
// decodifica o áudio para 16 kHz mono, manda em janelas de 30 s para o worker e monta o .md
// no mesmo formato do app de Windows ("**[hh:mm:ss] Eu:** texto").

const HF = "https://huggingface.co/";
export const QUALIDADES = [
  { id: "whisper-base", nome: "Rápida", desc: "Leve e rápida. Erra mais nomes e termos.",
    gpu: { encoder_model: "fp32", decoder_model_merged: "q4" }, cpu: { encoder_model: "q8", decoder_model_merged: "q8" } },
  { id: "whisper-small", nome: "Equilibrada", desc: "Boa qualidade. Recomendada para a maioria dos computadores.",
    gpu: { encoder_model: "fp32", decoder_model_merged: "q4" }, cpu: { encoder_model: "q8", decoder_model_merged: "q8" } },
  { id: "whisper-large-v3-turbo", nome: "Máxima", desc: "Melhor texto. Precisa de placa de vídeo com WebGPU.", soGpu: true,
    gpu: { encoder_model: "fp16", decoder_model_merged: "q4" } },
];
// tamanho em MB de cada arquivo (onnx-community, conferido em 10/2026)
const MB = {
  "whisper-base": { fp32: 79, q4: 118, q8: 22, q8d: 51 },
  "whisper-small": { fp32: 336, q4: 222, q8: 88, q8d: 149 },
  "whisper-large-v3-turbo": { fp16: 1215, q4: 319 },
};
const SUFIXO = { fp32: "", fp16: "_fp16", q4: "_q4", q8: "_quantized" };

let gpuInfo;
/** { webgpu: bool, f16: bool, nome: string|null } */
export async function gpu() {
  if (gpuInfo) return gpuInfo;
  gpuInfo = { webgpu: false, f16: false, nome: null };
  try {
    const a = await navigator.gpu?.requestAdapter();
    if (a) {
      gpuInfo.webgpu = true;
      gpuInfo.f16 = a.features.has("shader-f16");
      const i = a.info || (await a.requestAdapterInfo?.()) || {};
      const fab = { nvidia: "NVIDIA", amd: "AMD", intel: "Intel", apple: "Apple", qualcomm: "Qualcomm", arm: "Arm" }[i.vendor] || i.vendor;
      const arq = (i.architecture || "").replace(/^\w/, (c) => c.toUpperCase());
      gpuInfo.nome = i.description || [fab, arq].filter(Boolean).join(" ") || null;
    }
  } catch { /* sem WebGPU */ }
  return gpuInfo;
}

/** Configuração efetiva: device e dtype para a qualidade escolhida neste navegador. */
export async function plano(cfg) {
  const g = await gpu();
  const q = QUALIDADES.find((x) => x.id === cfg.modelo) || QUALIDADES[1];
  const usaGpu = g.webgpu && cfg.usarGpu !== false && (!q.soGpu || g.f16 || q.gpu.encoder_model !== "fp16");
  if (q.soGpu && !usaGpu) return { ...plano_(QUALIDADES[1], false), rebaixado: true };
  return plano_(q, usaGpu);
}
function plano_(q, usaGpu) {
  const dtype = usaGpu ? q.gpu : q.cpu;
  const arquivos = Object.entries(dtype).map(([parte, t]) => `onnx/${parte}${SUFIXO[t]}.onnx`);
  const mb = Object.entries(dtype).reduce((s, [parte, t]) => s + (MB[q.id][parte.startsWith("decoder") && t === "q8" ? "q8d" : t] || 0), 0);
  return { q, repo: "onnx-community/" + q.id, device: usaGpu ? "webgpu" : "wasm", dtype, arquivos, gb: mb / 1024 };
}

/** O modelo já está baixado no cache do navegador? */
export async function baixado(p) {
  try {
    const c = await caches.open("transformers-cache");
    for (const a of p.arquivos) if (!(await c.match(`${HF}${p.repo}/resolve/main/${a}`))) return false;
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------- worker

let worker = null, carregado = null, seq = 0;
const esperando = new Map();
let aoProgresso = null;

function abrirWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./transcritor.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data: m }) => {
    if (m.tipo === "progresso") return aoProgresso?.(m);
    const p = esperando.get(m.id);
    if (!p) return;
    esperando.delete(m.id);
    m.tipo === "erro" ? p.falha(new Error(m.erro)) : p.ok(m);
  };
  worker.onerror = (e) => { esperando.forEach((p) => p.falha(new Error(e.message || "O transcritor parou."))); esperando.clear(); worker = null; carregado = null; };
  return worker;
}
function pedir(msg, transferir) {
  const id = ++seq;
  return new Promise((ok, falha) => { esperando.set(id, { ok, falha }); abrirWorker().postMessage({ ...msg, id }, transferir || []); });
}

/** Baixa (se preciso) e carrega o modelo. progresso({carregado,total}) em bytes. */
export async function preparar(p, progresso) {
  const k = `${p.repo}|${p.device}|${JSON.stringify(p.dtype)}`;
  if (carregado === k) return;
  aoProgresso = progresso;
  try { await pedir({ tipo: "carregar", repo: p.repo, device: p.device, dtype: p.dtype }); }
  finally { aoProgresso = null; }
  carregado = k;
}

/** Interrompe na hora (descarta o modelo carregado; o próximo uso recarrega do cache). */
export function abortar() {
  if (!worker) return;
  worker.terminate();
  esperando.forEach((p) => p.falha(new Error("cancelado")));
  esperando.clear();
  worker = null; carregado = null;
}

// ---------------------------------------------------------------- áudio

export async function decodificar(blob) {
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  // mistura os canais (a conversão de taxa já veio do decodeAudioData)
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels; }
  return out;
}

const JANELA = 30 * 16000;
const SILENCIO = 0.004;   // RMS abaixo disso = janela muda (o Whisper inventa frases no silêncio)

function rms(a, ini, fim) {
  let s = 0;
  for (let i = ini; i < fim; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, fim - ini));
}

/**
 * Transcreve uma faixa. aoAvancar(fracao 0..1). cancelado() => true para parar.
 * Devolve [{ini, fim, texto}] em segundos desde o início da faixa.
 */
export async function transcreverFaixa(audio, idioma, aoAvancar, cancelado) {
  const frases = [];
  for (let ini = 0; ini < audio.length; ini += JANELA) {
    if (cancelado()) throw new Error("cancelado");
    const fim = Math.min(audio.length, ini + JANELA);
    if (fim - ini > 16000 / 2 && rms(audio, ini, fim) > SILENCIO) {
      const pedaco = audio.slice(ini, fim);
      const r = await pedir({ tipo: "janela", audio: pedaco, idioma }, [pedaco.buffer]);
      const off = ini / 16000;
      for (const f of r.frases) frases.push({ ini: off + f.ini, fim: off + f.fim, texto: f.texto });
    }
    aoAvancar(fim / audio.length);
  }
  return limpar(frases);
}

// O Whisper às vezes repete a mesma frase em sequência ao cortar a janela no meio de uma fala.
function limpar(frases) {
  const out = [];
  for (const f of frases) {
    const ant = out[out.length - 1];
    if (ant && ant.texto === f.texto && f.ini - ant.fim < 2) { ant.fim = f.fim; continue; }
    out.push(f);
  }
  return out;
}

const hms = (s) => [s / 3600, (s % 3600) / 60, s % 60].map((x) => String(Math.floor(x)).padStart(2, "0")).join(":");

/** Junta as faixas ({quem, frases}) num .md em ordem de tempo. */
export function montarMd(titulo, faixas) {
  const todas = faixas.flatMap(({ quem, frases }) => frases.map((f) => ({ ...f, quem }))).sort((a, b) => a.ini - b.ini);
  const linhas = [];
  for (const f of todas) {
    const ant = linhas[linhas.length - 1];
    // frases seguidas da mesma pessoa, sem pausa grande, viram um parágrafo só
    if (ant && ant.quem === f.quem && f.ini - ant.fim < 1.5 && ant.texto.length < 400) { ant.texto += " " + f.texto; ant.fim = f.fim; continue; }
    linhas.push({ ...f });
  }
  return `# ${titulo}\n\n` + linhas.map((l) => `**[${hms(l.ini)}] ${l.quem}:** ${l.texto}`).join("\n\n") + "\n";
}
