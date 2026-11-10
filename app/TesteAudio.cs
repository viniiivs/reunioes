using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Reunioes;

/// <summary>Teste de áudio das Configurações (como o do Skype): nível do microfone e da saída ao vivo,
/// gravar alguns segundos do microfone e ouvir de volta na saída, e um som de teste.
/// A tela pede a medição de 1 em 1 s; sem pedido por 3 s (tela fechada), solta os dispositivos.</summary>
public static class TesteAudio
{
    static readonly object trava = new();
    static MMDeviceEnumerator? enumerador;
    static MMDevice? mic, saida;
    static WasapiCapture? captura;
    static string? chave;                 // "mic|saida" aberto agora
    static DateTime ultimoPedido;
    static System.Threading.Timer? relogio;
    static Action<object>? emitir;
    static float picoMic;                 // maior pico desde o último aviso
    static List<float>? gravacao;         // amostras mono do teste, enquanto grava
    static bool testando;

    /// <summary>Abre (ou mantém) o microfone e a saída escolhidos e manda {evento:"niveis", mic, saida}
    /// 20 vezes por segundo. Nome nulo = padrão do Windows (o mesmo que o gravador usa).</summary>
    public static object Medir(string? nomeMic, string? nomeSaida, Action<object> aviso)
    {
        lock (trava)
        {
            ultimoPedido = DateTime.UtcNow;
            emitir = aviso;
            var k = $"{nomeMic}|{nomeSaida}";
            if (k != chave && !testando)
            {
                Fechar();
                chave = k;
                enumerador ??= new MMDeviceEnumerator();
                saida = Achar(DataFlow.Render, nomeSaida);
                mic = Achar(DataFlow.Capture, nomeMic);
                if (mic != null)
                    try
                    {
                        captura = new WasapiCapture(mic, true, 50);
                        captura.DataAvailable += AoCapturar;
                        captura.StartRecording();
                    }
                    catch (Exception) { captura?.Dispose(); captura = null; }
            }
            relogio ??= new System.Threading.Timer(_ => Tique(), null, 0, 50);
            return new { mic = captura != null, saida = saida != null };
        }
    }

    public static void Parar() { lock (trava) Fechar(); }

    /// <summary>Grava alguns segundos do microfone e toca de volta na saída. Avisa {evento:"testeAudio", etapa}.</summary>
    public static async Task GravarEOuvir(int segundos)
    {
        int taxa;
        lock (trava)
        {
            if (captura == null || saida == null) throw new InvalidOperationException("Microfone ou saída de som indisponível.");
            if (testando) return;
            testando = true;
            taxa = captura.WaveFormat.SampleRate;
            gravacao = new List<float>(taxa * segundos);
        }
        try
        {
            for (int resta = segundos; resta > 0; resta--)
            {
                emitir?.Invoke(new { evento = "testeAudio", etapa = "gravando", resta });
                await Task.Delay(1000);
            }
            float[] amostras;
            lock (trava) { amostras = gravacao!.ToArray(); gravacao = null; }
            emitir?.Invoke(new { evento = "testeAudio", etapa = "tocando" });
            await Tocar(amostras, taxa);
        }
        finally
        {
            lock (trava) { gravacao = null; testando = false; ultimoPedido = DateTime.UtcNow; }
            emitir?.Invoke(new { evento = "testeAudio", etapa = "fim" });
        }
    }

    /// <summary>Som de teste na saída: um acorde suave que cresce e some (nada de campainha).</summary>
    public static async Task TocarSom()
    {
        lock (trava) if (saida == null) throw new InvalidOperationException("Saída de som indisponível.");
        const int taxa = 48000;
        double dur = 1.6, ataque = 0.25, soltura = 0.7;
        var notas = new[] { 220.0, 277.18, 329.63, 440.0 };   // lá maior aberto
        var x = new float[(int)(taxa * dur)];
        for (int i = 0; i < x.Length; i++)
        {
            double t = (double)i / taxa;
            double env = t < ataque ? Math.Sin(Math.PI / 2 * t / ataque) : t > dur - soltura ? Math.Cos(Math.PI / 2 * (t - (dur - soltura)) / soltura) : 1;
            double s = 0;
            foreach (var f in notas) s += Math.Sin(2 * Math.PI * f * t) + 0.25 * Math.Sin(4 * Math.PI * f * t);
            x[i] = (float)(0.09 * env * s);
        }
        await Tocar(x, taxa);
    }

    // ------------------------------------------------------------------ por dentro

    static MMDevice? Achar(DataFlow fluxo, string? nome)
    {
        try
        {
            if (!string.IsNullOrEmpty(nome))
                foreach (var d in enumerador!.EnumerateAudioEndPoints(fluxo, DeviceState.Active))
                    if (d.FriendlyName == nome) return d;
            // configurado e desconectado: o gravador cai no padrão, o teste também
            return enumerador!.GetDefaultAudioEndpoint(fluxo, Role.Multimedia);
        }
        catch (Exception) { return null; }
    }

    static void AoCapturar(object? _, WaveInEventArgs e)
    {
        var f = captura?.WaveFormat;
        if (f == null) return;
        var mono = ParaMono(e.Buffer, e.BytesRecorded, f);
        float pico = 0;
        foreach (var v in mono) pico = Math.Max(pico, Math.Abs(v));
        lock (trava)
        {
            picoMic = Math.Max(picoMic, pico);
            gravacao?.AddRange(mono);
        }
    }

    static float[] ParaMono(byte[] b, int n, WaveFormat f)
    {
        int bytes = f.BitsPerSample / 8, ch = Math.Max(1, f.Channels), quadros = n / (bytes * ch);
        bool flutuante = f.Encoding == WaveFormatEncoding.IeeeFloat || f.Encoding == WaveFormatEncoding.Extensible && f.BitsPerSample == 32;
        var r = new float[quadros];
        for (int q = 0; q < quadros; q++)
        {
            float s = 0;
            for (int c = 0; c < ch; c++)
            {
                int o = (q * ch + c) * bytes;
                s += flutuante ? BitConverter.ToSingle(b, o)
                    : bytes == 2 ? BitConverter.ToInt16(b, o) / 32768f
                    : bytes == 3 ? (b[o] << 8 | b[o + 1] << 16 | b[o + 2] << 24) / 2147483648f
                    : BitConverter.ToInt32(b, o) / 2147483648f;
            }
            r[q] = s / ch;
        }
        return r;
    }

    static void Tique()
    {
        float m, s = 0;
        Action<object>? av;
        lock (trava)
        {
            if (!testando && DateTime.UtcNow - ultimoPedido > TimeSpan.FromSeconds(3)) { Fechar(); return; }
            m = picoMic; picoMic = 0;
            try { s = saida?.AudioMeterInformation.MasterPeakValue ?? 0; } catch (Exception) { }
            av = emitir;
        }
        av?.Invoke(new { evento = "niveis", mic = captura != null ? m : (float?)null, saida = s });
    }

    /// <summary>Toca amostras mono na saída escolhida, no formato de mixagem dela (sempre aceito no modo compartilhado).</summary>
    static async Task Tocar(float[] mono, int taxa)
    {
        MMDevice dev;
        lock (trava) dev = saida ?? throw new InvalidOperationException("Saída de som indisponível.");
        var mix = dev.AudioClient.MixFormat;
        int r = mix.SampleRate, ch = Math.Max(1, mix.Channels);
        bool flutuante = mix.Encoding == WaveFormatEncoding.IeeeFloat || mix.Encoding == WaveFormatEncoding.Extensible && mix.BitsPerSample == 32;
        int quadros = (int)((long)mono.Length * r / taxa);
        var ms = new MemoryStream();
        var w = new BinaryWriter(ms);
        for (int q = 0; q < quadros; q++)
        {
            double pos = (double)q * taxa / r;
            int i = (int)pos;
            float a = mono[Math.Min(i, mono.Length - 1)], b = mono[Math.Min(i + 1, mono.Length - 1)];
            float v = Math.Clamp(a + (b - a) * (float)(pos - i), -1f, 1f);
            for (int c = 0; c < ch; c++)
                if (flutuante) w.Write(v); else w.Write((short)(v * 32767));
        }
        ms.Position = 0;
        var fim = new TaskCompletionSource();
        using var fonte = new RawSourceWaveStream(ms, flutuante ? mix : new WaveFormat(r, 16, ch));
        using var tocador = new WasapiOut(dev, AudioClientShareMode.Shared, true, 100);
        tocador.PlaybackStopped += (_, _) => fim.TrySetResult();
        tocador.Init(fonte);
        tocador.Play();
        await Task.WhenAny(fim.Task, Task.Delay(TimeSpan.FromSeconds(mono.Length / (double)taxa + 3)));
    }

    static void Fechar()
    {
        try { captura?.StopRecording(); } catch (Exception) { }
        captura?.Dispose();
        captura = null; mic = null; saida = null; chave = null; picoMic = 0;
        relogio?.Dispose(); relogio = null;
    }
}
