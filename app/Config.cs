using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Reunioes;

/// <summary>Configuracao do usuario em %APPDATA%\Reunioes\config.json. Os scripts Python do motor
/// leem o mesmo arquivo (comum.py), entao os nomes das chaves sao contrato.</summary>
public sealed class Config
{
    public string PastaGravacoes { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Reuniões");
    public string PastaMotor { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Reunioes-motor");
    public string Idioma { get; set; } = "pt";
    public string Modelo { get; set; } = "large-v3";
    public bool UsarGpu { get; set; } = true;
    public bool SepararVozes { get; set; }
    public string? Mic { get; set; }
    public string? Saida { get; set; }
    public bool GravarSozinho { get; set; } = true;
    public string? Atalho { get; set; } = "ctrl+alt+g";
    public bool IniciarComWindows { get; set; } = true;
    public bool AtualizarSozinho { get; set; } = true;
    public ResumoConfig Resumo { get; set; } = new();
    /// <summary>Token do Hugging Face cifrado com DPAPI (so este usuario neste PC decifra).</summary>
    public string? HfTokenCifrado { get; set; }
    public bool ConfiguracaoConcluida { get; set; }

    public sealed class ResumoConfig
    {
        public bool Ativo { get; set; }
        public string Nome { get; set; } = "";
        public string Apelidos { get; set; } = "";
        public string Contexto { get; set; } = "";
    }

    // ------------------------------------------------------------------ caminhos

    public static readonly string DirApp = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Reunioes");
    public static readonly string DirLocal = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Reunioes-app");
    static string Arquivo => Path.Combine(DirApp, "config.json");

    [JsonIgnore] public string Scripts => Path.Combine(PastaMotor, "scripts");
    [JsonIgnore] public string Venv => Path.Combine(PastaMotor, "venv");
    [JsonIgnore] public string Python => Path.Combine(Venv, "Scripts", "python.exe");
    [JsonIgnore] public string PythonW => Path.Combine(Venv, "Scripts", "pythonw.exe");
    [JsonIgnore] public string Modelos => Path.Combine(PastaMotor, "modelos");

    [JsonIgnore]
    public string? HfToken
    {
        get
        {
            if (string.IsNullOrEmpty(HfTokenCifrado)) return null;
            try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(HfTokenCifrado), null, DataProtectionScope.CurrentUser)); }
            catch (CryptographicException) { return null; }
        }
        set => HfTokenCifrado = string.IsNullOrWhiteSpace(value) ? null
            : Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(value.Trim()), null, DataProtectionScope.CurrentUser));
    }

    // ------------------------------------------------------------------ ler / salvar

    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static bool Existe => File.Exists(Arquivo);

    public static Config Ler()
    {
        try { return JsonSerializer.Deserialize<Config>(File.ReadAllText(Arquivo), Json) ?? new Config(); }
        catch (Exception) { return new Config(); }
    }

    public void Salvar()
    {
        Directory.CreateDirectory(DirApp);
        var tmp = Arquivo + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(this, Json));
        File.Move(tmp, Arquivo, true);
    }

    /// <summary>Variaveis de ambiente para os processos Python do motor.</summary>
    public void Ambiente(System.Diagnostics.ProcessStartInfo psi, bool comToken)
    {
        psi.Environment["HF_HOME"] = Modelos;
        psi.Environment["TORCH_HOME"] = Path.Combine(PastaMotor, "torch");
        psi.Environment["PYTHONUTF8"] = "1";
        psi.Environment["PYTHONIOENCODING"] = "utf-8";
        psi.Environment["HF_HUB_DISABLE_TELEMETRY"] = "1";
        psi.Environment.Remove("HF_TOKEN");
        if (comToken && HfToken is { } t) psi.Environment["HF_TOKEN"] = t;
    }
}
