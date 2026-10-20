using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace Reunioes;

/// <summary>Janela nativa com um WebView2 servindo wwwroot. A pagina conversa com o host por
/// postMessage: {id, cmd, args} -> {id, ok, dados|erro}; o host avisa mudancas com {evento}.</summary>
public sealed class JanelaWeb : Form
{
    public const string TituloPrincipal = "Reuniões";
    static readonly List<JanelaWeb> abertas = new();
    static readonly JsonSerializerOptions json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    readonly string pagina;
    public string? Base { get; init; }
    public string? Aba { get; init; }

    public JanelaWeb(string pagina, string titulo, Size tamanho)
    {
        this.pagina = pagina;
        Text = titulo;
        Icon = IconeApp();
        ClientSize = tamanho;
        MinimumSize = new Size(720, 480);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Escuro() ? Color.FromArgb(22, 26, 25) : Color.FromArgb(246, 247, 247);
        web.DefaultBackgroundColor = BackColor;
        Controls.Add(web);
        abertas.Add(this);
        Action<object> aviso = e => BeginInvokeSeguro(() => Avisar(e));
        Nucleo.Evento += aviso;
        FormClosed += (_, _) => { abertas.Remove(this); Nucleo.Evento -= aviso; };
    }

    static Icon? icone;
    static Icon IconeApp()
    {
        if (icone != null) return icone;
        using var s = typeof(JanelaWeb).Assembly.GetManifestResourceStream("reunioes.ico")!;
        return icone = new Icon(s);
    }

    // ---- tema: barra de titulo escura quando o Windows esta no modo escuro ----
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);
    static bool Escuro() =>
        Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "AppsUseLightTheme", 1) is int v && v == 0;

    // Fechar no meio da instalacao do motor: confirma e cancela (senao o download segue escondido
    // e a proxima abertura comeca outra instalacao por cima).
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (Nucleo.Motor.Rodando && Base == null && e.CloseReason == CloseReason.UserClosing)
        {
            var r = MessageBox.Show(this, "A instalação do motor de transcrição ainda está rodando.\n\nFechar agora cancela a instalação. Dá para continuar depois, de onde parou.",
                TituloPrincipal, MessageBoxButtons.OKCancel, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (r != DialogResult.OK) { e.Cancel = true; return; }
            Nucleo.Motor.Cancelar();
        }
        base.OnFormClosing(e);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int sim = Escuro() ? 1 : 0;
        DwmSetWindowAttribute(Handle, 20, ref sim, 4); // DWMWA_USE_IMMERSIVE_DARK_MODE
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Config.DirLocal, "webview"));
            await web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (MessageBox.Show(this, "Este app precisa do Microsoft Edge WebView2, que não está instalado.\n\nAbrir a página de download?",
                    TituloPrincipal, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true });
            Close();
            return;
        }
        var cw = web.CoreWebView2;
        cw.SetVirtualHostNameToFolderMapping("app.local", Path.Combine(AppContext.BaseDirectory, "wwwroot"),
            CoreWebView2HostResourceAccessKind.Allow);
        cw.Settings.AreDefaultContextMenusEnabled = false;
        cw.Settings.IsStatusBarEnabled = false;
        cw.Settings.IsZoomControlEnabled = false;
#if !DEBUG
        cw.Settings.AreDevToolsEnabled = false;
#endif
        cw.WebMessageReceived += (_, a) => _ = Responder(a.WebMessageAsJson);
        // Links externos abrem no navegador, nunca dentro do app.
        cw.NewWindowRequested += (_, a) => { a.Handled = true; };
        cw.NavigationStarting += (_, a) => { if (!a.Uri.StartsWith("https://app.local/")) a.Cancel = true; };
        var q = Base != null ? "?b=" + Uri.EscapeDataString(Base) + (Aba != null ? "&aba=" + Aba : "") : "";
        cw.Navigate($"https://app.local/{pagina}{q}");
    }

    void BeginInvokeSeguro(Action a)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(a); } catch (InvalidOperationException) { }
    }

    public void Avisar(object msg)
    {
        if (web.CoreWebView2 == null) return;
        web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(msg, json));
    }

    async Task Responder(string bruto)
    {
        var m = JsonNode.Parse(bruto)!;
        var id = m["id"]?.GetValue<int>() ?? 0;
        var cmd = m["cmd"]?.GetValue<string>() ?? "";
        var args = m["args"] as JsonObject ?? new JsonObject();
        try
        {
            var dados = await Nucleo.Executar(this, cmd, args);
            Avisar(new { id, ok = true, dados });
        }
        catch (Exception ex)
        {
            Avisar(new { id, ok = false, erro = ex.Message });
        }
    }

    public string? EscolherPasta(string? atual, string? titulo)
    {
        using var d = new FolderBrowserDialog
        {
            Description = titulo ?? "Escolha a pasta",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = true,
            InitialDirectory = Directory.Exists(atual) ? atual : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        };
        return d.ShowDialog(this) == DialogResult.OK ? d.SelectedPath : null;
    }

    public void AbrirLeitor(string b, string titulo, string? aba)
    {
        var ja = abertas.FirstOrDefault(j => j.Base == b);
        if (ja != null)
        {
            if (ja.WindowState == FormWindowState.Minimized) ja.WindowState = FormWindowState.Normal;
            ja.Activate();
            if (aba != null) ja.Avisar(new { evento = "aba", aba });
            return;
        }
        var j = new JanelaWeb("leitor.html", titulo, new Size(860, 760)) { Base = b, Aba = aba, StartPosition = FormStartPosition.Manual };
        j.Location = new Point(Left + 48, Top + 36);
        j.Show();
    }
}
