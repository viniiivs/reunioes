// Markdown dos addons -> HTML seguro (tudo escapado antes; links só https).
// Cobre o que um resultado precisa: títulos, parágrafos, listas (inclusive [ ] / [x]), citação,
// tabela, código, linha, **negrito**, *itálico*, `código`, [texto](https://...), carimbos [hh:mm:ss]
// (viram link para o trecho na transcrição) e selos [[ok: Fato]] / [[erro: ...]] / [[alerta: ...]] / [[neutro: ...]].
import { esc } from "./fmt.js";

function inline(t) {
  // código, selos, links e carimbos viram marcadores antes do negrito/itálico: um "_" ou "*" dentro
  // de uma URL ou de um código não pode virar <em>
  const prontos = [];
  const guarda = (html) => `\u0000${prontos.push(html) - 1}\u0000`;
  const link = (url, txt) => guarda(`<a class="link-md" href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>`);
  const volta = (s) => (/\u0000\d+\u0000/.test(s) ? volta(s.replace(/\u0000(\d+)\u0000/g, (_, i) => prontos[i])) : s);   // um selo pode estar dentro do texto de um link
  return volta(esc(t)
    .replace(/`([^`]+)`/g, (_, c) => guarda(`<code>${c}</code>`))
    .replace(/\[\[(?:(ok|erro|alerta|neutro):\s*)?([^\]]{1,40})\]\]/g, (_, tom, txt) => guarda(`<span class="selo ${tom || "neutro"}">${txt.trim()}</span>`))
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_, txt, url) => link(url, txt))
    .replace(/(^|[\s(])(https:\/\/[^\s<)]+[^\s<).,;:!?])/g, (_, a, url) => a + link(url, url.replace(/^https:\/\/(www\.)?/, "")))
    .replace(/\[(\d{1,2}:\d\d:\d\d)\]/g, (_, h) => guarda(`<button class="tempo-link" data-tempo="${h.padStart(8, "0")}" title="Ver na transcrição">${h}</button>`))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>"));
}

const celulas = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function markdown(md) {
  const linhas = String(md || "").replace(/\r/g, "").split("\n");
  let html = "", i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if (/^```/.test(l)) {   // bloco de código
      const corpo = [];
      for (i++; i < linhas.length && !/^```/.test(linhas[i]); i++) corpo.push(linhas[i]);
      i++;
      html += `<pre><code>${esc(corpo.join("\n"))}</code></pre>`;
    } else if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
      const n = m[1].length <= 2 ? 2 : 3;
      html += `<h${n}>${inline(m[2])}</h${n}>`; i++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
      html += "<hr>"; i++;
    } else if (/^\s*>/.test(l)) {
      const corpo = [];
      for (; i < linhas.length && /^\s*>/.test(linhas[i]); i++) corpo.push(linhas[i].replace(/^\s*>\s?/, ""));
      html += `<blockquote>${markdown(corpo.join("\n"))}</blockquote>`;
    } else if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(linhas[i + 1] || "")) {
      const cab = celulas(l);
      const corpo = [];
      for (i += 2; i < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[i]); i++) corpo.push(celulas(linhas[i]));
      html += `<div class="tabela-md"><table><thead><tr>${cab.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${
        corpo.map((r) => `<tr>${cab.map((_, k) => `<td>${inline(r[k] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    } else if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordenada = /^\s*\d/.test(l);
      const itens = [];
      for (; i < linhas.length && /^\s*([-*+]|\d+[.)])\s+/.test(linhas[i]); i++) {
        let t = linhas[i].replace(/^\s*([-*+]|\d+[.)])\s+/, "");
        // continuação do item na linha de baixo (recuada)
        while (i + 1 < linhas.length && /^\s{2,}\S/.test(linhas[i + 1]) && !/^\s*([-*+]|\d+[.)])\s+/.test(linhas[i + 1])) t += " " + linhas[++i].trim();
        const tarefa = t.match(/^\[([ xX])\]\s+(.*)$/);
        itens.push(tarefa
          ? `<li class="tarefa${tarefa[1] === " " ? "" : " feita"}"><i class="ph ${tarefa[1] === " " ? "ph-square" : "ph-check-square"}" aria-hidden="true"></i><span>${inline(tarefa[2])}</span></li>`
          : `<li>${inline(t)}</li>`);
      }
      html += ordenada ? `<ol>${itens.join("")}</ol>` : `<ul>${itens.join("")}</ul>`;
    } else {
      const par = [];
      for (; i < linhas.length && linhas[i].trim() && !/^(#{1,4}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+|\s*\|.*\|\s*$)/.test(linhas[i]); i++) par.push(linhas[i].trim());
      if (!par.length) { html += `<p>${inline(l.trim())}</p>`; i++; continue; }
      html += `<p>${par.map(inline).join("<br>")}</p>`;
    }
  }
  return html;
}
