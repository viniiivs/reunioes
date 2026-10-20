using System.Diagnostics;
using System.Management;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.VisualBasic.FileIO;

namespace Reunioes;

public record App(string Exe, int Segundos);

public record Gravacao(
    string Base,
    string Inicio,           // ISO 8601
    double? Duracao,         // segundos; null = FLAC sem cabecalho final (gravacao interrompida)
    long Bytes,
    string Estado,           // gravando | incompleta | sem | fila | transcrevendo | pronta
    string? Etapa,           // "2/3 transcrevendo os outros"
    string[]? Falantes,      // nomes na transcricao
    App[]? Apps,             // apps que tocaram som durante a gravacao
    Resumo? Resumo,
    string? Auto,            // app que fez o servico comecar a gravar (null = gravacao manual)
    bool Vozes);             // tem .falantes.json (da para nomear as vozes)

/// <summary>Resumo da IA: estado gerando | fila | pronto | erro.</summary>
public record Resumo(string Estado, string? Veredito, bool? PrecisaAgir, int? Acoes, string? Erro);

/// <summary>Le a pasta das gravacoes e roda o motor: gravar, transcrever (fila, uma por vez: a GPU
/// e uma so), nomear vozes e resumir com o Claude Code.</summary>
public sealed class Gravacoes
{
    readonly Func<Config> cfg;
    readonly object trava = new();
    readonly List<string> fila = new();
    Process? atual;
    string? atualBase;
    readonly System.Threading.Timer relogio;
    FileSystemWatcher? vigia;
    string? pastaVigiada;
    DateTime ultimoAviso;

    public event Action? Mudou;

    public Gravacoes(Func<Config> cfg)
    {
        this.cfg = cfg;
        relogio = new System.Threading.Timer(_ => Proximo(), null, 5000, 5000);
        Vigiar();
    }

    string Dir => cfg().PastaGravacoes;

    /// <summary>(Re)aponta o observador de arquivos quando a pasta das gravacoes muda.</summary>
    public void Vigiar()
    {
        var d = Dir;
        if (d == pastaVigiada) return;
        Directory.CreateDirectory(d);
        vigia?.Dispose();
        vigia = new FileSystemWatcher(d)
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.Size | NotifyFilters.LastWrite,
            IncludeSubdirectories = true,   // uma subpasta por gravacao
            EnableRaisingEvents = true,
        };
        FileSystemEventHandler h = (_, _) => AvisarLogo();
        vigia.Created += h; vigia.Deleted += h; vigia.Changed += h;
        vigia.Renamed += (_, _) => AvisarLogo();
        pastaVigiada = d;
    }

    // Arquivos mudam varias vezes por segundo durante gravacao/transcricao: agrupa os avisos.
    int pendente;
    void AvisarLogo()
    {
        if (Interlocked.Exchange(ref pendente, 1) == 1) return;
        var espera = Math.Max(400, 1500 - (int)(DateTime.Now - ultimoAviso).TotalMilliseconds);
        Task.Delay(espera).ContinueWith(_ =>
        {
            Interlocked.Exchange(ref pendente, 0);
            ultimoAviso = DateTime.Now;
            Mudou?.Invoke();
        });
    }

    // ------------------------------------------------------------------ listar

    static readonly Regex reNome = new(@"^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)");
    static readonly Regex reFalante = new(@"^\*\*\[\d\d:\d\d:\d\d\] (.+?):\*\*", RegexOptions.Multiline);
    static readonly Regex reEtapa = new(@"\[(\d)/(\d)\] ([^\r\n]+)");

    record Proc(int Pid, string Linha);

    // A consulta ao WMI custa ~240 ms; a lista, o estado do topo e a fila pedem quase juntas.
    static List<Proc>? cacheProcs;
    static DateTime cacheProcsEm;
    static readonly object travaProcs = new();

    static List<Proc> Pythons()
    {
        lock (travaProcs)
        {
            if (cacheProcs != null && (DateTime.UtcNow - cacheProcsEm).TotalMilliseconds < 1500) return cacheProcs;
            cacheProcs = ConsultarPythons();
            cacheProcsEm = DateTime.UtcNow;
            return cacheProcs;
        }
    }

    /// <summary>Esquece a consulta guardada (depois de iniciar ou matar um processo).</summary>
    public static void EsquecerProcessos() { lock (travaProcs) cacheProcs = null; }

    static List<Proc> ConsultarPythons()
    {
        var r = new List<Proc>();
        try
        {
            using var q = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name LIKE 'python%'");
            foreach (ManagementObject o in q.Get())
                r.Add(new Proc(Convert.ToInt32(o["ProcessId"]), o["CommandLine"]?.ToString() ?? ""));
        }
        catch (Exception) { }
        return r;
    }

    static bool Cita(string linha, string b) => Regex.IsMatch(linha, Regex.Escape(b) + @"(?=[""\s]|$)");

    public bool GravandoAgora() => Pythons().Any(p => p.Linha.Contains("gravar.py"));

    public List<Gravacao> Listar()
    {
        var procs = Pythons();
        bool gravando = procs.Any(p => p.Linha.Contains("gravar.py"));
        var externos = procs.Where(p => p.Linha.Contains("transcrever.py")).ToList();
        string[] filaAgora; string? rodando;
        lock (trava) { filaAgora = fila.ToArray(); rodando = atualBase; }

        var lista = new List<Gravacao>();
        if (!Directory.Exists(Dir)) return lista;
        foreach (var b in Bases())
        {
            var eu = Caminho(b, "eu.flac");
            var arqs = Arquivos(b);
            long bytes = arqs.Where(a => !a.EndsWith(".parar")).Sum(a => new FileInfo(a).Length);

            string? inicio = null;
            var sha = Caminho(b, "sha256");
            bool fechada = File.Exists(sha);
            if (fechada)
                foreach (var l in File.ReadLines(sha).Take(2))
                {
                    var mi = Regex.Match(l, @"# inicio (\S+)");
                    if (mi.Success) inicio = mi.Groups[1].Value;
                }
            var mn = reNome.Match(b);
            inicio ??= mn.Success
                ? new DateTime(int.Parse(mn.Groups[1].Value), int.Parse(mn.Groups[2].Value), int.Parse(mn.Groups[3].Value),
                    int.Parse(mn.Groups[4].Value), int.Parse(mn.Groups[5].Value), 0).ToString("s")
                : File.GetCreationTime(eu).ToString("s");

            var duracao = new[] { DuracaoFlac(eu), DuracaoFlac(Caminho(b, "outros.flac")) }.Max();

            var md = Caminho(b, "transcricao.md");
            string[]? falantes = null;
            if (File.Exists(md))
                falantes = reFalante.Matches(LerCompartilhado(md)).Select(m => m.Groups[1].Value).Distinct().ToArray();

            App[]? apps = null;
            try
            {
                var aj = Caminho(b, "apps.json");
                if (File.Exists(aj))
                {
                    using var d = JsonDocument.Parse(File.ReadAllText(aj));
                    apps = d.RootElement.GetProperty("apps").EnumerateArray()
                        .Select(a => new App(a.GetProperty("exe").GetString()!, a.GetProperty("segundos").GetInt32())).ToArray();
                }
            }
            catch (Exception) { }

            string? auto = null;
            try
            {
                var oj = Caminho(b, "origem.json");
                if (File.Exists(oj)) { using var d = JsonDocument.Parse(File.ReadAllText(oj)); auto = d.RootElement.GetProperty("app").GetString(); }
            }
            catch (Exception) { }

            string estado; string? etapa = null;
            if (!fechada && gravando) estado = "gravando";
            else if (rodando == b || externos.Any(p => Cita(p.Linha, b))) { estado = "transcrevendo"; etapa = Etapa(b); }
            else if (filaAgora.Contains(b)) estado = "fila";
            else if (falantes != null) estado = "pronta";
            else if (duracao == null) estado = "incompleta";
            else estado = "sem";

            // Transcricao que terminou enquanto o painel olhava: resume sozinho.
            if (estado == "transcrevendo") lock (trava) vistasTranscrevendo.Add(b);
            else if (estado == "pronta")
            {
                bool viu;
                lock (trava) viu = vistasTranscrevendo.Remove(b);
                if (viu && cfg().Resumo.Ativo && !File.Exists(Caminho(b, "resumo.json"))) TentarResumir(b);
            }

            lista.Add(new Gravacao(b, inicio, duracao, bytes, estado, etapa, falantes, apps,
                falantes != null ? EstadoResumo(b) : null, auto, File.Exists(Caminho(b, "falantes.json"))));
        }
        return lista.OrderByDescending(g => g.Inicio, StringComparer.Ordinal).ToList();
    }

    /// <summary>Cada gravacao mora em &lt;pasta&gt;\&lt;nome&gt;\&lt;nome&gt;.*; versoes antigas deixavam tudo solto
    /// na raiz (a migracao move; ate la, as duas formas funcionam).</summary>
    string DirDe(string b)
    {
        var sub = Path.Combine(Dir, b);
        return Directory.Exists(sub) ? sub : Dir;
    }

    string Caminho(string b, string ext) => Path.Combine(DirDe(b), b + "." + ext);

    // "2026-10-14_17-08.*" nao pega "2026-10-14_17-08_x.*": o ponto logo depois do nome separa.
    string[] Arquivos(string b) => Directory.GetFiles(DirDe(b), b + ".*");

    IEnumerable<string> Bases()
    {
        if (!Directory.Exists(Dir)) yield break;
        foreach (var eu in Directory.GetFiles(Dir, "*.eu.flac")) yield return Path.GetFileName(eu)[..^".eu.flac".Length];
        foreach (var sub in Directory.GetDirectories(Dir))
        {
            var n = Path.GetFileName(sub);
            if (File.Exists(Path.Combine(sub, n + ".eu.flac"))) yield return n;
        }
    }

    /// <summary>Move gravacoes soltas na raiz para uma subpasta cada. Pula a que ainda esta sendo
    /// gravada ou transcrita (arquivos abertos); ela e migrada na proxima abertura.</summary>
    public int Migrar()
    {
        if (!Directory.Exists(Dir)) return 0;
        var procs = Pythons();
        bool gravando = procs.Any(p => p.Linha.Contains("gravar.py"));
        int n = 0;
        foreach (var eu in Directory.GetFiles(Dir, "*.eu.flac"))
        {
            var b = Path.GetFileName(eu)[..^".eu.flac".Length];
            if (gravando && !File.Exists(Path.Combine(Dir, b + ".sha256"))) continue;
            if (procs.Any(p => (p.Linha.Contains("transcrever.py") || p.Linha.Contains("nomear.py")) && Cita(p.Linha, b))) continue;
            var sub = Path.Combine(Dir, b);
            Directory.CreateDirectory(sub);
            try
            {
                foreach (var a in Directory.GetFiles(Dir, b + ".*"))
                    File.Move(a, Path.Combine(sub, Path.GetFileName(a)));
                n++;
            }
            catch (IOException) { }   // arquivo em uso: tenta de novo na proxima abertura
        }
        return n;
    }

    static string LerCompartilhado(string p)
    {
        using var f = new FileStream(p, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var r = new StreamReader(f);
        return r.ReadToEnd();
    }

    string? Etapa(string b)
    {
        var log = Caminho(b, "log");
        if (!File.Exists(log)) return null;
        try
        {
            var ms = reEtapa.Matches(LerCompartilhado(log));
            if (ms.Count == 0) return "carregando modelos";
            var m = ms[^1];
            return $"{m.Groups[1].Value}/{m.Groups[2].Value} {m.Groups[3].Value.Trim()}";
        }
        catch (IOException) { return null; }
    }

    /// <summary>Duracao pelo STREAMINFO do FLAC. Total de amostras 0 = arquivo nao finalizado.</summary>
    static double? DuracaoFlac(string p)
    {
        if (!File.Exists(p)) return null;
        try
        {
            using var f = new FileStream(p, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var h = new byte[26];
            if (f.Read(h, 0, 26) < 26 || h[0] != 'f' || h[1] != 'L' || h[2] != 'a' || h[3] != 'C') return null;
            ulong x = 0;
            for (int i = 18; i < 26; i++) x = (x << 8) | h[i];
            var taxa = x >> 44;
            var total = x & 0xF_FFFF_FFFFUL;
            return taxa == 0 || total == 0 ? null : (double)total / taxa;
        }
        catch (IOException) { return null; }
    }

    // ------------------------------------------------------------------ acoes

    void Validar(string b)
    {
        if (b.Contains('/') || b.Contains('\\') || b.Contains("..") || !File.Exists(Caminho(b, "eu.flac")))
            throw new InvalidOperationException("Gravação não encontrada.");
    }

    public string[] Pasta(string? b)
    {
        Directory.CreateDirectory(Dir);
        if (b == null) return new[] { "explorer.exe", $"\"{Dir}\"" };
        Validar(b);
        var sub = Path.Combine(Dir, b);
        return Directory.Exists(sub)
            ? new[] { "explorer.exe", $"\"{sub}\"" }
            : new[] { "explorer.exe", $"/select,\"{Caminho(b, "eu.flac")}\"" };
    }

    public string[] Arquivo(string b, string ext)
    {
        Validar(b);
        if (ext != "transcricao.md") throw new InvalidOperationException("Tipo de arquivo não permitido.");
        return new[] { Caminho(b, ext) };
    }

    public object Ler(string b)
    {
        Validar(b);
        var md = Caminho(b, "transcricao.md");
        if (!File.Exists(md)) throw new InvalidOperationException("Essa gravação ainda não foi transcrita.");
        var g = Listar().FirstOrDefault(x => x.Base == b);
        var rj = Caminho(b, "resumo.json");
        JsonNode? resumo = null;
        try { if (File.Exists(rj)) resumo = JsonNode.Parse(LerCompartilhado(rj)); }
        catch (Exception) { }   // resumo corrompido nao pode impedir de ler a transcricao
        var nome = cfg().Resumo.Nome?.Trim();
        return new { texto = LerCompartilhado(md), gravacao = g, resumo, resumoAtivo = cfg().Resumo.Ativo, nome = string.IsNullOrEmpty(nome) ? null : nome };
    }

    ProcessStartInfo Py(string script, bool comToken)
    {
        var c = cfg();
        if (!File.Exists(c.Python)) throw new InvalidOperationException("O motor de transcrição não está instalado. Abra Configurações.");
        var psi = new ProcessStartInfo(c.Python) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = c.Scripts };
        psi.ArgumentList.Add(Path.Combine(c.Scripts, script));
        c.Ambiente(psi, comToken);
        return psi;
    }

    /// <summary>Grava agora (botao do app). Para parar, cria .parar nas gravacoes abertas.</summary>
    public void GravarOuParar()
    {
        if (GravandoAgora())
        {
            foreach (var b in Bases())
                if (!File.Exists(Caminho(b, "sha256"))) File.WriteAllText(Caminho(b, "parar"), "");
            EsquecerProcessos();
            return;
        }
        Directory.CreateDirectory(Dir);
        var nome = DateTime.Now.ToString("yyyy-MM-dd_HH-mm");
        if (File.Exists(Caminho(nome, "eu.flac"))) nome = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
        Directory.CreateDirectory(Path.Combine(Dir, nome));   // o gravar.py usa a mesma subpasta
        var psi = Py("gravar.py", false);
        psi.ArgumentList.Add(nome);
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        var p = Process.Start(psi)!;
        EsquecerProcessos();
        var log = Caminho(nome, "gravar.log");
        _ = Task.Run(async () =>
        {
            await using var w = new StreamWriter(log, false, Encoding.UTF8) { AutoFlush = true };
            var e = p.StandardError.ReadToEndAsync();
            string? l;
            while ((l = await p.StandardOutput.ReadLineAsync()) != null) await w.WriteLineAsync(l);
            await w.WriteAsync(await e);
        });
    }

    public void Transcrever(string b)
    {
        Validar(b);
        lock (trava)
        {
            if (atualBase == b || fila.Contains(b)) return;
            fila.Add(b);
        }
        Proximo();
        Mudou?.Invoke();
    }

    public void Cancelar(string b)
    {
        lock (trava)
        {
            fila.Remove(b);
            if (atualBase == b) { try { atual?.Kill(true); } catch (Exception) { } }
        }
        foreach (var p in Pythons().Where(p => p.Linha.Contains("transcrever.py") && Cita(p.Linha, b)))
            try { Process.GetProcessById(p.Pid).Kill(true); } catch (Exception) { }
        EsquecerProcessos();
        Mudou?.Invoke();
    }

    public void Excluir(string b)
    {
        Validar(b);
        var g = Listar().First(x => x.Base == b);
        if (g.Estado is "gravando" or "transcrevendo" or "fila")
            throw new InvalidOperationException("Não dá para excluir enquanto grava ou transcreve.");
        foreach (var a in Arquivos(b))
        {
            var fi = new FileInfo(a);
            if (fi.IsReadOnly) fi.IsReadOnly = false; // arquivo somente leitura: a lixeira recusa
        }
        var sub = Path.Combine(Dir, b);
        if (Directory.Exists(sub))
            FileSystem.DeleteDirectory(sub, UIOption.OnlyErrorDialogs, RecycleOption.SendToRecycleBin);
        else
            foreach (var a in Arquivos(b))
                FileSystem.DeleteFile(a, UIOption.OnlyErrorDialogs, RecycleOption.SendToRecycleBin);
    }

    /// <summary>Da nome a uma voz ("Falante 1" -> "Ana") e memoriza para as proximas reunioes.</summary>
    public async Task Nomear(string b, string de, string para)
    {
        Validar(b);
        para = para.Trim();
        if (para.Length == 0 || para.Length > 60 || para.Contains('=') || para.Contains('*'))
            throw new InvalidOperationException("Nome inválido.");
        if (!File.Exists(Caminho(b, "falantes.json")))
            throw new InvalidOperationException("Esta gravação foi transcrita sem separar as vozes.");
        var psi = Py("nomear.py", false);
        psi.ArgumentList.Add(b);
        psi.ArgumentList.Add($"{de}={para}");
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        using var p = Process.Start(psi)!;
        var saida = await p.StandardOutput.ReadToEndAsync() + await p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        if (p.ExitCode != 0)
            throw new InvalidOperationException(saida.Split('\n').LastOrDefault(l => l.Contains("[erro]"))?.Replace("[erro]", "").Trim() ?? "Não consegui renomear.");
        Mudou?.Invoke();
    }

    void Proximo()
    {
        lock (trava)
        {
            if (atual != null || fila.Count == 0) return;
            // Transcricao iniciada fora do app: espera ela acabar.
            if (Pythons().Any(p => p.Linha.Contains("transcrever.py"))) return;
            var b = fila[0];
            fila.RemoveAt(0);
            ProcessStartInfo psi;
            try { psi = Py("transcrever.py", true); }
            catch (Exception ex) { File.WriteAllText(Caminho(b, "log"), "[erro] " + ex.Message); return; }
            psi.ArgumentList.Add(b);
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            var p = Process.Start(psi)!;
            EsquecerProcessos();
            var log = new StreamWriter(new FileStream(Caminho(b, "log"), FileMode.Create, FileAccess.Write, FileShare.ReadWrite), Encoding.UTF8) { AutoFlush = true };
            p.OutputDataReceived += (_, e) => { if (e.Data != null) lock (log) log.WriteLine(e.Data); };
            p.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (log) log.WriteLine(e.Data); };
            p.EnableRaisingEvents = true;
            p.Exited += (_, _) =>
            {
                p.WaitForExit();
                lock (log) log.Dispose();
                lock (trava) { atual = null; atualBase = null; }
                EsquecerProcessos();
                if (p.ExitCode == 0 && cfg().Resumo.Ativo && File.Exists(Caminho(b, "transcricao.md")) && !File.Exists(Caminho(b, "resumo.json")))
                    TentarResumir(b);
                Proximo();
                Mudou?.Invoke();
            };
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            atual = p;
            atualBase = b;
        }
    }

    // ------------------------------------------------------------------ resumo com IA (Claude Code)

    readonly List<string> filaResumo = new();
    readonly HashSet<string> vistasTranscrevendo = new();
    string? resumindo;

    Resumo? EstadoResumo(string b)
    {
        lock (trava)
        {
            if (resumindo == b) return new Resumo("gerando", null, null, null, null);
            if (filaResumo.Contains(b)) return new Resumo("fila", null, null, null, null);
        }
        var j = Caminho(b, "resumo.json");
        if (File.Exists(j))
        {
            try
            {
                using var d = JsonDocument.Parse(LerCompartilhado(j));
                var r = d.RootElement;
                return new Resumo("pronto", r.GetProperty("veredito").GetString(), r.GetProperty("precisa_agir").GetBoolean(),
                    r.GetProperty("acoes").GetArrayLength(), null);
            }
            catch (Exception ex) { return new Resumo("erro", null, null, null, "resumo.json ilegível: " + ex.Message); }
        }
        var e = Caminho(b, "resumo.erro");
        return File.Exists(e) ? new Resumo("erro", null, null, null, File.ReadAllText(e)) : null;
    }

    void TentarResumir(string b)
    {
        try { Resumir(b, avisar: false); } catch (Exception) { }
    }

    public void Resumir(string b, bool avisar = true)
    {
        Validar(b);
        if (!cfg().Resumo.Ativo) throw new InvalidOperationException("Ligue o resumo com IA em Configurações.");
        if (Sistema.Claude() == null) throw new InvalidOperationException("O Claude Code não está instalado neste computador.");
        if (!File.Exists(Caminho(b, "transcricao.md"))) throw new InvalidOperationException("Transcreva antes de resumir.");
        lock (trava)
        {
            if (resumindo == b || filaResumo.Contains(b)) return;
            filaResumo.Add(b);
            if (resumindo != null) { if (avisar) Mudou?.Invoke(); return; }
        }
        _ = Task.Run(RodarResumos);
        if (avisar) Mudou?.Invoke();
    }

    async Task RodarResumos()
    {
        while (true)
        {
            string b;
            lock (trava)
            {
                if (resumindo != null || filaResumo.Count == 0) return;
                b = filaResumo[0];
                filaResumo.RemoveAt(0);
                resumindo = b;
            }
            Mudou?.Invoke();
            try
            {
                File.Delete(Caminho(b, "resumo.erro"));
                var prompt = Path.Combine(Config.DirApp, "resumo-prompt.md");
                File.WriteAllText(prompt, PromptResumo.Montar(cfg().Resumo));
                var schema = Path.Combine(AppContext.BaseDirectory, "motor", "resumo-schema.json");
                var psi = new ProcessStartInfo(Sistema.Claude()!)
                {
                    UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Config.DirApp,
                    RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8,
                };
                // Prompt de sistema proprio e sem configs/MCPs do usuario: chamada enxuta.
                foreach (var a in new[] { "-p", "--output-format", "json", "--model", "sonnet", "--tools", "",
                             "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "",
                             "--system-prompt-file", prompt, "--json-schema", File.ReadAllText(schema) })
                    psi.ArgumentList.Add(a);
                using var p = Process.Start(psi)!;
                var saida = p.StandardOutput.ReadToEndAsync();
                var erro = p.StandardError.ReadToEndAsync();
                await p.StandardInput.WriteAsync(LerCompartilhado(Caminho(b, "transcricao.md")));
                p.StandardInput.Close();
                using var limite = new CancellationTokenSource(TimeSpan.FromMinutes(5));
                try { await p.WaitForExitAsync(limite.Token); }
                catch (OperationCanceledException) { p.Kill(true); throw new TimeoutException("O Claude não respondeu em 5 minutos."); }

                var res = JsonNode.Parse(await saida);
                if (res?["structured_output"] is not JsonObject so)
                {
                    var m = (res?["result"]?.ToString() ?? await erro).Trim();
                    throw new InvalidOperationException(m.Length > 0 ? m : "Resposta vazia do Claude.");
                }
                so["gerado_em"] = DateTime.Now.ToString("s");
                so["modelo"] = res["modelUsage"] is JsonObject mu && mu.Count > 0 ? mu.First().Key : "sonnet";
                File.WriteAllText(Caminho(b, "resumo.json"), so.ToJsonString(Config.Json));
            }
            catch (Exception ex)
            {
                try { File.WriteAllText(Caminho(b, "resumo.erro"), ex.Message); } catch (IOException) { }
            }
            finally
            {
                lock (trava) resumindo = null;
                Mudou?.Invoke();
            }
        }
    }
}
