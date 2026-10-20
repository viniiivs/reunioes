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

Console.WriteLine(falhas == 0 ? "\nTUDO OK" : $"\n{falhas} FALHA(S)");
Directory.Delete(raiz, true);
return falhas;

