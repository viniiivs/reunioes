using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Reunioes;

/// <summary>Um addon instalado: pasta %APPDATA%\Reunioes\addons\&lt;id&gt;\ com addon.json. Erro != null =
/// addon.json invalido (aparece nas Configuracoes com o motivo e nao vira aba).</summary>
public sealed record Addon(
    string Id, string Pasta, string Nome, string Icone, string? Descricao, string Botao, string? Versao,
    string Tipo,              // claude (= "ia": roda no Claude Code ou no Codex) | comando
    string? Prompt,           // claude: arquivo do prompt de sistema (relativo a pasta)
    string[] Ferramentas,     // claude: ex. WebSearch, WebFetch; vazio = nenhuma
    string Modelo,            // claude: sonnet, opus, haiku... (no Codex vira o esforco de raciocinio)
    string? IaExigida,        // claude: "claude" ou "codex" quando o addon so funciona numa; null = a escolhida
    string[]? Comando,        // comando: programa e argumentos; "{python}" = Python do motor
    int PrazoMinutos,
    string? BotaoTrecho,      // != null: tambem roda num trecho selecionado na transcricao (rotulo do botao)
    string? Erro);

/// <summary>Trecho selecionado na transcricao.</summary>
public sealed record Trecho(string Texto, string? Quem, string? Tempo);

/// <summary>Addons fazem algo com uma reuniao ja transcrita, cada um numa aba do leitor, como o Fato ou
/// fake. Nao vem nenhum com o app: so existem no computador de quem copiou a pasta. O resultado e
/// markdown e fica em &lt;base&gt;.addon.&lt;id&gt;.json junto da gravacao.</summary>
public static class Addons
{
    public static string Dir { get; set; } = Path.Combine(Config.DirApp, "addons");   // testes trocam
    static readonly Regex reId = new("^[a-z0-9][a-z0-9_-]{0,39}$");
    static readonly Regex reIcone = new("^[a-z0-9-]{1,40}$");
    static readonly Regex reFerramenta = new("^[A-Za-z]{1,40}$");
    const int LimiteMd = 1_000_000;

    public static List<Addon> Listar()
    {
        if (!Directory.Exists(Dir)) return [];
        return Directory.GetDirectories(Dir).Select(Ler).OrderBy(a => a.Nome, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    public static Addon? Achar(string id) => reId.IsMatch(id) ? Listar().FirstOrDefault(a => a.Id == id) : null;

    static Addon Ler(string pasta)
    {
        var id = Path.GetFileName(pasta);
        Addon Ruim(string msg) => new(id, pasta, id, "puzzle-piece", null, "Rodar", null, "claude", null, [], "sonnet", null, null, 10, null, msg);
        if (!reId.IsMatch(id)) return Ruim("Nome da pasta inválido: use letras minúsculas, números e hífen.");
        var arq = Path.Combine(pasta, "addon.json");
        if (!File.Exists(arq)) return Ruim("Falta o addon.json.");
        JsonObject j;
        try { j = JsonNode.Parse(File.ReadAllText(arq), documentOptions: new() { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true }) as JsonObject ?? throw new JsonException(); }
        catch (Exception) { return Ruim("addon.json ilegível."); }

        string? Txt(string k, int max) => j[k] is JsonValue v && v.TryGetValue<string>(out var s) && s.Trim().Length > 0 ? s.Trim()[..Math.Min(s.Trim().Length, max)] : null;
        var nome = Txt("nome", 40) ?? id;
        var icone = Txt("icone", 40) ?? "puzzle-piece";
        if (!reIcone.IsMatch(icone)) icone = "puzzle-piece";
        var tipo = Txt("tipo", 10) ?? "claude";
        if (tipo == "ia") tipo = "claude";
        var exigida = Txt("ia", 10);
        var prazo = j["prazoMinutos"] is JsonValue pv && pv.TryGetValue<int>(out var p) ? Math.Clamp(p, 1, 60) : 10;
        var ferramentas = j["ferramentas"] is JsonArray fa ? fa.Select(x => x?.ToString() ?? "").Where(x => reFerramenta.IsMatch(x)).ToArray() : [];
        var comando = j["comando"] is JsonArray ca ? ca.Select(x => x?.ToString() ?? "").ToArray() : null;
        var a = new Addon(id, pasta, nome, icone, Txt("descricao", 300), Txt("botao", 30) ?? "Rodar", Txt("versao", 20), tipo,
            Txt("prompt", 100) ?? "prompt.md", ferramentas, Txt("modelo", 30) ?? "sonnet", exigida, comando, prazo, Txt("botaoTrecho", 30), null);

        if (tipo == "claude")
        {
            var pr = Dentro(pasta, a.Prompt!);
            if (pr == null || !File.Exists(pr)) return a with { Erro = $"Falta o arquivo do prompt ({a.Prompt})." };
            if (exigida is not (null or Ia.Claude or Ia.Codex)) return a with { Erro = "\"ia\" precisa ser \"claude\" ou \"codex\"." };
        }
        else if (tipo == "comando")
        {
            if (comando is not { Length: > 0 } || comando[0].Length == 0) return a with { Erro = "Falta o \"comando\" no addon.json." };
        }
        else return a with { Erro = "\"tipo\" precisa ser \"claude\" ou \"comando\"." };
        return a;
    }

    /// <summary>Caminho relativo a pasta do addon, sem sair dela.</summary>
    static string? Dentro(string pasta, string rel)
    {
        var p = Path.GetFullPath(Path.Combine(pasta, rel));
        return p.StartsWith(Path.GetFullPath(pasta) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ? p : null;
    }

    /// <summary>Copia a pasta escolhida (precisa ter addon.json) para a pasta de addons. Mesmo id = atualiza.</summary>
    public static string Instalar(string origem)
    {
        if (!File.Exists(Path.Combine(origem, "addon.json"))) throw new InvalidOperationException("Essa pasta não tem um addon.json.");
        var id = Path.GetFileName(origem.TrimEnd('\\', '/')).ToLowerInvariant();
        if (!reId.IsMatch(id)) throw new InvalidOperationException("Nome da pasta inválido: use letras minúsculas, números e hífen.");
        var destino = Path.Combine(Dir, id);
        if (Path.GetFullPath(origem).TrimEnd('\\').Equals(Path.GetFullPath(destino), StringComparison.OrdinalIgnoreCase)) return id;
        if (Directory.Exists(destino)) Directory.Delete(destino, true);
        foreach (var d in Directory.GetDirectories(origem, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(Path.Combine(destino, Path.GetRelativePath(origem, d)));
        Directory.CreateDirectory(destino);
        foreach (var f in Directory.GetFiles(origem, "*", SearchOption.AllDirectories))
            File.Copy(f, Path.Combine(destino, Path.GetRelativePath(origem, f)), true);
        return id;
    }

    /// <summary>Roda o addon e devolve (markdown, modelo).</summary>
    public static async Task<(string Md, string? Modelo)> Rodar(Addon a, Config c, string b, DateTime dia, string transcricao, string pastaGravacao, Trecho? trecho = null)
    {
        var nome = c.Resumo.Nome?.Trim() is { Length: > 0 } n ? n : null;
        string md; string? modelo = null;
        if (a.Tipo == "claude")
        {
            var prompt = File.ReadAllText(Dentro(a.Pasta, a.Prompt!)!).Replace("{nome}", nome ?? "o dono do app");
            var arq = Path.Combine(Config.DirApp, $"addon-{a.Id}-prompt.md");
            File.WriteAllText(arq, prompt);
            var entrada = $"Data da reunião: {dia:dd/MM/yyyy}.\n" + (nome != null ? $"Dono do app (\"Eu\" na transcrição): {nome}.\n" : "")
                + (trecho is null ? "\nTranscrição:\n\n"
                    : $"\nRode só neste trecho{(trecho.Quem is null ? "" : $", dito por {trecho.Quem}")}{(trecho.Tempo is null ? "" : $" em {trecho.Tempo}")}:\n«{trecho.Texto}»\n\nTranscrição, só para contexto:\n\n")
                + transcricao;
            var res = await Ia.Rodar(c, a.IaExigida, arq, null, entrada, string.Join(",", a.Ferramentas), TimeSpan.FromMinutes(a.PrazoMinutos), a.Modelo);
            md = res.Texto;
            modelo = res.Modelo;
        }
        else
        {
            var cmd = a.Comando!;
            var exe = cmd[0] == "{python}" ? c.Python : Dentro(a.Pasta, cmd[0]) is { } local && File.Exists(local) ? local : cmd[0];
            var psi = new ProcessStartInfo(exe)
            {
                UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = a.Pasta,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
            };
            foreach (var arg in cmd.Skip(1)) psi.ArgumentList.Add(arg);
            psi.Environment["PYTHONUTF8"] = "1";
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            psi.Environment["REUNIOES_BASE"] = b;
            psi.Environment["REUNIOES_PASTA"] = pastaGravacao;
            psi.Environment["REUNIOES_TRANSCRICAO"] = Path.Combine(pastaGravacao, b + ".transcricao.md");
            var entrada = new JsonObject
            {
                ["base"] = b, ["data"] = dia.ToString("yyyy-MM-dd"), ["nome"] = nome, ["transcricao"] = transcricao,
                ["pasta"] = pastaGravacao, ["prefixo"] = Path.Combine(pastaGravacao, b),
                ["trecho"] = trecho is null ? null : new JsonObject { ["texto"] = trecho.Texto, ["quem"] = trecho.Quem, ["tempo"] = trecho.Tempo },
            };
            Process p;
            try { p = Process.Start(psi)!; }
            catch (System.ComponentModel.Win32Exception) { throw new InvalidOperationException($"Não achei o programa do addon: {cmd[0]}"); }
            using (p)
            {
                var saida = p.StandardOutput.ReadToEndAsync();
                var erro = p.StandardError.ReadToEndAsync();
                try { await p.StandardInput.WriteAsync(entrada.ToJsonString()); p.StandardInput.Close(); }
                catch (IOException) { }   // programa que nao le a entrada
                using var prazo = new CancellationTokenSource(TimeSpan.FromMinutes(a.PrazoMinutos));
                try { await p.WaitForExitAsync(prazo.Token); }
                catch (OperationCanceledException) { p.Kill(true); throw new TimeoutException($"O addon não terminou em {a.PrazoMinutos} minutos."); }
                md = await saida;
                if (p.ExitCode != 0)
                {
                    var linhas = (await erro).Trim().Split('\n');
                    var msg = string.Join("\n", linhas.TakeLast(3)).Trim();
                    throw new InvalidOperationException(msg.Length > 0 ? msg : $"O addon saiu com erro (código {p.ExitCode}).");
                }
            }
        }
        md = md.Trim();
        if (md.Length == 0) throw new InvalidOperationException("O addon não devolveu nada.");
        return (md.Length > LimiteMd ? md[..LimiteMd] : md, modelo);
    }
}

/// <summary>Rodar addon numa gravacao: um por vez para cada par (reuniao, addon). Rodar na reuniao
/// troca o "markdown"; rodar num trecho soma no topo de "trechos" (os dois ficam).</summary>
public sealed partial class Gravacoes
{
    readonly HashSet<string> rodandoAddon = new();

    bool AddonRodando(string b, string id) { lock (trava) return rodandoAddon.Contains(b + "|" + id); }

    public void RodarAddon(string b, string id, Trecho? trecho = null)
    {
        Validar(b);
        var a = Addons.Achar(id) ?? throw new InvalidOperationException("Addon não encontrado.");
        if (a.Erro != null) throw new InvalidOperationException(a.Erro);
        if (cfg().AddonsDesligados.Contains(a.Id)) throw new InvalidOperationException("Esse addon está desligado em Configurações.");
        if (!File.Exists(Caminho(b, "transcricao.md"))) throw new InvalidOperationException("Transcreva antes.");
        if (trecho != null)
        {
            if (a.BotaoTrecho == null) throw new InvalidOperationException($"{a.Nome} não roda em trechos.");
            if (trecho.Texto.Trim().Length == 0) throw new InvalidOperationException("Selecione um trecho.");
            if (trecho.Texto.Length > 2000) throw new InvalidOperationException("Escolha um trecho menor (até umas 300 palavras).");
        }
        lock (trava)
            if (!rodandoAddon.Add(b + "|" + id)) throw new InvalidOperationException($"{a.Nome} já está rodando nesta reunião.");
        _ = Task.Run(async () =>
        {
            try
            {
                File.Delete(Caminho(b, $"addon.{id}.erro"));
                var dia = DateTime.TryParseExact(b.Length >= 10 ? b[..10] : b, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : DateTime.Today;
                var (md, modelo) = await Addons.Rodar(a, cfg(), b, dia, LerCompartilhado(Caminho(b, "transcricao.md")), DirDe(b), trecho);
                var arq = Caminho(b, $"addon.{id}.json");
                JsonObject? velho = null;
                try { if (File.Exists(arq)) velho = JsonNode.Parse(LerCompartilhado(arq)) as JsonObject; } catch (Exception) { }
                var agora = DateTime.Now.ToString("s");
                var trechos = velho?["trechos"] is JsonArray t ? (JsonArray)t.DeepClone() : new JsonArray();
                JsonObject saida;
                if (trecho is null)
                    saida = new JsonObject { ["markdown"] = md, ["gerado_em"] = agora, ["modelo"] = modelo, ["versao"] = a.Versao };
                else
                {
                    saida = velho is null ? new JsonObject() : (JsonObject)velho.DeepClone();
                    trechos.Insert(0, new JsonObject { ["texto"] = trecho.Texto, ["quem"] = trecho.Quem, ["tempo"] = trecho.Tempo, ["markdown"] = md, ["gerado_em"] = agora });
                    saida["modelo"] = modelo; saida["versao"] = a.Versao;
                }
                saida["trechos"] = trechos;
                File.WriteAllText(arq, saida.ToJsonString(Config.Json));
            }
            catch (Exception ex)
            {
                try { File.WriteAllText(Caminho(b, $"addon.{id}.erro"), ex.Message); } catch (IOException) { }
            }
            finally
            {
                lock (trava) rodandoAddon.Remove(b + "|" + id);
                Mudou?.Invoke();
            }
        });
        Mudou?.Invoke();
    }

    /// <summary>Addons ligados e validos, com o resultado (se houver) desta reuniao, para as abas do leitor.</summary>
    object[] AddonsDe(string b)
    {
        var desligados = cfg().AddonsDesligados;
        return Addons.Listar().Where(a => a.Erro == null && !desligados.Contains(a.Id)).Select(a =>
        {
            JsonNode? res = null;
            var j = Caminho(b, $"addon.{a.Id}.json");
            try { if (File.Exists(j)) res = JsonNode.Parse(LerCompartilhado(j)); } catch (Exception) { }
            var e = Caminho(b, $"addon.{a.Id}.erro");
            return (object)new
            {
                id = a.Id, nome = a.Nome, icone = a.Icone, descricao = a.Descricao, botao = a.Botao, botaoTrecho = a.BotaoTrecho,
                pode = a.Tipo != "claude" || Ia.Escolhida(cfg(), a.IaExigida) != null,
                precisa = a.Tipo == "claude" ? a.IaExigida : null,
                resultado = res, rodando = AddonRodando(b, a.Id), erro = File.Exists(e) ? LerCompartilhado(e) : null,
            };
        }).ToArray();
    }
}
