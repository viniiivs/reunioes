// Tudo fica no navegador da pessoa: gravações e transcrições no IndexedDB, configuração no
// localStorage. Nada vai para servidor.
const BANCO = "reunioes", VERSAO = 1;
let banco;

function abrir() {
  if (banco) return banco;
  banco = new Promise((ok, falha) => {
    const r = indexedDB.open(BANCO, VERSAO);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("gravacoes")) db.createObjectStore("gravacoes", { keyPath: "base" });
      if (!db.objectStoreNames.contains("audios")) db.createObjectStore("audios");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
  return banco;
}

async function op(loja, modo, fn) {
  const db = await abrir();
  return new Promise((ok, falha) => {
    const tx = db.transaction(loja, modo);
    const req = fn(tx.objectStore(loja));
    tx.oncomplete = () => ok(req?.result);
    tx.onerror = () => falha(tx.error);
    tx.onabort = () => falha(tx.error || new Error("Operação cancelada."));
  });
}

export const gravacoes = {
  todas: () => op("gravacoes", "readonly", (s) => s.getAll()),
  uma: (base) => op("gravacoes", "readonly", (s) => s.get(base)),
  salvar: (g) => op("gravacoes", "readwrite", (s) => s.put(g)),
  apagar: (base) => op("gravacoes", "readwrite", (s) => s.delete(base)),
};

export const audios = {
  ler: (chave) => op("audios", "readonly", (s) => s.get(chave)),
  salvar: (chave, blob) => op("audios", "readwrite", (s) => s.put(blob, chave)),
  apagar: (chave) => op("audios", "readwrite", (s) => s.delete(chave)),
};

const CHAVE_CONFIG = "reunioes.config";
export const PADRAO = {
  idioma: "pt", modelo: "whisper-small", usarGpu: true, mic: null,
  resumo: { ativo: false, nome: "", apelidos: "", contexto: "" },
  configuracaoConcluida: false,
};

export function config() {
  try { return { ...PADRAO, ...JSON.parse(localStorage.getItem(CHAVE_CONFIG) || "{}") }; }
  catch { return { ...PADRAO }; }
}
export function salvarConfig(c) { localStorage.setItem(CHAVE_CONFIG, JSON.stringify(c)); }

// Chave da API da Anthropic: só neste navegador, separada da configuração (nunca é exportada).
const CHAVE_API = "reunioes.chaveApi";
export const chaveApi = {
  ler: () => localStorage.getItem(CHAVE_API) || null,
  salvar: (v) => (v ? localStorage.setItem(CHAVE_API, v.trim()) : localStorage.removeItem(CHAVE_API)),
};

export async function espaco() {
  const e = await navigator.storage?.estimate?.();
  return e ? { usado: e.usage || 0, cota: e.quota || 0 } : { usado: 0, cota: 0 };
}
