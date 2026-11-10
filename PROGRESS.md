# Progresso

Resumo vivo do projeto: decisões, o que está pronto, o que falta e onde fica cada coisa.

## Onde fica
- `app/` — app Windows (.NET 8 WinForms + WebView2). Telas em `app/wwwroot` (HTML/CSS/JS), host em `*.cs`.
- `app/motor/` — scripts Python (gravar, transcrever com WhisperX, nomear vozes, resumir). O app copia para a pasta do motor ao abrir.
- `web/` — versão web (mesmas telas; transcrição no navegador com Transformers.js, dados no IndexedDB).
- `build/publicar.ps1 -Versao X -Publicar` — instalador + auto-update (Velopack) no GitHub Releases.
- `build/web.ps1 -Publicar` — publica a versão web no GitHub Pages (branch gh-pages).
- `build/prints.py` — refaz os prints do README (`docs/*.png`) pelo simulador da ponte, com a versão da última tag (09/11/2026: prints refeitos para a 1.0.19, + `checagem.png`).
- `testes/` — testes do layout das pastas, da detecção de gravação e dos addons (`dotnet run --project testes`; `REUNIOES_TESTE_CLAUDE=1` inclui 1 chamada curta ao haiku).
- `app/Addons.cs` + `app/wwwroot/md.js` — addons (abas extras no leitor). Exemplos em `exemplos/addons/` (ata = claude, falas = comando).

## Decisões
- Comunicação tela ↔ host por `{id, cmd, args}` (ponte.js); fora do app, `ponte.js` cai num simulador com dados fictícios — testes de tela usam só ele.
- Gravando = a gravação citada na linha de comando de um `gravar.py`; sem `.sha256` sozinho não basta (sessões interrompidas).
- Pausar = matar o processo; cada etapa pronta fica em `<base>.parcial.<etapa>.json` e é retomada.
- Configurações e leitor (resumo/transcrição) abrem por cima da lista, na mesma janela, num iframe que usa a ponte da lista. O leitor entra no histórico (voltar do mouse/navegador fecha).
- Progresso da transcrição: o motor imprime `[pct] N` (0–99) da transcrição inteira; cada canal pesa 1, separar vozes pesa 0,5; dentro de um canal, 80% reconhecer e 20% alinhar. A lista mostra "Transcrevendo N%" com a barra (`.barra`, componente único em base.css).
- Modelo de transcrição carrega do disco sem consultar o Hugging Face (`local_files_only`); só baixa se faltar. A consulta online levava ~2 min por carga.
- (até 1.0.19; agora é o addon externo, ver abaixo) Fato ou fake: Claude Code com WebSearch/WebFetch (`claude -p --tools WebSearch,WebFetch --allowedTools ...` + `--json-schema`) no Windows; na web, ferramenta `web_search` da API + ferramenta `registrar_checagem`. Não existe skill/MCP oficial de checagem; Brave MCP e Google Fact Check API ficaram de fora (pedem chave e repetem o que a busca do Claude já faz).
- Checagem fica em `<base>.checagem.json` (itens com origem "reuniao" ou "trecho"); checar a reunião troca só os itens dela, trecho soma no topo. Prompt igual em `app/PromptChecagem.cs` e `web/checagem.js`.
- Fato ou fake checa TODAS as afirmações verificáveis (sem limite), cada uma no contexto da conversa (pronomes e referências resolvidos), toda com fonte da busca (sem fonte = sem_dados), citações marcadas em quem. Reunião fictícia de 12 afirmações: 28 s. Prazo 20 min no Windows; na web até 60 buscas.
- Mais de 5 itens: chips de filtro por veredito (mesmo componente `.pessoa` do filtro da transcrição).
- Selo (`.selo` em base.css) é componente único: "Recomendada" nas Configurações e veredito do Fato ou fake; cores por tokens --ok/--alerta/--danger-texto.
- O motor escreve o próprio log (`REUNIOES_LOG`, stdout/stderr redirecionados no Python): fechar ou atualizar o app no meio não corta mais o andamento (antes o app lia por pipe e o log parava). A lista relê o log de 5 em 5 s, porque o Windows nem sempre avisa que um arquivo aberto cresceu. Atualizar fica bloqueado durante transcrição.
- Modo da transcrição pela memória livre na placa: ≥ 8 GB float16 lote 8; ≥ 6 GB int8_float16 lote 8; menos, int8_float16 lote 4. GTX 1660 SUPER com ~3 GB livres (3 monitores + Wallpaper Engine usam ~3 GB): float16 lote 8 transbordava (2,7 GB emprestados, parado horas); int8_float16 lote 4 = 7,6× tempo real, mesmo texto.
- Vigia de transbordo (transcrever.py, `Vigia`): a cada 20 s mede a memória do PC emprestada à placa (contador "GPU Process MemoryShared Usage" do Windows); 2 medidas > 1 GB = interrompe a etapa e segue num modo mais leve; o último modo é sempre o processador. Vale para texto, alinhamento e vozes. Testado 26/10/2026 forçando float16 lote 16: detectou 2,5 e 3,2 GB e terminou em int8_float16 lote 4. `REUNIOES_MODOS` força a lista (testes).
- Commits sem coautoria/atribuição de IA.
- Fato ou fake SAIU do app (10/11/2026, pedido do dono: o único que vem por padrão é o Resumo, que continua embutido). Virou o addon `fato-ou-fake` em `D:\Projetos\reunioes-addons\` (fora do repo; instalado em %APPDATA%/Reunioes/addons). Mesmo prompt, agora responde markdown com selos. Checagens antigas (`.checagem.json`) convertidas por `fato-ou-fake/converter.py` para `.addon.fato-ou-fake.json` (10 gravações; originais intactos). Saiu também da versão web (web/checagem.js apagado).
- Addons (10/11/2026): para funções que não são para todo mundo. Pasta `%APPDATA%/Reunioes/addons/<id>/addon.json`; nada vem no app/repo público (só exemplos genéricos). Dois tipos: `claude` (prompt.md + modelo + ferramentas → `claude -p` sem esquema, texto em `result`) e `comando` (programa; `{python}` = Python do motor; reunião em JSON no stdin, markdown no stdout, stderr vira erro). Resultado sempre markdown em `<base>.addon.<id>.json` (+ `.erro`), aba própria depois do Fato ou fake, carimbos `[hh:mm:ss]` clicáveis. Instalar = Configurações › Addons › Instalar addon (copia a pasta) ou copiar à mão; interruptor só esconde (`addonsDesligados` na config). Um por vez por (reunião, addon). Escolhas do dono: motor dos dois tipos, aba com texto formatado, instalação por pasta local. Trecho: `botaoTrecho` no addon.json → botão junto da seleção na transcrição; resultado do trecho soma em `trechos` no topo, rodar na reunião troca só `markdown`. Markdown aceita selos `[[ok|erro|alerta|neutro: texto]]` (componente .selo).

## Feito (versões)
- 1.0.7 só a gravação em curso aparece como gravando · 1.0.8–1.0.10 layout responsivo e Configurações em pilha no estreito
- 1.0.11 pausar sem perder progresso, "Primeiro" na fila, marcar ações do resumo como feitas
- 1.0.12 resumo/transcrição na mesma janela, ‹ Reuniões, Copiar resumo
- 1.0.13 porcentagem da transcrição inteira na lista (23/10/2026)
- 1.0.14 "Carregando modelos" de ~5 min para ~20 s: modelo lido só do disco (23/10/2026; gravação curta: 6,5 min → 2 min)
- 1.0.15 Fato ou fake no leitor (aba própria + "Checar trecho" ao selecionar texto), 23/10/2026
- 1.0.16 Fato ou fake checa todas as afirmações, no contexto, sempre com fonte; filtros por veredito (24/10/2026)
- 1.0.17 transcrição não trava mais na tela: log escrito pelo motor, lista relê a porcentagem, não atualiza no meio de uma transcrição (24/10/2026)
- 1.0.18 transcrição escolhe o modo pela memória livre da placa (GTX 1660: de "travada" para ~7× tempo real), 26/10/2026
- 1.0.19 vigia de transbordo: se outro programa ocupar a placa no meio, a transcrição troca de modo (ou vai para o processador) em vez de travar, 26/10/2026
- 1.0.20 addons (abas extras por pasta local, tipos claude/comando, trecho, selos); Fato ou fake vira addon externo, 10/11/2026

## Pendente / conhecido
- Web publicada na 1.0.27 (10/11/2026), testada com gravação falsa no IndexedDB (scratchpad web_teste.py; PC e celular, claro e escuro).
- 1.0.27 (10/11/2026): textos da interface trocam "sozinho" por "automaticamente" (Gravar/Atualizar automaticamente etc.); nomes de config (gravarSozinho...) ficam iguais. Topo medido: botão 197→219 px, cabe em 704 e 1260. Grade de apps da gravação automática: colunas max-content (switch colado no nome, alinhado na coluna), respiro 11 px em cima e embaixo, linhas a cada 36 px; celular (≤480) em 2 colunas. Medido em 1260/704/390/320, claro e escuro.
- 1.0.28 (10/11/2026, NÃO publicada, aguardando o "sim"): amigo ainda com gravações de 1 KB "Áudio incompleto" (manuais e automáticas). Eu (PC do dono) gravo normal. Causa provável: o gravador cria o FLAC e morre ao abrir o dispositivo (sem o gravar.log dele ainda para confirmar). Aqui, um loopback recusa abrir com nº de canais diferente do dele (-9996), então fone 7.1 ou mic em matriz com min(2, canais) pode falhar.
  - gravar.py: `Canal._abrir` tenta canais do dispositivo, 2 e 1; abre o stream ANTES de criar o FLAC; se o escolhido não abre, tenta o padrão do Windows; se nada abre, `[erro] Não consegui abrir ...` no log (via dizer, UTF-8), apaga os FLACs e sai 1.
  - App: estado "falhou" ("Não gravou", vermelho, tooltip = motivo) quando o FLAC não tem fim (ou não existe) e o gravar.log tem `[erro]` ou traceback (`ErroGravacao`). Bases() lista pasta só com .gravar.log; Validar aceita. Testes novos no Program.cs; simulador tem a linha "i".
- 1.0.27 publicada (10/11/2026), app e web; gravação cortada + teste de áudio:
  - Causa do "clico em gravar e para sozinho, áudio incompleto" (amigo): o app abria o gravar.py lendo a saída por pipe; fechar a janela (ou o app sair) quebrava o pipe e o gravador morria no aviso seguinte (a cada 10 s, OSError 22), sem fechar o FLAC nem gerar .sha256. Reproduzido. Agora o app passa REUNIOES_LOG e o gravador escreve o próprio log (comum.log_proprio); avisos por dizer() nunca derrubam; fechar() não falha com aparelho caído; aparelho que para de mandar áudio é reaberto a cada 2 s (silêncio no meio, tempo certo). Testado: "app" sai logo após abrir, gravação segue 25 s e fecha com .sha256.
  - Teste de áudio (Configurações › Áudio e no assistente), como o do Skype: `app/TesteAudio.cs` (NAudio). Medidor ao vivo do mic (WasapiCapture) e da saída (AudioMeterInformation, mostra se o fone recebe som), "Testar" grava 5 s e toca de volta na saída, "Tocar som" toca um acorde suave (não campainha). Tela pede `medirAudio` de 1 em 1 s; sem pedido por 3 s o host solta os aparelhos. Eventos `niveis` (20/s) e `testeAudio`. Medidor = variante `.barra.medidor`. Testes reais: REUNIOES_TESTE_AUDIO=1 (mede e toca silêncio). Simulador: config.html?testelento#audio.
  - "Padrão do Windows (agora: X)" passou a usar Role.Multimedia, o mesmo padrão que o gravador (PortAudio) usa; antes mostrava o de Comunicações.
- 1.0.26 publicada (10/11/2026): "Gravar sozinho" vale para começar E parar. Desligado (ou app fora da lista) no meio de uma gravação automática: Servico.largar() solta a gravação, que vira manual. Com ele desligado nada para sozinho (passo() sai antes). Testado com laço simulado.
- 1.0.25 publicada (10/11/2026): Discord solta o mic quando a pessoa para de falar (push-to-talk) e só toca som quando alguém fala; com FIM=45 s virava um arquivo por fala (relato de um amigo, com gravar sozinho ligado). FIM_POR_APP = {discord: 180} em servico.py (fim_de()). Testado simulando o laço com relógio falso.
- 1.0.24 publicada (10/11/2026):
  - IA: resumo e addons rodam no Claude Code OU no Codex (conta ChatGPT). `app/Ia.cs` (antes Claude.cs) escolhe: addon com "ia" exigida > Config.Ia > a instalada (Claude primeiro). Codex: `codex exec --ephemeral --ignore-user-config --ignore-rules -s read-only --disable shell_tool -c web_search=live|disabled -c model_reasoning_effort=low|medium|high -c model_instructions_file=<prompt>` (+ `--output-schema`); stdout = resposta, stderr traz "model: ...". Antes checa `codex login status` (sem login o exec fica ~30 s tentando). Pelo npm usa o codex.exe de dentro de @openai/codex (o .cmd passa pelo cmd.exe; pastas ".codex-xxxx" são sobras de update, ignoradas). Testes reais: REUNIOES_TESTE_CODEX=1 / REUNIOES_TESTE_CLAUDE=1.
  - Gravar sozinho por app: Config.GravarSozinhoSem (ids teams, meet, zoom, discord, slack, webex, skype, jitsi, whereby); `plataforma()` em servico.py; vale também para aba de navegador.
  - Claude Code: PATH relido do registro, npm/winget, aviso quando só existe o app Claude Desktop.
- 1.0.23 (10/11/2026): erro na instalação durante a configuração procura atualização; botão "Atualizar para X" aplica com `--retomar-instalacao` (Program.cs abre config.html?modo=setup&instalar, que pula para Instalação e já instala). Simulador: config.html?modo=setup&instalar&pend&insterro&updsetup. Caminho real de reiniciar pelo Velopack não testado (precisa de app instalado + versão nova).
- 1.0.22 publicada (10/11/2026): instalação de um amigo quebrou em "Baixando os modelos" com WinError 1314 (link simbólico). Causa: corrida no huggingface_hub 0.36 (marca link como suportado antes de testar, com downloads paralelos); `comum.links_sem_corrida()` testa sob trava (reproduzido e testado com os.symlink lento sem privilégio). E "Tentar de novo" marcava a etapa errada: a tela agora relê `pendentes`. Até a 1.0.22, quem está no meio da configuração não recebia atualização: tinha que rodar o Setup novo. Contorno sem atualizar: clicar em Tentar de novo ou ligar o Modo de desenvolvedor do Windows.
- 1.0.21 publicada (10/11/2026): listas aninhadas no markdown dos addons. Addons pessoais (fora do repo) em D:/Projetos/reunioes-addons: fato-ou-fake (instalado) e tcc (sessão de terapia, Eu = terapeuta; opus) NÃO instalado: o dono instala depois, só na máquina dele.
- Addons: publicado na 1.0.20 (10/11/2026). Falta o primeiro addon novo de verdade do dono. Ideias se precisar: rodar addon num trecho selecionado, addon na versão web.
- Gravações curtas mostram "0 falantes".
- Tela preta no app (visto uma vez na 1.0.6): causa não confirmada.
- Versão web: resumo não testado com chave real da API.
- Dá para ganhar ~40 s por transcrição carregando o modelo e o alinhamento uma vez só para os dois canais (hoje recarrega por canal; cuidado com os 6 GB da GPU).
- Separar vozes ainda consulta o Hugging Face ao carregar (não medido).
- Fato ou fake na versão web não testado com chave real da API (só o app Windows foi testado de ponta a ponta).
- Tempo do Fato ou fake numa reunião real de 1 h não medido (só amostras fictícias).
- Fontes da checagem às vezes vêm da imprensa em vez do órgão oficial, mesmo com o prompt pedindo o oficial primeiro.
- Progresso da etapa "separar vozes" não testado com token do Hugging Face.
- RESOLVIDO 26/10/2026: lentidão/"travada" era a placa transbordando (driver NVIDIA empresta RAM do PC em vez de dar erro). Motor agora escolhe o modo pela memória livre (`modos()` em transcrever.py).
