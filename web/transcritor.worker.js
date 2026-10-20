// Whisper rodando no navegador (Transformers.js). Recebe janelas de até 30 s de áudio a 16 kHz
// e devolve as frases com o tempo de cada uma. Quem divide o áudio e junta as faixas é o motor.js.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";

env.allowLocalModels = false;
let asr = null, chave = null;

async function carregar({ repo, device, dtype }) {
  const k = `${repo}|${device}|${JSON.stringify(dtype)}`;
  if (asr && chave === k) return;
  if (asr) { await asr.dispose?.(); asr = null; }
  asr = await pipeline("automatic-speech-recognition", repo, {
    device, dtype,
    progress_callback: (p) => {
      if (p.status === "progress_total") postMessage({ tipo: "progresso", carregado: p.loaded, total: p.total });
    },
  });
  chave = k;
}

onmessage = async ({ data: m }) => {
  try {
    if (m.tipo === "carregar") {
      await carregar(m);
      postMessage({ tipo: "pronto", id: m.id });
    } else if (m.tipo === "janela") {
      const r = await asr(m.audio, { language: m.idioma, task: "transcribe", return_timestamps: true });
      const frases = (r.chunks || [{ timestamp: [0, m.audio.length / 16000], text: r.text }])
        .map((c) => ({ ini: c.timestamp[0] ?? 0, fim: c.timestamp[1] ?? c.timestamp[0] ?? 0, texto: c.text.trim() }))
        .filter((c) => c.texto);
      postMessage({ tipo: "janela", id: m.id, frases });
    }
  } catch (e) {
    postMessage({ tipo: "erro", id: m.id, erro: String(e?.message || e) });
  }
};
