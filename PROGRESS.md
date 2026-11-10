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
- NÃO publicado (10/11/2026): detecção do Claude Code relê o PATH do registro (npm/winget instalados com o app aberto), procura em %APPDATA%\npm e WinGet\Links, e "verificar de novo" avisa quando só existe o app Claude Desktop (o claude.exe dele fica em Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\<versão>\..., caminho muda a cada versão; não usado).
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
