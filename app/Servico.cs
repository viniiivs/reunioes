using System.Diagnostics;
using System.Management;
using System.Text.Json;
using Microsoft.Win32;

namespace Reunioes;

/// <summary>Liga, desliga e consulta o servico de fundo (servico.py: gravar sozinho + atalho global).
/// Ele roda com o pythonw do motor e inicia com o Windows pela chave Run do usuario.</summary>
public static class Servico
{
    const string ChaveRun = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string NomeRun = "Reunioes";
    static string Estado => Path.Combine(Config.DirApp, "servico.estado.json");

    static string Comando(Config c) => $"\"{c.PythonW}\" \"{Path.Combine(c.Scripts, "servico.py")}\"";

    public static void IniciarComWindows(Config c, bool sim)
    {
        using var k = Registry.CurrentUser.CreateSubKey(ChaveRun);
        if (sim && File.Exists(c.PythonW)) k.SetValue(NomeRun, Comando(c));
        else k.DeleteValue(NomeRun, false);
    }

    public static void Iniciar(Config c)
    {
        if (!File.Exists(c.PythonW)) return;
        var psi = new ProcessStartInfo(c.PythonW) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = c.Scripts };
        psi.ArgumentList.Add(Path.Combine(c.Scripts, "servico.py"));
        c.Ambiente(psi, comToken: false);
        Process.Start(psi); // o servico tem mutex: se ja houver um rodando, este sai sozinho
    }

    public static void Parar()
    {
        try
        {
            using var q = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name LIKE 'python%'");
            foreach (ManagementObject o in q.Get())
                if ((o["CommandLine"]?.ToString() ?? "").Contains("servico.py"))
                    try { Process.GetProcessById(Convert.ToInt32(o["ProcessId"])).Kill(true); } catch (Exception) { }
        }
        catch (Exception) { }
    }

    public static void Reiniciar(Config c)
    {
        Parar();
        Thread.Sleep(400);
        Iniciar(c);
    }

    /// <summary>Estado escrito pelo servico a cada 3 s. Arquivo velho = servico parado.</summary>
    public static object Status()
    {
        bool rodando = false; string? app = null; bool? atalhoOk = null;
        try
        {
            using var d = JsonDocument.Parse(File.ReadAllText(Estado));
            var r = d.RootElement;
            var quando = DateTime.Parse(r.GetProperty("quando").GetString()!);
            try { rodando = Process.GetProcessById(r.GetProperty("pid").GetInt32()).ProcessName.StartsWith("python", StringComparison.OrdinalIgnoreCase); }
            catch (ArgumentException) { }
            if ((DateTime.Now - quando).TotalSeconds > 30) rodando = false;
            if (r.TryGetProperty("app", out var a) && a.ValueKind == JsonValueKind.String) app = a.GetString();
            if (r.TryGetProperty("atalhoOk", out var k) && k.ValueKind is JsonValueKind.True or JsonValueKind.False) atalhoOk = k.GetBoolean();
        }
        catch (Exception) { }
        return new { rodando, app, atalhoOk };
    }
}
