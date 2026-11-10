using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace Reunioes;

/// <summary>Resposta de uma IA: o texto final, o JSON validado pelo esquema (quando pedido), o modelo
/// e qual IA respondeu ("claude" ou "codex").</summary>
public sealed record RespostaIa(string Texto, JsonObject? Estruturado, string Modelo, string Ia);

/// <summary>Resumo e addons rodam no Claude Code (conta do Claude) ou no Codex (conta do ChatGPT),
/// o que estiver instalado; com os dois, vale a escolha em Configuracoes.</summary>
public static class Ia
{
    public const string Claude = "claude", Codex = "codex";

    public static string Nome(string? ia) => ia == Codex ? "ChatGPT" : "Claude";

    /// <summary>Qual IA usar: a exigida (addon que so funciona numa), a escolhida, ou a que estiver
    /// instalada (Claude primeiro). null = nenhuma serve.</summary>
    public static string? Escolhida(Config c, string? exigida = null)
    {
        bool cl = Sistema.Claude() != null, cx = Sistema.Codex() != null;
        if (exigida != null) return (exigida == Codex ? cx : cl) ? exigida : null;
        if (c.Ia == Codex && cx) return Codex;
        if (c.Ia == Claude && cl) return Claude;
        return cl ? Claude : cx ? Codex : null;
    }

    public static string Falta(string? exigida) => exigida switch
    {
        Codex => "O Codex não está instalado neste computador.",
        Claude => "O Claude Code não está instalado neste computador.",
        _ => "Instale o Claude Code ou o Codex neste computador.",
    };

    /// <summary>Roda a IA com o prompt de sistema do arquivo. Sem esquema, a resposta e texto livre.
    /// ferramentas vazio = nenhuma (WebSearch/WebFetch ligam a busca na web). modelo segue os nomes do
    /// Claude (haiku, sonnet, opus); no Codex vira o esforco de raciocinio (baixo, medio, alto).</summary>
    public static Task<RespostaIa> Rodar(Config c, string? exigida, string promptArquivo, string? esquema, string entrada,
        string ferramentas, TimeSpan limite, string modelo = "sonnet")
    {
        var ia = Escolhida(c, exigida) ?? throw new InvalidOperationException(Falta(exigida));
        return ia == Codex
            ? RodarCodex(promptArquivo, esquema, entrada, ferramentas, limite, modelo)
            : RodarClaude(promptArquivo, esquema, entrada, ferramentas, limite, modelo);
    }

    static string Esquema(string nome) => Path.Combine(AppContext.BaseDirectory, "motor", nome);

    /// <summary>Claude Code sem configs/MCPs do usuario (chamada enxuta).</summary>
    static async Task<RespostaIa> RodarClaude(string promptArquivo, string? esquema, string entrada, string ferramentas, TimeSpan limite, string modelo)
    {
        var psi = Processo(Sistema.Claude()!);
        foreach (var a in new[] { "-p", "--output-format", "json", "--model", modelo, "--tools", ferramentas,
                     "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "",
                     "--system-prompt-file", promptArquivo })
            psi.ArgumentList.Add(a);
        if (esquema != null)
        {
            psi.ArgumentList.Add("--json-schema");
            psi.ArgumentList.Add(File.ReadAllText(Esquema(esquema)));
        }
        if (ferramentas.Length > 0) { psi.ArgumentList.Add("--allowedTools"); psi.ArgumentList.Add(ferramentas); }
        var (saida, erro) = await Executar(psi, entrada, limite, "o Claude");

        var res = JsonNode.Parse(saida);
        var usado = res?["modelUsage"] is JsonObject mu && mu.Count > 0 ? mu.First().Key : modelo;
        if (esquema == null && res?["is_error"]?.GetValue<bool>() == false && res["result"] is JsonValue)
            return new(res["result"]!.ToString(), null, usado, Claude);
        if (esquema == null || res?["structured_output"] is not JsonObject so)
        {
            var m = (res?["result"]?.ToString() ?? erro).Trim();
            throw new InvalidOperationException(m.Length > 0 ? m : "Resposta vazia do Claude.");
        }
        return new(so.ToJsonString(), so, usado, Claude);
    }

    /// <summary>Codex sem config, regras nem terminal do usuario: so le o texto e responde (com busca na
    /// web, se pedida). O prompt de sistema substitui o do Codex, que e voltado para programar.</summary>
    static async Task<RespostaIa> RodarCodex(string promptArquivo, string? esquema, string entrada, string ferramentas, TimeSpan limite, string modelo)
    {
        var exe = Sistema.Codex()!;
        if (!await CodexLogado(exe))
            throw new InvalidOperationException("Falta entrar no Codex: abra o PowerShell, rode codex login e entre com a sua conta do ChatGPT.");
        var vazia = Path.Combine(Config.DirApp, "codex");   // pasta de trabalho sem nada dentro
        Directory.CreateDirectory(vazia);
        var web = ferramentas.Split(',').Any(f => f.Trim() is "WebSearch" or "WebFetch");
        var esforco = modelo switch { "opus" => "high", "haiku" => "low", _ => "medium" };
        var psi = Processo(exe, vazia);
        // valores sem aspas: o -c le como TOML e, se nao for TOML valido, usa o texto literal
        foreach (var a in new[] { "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules",
                     "-s", "read-only", "-C", vazia, "--color", "never", "--disable", "shell_tool",
                     "-c", "web_search=" + (web ? "live" : "disabled"), "-c", "model_reasoning_effort=" + esforco,
                     "-c", "model_instructions_file=" + promptArquivo })
            psi.ArgumentList.Add(a);
        if (esquema != null) { psi.ArgumentList.Add("--output-schema"); psi.ArgumentList.Add(Esquema(esquema)); }
        psi.ArgumentList.Add("-");
        var (saida, erro) = await Executar(psi, entrada, limite, "o ChatGPT");

        // stdout traz so a resposta final; stderr, o cabecalho (com o modelo) e os erros
        var linhas = erro.Split('\n').Select(l => l.Trim()).ToArray();
        var usado = linhas.FirstOrDefault(l => l.StartsWith("model: "))?[7..] ?? "codex";
        var texto = saida.Trim();
        if (texto.Length == 0)
        {
            var m = linhas.LastOrDefault(l => l.StartsWith("ERROR: ") && !l.Contains("Reconnecting"))?[7..]
                ?? linhas.LastOrDefault(l => l.Length > 0 && !l.StartsWith("20")) ?? "";
            throw new InvalidOperationException(m.Length > 0 ? m : "Resposta vazia do ChatGPT.");
        }
        if (esquema == null) return new(texto, null, usado, Codex);
        return JsonNode.Parse(texto) is JsonObject so
            ? new(texto, so, usado, Codex)
            : throw new InvalidOperationException("O ChatGPT não devolveu o formato pedido.");
    }

    static async Task<bool> CodexLogado(string exe)
    {
        var psi = Processo(exe);
        psi.ArgumentList.Add("login");
        psi.ArgumentList.Add("status");
        using var p = Process.Start(psi)!;
        p.StandardInput.Close();
        var _ = p.StandardOutput.ReadToEndAsync();
        var __ = p.StandardError.ReadToEndAsync();
        using var prazo = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        try { await p.WaitForExitAsync(prazo.Token); }
        catch (OperationCanceledException) { try { p.Kill(true); } catch (Exception) { } return true; }   // na duvida, deixa a chamada dizer
        return p.ExitCode == 0;
    }

    static ProcessStartInfo Processo(string exe, string? pasta = null)
    {
        var psi = new ProcessStartInfo(exe)
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = pasta ?? Config.DirApp,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        psi.Environment["PATH"] = Sistema.PathAtual();   // claude.cmd (npm) precisa achar o node instalado depois do app abrir
        return psi;
    }

    static async Task<(string Saida, string Erro)> Executar(ProcessStartInfo psi, string entrada, TimeSpan limite, string quem)
    {
        using var p = Process.Start(psi)!;
        var saida = p.StandardOutput.ReadToEndAsync();
        var erro = p.StandardError.ReadToEndAsync();
        await p.StandardInput.WriteAsync(entrada);
        p.StandardInput.Close();
        using var prazo = new CancellationTokenSource(limite);
        try { await p.WaitForExitAsync(prazo.Token); }
        catch (OperationCanceledException)
        {
            p.Kill(true);
            throw new TimeoutException($"{char.ToUpper(quem[0])}{quem[1..]} não respondeu em {limite.TotalMinutes:0} minutos.");
        }
        return (await saida, await erro);
    }
}
