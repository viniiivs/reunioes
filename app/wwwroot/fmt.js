// Formatos em pt-BR compartilhados pela lista e pelo leitor.

export function duracao(s) {
  if (s == null) return null;
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h}h${String(r).padStart(2, "0")}`;
}

export function tamanho(b) {
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  const mb = b / 1024 / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1).replace(".", ",") : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1).replace(".", ",")} GB`;
}

export const hora = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function dia(d) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dif = Math.round((hoje - x) / 86400000);
  if (dif === 0) return "Hoje";
  if (dif === 1) return "Ontem";
  const s = x.toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long",
    year: x.getFullYear() === hoje.getFullYear() ? undefined : "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "Hoje", "Ontem" ou "qui., 16/10" (com ano se não for o atual): para a coluna Data.
export function diaTabela(d) {
  const n = dia(d);
  if (n === "Hoje" || n === "Ontem") return n;
  const x = new Date(d);
  const sem = x.toLocaleDateString("pt-BR", { weekday: "short" });
  const dt = x.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit",
    year: x.getFullYear() === new Date().getFullYear() ? undefined : "2-digit" });
  return `${sem} ${dt}`;
}

export const diaCurto =(d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

// Nome amigavel dos executaveis que costumam tocar som numa reuniao.
const APPS = {
  "ms-teams.exe": "Teams", "teams.exe": "Teams", "msteams.exe": "Teams",
  "chrome.exe": "Chrome", "msedge.exe": "Edge", "firefox.exe": "Firefox", "brave.exe": "Brave", "opera.exe": "Opera",
  "zoom.exe": "Zoom", "discord.exe": "Discord", "slack.exe": "Slack", "whatsapp.exe": "WhatsApp",
  "whatsapp.root.exe": "WhatsApp", "telegram.exe": "Telegram", "spotify.exe": "Spotify", "vlc.exe": "VLC",
  "webex.exe": "Webex", "ciscocollabhost.exe": "Webex", "skype.exe": "Skype", "msedgewebview2.exe": "WebView",
  "pwsh.exe": "PowerShell", "powershell.exe": "PowerShell", "audiodg.exe": "Windows",
};
export function nomeApp(exe) {
  const k = exe.toLowerCase();
  if (APPS[k]) return APPS[k];
  const n = exe.replace(/\.exe$/i, "");
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
