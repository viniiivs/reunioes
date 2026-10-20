using System.Management;
using NAudio.CoreAudioApi;

namespace Reunioes;

/// <summary>O que o assistente precisa saber da maquina: placa de video, memoria, espaco em disco,
/// dispositivos de audio e se o Claude Code esta instalado (para o resumo).</summary>
public static class Sistema
{
    static string[]? gpus;

    public static string[] Gpus()
    {
        if (gpus != null) return gpus;
        try
        {
            using var q = new ManagementObjectSearcher("SELECT Name FROM Win32_VideoController");
            return gpus = q.Get().Cast<ManagementObject>().Select(o => o["Name"]?.ToString() ?? "").Where(n => n.Length > 0).ToArray();
        }
        catch (Exception) { return gpus = Array.Empty<string>(); }
    }

    public static bool TemNvidia() => Gpus().Any(n => n.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase));

    public static double MemoriaGB()
    {
        try
        {
            using var q = new ManagementObjectSearcher("SELECT TotalPhysicalMemory FROM Win32_ComputerSystem");
            foreach (ManagementObject o in q.Get()) return Convert.ToDouble(o["TotalPhysicalMemory"]) / 1024 / 1024 / 1024;
        }
        catch (Exception) { }
        return 0;
    }

    public static double LivreGB(string pasta)
    {
        try { return new DriveInfo(Path.GetPathRoot(Path.GetFullPath(pasta))!).AvailableFreeSpace / 1024d / 1024 / 1024; }
        catch (Exception) { return -1; }
    }

    public static string? Claude()
    {
        var nativo = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin", "claude.exe");
        if (File.Exists(nativo)) return nativo;
        foreach (var d in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries))
            foreach (var n in new[] { "claude.exe", "claude.cmd" })
            {
                try { var p = Path.Combine(d.Trim(), n); if (File.Exists(p)) return p; }
                catch (ArgumentException) { }
            }
        return null;
    }

    public record Dispositivo(string Nome, bool Padrao);

    public static object Dispositivos()
    {
        using var e = new MMDeviceEnumerator();
        List<Dispositivo> Listar(DataFlow f)
        {
            string? pad = null;
            try { pad = e.GetDefaultAudioEndpoint(f, Role.Communications).FriendlyName; } catch (Exception) { }
            return e.EnumerateAudioEndPoints(f, DeviceState.Active).Select(d => new Dispositivo(d.FriendlyName, d.FriendlyName == pad)).ToList();
        }
        return new { mics = Listar(DataFlow.Capture), saidas = Listar(DataFlow.Render) };
    }

    public static object Info(Config c) => new
    {
        versao = Atualizador.Versao,
        gpus = Gpus(),
        nvidia = TemNvidia(),
        memoriaGB = Math.Round(MemoriaGB(), 1),
        livreGB = Math.Round(LivreGB(c.PastaMotor), 1),
        livreGravacoesGB = Math.Round(LivreGB(c.PastaGravacoes), 1),
        claude = Claude() != null,
    };
}
