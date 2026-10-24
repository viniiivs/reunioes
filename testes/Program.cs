// Testa a migracao para subpastas e as operacoes que dependem do layout, numa pasta temporaria
// com gravacoes falsas. Nao toca na configuracao nem no servico do usuario.
using Reunioes;

var raiz = Path.Combine(Path.GetTempPath(), "reunioes-teste-" + Guid.NewGuid().ToString("N")[..6]);
Directory.CreateDirectory(raiz);
int falhas = 0;
void Checar(bool ok, string o) { Console.WriteLine((ok ? "ok    " : "FALHA ") + o); if (!ok) falhas++; }

// duas gravacoes soltas na raiz (formato 1.0.0), uma com nome que e prefixo da outra
foreach (var b in new[] { "2026-10-14_17-08", "2026-10-14_17-08_rec" })
{
    foreach (var ext in new[] { "eu.flac", "outros.flac", "sha256", "transcricao.md", "resumo.json" })
        File.WriteAllText(Path.Combine(raiz, $"{b}.{ext}"), ext == "transcricao.md" ? "**[00:00:01] Eu:** oi\n" : "x");
    File.SetAttributes(Path.Combine(raiz, $"{b}.eu.flac"), FileAttributes.ReadOnly);   // prova: somente leitura
}
File.WriteAllText(Path.Combine(raiz, "anotacao-solta.txt"), "nao e gravacao");

var cfg = new Config { PastaGravacoes = raiz };
var g = new Gravacoes(() => cfg);

Checar(g.Listar().Count == 2, "lista as 2 gravacoes antigas antes de migrar");
Checar(g.Migrar() == 2, "migra as 2");
foreach (var b in new[] { "2026-10-14_17-08", "2026-10-14_17-08_rec" })
{
    var sub = Path.Combine(raiz, b);
    Checar(Directory.GetFiles(sub).Length == 5, $"{b}: 5 arquivos na subpasta");
    Checar(File.GetAttributes(Path.Combine(sub, b + ".eu.flac")).HasFlag(FileAttributes.ReadOnly), $"{b}: continua somente leitura");
}
Checar(Directory.GetFiles(raiz).Select(Path.GetFileName).SequenceEqual(new[] { "anotacao-solta.txt" }), "raiz so ficou com o arquivo que nao e gravacao");
Checar(g.Migrar() == 0, "migrar de novo nao faz nada");
var lista = g.Listar();
Checar(lista.Count == 2 && lista.All(x => x.Estado == "pronta"), "depois de migrar: 2 gravacoes, transcritas");
Checar(System.Text.Json.JsonSerializer.Serialize(g.Ler("2026-10-14_17-08_rec")).Contains("oi"), "le a transcricao de dentro da subpasta");
var pasta = g.Pasta("2026-10-14_17-08");
Checar(pasta[1].Trim('"') == Path.Combine(raiz, "2026-10-14_17-08"), "botao de pasta abre a subpasta");
g.Excluir("2026-10-14_17-08");
Checar(!Directory.Exists(Path.Combine(raiz, "2026-10-14_17-08")), "excluir manda a subpasta inteira para a lixeira");
Checar(Directory.Exists(Path.Combine(raiz, "2026-10-14_17-08_rec")), "excluir nao pega a gravacao de nome parecido");
Checar(g.Listar().Count == 1, "sobra 1 gravacao");

// gravacao em curso: so a que o gravar.py cita na linha de comando, nao toda gravacao sem .sha256
// (gravacoes de sessoes interrompidas ficam sem .sha256 para sempre e apareciam como "Gravando agora")
foreach (var b in new[] { "2026-10-14_17-09", "2026-10-20_19-57" })
{
    Directory.CreateDirectory(Path.Combine(raiz, b));
    foreach (var ext in new[] { "eu.flac", "outros.flac" }) File.WriteAllText(Path.Combine(raiz, b, $"{b}.{ext}"), "x");
}
var falso = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("py",
    new[] { "-c", "import time; time.sleep(60)", "gravar.py", "2026-10-20_19-57" }) { CreateNoWindow = true, UseShellExecute = false })!;
try
{
    Thread.Sleep(1500);
    Gravacoes.EsquecerProcessos();
    var est = g.Listar().ToDictionary(x => x.Base, x => x.Estado);
    Checar(est["2026-10-20_19-57"] == "gravando", "a gravacao citada pelo gravador aparece gravando");
    Checar(est["2026-10-14_17-09"] != "gravando", $"a antiga sem .sha256 NAO aparece gravando ({est["2026-10-14_17-09"]})");
    g.GravarOuParar();   // com gravador rodando: pede para parar
    Checar(File.Exists(Path.Combine(raiz, "2026-10-20_19-57", "2026-10-20_19-57.parar")), "parar marca a gravacao em curso");
    Checar(!File.Exists(Path.Combine(raiz, "2026-10-14_17-09", "2026-10-14_17-09.parar")), "parar nao mexe na antiga");
}
finally
{
    try { falso.Kill(true); } catch { }   // o py.exe e o python.exe filho
}

// transcricao: o motor escreve o proprio log (sobrevive ao app fechar) e a lista acompanha a porcentagem
// sem depender do aviso de arquivo do Windows. Motor falso num venv temporario, sem GPU.
var motor = Path.Combine(raiz, "_motor");
Directory.CreateDirectory(Path.Combine(motor, "scripts"));
System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("py", new[] { "-m", "venv", "--without-pip", Path.Combine(motor, "venv") }) { CreateNoWindow = true, UseShellExecute = false })!.WaitForExit();
File.Copy(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "app", "motor", "comum.py"), Path.Combine(motor, "scripts", "comum.py"));
File.WriteAllText(Path.Combine(motor, "scripts", "transcrever.py"), """
    import sys, time, warnings, comum
    comum.utf8_stdout(); comum.log_proprio()
    print("[1/2] transcrevendo seu microfone", flush=True)
    for n in (10, 30, 50):
        print(f"[pct] {n}", flush=True); time.sleep(1.5)
    warnings.warn("aviso do motor com acentuação")
    print("[2/2] transcrevendo os outros", flush=True); print("[pct] 70", flush=True); time.sleep(1.5)
    open(comum.base_de(sys.argv[1]) + ".transcricao.md", "w", encoding="utf-8").write("**[00:00:01] Eu:** pronto\n")
    print("[pronto]", flush=True)
    """);
cfg.PastaMotor = motor;
var bt = "2026-10-21_10-00";
Directory.CreateDirectory(Path.Combine(raiz, bt));
foreach (var ext in new[] { "eu.flac", "outros.flac", "sha256" }) File.WriteAllText(Path.Combine(raiz, bt, $"{bt}.{ext}"), "x");
Environment.SetEnvironmentVariable("REUNIOES_CONFIG", Path.Combine(raiz, "config-teste.json"));
File.WriteAllText(Path.Combine(raiz, "config-teste.json"), System.Text.Json.JsonSerializer.Serialize(new { pastaGravacoes = raiz }));
int avisos = 0;
g.Mudou += () => Interlocked.Increment(ref avisos);
g.Transcrever(bt);
var pcts = new HashSet<int?>();
for (int i = 0; i < 40 && g.Listar().First(x => x.Base == bt).Estado is "transcrevendo" or "fila"; i++)
{
    pcts.Add(g.Listar().First(x => x.Base == bt).Pct);
    Thread.Sleep(250);
}
Checar(pcts.Contains(30) && pcts.Contains(70), $"lista acompanha a porcentagem ({string.Join(",", pcts)})");
Checar(g.Listar().First(x => x.Base == bt).Estado == "pronta", "terminou pronta");
var logMotor = File.ReadAllText(Path.Combine(raiz, bt, $"{bt}.log"));
Checar(logMotor.Contains("[pct] 70") && logMotor.Contains("acentuação") && logMotor.Contains("[pronto]"), "o motor escreveu o proprio log (stdout e stderr, UTF-8)");
Checar(!g.TranscrevendoAgora(), "depois de terminar, nao esta transcrevendo");
Checar(avisos > 0, $"avisou a tela durante a transcricao ({avisos}x)");

Console.WriteLine(falhas == 0 ? "\nTUDO OK" : $"\n{falhas} FALHA(S)");
foreach (var a in Directory.GetFiles(raiz, "*", SearchOption.AllDirectories)) File.SetAttributes(a, FileAttributes.Normal);
Directory.Delete(raiz, true);
return falhas;

