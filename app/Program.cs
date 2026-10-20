using System.Runtime.InteropServices;
using Velopack;

namespace Reunioes;

static class Program
{
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string? cls, string title);

    [STAThread]
    static void Main()
    {
        // Ganchos do instalador (instalar, atualizar, desinstalar) rodam e saem antes de qualquer janela.
        VelopackApp.Build()
            .OnBeforeUninstallFastCallback(_ => Nucleo.Desinstalar())
            .Run();

        // Uma instancia so: a segunda traz a janela que ja esta aberta.
        using var mutex = new Mutex(true, "Reunioes.App", out bool primeira);
        if (!primeira)
        {
            var h = FindWindow(null, JanelaWeb.TituloPrincipal);
            if (h != IntPtr.Zero) { ShowWindow(h, 9); SetForegroundWindow(h); }
            return;
        }
        ApplicationConfiguration.Initialize();
        Nucleo.AoAbrir();
        var inicio = Nucleo.Config.ConfiguracaoConcluida ? "index.html" : "config.html?modo=setup";
        Application.Run(new JanelaWeb(inicio, JanelaWeb.TituloPrincipal, new Size(1260, 760)));
    }
}
