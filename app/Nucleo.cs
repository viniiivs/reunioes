using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Reunioes;

/// <summary>Estado unico do app (configuracao, gravacoes, motor, atualizador) e os comandos que as
/// paginas podem chamar. As janelas so repassam mensagens para ca.</summary>
public static class Nucleo
{
    static Config config = Config.Ler();
    static readonly object trava = new();
    public static Config Config { get { lock (trava) return config; } }

    public static readonly Gravacoes Gravacoes = new(() => Config);
    public static readonly Motor Motor = new(() => Config);
    public static readonly Atualizador Atualizador = new();

    /// <summary>Avisa todas as janelas (lista, leitores, configuracoes).</summary>
    public static event Action<object>? Evento;
    static void Emitir(object e) => Evento?.Invoke(e);

    static Nucleo()
    {
        Gravacoes.Mudou += () => Emitir(new { evento = "mudou" });
    }

    // ------------------------------------------------------------------ inicio

    public static void AoAbrir()
    {
        var c = Config;
        if (!c.ConfiguracaoConcluida) return;
        try { Gravacoes.Migrar(); } catch (Exception) { }   // gravacoes soltas da 1.0.0 -> uma subpasta cada
        bool scriptsNovos = Motor.SincronizarScripts(c);
        _ = Task.Run(() => Motor.LimparTorch(c));   // instalacoes da 1.0.0 ficaram com 2,6 GB de .lib inuteis
        var st = (dynamic)Servico.Status();
        if (scriptsNovos) Servico.Reiniciar(c);
        else if (!(bool)st.rodando) Servico.Iniciar(c);
        Servico.IniciarComWindows(c, c.IniciarComWindows);
        if (c.AtualizarSozinho)
            _ = Task.Run(async () =>
            {
                await Task.Delay(4000);
                await Atualizador.Procurar(AvisarAtualizacao);
                if (Atualizador.Estado == "disponivel") await Atualizador.Baixar(AvisarAtualizacao);
            });
    }

    static void AvisarAtualizacao() => Emitir(new { evento = "atualizacao", status = Atualizador.Status() });

    /// <summary>Chamado pelo desinstalador (Velopack). Para o servico e apaga o motor e a configuracao;
    /// as gravacoes ficam onde estao.</summary>
    public static void Desinstalar()
    {
        var c = Config.Ler();
        try { Servico.Parar(); } catch (Exception) { }
        try { Servico.IniciarComWindows(c, false); } catch (Exception) { }
        foreach (var d in new[] { c.PastaMotor, Config.DirLocal, Config.DirApp })
            if (Directory.Exists(d))
                // rmdir em segundo plano: o motor tem dezenas de milhares de arquivos e o gancho tem prazo curto
                Process.Start(new ProcessStartInfo("cmd.exe", $"/c timeout /t 3 >nul & rmdir /s /q \"{d}\"")
                { UseShellExecute = false, CreateNoWindow = true });
    }

    // ------------------------------------------------------------------ comandos

    public static async Task<object?> Executar(JanelaWeb janela, string cmd, JsonObject a)
    {
        string? b = a["base"]?.GetValue<string>();
        switch (cmd)
        {
            // gravacoes
            case "listar": return await Task.Run(Gravacoes.Listar);
            case "pasta": return Abrir(Gravacoes.Pasta(b));
            case "transcrever": Gravacoes.Transcrever(b!); return null;
            case "cancelar": Gravacoes.Cancelar(b!); return null;
            case "excluir": Gravacoes.Excluir(b!); return null;
            case "ler": return await Task.Run(() => Gravacoes.Ler(b!));
            case "resumir": Gravacoes.Resumir(b!); return null;
            case "nomear": await Gravacoes.Nomear(b!, a["de"]!.GetValue<string>(), a["para"]!.GetValue<string>()); return null;
            case "gravar": await Task.Run(Gravacoes.GravarOuParar); return null;
            case "abrirArquivo": return Abrir(Gravacoes.Arquivo(b!, a["ext"]!.GetValue<string>()));
            case "copiar": Clipboard.SetText(a["texto"]!.GetValue<string>()); return null;
            case "abrirLeitor":
                janela.AbrirLeitor(b!, a["titulo"]?.GetValue<string>() ?? b!, a["aba"]?.GetValue<string>());
                return null;

            // estado geral (cabecalho da lista)
            case "estado":
                return await Task.Run(() => new
                {
                    gravando = Gravacoes.GravandoAgora(),
                    servico = Servico.Status(),
                    gravarSozinho = Config.GravarSozinho,
                    resumoAtivo = Config.Resumo.Ativo,
                    atalho = Config.Atalho,
                    motorPronto = Motor.Pronto(Config),
                    atualizacao = Atualizador.Status(),
                });

            // configuracao e assistente
            case "config":
            {
                var c = Config;
                var n = JsonSerializer.SerializeToNode(c, Config.Json)!.AsObject();
                n.Remove("hfTokenCifrado");
                n["temToken"] = c.HfToken != null;
                return n;
            }
            case "salvarConfig": return Salvar(a["config"]!.AsObject(), a["token"]?.GetValue<string>());
            case "gravarSozinho":
            {
                var c = Config; c.GravarSozinho = a["ligado"]!.GetValue<bool>(); c.Salvar();
                if (!(bool)((dynamic)Servico.Status()).rodando) Servico.Iniciar(c);
                return null;
            }
            case "sistema": return await Task.Run(() => Sistema.Info(Config));
            case "dispositivos": return await Task.Run(Sistema.Dispositivos);
            case "livre": return Math.Round(Sistema.LivreGB(a["pasta"]!.GetValue<string>()), 1);
            case "escolherPasta": return janela.EscolherPasta(a["atual"]?.GetValue<string>(), a["titulo"]?.GetValue<string>());
            case "testarToken": return await TestarToken(a["token"]?.GetValue<string>() ?? Config.HfToken);
            case "pendentes": return Motor.Pendentes(Config);
            case "instalar":
                _ = Motor.Instalar(p =>
                {
                    Emitir(p);
                    if (p.Estado == "fim") AposInstalar();
                });
                return null;
            case "cancelarInstalacao": Motor.Cancelar(); return null;
            case "concluir":
            {
                var c = Config; c.ConfiguracaoConcluida = true; c.Salvar();
                AoAbrir();
                return null;
            }
            case "abrirLink":
            {
                var url = a["url"]!.GetValue<string>();
                if (!url.StartsWith("https://")) throw new InvalidOperationException("Link inválido.");
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                return null;
            }
            case "abrirLog": return Abrir(new[] { Path.Combine(Config.PastaMotor, "instalacao.log") });

            // atualizacao
            case "atualizacao": return Atualizador.Status();
            case "procurarAtualizacao":
                await Atualizador.Procurar(AvisarAtualizacao);
                if (Atualizador.Estado == "disponivel") _ = Atualizador.Baixar(AvisarAtualizacao);
                return Atualizador.Status();
            case "aplicarAtualizacao":
                if (Gravacoes.GravandoAgora()) throw new InvalidOperationException("Pare a gravação antes de atualizar.");
                Servico.Parar();
                Atualizador.AplicarEReiniciar();
                return null;
        }
        throw new InvalidOperationException("comando desconhecido: " + cmd);
    }

    static void AposInstalar()
    {
        var c = Config;
        Motor.SincronizarScripts(c);
        if (c.ConfiguracaoConcluida) { Servico.Reiniciar(c); Servico.IniciarComWindows(c, c.IniciarComWindows); }
    }

    /// <summary>Grava a configuracao vinda da pagina e aplica o que mudou. Devolve as etapas do motor
    /// que precisam rodar de novo (troca de modelo, idioma, GPU, pasta do motor...).</summary>
    static object Salvar(JsonObject novo, string? token)
    {
        Config c;
        lock (trava)
        {
            var antes = config;
            var n = JsonSerializer.SerializeToNode(antes, Config.Json)!.AsObject();
            foreach (var (k, v) in novo)
                if (k is not ("hfTokenCifrado" or "temToken" or "configuracaoConcluida")) n[k] = v?.DeepClone();
            c = n.Deserialize<Config>(Config.Json)!;
            if (token != null) c.HfToken = token;
            if (string.IsNullOrWhiteSpace(c.PastaGravacoes) || string.IsNullOrWhiteSpace(c.PastaMotor))
                throw new InvalidOperationException("Escolha as pastas.");
            c.Salvar();
            config = c;
        }
        Gravacoes.Vigiar();
        Emitir(new { evento = "mudou" });   // pasta pode ter mudado: a lista recarrega
        if (c.ConfiguracaoConcluida)
        {
            Servico.IniciarComWindows(c, c.IniciarComWindows);
            Servico.Reiniciar(c);   // atalho e dispositivos sao lidos na partida do servico
        }
        return Motor.Pendentes(c);
    }

    static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(20) };

    /// <summary>O modelo que separa vozes e "fechado": exige token e aceitar os termos na pagina dele.</summary>
    static async Task<object> TestarToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return new { ok = false, msg = "Cole o token." };
        var req = new HttpRequestMessage(HttpMethod.Get, "https://huggingface.co/pyannote/speaker-diarization-community-1/resolve/main/config.yaml");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Trim());
        try
        {
            using var r = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
            return r.StatusCode switch
            {
                HttpStatusCode.OK => new { ok = true, msg = "Token válido e termos aceitos." },
                HttpStatusCode.Unauthorized => new { ok = false, msg = "Token inválido. Confira se copiou inteiro." },
                HttpStatusCode.Forbidden => new { ok = false, msg = "O token funciona, mas falta aceitar os termos do modelo (link acima)." },
                _ => new { ok = false, msg = $"O Hugging Face respondeu {(int)r.StatusCode}. Tente de novo." },
            };
        }
        catch (Exception) { return new { ok = false, msg = "Sem conexão com o Hugging Face." }; }
    }

    static object? Abrir(string[] args)
    {
        Process.Start(new ProcessStartInfo(args[0]) { UseShellExecute = true, Arguments = args.Length > 1 ? args[1] : "" });
        return null;
    }
}
