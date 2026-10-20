using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Reunioes;

/// <summary>Instala e mantem o motor (Python + bibliotecas + modelos) na pasta escolhida pelo usuario.
/// Usa o uv embutido no app: ele baixa um Python proprio, sem depender do que houver na maquina.
/// pronto.json registra o que ja foi feito, para so refazer o necessario quando algo muda.</summary>
public sealed class Motor
{
    public const string VersaoPython = "3.12";
    static readonly string Origem = Path.Combine(AppContext.BaseDirectory, "motor");
    static readonly string Uv = Path.Combine(AppContext.BaseDirectory, "ferramentas", "uv.exe");

    public record Etapa(string Id, string Titulo);
    public record Progresso(string Evento, int Etapa, int Total, string Titulo, string? Detalhe, double? Pct, string Estado, string? Erro);

    record Feito(string ReqHash, string Torch, string Modelo, string Idioma, bool Vozes, string Data);

    readonly Func<Config> cfg;
    Process? atual;
    CancellationTokenSource? cancelar;
    public bool Rodando { get; private set; }

    public Motor(Func<Config> cfg) => this.cfg = cfg;

    static string HashRequisitos() =>
        Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Path.Combine(Origem, "requirements.txt"))))[..16];

    Feito? LerPronto(Config c)
    {
        try { return JsonSerializer.Deserialize<Feito>(File.ReadAllText(Path.Combine(c.PastaMotor, "pronto.json")), Config.Json); }
        catch (Exception) { return null; }
    }

    static string IndiceTorch(Config c) => c.UsarGpu && Sistema.TemNvidia() ? "cu128" : "cpu";

    /// <summary>Etapas que faltam para o motor bater com a configuracao atual (vazio = pronto).</summary>
    public List<Etapa> Pendentes(Config c)
    {
        var p = LerPronto(c);
        var r = new List<Etapa>();
        bool semPython = !File.Exists(c.Python);
        bool libs = semPython || p == null || p.ReqHash != HashRequisitos() || p.Torch != IndiceTorch(c);
        bool modelos = libs || p!.Modelo != c.Modelo || p.Idioma != c.Idioma || (c.SepararVozes && !p.Vozes);
        if (semPython) { r.Add(new("python", "Baixando o Python")); r.Add(new("venv", "Criando o ambiente")); }
        if (libs) r.Add(new("libs", IndiceTorch(c) == "cu128"
            ? "Instalando as bibliotecas de IA (cerca de 3 GB, com suporte à placa de vídeo)"
            : "Instalando as bibliotecas de IA (cerca de 1 GB)"));
        if (modelos) r.Add(new("modelos", "Baixando os modelos"));
        if (r.Count > 0) r.Add(new("limpar", "Limpando arquivos temporários"));
        return r;
    }

    public bool Pronto(Config c) => File.Exists(c.Python) && Pendentes(c).Count == 0;

    /// <summary>O PyTorch traz ~2,6 GB de bibliotecas estaticas (.lib) que so servem para compilar
    /// extensoes em C++. Em tempo de execucao ninguem usa: apaga.</summary>
    public static long LimparTorch(Config c)
    {
        var lib = Path.Combine(c.Venv, "Lib", "site-packages", "torch", "lib");
        if (!Directory.Exists(lib)) return 0;
        long livre = 0;
        foreach (var f in Directory.GetFiles(lib, "*.lib"))
            try { livre += new FileInfo(f).Length; File.Delete(f); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        return livre;
    }

    /// <summary>Copia os scripts do app para a pasta do motor. O servico roda de la, entao uma
    /// atualizacao do app nunca encontra arquivos presos. Devolve true se algo mudou.</summary>
    public static bool SincronizarScripts(Config c)
    {
        if (!Directory.Exists(Origem)) return false;
        Directory.CreateDirectory(c.Scripts);
        bool mudou = false;
        foreach (var arq in Directory.GetFiles(Origem))
        {
            var dest = Path.Combine(c.Scripts, Path.GetFileName(arq));
            if (File.Exists(dest) && File.ReadAllBytes(dest).AsSpan().SequenceEqual(File.ReadAllBytes(arq))) continue;
            File.Copy(arq, dest, true);
            mudou = true;
        }
        return mudou;
    }

    public void Cancelar()
    {
        cancelar?.Cancel();
        try { atual?.Kill(true); } catch (Exception) { }
    }

    public async Task Instalar(Action<Progresso> avisar)
    {
        if (Rodando) throw new InvalidOperationException("A instalação já está rodando.");
        Rodando = true;
        cancelar = new CancellationTokenSource();
        var c = cfg();
        var etapas = Pendentes(c);
        int i = 0;
        try
        {
            Directory.CreateDirectory(c.PastaMotor);
            SincronizarScripts(c);
            foreach (var e in etapas)
            {
                i++;
                cancelar.Token.ThrowIfCancellationRequested();
                void Av(string? det, double? pct) => avisar(new("instalacao", i, etapas.Count, e.Titulo, det, pct, "rodando", null));
                Av(null, null);
                switch (e.Id)
                {
                    case "python":
                        await Rodar(c, Uv, new[] { "python", "install", VersaoPython }, l => Av(LinhaUv(l), null));
                        break;
                    case "venv":
                        await Rodar(c, Uv, new[] { "venv", c.Venv, "--python", VersaoPython, "--python-preference", "only-managed", "--seed" }, l => Av(LinhaUv(l), null));
                        break;
                    case "libs":
                        var baixados = 0;
                        await Rodar(c, Uv, new[] { "pip", "install", "--python", c.Python, "-r", Path.Combine(c.Scripts, "requirements.txt"),
                            "--extra-index-url", "https://download.pytorch.org/whl/" + IndiceTorch(c), "--index-strategy", "unsafe-best-match" },
                            l =>
                            {
                                if (l.TrimStart().StartsWith("Downloaded ")) baixados++;
                                Av(LinhaUv(l), null);
                            });
                        break;
                    case "modelos":
                        await Rodar(c, c.Python, new[] { Path.Combine(c.Scripts, "preparar.py") }, l =>
                        {
                            if (l.StartsWith("[etapa] ")) Av(l[8..], null);
                            else if (l.StartsWith("[progresso] "))
                            {
                                var p = l[12..].Split(' ');
                                if (p.Length == 2 && double.TryParse(p[0], out var f) && double.TryParse(p[1], out var t) && t > 0)
                                    Av($"{f / 1e9:0.00} de {t / 1e9:0.00} GB", Math.Min(100, f * 100 / t));
                            }
                            else if (l.StartsWith("[ok] ")) Av(l[5..], 100);
                            else if (l.StartsWith("[erro] ")) throw new InvalidOperationException(l[7..]);
                        }, comToken: true);
                        break;
                    case "limpar":
                        try { await Rodar(c, Uv, new[] { "cache", "clean" }, l => Av(LinhaUv(l), null)); } catch (Exception) { }
                        LimparTorch(c);
                        break;
                }
            }
            File.WriteAllText(Path.Combine(c.PastaMotor, "pronto.json"), JsonSerializer.Serialize(
                new Feito(HashRequisitos(), IndiceTorch(c), c.Modelo, c.Idioma, c.SepararVozes, DateTime.Now.ToString("s")), Config.Json));
            avisar(new("instalacao", etapas.Count, etapas.Count, "Pronto", null, 100, "fim", null));
        }
        catch (Exception ex)
        {
            var msg = cancelar.IsCancellationRequested ? "Instalação cancelada." : ex.Message;
            avisar(new("instalacao", i, etapas.Count, i > 0 && i <= etapas.Count ? etapas[i - 1].Titulo : "", null, null, "erro", msg));
        }
        finally
        {
            Rodando = false;
            atual = null;
        }
    }

    // A saida do uv vem com codigos de cor e barras; mostra so o texto util.
    static readonly Regex reAnsi = new(@"\x1B\[[0-9;?]*[A-Za-z]");
    static string LinhaUv(string l) => reAnsi.Replace(l, "").Trim();

    readonly List<string> ultimas = new();

    async Task Rodar(Config c, string exe, string[] args, Action<string> linha, bool comToken = false)
    {
        var psi = new ProcessStartInfo(exe)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
            WorkingDirectory = c.PastaMotor,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        c.Ambiente(psi, comToken);
        psi.Environment["UV_PYTHON_INSTALL_DIR"] = Path.Combine(c.PastaMotor, "python");
        psi.Environment["UV_CACHE_DIR"] = Path.Combine(c.PastaMotor, "cache");
        psi.Environment["UV_HTTP_TIMEOUT"] = "600";
        psi.Environment["UV_NO_PROGRESS"] = "1";
        psi.Environment["NO_COLOR"] = "1";
        psi.Environment.Remove("VIRTUAL_ENV");
        psi.Environment.Remove("PYTHONHOME");
        psi.Environment.Remove("PYTHONPATH");

        ultimas.Clear();
        var log = new StreamWriter(Path.Combine(c.PastaMotor, "instalacao.log"), append: true, Encoding.UTF8) { AutoFlush = true };
        await log.WriteLineAsync($"\n=== {DateTime.Now:s} {Path.GetFileName(exe)} {string.Join(' ', args)}");
        Exception? erroLinha = null;
        void Receber(string? l)
        {
            if (string.IsNullOrWhiteSpace(l)) return;
            lock (ultimas)
            {
                log.WriteLine(l);
                ultimas.Add(l);
                if (ultimas.Count > 12) ultimas.RemoveAt(0);
            }
            try { linha(l); } catch (Exception ex) { erroLinha ??= ex; }
        }
        using var p = new Process { StartInfo = psi };
        p.OutputDataReceived += (_, e) => Receber(e.Data);
        p.ErrorDataReceived += (_, e) => Receber(e.Data);
        p.Start();
        atual = p;
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        try { await p.WaitForExitAsync(cancelar!.Token); }
        catch (OperationCanceledException) { try { p.Kill(true); } catch (Exception) { } throw; }
        finally { await log.DisposeAsync(); }
        if (erroLinha != null) throw erroLinha;
        if (p.ExitCode != 0)
        {
            string fim;
            lock (ultimas) fim = string.Join("\n", ultimas.TakeLast(4).Select(LinhaUv));
            throw new InvalidOperationException($"{Path.GetFileName(exe)} falhou (código {p.ExitCode}).\n{fim}");
        }
    }
}
