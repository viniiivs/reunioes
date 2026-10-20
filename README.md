# Reuniões

Grava suas reuniões, transcreve no seu próprio computador e diz o que ficou para você fazer.

**[Baixar para Windows](https://github.com/viniiivs/reunioes/releases/latest/download/Reunioes-win-Setup.exe)** (Windows 10 e 11, 64 bits)

## O que faz

- **Grava duas faixas separadas**: o seu microfone e o som do computador (a voz dos outros), sem perda de qualidade.
- **Grava sozinho quando a reunião começa**: percebe quando um app de chamada (Teams, Meet, Discord, Zoom, Slack, Webex...) usa o microfone, e para quando ele solta.
- **Atalho global** para gravar e parar, mesmo com o app fechado.
- **Transcreve no seu computador** com WhisperX. O áudio nunca sai da sua máquina. Com placa de vídeo NVIDIA, uma reunião de 30 minutos fica pronta em poucos minutos.
- **Separa as vozes** de cada pessoa (opcional) e aprende os nomes: dê nome a "Falante 1" uma vez e ele reconhece nas próximas.
- **Resumo com IA** (opcional, com o [Claude Code](https://claude.com/product/claude-code)): lista as tarefas que são suas, com o trecho da reunião que comprova cada uma.
- **Atualiza sozinho**: baixa versões novas em segundo plano e avisa quando é só reiniciar.

## Instalação

1. Baixe e abra o `Reunioes-win-Setup.exe`. Não precisa de administrador.
2. Na primeira vez, um assistente configura tudo: pastas, qualidade da transcrição, microfone e saída de som, e baixa o motor de transcrição (de 2 a 8 GB, conforme a qualidade escolhida).

Para separar as vozes, o assistente explica como criar um token gratuito no Hugging Face (o modelo [pyannote community-1](https://huggingface.co/pyannote/speaker-diarization-community-1) pede que cada pessoa aceite os termos de uso).

## Privacidade

Gravação e transcrição acontecem no seu computador. Só sai daqui:
- o download dos modelos e das atualizações;
- o texto da transcrição, enviado ao Claude, se você ligar o resumo com IA.

Grave reuniões só com o conhecimento das pessoas e respeitando as leis do seu país.

## Para desenvolvedores

```powershell
# compilar e rodar
dotnet run --project app

# gerar o instalador (build\releases) e publicar uma versão nova
.\build\publicar.ps1 -Versao 1.0.1 -Publicar
```

O app é .NET 8 (WinForms + WebView2) com a interface em HTML/CSS/JS (`app/wwwroot`). O motor é Python (`app/motor`), instalado pelo próprio app com o [uv](https://github.com/astral-sh/uv). Instalador e atualizações: [Velopack](https://velopack.io).

## Créditos

Feito por **Vinícius Vieira** ([github.com/viniiivs](https://github.com/viniiivs)).

Usa [WhisperX](https://github.com/m-bain/whisperX), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [pyannote.audio](https://github.com/pyannote/pyannote-audio), [PyTorch](https://pytorch.org), [uv](https://github.com/astral-sh/uv), [Velopack](https://velopack.io), [NAudio](https://github.com/naudio/NAudio) e [Phosphor Icons](https://phosphoricons.com).

Licença MIT.
