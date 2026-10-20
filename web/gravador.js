// Grava duas faixas separadas, como o app de Windows:
//   eu     = microfone (getUserMedia)
//   outros = áudio da aba ou da tela que a pessoa compartilhar (getDisplayMedia + "Compartilhar áudio")
// O vídeo do compartilhamento é descartado; só o áudio é gravado.

const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
const parar = (s) => s?.getTracks().forEach((t) => t.stop());

export class Gravacao {
  constructor() { this.faixas = {}; this.ativa = false; this.bytes = 0; }

  async iniciar(micId) {
    // A tela primeiro: o navegador só deixa pedir o compartilhamento logo depois do clique.
    let tela;
    try {
      tela = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1, width: 320, height: 180 },
        audio: { suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: "include", selfBrowserSurface: "exclude", surfaceSwitching: "include", preferCurrentTab: false,
      });
    } catch (e) {
      throw new Error(e.name === "NotAllowedError" ? "Gravação cancelada: escolha a aba ou a tela da reunião para gravar." : e.message);
    }
    const audioTela = tela.getAudioTracks();
    if (!audioTela.length) {
      parar(tela);
      throw new Error("O compartilhamento veio sem som. Grave de novo e marque “Compartilhar áudio da guia” (ou “do sistema”).");
    }

    const abrirMic = (id) => navigator.mediaDevices.getUserMedia({
      audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: true },
    });
    let mic;
    try {
      // o microfone escolhido pode ter sido desconectado: cai no padrão
      mic = await abrirMic(micId).catch((e) => (e.name === "OverconstrainedError" && micId ? abrirMic(null) : Promise.reject(e)));
    } catch (e) {
      parar(tela);
      throw new Error(e.name === "NotAllowedError" ? "Permita o uso do microfone para gravar." : "Não consegui abrir o microfone: " + e.message);
    }

    this.superficie = tela.getVideoTracks()[0]?.getSettings?.().displaySurface || null;
    this.streams = [mic, tela];
    this.inicio = new Date();
    this.faixas = {};
    this.bytes = 0;
    this._gravar("eu", mic);
    this._gravar("outros", new MediaStream(audioTela));
    this.ativa = true;
    // "Parar de compartilhar" do navegador também encerra a gravação
    tela.getTracks().forEach((t) => t.addEventListener("ended", () => this.aoEncerrarPeloNavegador?.()));
  }

  _gravar(nome, stream) {
    const partes = [];
    const rec = new MediaRecorder(stream, MIME ? { mimeType: MIME, audioBitsPerSecond: 64000 } : undefined);
    rec.ondataavailable = (e) => { if (e.data.size) { partes.push(e.data); this.bytes += e.data.size; } };
    const fim = new Promise((ok) => (rec.onstop = () => ok(new Blob(partes, { type: rec.mimeType || "audio/webm" }))));
    rec.start(1000);
    this.faixas[nome] = { rec, fim };
  }

  /** Para e devolve { eu: Blob, outros: Blob, duracao, inicio, superficie }. */
  async parar() {
    if (!this.ativa) return null;
    this.ativa = false;
    Object.values(this.faixas).forEach((f) => f.rec.state !== "inactive" && f.rec.stop());
    const [eu, outros] = await Promise.all([this.faixas.eu.fim, this.faixas.outros.fim]);
    this.streams.forEach(parar);
    return { eu, outros, inicio: this.inicio, duracao: (Date.now() - this.inicio) / 1000, superficie: this.superficie };
  }
}
