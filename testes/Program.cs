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

// ---------------------------------------------------------------- Claude Code
// PATH relido do registro: inclui o do usuario mesmo que o processo tenha comecado sem ele.
var pathUsuario = Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User) ?? "";
var pathAntes = Environment.GetEnvironmentVariable("PATH");
Environment.SetEnvironmentVariable("PATH", @"C:\Windows\System32");
var primeiraDoUsuario = Environment.ExpandEnvironmentVariables(pathUsuario.Split(';', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "");
Checar(primeiraDoUsuario == "" || Sistema.PathAtual().Contains(primeiraDoUsuario), "PATH atual inclui o do usuario sem reiniciar");
Environment.SetEnvironmentVariable("PATH", pathAntes);
Console.WriteLine($"   (Claude Code: {Sistema.Claude() ?? "nao achado"}; app Claude: {Sistema.ClaudeDesktop()}; Codex: {Sistema.Codex() ?? "nao achado"})");
Checar(Sistema.Codex() is not { } cx || cx.EndsWith("codex.exe", StringComparison.OrdinalIgnoreCase), "Codex do npm roda pelo codex.exe, nao pelo .cmd");
var iaAntes = cfg.Ia;
cfg.Ia = "codex";
Checar(Ia.Escolhida(cfg) == (Sistema.Codex() != null ? "codex" : Sistema.Claude() != null ? "claude" : null), "IA escolhida: a preferida, se instalada");
cfg.Ia = iaAntes;
Checar(Ia.Escolhida(cfg, "codex") == (Sistema.Codex() != null ? "codex" : null), "addon que exige o Codex nao cai no Claude");

// ---------------------------------------------------------------- addons
// Pasta de addons temporaria (nunca a do usuario). O de comando roda de verdade; o do Claude so
// com REUNIOES_TESTE_CLAUDE=1 (uma chamada curta ao haiku).
Addons.Dir = Path.Combine(raiz, "addons");
var exemplos = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "exemplos", "addons"));
Checar(Addons.Listar().Count == 0, "sem pasta de addons: nenhum addon");
Checar(Addons.Instalar(Path.Combine(exemplos, "falas")) == "falas" && Addons.Instalar(Path.Combine(exemplos, "ata")) == "ata", "instala os 2 exemplos");
void NovoAddon(string id, string json, params (string, string)[] arquivos)
{
    Directory.CreateDirectory(Path.Combine(Addons.Dir, id));
    File.WriteAllText(Path.Combine(Addons.Dir, id, "addon.json"), json);
    foreach (var (n, c) in arquivos) File.WriteAllText(Path.Combine(Addons.Dir, id, n), c);
}
NovoAddon("sem-prompt", """{ "nome": "Sem prompt", "tipo": "claude" }""");
NovoAddon("fuga", """{ "nome": "Fuga", "tipo": "claude", "prompt": "..\\..\\config-teste.json" }""");
NovoAddon("ia-ruim", """{ "nome": "IA ruim", "tipo": "ia", "ia": "gemini" }""", ("prompt.md", "x"));
NovoAddon("Maiusculo", """{ "nome": "X", "tipo": "comando", "comando": ["a"] }""");
NovoAddon("falha", """{ "nome": "Falha", "tipo": "comando", "comando": ["{python}", "-c", "import sys; print('deu ruim', file=sys.stderr); sys.exit(3)"] }""");
var todos = Addons.Listar();
Checar(todos.First(a => a.Id == "falas").Erro == null && todos.First(a => a.Id == "ata").Erro == null, "exemplos validos");
Checar(todos.First(a => a.Id == "sem-prompt").Erro?.Contains("prompt") == true, "addon sem prompt.md aparece com erro");
Checar(todos.First(a => a.Id == "fuga").Erro != null, "prompt fora da pasta do addon e recusado");
Checar(todos.First(a => a.Id == "Maiusculo").Erro?.Contains("Nome da pasta") == true, "id invalido aparece com erro");
Checar(todos.First(a => a.Id == "ia-ruim").Erro?.Contains("\"ia\"") == true, "\"ia\" desconhecida aparece com erro (e tipo \"ia\" vale como claude)");

var ba = "2026-10-14_17-08_rec";
File.WriteAllText(Path.Combine(raiz, ba, $"{ba}.transcricao.md"),
    "**[00:00:01] Eu:** bom dia a todos\n\n**[00:00:05] Ana:** bom dia, vamos falar da proposta nova hoje\n\n**[00:00:12] Eu:** pode ser\n");
System.Text.Json.Nodes.JsonNode AddonLido(string id) =>
    System.Text.Json.Nodes.JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(g.Ler(ba)))!["addons"]!.AsArray().First(x => x!["id"]!.ToString() == id)!;
void Esperar(string id) { for (int i = 0; i < 480 && AddonLido(id)["rodando"]!.GetValue<bool>(); i++) Thread.Sleep(250); }

g.RodarAddon(ba, "falas");
bool repetiu = false;
try { g.RodarAddon(ba, "falas"); } catch (InvalidOperationException) { repetiu = true; }
Checar(repetiu, "nao roda o mesmo addon duas vezes ao mesmo tempo na mesma reuniao");
Esperar("falas");
var mdFalas = AddonLido("falas")["resultado"]?["markdown"]?.ToString() ?? "";
Checar(mdFalas.Contains("| Ana | 1 | 8 |") && mdFalas.Contains("| Eu | 2 | 6 |") && mdFalas.Contains("[00:00:05]"), $"addon de comando devolve o markdown (tabela por pessoa)\n{mdFalas}");
Checar(File.Exists(Path.Combine(raiz, ba, $"{ba}.addon.falas.json")), "resultado fica junto da gravacao");

g.RodarAddon(ba, "falha");
Esperar("falha");
Checar(AddonLido("falha")["erro"]?.ToString() == "deu ruim", $"erro do programa vira a mensagem da aba ({AddonLido("falha")["erro"]})");

NovoAddon("trecho", """{ "nome": "Trecho", "tipo": "comando", "botaoTrecho": "Ver trecho", "comando": ["{python}", "t.py"] }""",
    ("t.py", "import json,sys; d=json.load(sys.stdin); t=d['trecho']; print('trecho: ' + t['texto'] + ' / ' + str(t['quem']) if t else 'reuniao inteira')"));
g.RodarAddon(ba, "trecho"); Esperar("trecho");
g.RodarAddon(ba, "trecho", new Trecho("proposta nova", "Ana", "00:00:05")); Esperar("trecho");
var rt = AddonLido("trecho")["resultado"]!;
Checar(rt["markdown"]?.ToString() == "reuniao inteira" && rt["trechos"]!.AsArray().Count == 1 && rt["trechos"]![0]!["markdown"]!.ToString() == "trecho: proposta nova / Ana"
    && rt["trechos"]![0]!["tempo"]!.ToString() == "00:00:05", "trecho soma em trechos e mantem o resultado da reuniao");
g.RodarAddon(ba, "trecho"); Esperar("trecho");
Checar(AddonLido("trecho")["resultado"]!["trechos"]!.AsArray().Count == 1, "rodar na reuniao de novo mantem os trechos");
bool semTrecho = false;
try { g.RodarAddon(ba, "falas", new Trecho("x x x x x x x x", null, null)); } catch (InvalidOperationException) { semTrecho = true; }
Checar(semTrecho, "addon sem botaoTrecho recusa trecho");

cfg.AddonsDesligados = ["falas"];
var idsLidos = System.Text.Json.Nodes.JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(g.Ler(ba)))!["addons"]!.AsArray().Select(x => x!["id"]!.ToString()).ToList();
Checar(!idsLidos.Contains("falas") && idsLidos.Contains("ata") && !idsLidos.Contains("sem-prompt"), $"leitor recebe so os ligados e validos ({string.Join(",", idsLidos)})");
bool recusou = false;
try { g.RodarAddon(ba, "falas"); } catch (InvalidOperationException) { recusou = true; }
Checar(recusou, "addon desligado nao roda");
cfg.AddonsDesligados = [];

if (Environment.GetEnvironmentVariable("REUNIOES_TESTE_CLAUDE") == "1")
{
    NovoAddon("eco", """{ "nome": "Eco", "tipo": "claude", "modelo": "haiku", "prazoMinutos": 2 }""",
        ("prompt.md", "Responda exatamente com duas linhas: '## Eco' e depois o nome de quem falou primeiro seguido do carimbo [hh:mm:ss] da fala. {nome} e o dono do app."));
    g.RodarAddon(ba, "eco");
    Esperar("eco");
    var eco = AddonLido("eco");
    Checar(eco["resultado"]?["markdown"]?.ToString().Contains("## Eco") == true, $"addon do Claude devolve markdown ({eco["resultado"]?["markdown"] ?? eco["erro"]})");
}

// Codex de verdade (conta do ChatGPT): addon que exige o Codex e o resumo com esquema.
if (Environment.GetEnvironmentVariable("REUNIOES_TESTE_CODEX") == "1")
{
    NovoAddon("eco-codex", """{ "nome": "Eco", "tipo": "ia", "ia": "codex", "modelo": "haiku", "prazoMinutos": 3 }""",
        ("prompt.md", "Responda exatamente com duas linhas: '## Eco' e depois o nome de quem falou primeiro seguido do carimbo [hh:mm:ss] da fala. {nome} e o dono do app."));
    g.RodarAddon(ba, "eco-codex");
    Esperar("eco-codex");
    var eco = AddonLido("eco-codex");
    Checar(eco["resultado"]?["markdown"]?.ToString().Contains("## Eco") == true, $"addon no Codex devolve markdown ({eco["resultado"]?["markdown"] ?? eco["erro"]})");
    Checar(eco["resultado"]?["modelo"]?.ToString().StartsWith("gpt") == true, $"modelo do Codex registrado ({eco["resultado"]?["modelo"]})");

    cfg.Ia = "codex";
    cfg.Resumo.Ativo = true; cfg.Resumo.Nome = "Vini";
    var json = Path.Combine(raiz, ba, $"{ba}.resumo.json");
    var erroResumo = Path.Combine(raiz, ba, $"{ba}.resumo.erro");
    File.Delete(json); File.Delete(erroResumo);
    g.Resumir(ba);
    for (int i = 0; i < 360 && !File.Exists(json) && !File.Exists(erroResumo); i++) Thread.Sleep(500);
    var r = File.Exists(json) ? System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(json)) : null;
    Checar(r?["ia"]?.ToString() == "codex" && r["veredito"] != null && r["acoes"] is System.Text.Json.Nodes.JsonArray,
        $"resumo pelo Codex segue o esquema ({(r == null ? File.ReadAllText(erroResumo) : r["veredito"])})");
    cfg.Ia = ""; cfg.Resumo.Ativo = false;
}

// Teste de áudio com os aparelhos de verdade: medidor e reprodução (tocando silêncio, para não fazer barulho).
if (Environment.GetEnvironmentVariable("REUNIOES_TESTE_AUDIO") == "1")
{
    var avisosAudio = new System.Collections.Concurrent.ConcurrentBag<string>();
    Action<object> anotar = e => avisosAudio.Add(System.Text.Json.JsonSerializer.Serialize(e));
    var r = (dynamic)Reunioes.TesteAudio.Medir(null, null, anotar);
    Checar(r.mic && r.saida, $"teste de áudio abre o microfone e a saída padrão (mic={r.mic}, saida={r.saida})");
    for (int i = 0; i < 4; i++) { Thread.Sleep(500); Reunioes.TesteAudio.Medir(null, null, anotar); }
    var niveis = avisosAudio.Where(x => x.Contains("\"niveis\"")).ToList();
    Checar(niveis.Count >= 25 && niveis.All(x => !x.Contains("\"mic\":null")), $"medidor manda ~20 níveis por segundo com o microfone ({niveis.Count} em 2 s; ex.: {niveis.LastOrDefault()})");
    Console.WriteLine("      formato do mic: " + ((NAudio.CoreAudioApi.WasapiCapture)typeof(Reunioes.TesteAudio).GetField("captura", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!.GetValue(null)!).WaveFormat);
    Console.WriteLine("      maior nível do mic: " + niveis.Select(x => System.Text.Json.Nodes.JsonNode.Parse(x)!["mic"]!.GetValue<double>()).Max());
    var tocar = typeof(Reunioes.TesteAudio).GetMethod("Tocar", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!;
    var sw = System.Diagnostics.Stopwatch.StartNew();
    ((Task)tocar.Invoke(null, new object[] { new float[16000], 16000 })!).Wait();
    Checar(sw.Elapsed.TotalSeconds is > 0.8 and < 3, $"reproduz na saída no formato dela (1 s de silêncio a 16 kHz levou {sw.Elapsed.TotalSeconds:0.0} s)");
    Reunioes.TesteAudio.Parar();
    Thread.Sleep(300); int antes = avisosAudio.Count; Thread.Sleep(500);
    Checar(avisosAudio.Count == antes, "parar solta os aparelhos e o medidor para");
}

Console.WriteLine(falhas == 0 ? "\nTUDO OK" : $"\n{falhas} FALHA(S)");
foreach (var a in Directory.GetFiles(raiz, "*", SearchOption.AllDirectories)) File.SetAttributes(a, FileAttributes.Normal);
Directory.Delete(raiz, true);
return falhas;

