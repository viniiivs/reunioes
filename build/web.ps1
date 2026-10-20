<#
.SYNOPSIS
  Monta a versão web do Reuniões (as mesmas telas do app, com o motor rodando no navegador)
  em build\web e, com -Publicar, sobe no GitHub Pages (branch gh-pages).

.EXAMPLE
  .\build\web.ps1              # só monta em build\web (teste: py -m http.server 8790 -d build\web)
  .\build\web.ps1 -Publicar    # monta e publica em https://viniiivs.github.io/reunioes/

Quem já usa recebe a versão nova ao recarregar a página (o service worker busca da rede primeiro).
#>
param([switch]$Publicar)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
$saida = Join-Path $PSScriptRoot 'web'
$utf8 = New-Object Text.UTF8Encoding $false

# versão = a última do app de Windows (tag vX.Y.Z; o publicar.ps1 cria uma por versão)
git -C $raiz fetch -q --tags origin 2>$null
$versao = (git -C $raiz tag --list 'v*' --sort=-v:refname | Select-Object -First 1) -replace '^v'
if (-not $versao) { throw 'Não achei nenhuma tag de versão (vX.Y.Z)' }

if (Test-Path $saida) { Remove-Item $saida -Recurse -Force }
Copy-Item (Join-Path $raiz 'app\wwwroot') $saida -Recurse
New-Item -ItemType Directory (Join-Path $saida 'web') | Out-Null
Get-ChildItem (Join-Path $raiz 'web') -File | Where-Object { $_.Name -notin 'sw.js', 'manifest.webmanifest' } | Copy-Item -Destination (Join-Path $saida 'web')
# o service worker e o manifesto ficam na raiz (o escopo do service worker é a pasta dele)
Copy-Item (Join-Path $raiz 'web\sw.js'), (Join-Path $raiz 'web\manifest.webmanifest') $saida
[IO.File]::WriteAllText((Join-Path $saida 'web\versao.js'), "export const VERSAO = `"$versao`";`n", $utf8)
# o cache do service worker muda de nome a cada versão
$sw = Join-Path $saida 'sw.js'
[IO.File]::WriteAllText($sw, ((Get-Content $sw -Raw) -replace 'const CACHE = "reunioes-app";', "const CACHE = `"reunioes-$versao`";"), $utf8)

# marca as páginas como versão web
$cabeca = @"
  <script src="web/iniciar.js"></script>
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#1e1e20" media="(prefers-color-scheme: dark)">
  <meta name="description" content="Grava, transcreve e resume reuniões no navegador. A transcrição roda no seu computador.">
  <link rel="apple-touch-icon" href="web/icone-192.png">
"@
foreach ($p in Get-ChildItem $saida -Filter *.html) {
    $h = Get-Content $p.FullName -Raw
    if ($h -notmatch '<meta name="viewport"[^>]*>') { throw "Sem meta viewport em $($p.Name)" }
    $h = $h -replace '(<meta name="viewport"[^>]*>)', "`$1`n$cabeca"
    # o CSS de celular vem por último, para valer sobre o tema
    $h = $h -replace '(<link rel="stylesheet" href="liquid-glass.css">)', "`$1`n  <link rel=`"stylesheet`" href=`"web/web.css`">"
    [IO.File]::WriteAllText($p.FullName, $h, $utf8)
}
# o GitHub Pages não deve tratar a pasta como Jekyll
[IO.File]::WriteAllText((Join-Path $saida '.nojekyll'), '', $utf8)
Write-Host "> versão web $versao montada em $saida"

if (-not $Publicar) { return }

# publica na branch gh-pages (histórico próprio, só com o site)
$tmp = Join-Path ([IO.Path]::GetTempPath()) "reunioes-gh-pages"
if (Test-Path $tmp) { git -C $raiz worktree remove --force $tmp 2>$null; Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
git -C $raiz worktree prune
git -C $raiz fetch origin gh-pages 2>$null
if ($LASTEXITCODE -eq 0) { git -C $raiz worktree add -B gh-pages $tmp origin/gh-pages }
else { git -C $raiz worktree add --orphan -b gh-pages $tmp }
if ($LASTEXITCODE -ne 0) { throw 'Não consegui preparar a branch gh-pages' }
try {
    Get-ChildItem $tmp -Force | Where-Object Name -ne '.git' | Remove-Item -Recurse -Force
    Copy-Item (Join-Path $saida '*') $tmp -Recurse -Force
    Copy-Item (Join-Path $saida '.nojekyll') $tmp -Force
    git -C $tmp add -A
    git -C $tmp diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { Write-Host '> nada mudou no site'; return }
    git -C $tmp commit -q -m "Versão web $versao"
    git -C $tmp push -q origin gh-pages
    if ($LASTEXITCODE -ne 0) { throw 'O push da gh-pages falhou' }
} finally {
    git -C $raiz worktree remove --force $tmp
}

# liga o GitHub Pages na primeira vez (servindo a gh-pages). O GitHub às vezes liga sozinho ao
# receber a branch: aí o POST responde 409 e está tudo certo.
gh api repos/viniiivs/reunioes/pages 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    gh api -X POST repos/viniiivs/reunioes/pages -f 'source[branch]=gh-pages' -f 'source[path]=/' 2>&1 | Out-Null
}
$global:LASTEXITCODE = 0
Write-Host '> publicado em https://viniiivs.github.io/reunioes/ (o GitHub leva 1 ou 2 minutos)'
