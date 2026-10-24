// Conversa com o host (.NET) pelo WebView2. Fora do app (navegador comum, testes de tela),
// cai num simulador com dados ficticios para as telas poderem ser vistas e verificadas.
const wv = window.chrome && window.chrome.webview;
const pendentes = new Map();
const ouvintes = new Set();
let seq = 0;

if (wv) {
  wv.addEventListener("message", (e) => {
    const m = e.data;
    if (m.id && pendentes.has(m.id)) {
      const { ok, falha } = pendentes.get(m.id);
      pendentes.delete(m.id);
      m.ok ? ok(m.dados) : falha(new Error(m.erro));
    } else if (m.evento) {
      ouvintes.forEach((f) => f(m));
    }
  });
}

// Uma tela embutida (Configurações por cima da lista) usa a ponte da janela que a contém:
// assim abrir e fechar não recarrega nada e os avisos do app chegam às duas.
// Atenção: dentro do WebView2 o iframe TAMBÉM tem chrome.webview, mas o host só recebe mensagens
// do documento principal. Embutida, a tela precisa sempre usar a ponte da janela principal.
const pai = window.parent !== window ? window.parent.ponteReunioes || null : null;

// Versão web (build/web.ps1 marca as páginas): os comandos rodam no próprio navegador.
export const naWeb = !!window.REUNIOES_WEB;
const web = naWeb && !pai ? await import("./web/backend.js") : null;
if (web) web.ligar((m) => ouvintes.forEach((f) => f(m)));

export function chamar(cmd, args = {}) {
  if (pai) return pai.chamar(cmd, args);
  if (web) return web.chamar(cmd, args);
  if (!wv) return simular(cmd, args);
  return new Promise((ok, falha) => {
    const id = ++seq;
    pendentes.set(id, { ok, falha });
    wv.postMessage({ id, cmd, args });
  });
}

export function aoMudar(f) { pai ? pai.aoMudar(f) : ouvintes.add(f); }

export const embutida = !!pai || (window.parent !== window);
if (!pai) window.ponteReunioes = { chamar, aoMudar };

export const noApp = !!wv;

// ---------------------------------------------------------------- simulador (dados ficticios)
const hoje = new Date();
const dia = (d, h, m) => { const x = new Date(hoje); x.setDate(x.getDate() - d); x.setHours(h, m, 0, 0); return x.toISOString(); };
const exemplo = [
  { base: "a", inicio: dia(0, 10, 0), duracao: 1712, bytes: 84211000, estado: "transcrevendo", etapa: "2/3 transcrevendo os outros", pct: 42, falantes: null, apps: [{ exe: "zoom.exe", segundos: 1690 }], auto: "Zoom", vozes: false },
  { base: "b", inicio: dia(1, 14, 30), duracao: 2290, bytes: 101300000, estado: "pronta", falantes: ["Ana", "Eu", "Bruno", "Falante 3"], apps: null, vozes: true,
    resumo: { estado: "pronto", veredito: "2 ações: revisar a proposta e marcar a demo com a Ana", precisaAgir: true, acoes: 2, feitas: 1 } },
  { base: "c", inicio: dia(2, 9, 15), duracao: 640, bytes: 27100000, estado: "pronta", falantes: ["Outros", "Eu"], apps: null, vozes: false,
    resumo: { estado: "pronto", veredito: "Nada pra você fazer", precisaAgir: false, acoes: 0 } },
  { base: "d", inicio: dia(3, 16, 5), duracao: 3920, bytes: 190400000, estado: "pronta", falantes: ["Ana", "Eu"], apps: null, vozes: true, resumo: null },
  { base: "g", inicio: dia(3, 9, 0), duracao: 2710, bytes: 120000000, estado: "pausada", etapa: "já tem sua voz", falantes: null, apps: null },
  { base: "h", inicio: dia(3, 8, 0), duracao: 1500, bytes: 70000000, estado: "fila", falantes: null, apps: null },
  { base: "e", inicio: dia(4, 11, 40), duracao: 15, bytes: 52000, estado: "sem", falantes: null, apps: null },
  { base: "f", inicio: dia(6, 15, 0), duracao: null, bytes: 88000000, estado: "incompleta", falantes: null, apps: null },
];
const textoExemplo = `# Reuniao exemplo

**[00:00:00] Ana:** Bom dia. Vamos começar pela proposta do cliente novo.

**[00:00:07] Bruno:** Eu mandei ontem à noite. Falta alguém revisar os valores.

**[00:00:15] Eu:** Eu reviso hoje à tarde e devolvo comentado.

**[00:00:22] Eu:** Obrigado.

**[00:00:26] Ana:** Ótimo. E a demo, consegue marcar comigo para quinta?

**[00:00:31] Eu:** Consigo, te mando o convite.
`;
const resumoExemplo = {
  precisa_agir: true,
  veredito: "2 ações: revisar a proposta e marcar a demo com a Ana",
  acoes: [
    { acao: "Revisar os valores da proposta do cliente novo e devolver comentada", prazo: "hoje à tarde", pedido_por: "Bruno", tempo: "00:00:15", feita: true },
    { acao: "Mandar o convite da demo para a Ana", prazo: "quinta", pedido_por: "Ana", tempo: "00:00:26" },
  ],
  atencao: ["A proposta já foi enviada pelo Bruno; só falta a revisão."],
  resumo: ["Proposta do cliente novo pronta, aguardando revisão de valores.", "Demo com a Ana combinada para quinta."],
  gerado_em: hoje.toISOString(), modelo: "claude-sonnet",
};
const checagemExemplo = {
  itens: [
    { afirmacao: "O Brasil tem uns 250 milhões de habitantes", quem: "Ana", tempo: "00:00:00", veredito: "fake",
      explicacao: "O IBGE estima 213,4 milhões de habitantes em 2025, não 250 milhões.",
      fontes: [{ titulo: "Estimativas da população | IBGE", url: "https://www.ibge.gov.br/estatisticas/sociais/populacao/9103-estimativas-de-populacao.html" }], origem: "reuniao" },
    { afirmacao: "A LGPD vale desde 2018, com multa de até 2% do faturamento", quem: "Bruno", tempo: "00:00:07", veredito: "impreciso",
      explicacao: "Foi sancionada em 2018, mas só vale desde 2020; a multa é de até 2% do faturamento, limitada a R$ 50 milhões por infração.",
      fontes: [{ titulo: "Lei nº 13.709/2018 (LGPD)", url: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm" }, { titulo: "ANPD: sanções", url: "https://www.gov.br/anpd/pt-br" }], origem: "reuniao" },
    { afirmacao: "O Pix foi lançado em novembro de 2020", quem: "Eu", tempo: "00:00:15", veredito: "fato",
      explicacao: "O Banco Central lançou o Pix em 16 de novembro de 2020.",
      fontes: [{ titulo: "Pix | Banco Central do Brasil", url: "https://www.bcb.gov.br/estabilidadefinanceira/pix" }], origem: "reuniao" },
  ],
  reuniao_checada: true, gerado_em: hoje.toISOString(), modelo: "claude-sonnet",
};
let checagemSim = null, checandoSim = false;
const configExemplo = {
  pastaGravacoes: "C:\\Users\\voce\\Documents\\Reuniões", pastaMotor: "C:\\Users\\voce\\AppData\\Local\\Reunioes-motor",
  idioma: "pt", modelo: "large-v3", usarGpu: true, separarVozes: false, mic: null, saida: null,
  gravarSozinho: true, atalho: "ctrl+alt+g", iniciarComWindows: true, atualizarSozinho: true,
  resumo: { ativo: false, nome: "", apelidos: "", contexto: "" }, temToken: false, configuracaoConcluida: false,
};
const etapasExemplo = [
  { id: "python", titulo: "Baixando o Python" }, { id: "venv", titulo: "Criando o ambiente" },
  { id: "libs", titulo: "Instalando as bibliotecas de IA (cerca de 3 GB, com suporte à placa de vídeo)" },
  { id: "modelos", titulo: "Baixando os modelos" }, { id: "limpar", titulo: "Limpando arquivos temporários" },
];

function simularInstalacao() {
  let i = 1, pct = 0;
  const t = setInterval(() => {
    pct += 20;
    ouvintes.forEach((f) => f({ evento: "instalacao", etapa: i, total: 5, titulo: etapasExemplo[i - 1].titulo, detalhe: i === 4 ? `${(pct * 0.031).toFixed(2)} de 3,10 GB` : "Downloading torch", pct: i === 4 ? pct : null, estado: "rodando" }));
    if (pct >= 100) { pct = 0; i++; }
    if (i > 5) { clearInterval(t); ouvintes.forEach((f) => f({ evento: "instalacao", etapa: 5, total: 5, estado: "fim" })); }
  }, 300);
}

async function simular(cmd, args) {
  await new Promise((r) => setTimeout(r, 150));
  const q = new URLSearchParams(location.search);
  if (q.has("vazio") && cmd === "listar") return [];
  if (q.has("erro")) throw new Error("Falha simulada ao falar com o app.");
  switch (cmd) {
    case "listar":
      if (!q.has("muitas")) return exemplo;
      // lista longa para testes de tela (rolagem, material translucido)
      return Array.from({ length: 4 }, (_, k) => exemplo.map((g) => ({
        ...g, base: g.base + k, inicio: new Date(new Date(g.inicio).getTime() - k * 7 * 86400000).toISOString(),
        estado: k > 0 && g.estado === "transcrevendo" ? "pronta" : g.estado,
        falantes: k > 0 && g.estado === "transcrevendo" ? ["Ana", "Eu"] : g.falantes,
      }))).flat();
    case "ler":
      if (checagemSim === null) checagemSim = q.has("checagem") ? structuredClone(checagemExemplo) : false;
      return { texto: textoExemplo, gravacao: exemplo.find((g) => g.base === args.base) || exemplo[1], resumo: q.has("semresumo") ? null : resumoExemplo, resumoAtivo: true,
        checagem: checagemSim || null, checando: checandoSim || q.has("checando"), checagemErro: q.has("checagemerro") ? "O Claude não respondeu em 6 minutos." : null, podeChecar: !q.has("semclaude") };
    case "checar":
      // pesquisa fictícia: 1,2 s depois chega o resultado (trecho soma no topo; reunião troca os itens)
      checandoSim = true;
      setTimeout(() => {
        const base = checagemSim || { itens: [], reuniao_checada: false };
        const trecho = args.trecho ? [{ afirmacao: args.trecho.slice(0, 90), quem: args.quem, tempo: args.tempo, veredito: "sem_dados",
          explicacao: "Não achei fonte pública confiável sobre isso: parece um assunto interno da reunião.", fontes: [], origem: "trecho" }] : [];
        checagemSim = args.trecho ? { ...base, itens: [...trecho, ...base.itens] }
          : { ...structuredClone(checagemExemplo), itens: [...base.itens.filter((x) => x.origem === "trecho"), ...checagemExemplo.itens] };
        checagemSim.gerado_em = new Date().toISOString();
        checandoSim = false;
        ouvintes.forEach((f) => f({ evento: "mudou" }));
      }, 1200);
      return null;
    case "estado": return { gravando: q.has("gravando"), servico: { rodando: true, app: q.has("nomic") ? "Zoom" : null, atalhoOk: true }, gravarSozinho: !q.has("auto0"), atalho: "ctrl+alt+g", motorPronto: true, atualizacao: { estado: q.has("upd") ? "pronta" : "atual", nova: "1.1.0", versao: "1.0.0" } };
    case "config": return { ...configExemplo };
    case "sistema": return { versao: "1.0.0", gpus: q.has("semgpu") ? ["Intel UHD Graphics"] : ["NVIDIA GeForce RTX 4060"], nvidia: !q.has("semgpu"), memoriaGB: 16, livreGB: 120.4, livreGravacoesGB: 120.4, claude: !q.has("semclaude") };
    case "dispositivos": return { mics: [{ nome: "Microfone (USB Audio)", padrao: true }, { nome: "Microfone (Webcam)", padrao: false }], saidas: [{ nome: "Fones de ouvido (USB Audio)", padrao: true }, { nome: "Alto-falantes (Realtek)", padrao: false }] };
    case "livre": return 120.4;
    case "pendentes": return q.has("pend") ? etapasExemplo.slice(3) : [];
    case "salvarConfig": return etapasExemplo;
    case "instalar": simularInstalacao(); return null;
    case "atualizacao": return { versao: "1.0.0", estado: "atual", instalado: true };
    case "procurarAtualizacao": return { versao: "1.0.0", estado: "atual", instalado: true };
    case "testarToken": return { ok: false, msg: "O token funciona, mas falta aceitar os termos do modelo (link acima)." };
    default: console.log("[simulado]", cmd, args); return null;
  }
}
