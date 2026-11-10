using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace Reunioes;

public sealed partial class Gravacoes
{
    /// <summary>Roda o Claude Code sem configs/MCPs do usuario (chamada enxuta) e devolve o JSON dele,
    /// com o structured_output validado pelo esquema (sem esquema: o texto vem em "result", usado pelos
    /// addons). ferramentas vazio = nenhuma.</summary>
    internal static async Task<JsonNode> RodarClaude(string promptArquivo, string? esquema, string entrada, string ferramentas, TimeSpan limite, string modelo = "sonnet")
    {
        var psi = new ProcessStartInfo(Sistema.Claude()!)
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Config.DirApp,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8,
        };
        psi.Environment["PATH"] = Sistema.PathAtual();   // claude.cmd (npm) precisa achar o node instalado depois do app abrir
        foreach (var a in new[] { "-p", "--output-format", "json", "--model", modelo, "--tools", ferramentas,
                     "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "",
                     "--system-prompt-file", promptArquivo })
            psi.ArgumentList.Add(a);
        if (esquema != null)
        {
            psi.ArgumentList.Add("--json-schema");
            psi.ArgumentList.Add(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "motor", esquema)));
        }
        if (ferramentas.Length > 0) { psi.ArgumentList.Add("--allowedTools"); psi.ArgumentList.Add(ferramentas); }
        using var p = Process.Start(psi)!;
        var saida = p.StandardOutput.ReadToEndAsync();
        var erro = p.StandardError.ReadToEndAsync();
        await p.StandardInput.WriteAsync(entrada);
        p.StandardInput.Close();
        using var prazo = new CancellationTokenSource(limite);
        try { await p.WaitForExitAsync(prazo.Token); }
        catch (OperationCanceledException) { p.Kill(true); throw new TimeoutException($"O Claude não respondeu em {limite.TotalMinutes:0} minutos."); }

        var res = JsonNode.Parse(await saida);
        if (esquema == null && res?["is_error"]?.GetValue<bool>() == false && res["result"] is JsonValue) return res;
        if (esquema == null || res?["structured_output"] is not JsonObject)
        {
            var m = (res?["result"]?.ToString() ?? await erro).Trim();
            throw new InvalidOperationException(m.Length > 0 ? m : "Resposta vazia do Claude.");
        }
        return res;
    }
}
