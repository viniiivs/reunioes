using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;

namespace Reunioes;

/// <summary>"Fato ou fake": o Claude Code confere na web o que foi dito na reuniao e guarda em
/// &lt;base&gt;.checagem.json. Checar a reuniao troca os itens dela; checar um trecho soma no topo.</summary>
public sealed partial class Gravacoes
{
    readonly HashSet<string> checando = new();

    public void Checar(string b, string? trecho, string? quem, string? tempo)
    {
        Validar(b);
        if (Sistema.Claude() == null) throw new InvalidOperationException("O Claude Code não está instalado neste computador.");
        if (!File.Exists(Caminho(b, "transcricao.md"))) throw new InvalidOperationException("Transcreva antes de checar.");
        trecho = trecho?.Trim();
        if (trecho is { Length: 0 }) trecho = null;
        if (trecho is { Length: > 2000 }) throw new InvalidOperationException("Escolha um trecho menor (até umas 300 palavras).");
        lock (trava)
            if (!checando.Add(b)) throw new InvalidOperationException("Já estou checando esta reunião. Espere terminar.");
        _ = Task.Run(() => RodarChecagem(b, trecho, quem, tempo));
        Mudou?.Invoke();
    }

    bool Checando(string b) { lock (trava) return checando.Contains(b); }

    async Task RodarChecagem(string b, string? trecho, string? quem, string? tempo)
    {
        try
        {
            File.Delete(Caminho(b, "checagem.erro"));
            var dia = DateTime.TryParseExact(b.Length >= 10 ? b[..10] : b, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : DateTime.Today;
            var prompt = Path.Combine(Config.DirApp, "checagem-prompt.md");
            File.WriteAllText(prompt, PromptChecagem.Sistema);
            var res = await RodarClaude(prompt, "checagem-schema.json",
                PromptChecagem.Mensagem(dia, LerCompartilhado(Caminho(b, "transcricao.md")), trecho, quem, tempo),
                "WebSearch,WebFetch", TimeSpan.FromMinutes(20));

            var origem = trecho is null ? "reuniao" : "trecho";
            var agora = DateTime.Now.ToString("s");
            var novos = new JsonArray();
            foreach (var it in res["structured_output"]!["itens"]!.AsArray())
            {
                if (it is not JsonObject o) continue;
                // so link https, que o app sabe abrir; o resto some em vez de virar link quebrado
                var fontes = new JsonArray(o["fontes"]?.AsArray().OfType<JsonObject>()
                    .Where(f => f["url"]?.ToString().StartsWith("https://") == true)
                    .Select(f => (JsonNode)f.DeepClone()).ToArray() ?? []);
                var n = (JsonObject)o.DeepClone();
                n["fontes"] = fontes;
                n["origem"] = origem;
                n["checado_em"] = agora;
                novos.Add(n);
            }
            var arq = Caminho(b, "checagem.json");
            var velho = File.Exists(arq) ? JsonNode.Parse(LerCompartilhado(arq)) as JsonObject : null;
            var antigos = velho?["itens"]?.AsArray().OfType<JsonObject>().ToList() ?? [];
            var itens = trecho is null
                ? antigos.Where(x => x["origem"]?.ToString() == "trecho").Select(x => x.DeepClone()).Concat(novos.Select(x => x!.DeepClone()))
                : novos.Select(x => x!.DeepClone()).Concat(antigos.Select(x => x.DeepClone()));
            var saida = new JsonObject
            {
                ["itens"] = new JsonArray(itens.ToArray()),
                ["reuniao_checada"] = trecho is null || velho?["reuniao_checada"]?.GetValue<bool>() == true,
                ["gerado_em"] = agora,
                ["modelo"] = res["modelUsage"] is JsonObject mu && mu.Count > 0 ? mu.First().Key : "sonnet",
            };
            File.WriteAllText(arq, saida.ToJsonString(Config.Json));
        }
        catch (Exception ex)
        {
            try { File.WriteAllText(Caminho(b, "checagem.erro"), ex.Message); } catch (IOException) { }
        }
        finally
        {
            lock (trava) checando.Remove(b);
            Mudou?.Invoke();
        }
    }

    /// <summary>Roda o Claude Code sem configs/MCPs do usuario (chamada enxuta) e devolve o JSON dele,
    /// com o structured_output validado pelo esquema. ferramentas vazio = nenhuma.</summary>
    static async Task<JsonNode> RodarClaude(string promptArquivo, string esquema, string entrada, string ferramentas, TimeSpan limite)
    {
        var psi = new ProcessStartInfo(Sistema.Claude()!)
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Config.DirApp,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8,
        };
        foreach (var a in new[] { "-p", "--output-format", "json", "--model", "sonnet", "--tools", ferramentas,
                     "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "",
                     "--system-prompt-file", promptArquivo,
                     "--json-schema", File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "motor", esquema)) })
            psi.ArgumentList.Add(a);
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
        if (res?["structured_output"] is not JsonObject)
        {
            var m = (res?["result"]?.ToString() ?? await erro).Trim();
            throw new InvalidOperationException(m.Length > 0 ? m : "Resposta vazia do Claude.");
        }
        return res;
    }
}
