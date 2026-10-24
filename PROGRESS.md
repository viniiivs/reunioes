# Progresso

Resumo vivo do projeto: decisões, o que está pronto, o que falta e onde fica cada coisa.

## Onde fica
- `app/` — app Windows (.NET 8 WinForms + WebView2). Telas em `app/wwwroot` (HTML/CSS/JS), host em `*.cs`.
- `app/motor/` — scripts Python (gravar, transcrever com WhisperX, nomear vozes, resumir). O app copia para a pasta do motor ao abrir.
- `web/` — versão web (mesmas telas; transcrição no navegador com Transformers.js, dados no IndexedDB).
- `build/publicar.ps1 -Versao X -Publicar` — instalador + auto-update (Velopack) no GitHub Releases.
- `build/web.ps1 -Publicar` — publica a versão web no GitHub Pages (branch gh-pages).
- `testes/` — testes do layout das pastas e da detecção de gravação (`dotnet run --project testes`).

## Decisões
- Comunicação tela ↔ host por `{id, cmd, args}` (ponte.js); fora do app, `ponte.js` cai num simulador com dados fictícios — testes de tela usam só ele.
- Gravando = a gravação citada na linha de comando de um `gravar.py`; sem `.sha256` sozinho não basta (sessões interrompidas).
- Pausar = matar o processo; cada etapa pronta fica em `<base>.parcial.<etapa>.json` e é retomada.
- Configurações e leitor (resumo/transcrição) abrem por cima da lista, na mesma janela, num iframe que usa a ponte da lista. O leitor entra no histórico (voltar do mouse/navegador fecha).
- Progresso da transcrição: o motor imprime `[pct] N` (0–99) da transcrição inteira; cada canal pesa 1, separar vozes pesa 0,5; dentro de um canal, 80% reconhecer e 20% alinhar. A lista mostra "Transcrevendo N%" com a barra (`.barra`, componente único em base.css).
- Modelo de transcrição carrega do disco sem consultar o Hugging Face (`local_files_only`); só baixa se faltar. A consulta online levava ~2 min por carga.
- Commits sem coautoria/atribuição de IA.

## Feito (versões)
- 1.0.7 só a gravação em curso aparece como gravando · 1.0.8–1.0.10 layout responsivo e Configurações em pilha no estreito
- 1.0.11 pausar sem perder progresso, "Primeiro" na fila, marcar ações do resumo como feitas
- 1.0.12 resumo/transcrição na mesma janela, ‹ Reuniões, Copiar resumo
- 1.0.13 porcentagem da transcrição inteira na lista (23/10/2026)
- 1.0.14 "Carregando modelos" de ~5 min para ~20 s: modelo lido só do disco (23/10/2026; gravação curta: 6,5 min → 2 min)

## Pendente / conhecido
- Gravações curtas mostram "0 falantes".
- Tela preta no app (visto uma vez na 1.0.6): causa não confirmada.
- Versão web: resumo não testado com chave real da API.
- Dá para ganhar ~40 s por transcrição carregando o modelo e o alinhamento uma vez só para os dois canais (hoje recarrega por canal; cuidado com os 6 GB da GPU).
- Separar vozes ainda consulta o Hugging Face ao carregar (não medido).
- Progresso da etapa "separar vozes" não testado com token do Hugging Face.
