using System.Reflection;
using Velopack;
using Velopack.Sources;

namespace Reunioes;

/// <summary>Atualizacao dentro do app (Velopack): procura uma versao nova nas releases do GitHub,
/// baixa em segundo plano (so a diferenca, quando da) e reinicia ja atualizado.
/// REUNIOES_ATUALIZACAO troca a origem por uma pasta ou URL (para testar sem publicar).</summary>
public sealed class Atualizador
{
    public const string Repositorio = "https://github.com/viniiivs/reunioes";

    public static string Versao =>
        (Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0")
        .Split('+')[0];

    readonly UpdateManager mgr;
    UpdateInfo? pendente;
    public string Estado { get; private set; } = "parado";   // parado | procurando | atual | disponivel | baixando | pronta | erro | dev
    public string? Nova => pendente?.TargetFullRelease.Version.ToString();
    public int Pct { get; private set; }
    public string? Erro { get; private set; }

    public Atualizador()
    {
        var alt = Environment.GetEnvironmentVariable("REUNIOES_ATUALIZACAO");
        mgr = string.IsNullOrEmpty(alt)
            ? new UpdateManager(new GithubSource(Repositorio, null, false))
            : new UpdateManager(alt);   // pasta local ou URL simples (teste)
        if (!mgr.IsInstalled) Estado = "dev";
    }

    public object Status() => new { versao = Versao, estado = Estado, nova = Nova, pct = Pct, erro = Erro, instalado = mgr.IsInstalled };

    public async Task Procurar(Action mudou)
    {
        if (!mgr.IsInstalled || Estado is "procurando" or "baixando") return;
        Estado = "procurando"; Erro = null; mudou();
        try
        {
            pendente = await mgr.CheckForUpdatesAsync();
            Estado = pendente == null ? "atual" : "disponivel";
        }
        catch (Exception ex) { Estado = "erro"; Erro = Simplificar(ex); }
        mudou();
    }

    public async Task Baixar(Action mudou)
    {
        if (pendente == null || Estado == "baixando") return;
        Estado = "baixando"; Pct = 0; mudou();
        try
        {
            await mgr.DownloadUpdatesAsync(pendente, p => { Pct = p; mudou(); });
            Estado = "pronta";
        }
        catch (Exception ex) { Estado = "erro"; Erro = Simplificar(ex); }
        mudou();
    }

    /// <summary>Fecha o app, troca os arquivos e abre a versao nova.</summary>
    public void AplicarEReiniciar()
    {
        if (pendente == null || Estado != "pronta") throw new InvalidOperationException("Nenhuma atualização baixada.");
        mgr.ApplyUpdatesAndRestart(pendente);
    }

    static string Simplificar(Exception ex) =>
        ex is HttpRequestException ? "Sem conexão com o servidor de atualizações." : ex.Message.Split('\n')[0];
}
