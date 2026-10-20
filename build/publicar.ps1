<#
.SYNOPSIS
  Gera o instalador do Reuniões e, com -Publicar, sobe a versão nas releases do GitHub
  (de onde o app instalado baixa as atualizações sozinho).

.EXAMPLE
  .\build\publicar.ps1 -Versao 1.0.1                 # só gera em build\releases
  .\build\publicar.ps1 -Versao 1.0.1 -Publicar       # gera e publica no GitHub
  .\build\publicar.ps1 -Versao 1.0.1 -Publicar -Notas "Corrige o atalho"

Requer: .NET 8 SDK, vpk (dotnet tool install -g vpk) e, para publicar, gh logado.
#>
param(
    [Parameter(Mandatory)][string]$Versao,
    [switch]$Publicar,
    [string]$Notas = ""
)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
$app = Join-Path $raiz 'app'
$saida = Join-Path $PSScriptRoot 'publish'
$releases = Join-Path $PSScriptRoot 'releases'
$repo = 'https://github.com/viniiivs/reunioes'
$env:PATH += ";$env:USERPROFILE\.dotnet\tools"

# uv (gerenciador de Python que o app usa para instalar o motor) vai junto no instalador.
$uv = Join-Path $app 'ferramentas\uv.exe'
if (-not (Test-Path $uv)) {
    Write-Host '> baixando o uv'
    New-Item -ItemType Directory -Force (Split-Path $uv) | Out-Null
    $zip = Join-Path $env:TEMP 'uv-win.zip'
    Invoke-WebRequest 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile $zip
    Expand-Archive $zip -DestinationPath (Split-Path $uv) -Force
    Remove-Item $zip, (Join-Path (Split-Path $uv) 'uvx.exe'), (Join-Path (Split-Path $uv) 'uvw.exe') -ErrorAction SilentlyContinue
}

Write-Host "> compilando $Versao"
if (Test-Path $saida) { Remove-Item $saida -Recurse -Force }
dotnet publish (Join-Path $app 'Reunioes.csproj') -c Release -r win-x64 --self-contained true `
    -p:Version=$Versao -p:PublishReadyToRun=true -p:DebugType=none -p:DebugSymbols=false -o $saida --nologo
if ($LASTEXITCODE) { throw 'dotnet publish falhou' }
Get-ChildItem $saida -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force

if ($Publicar) {
    # Baixa a release anterior para o vpk gerar o pacote de diferença (atualização menor).
    $token = (gh auth token).Trim()
    vpk download github --repoUrl $repo --token $token -o $releases 2>$null
}

Write-Host '> empacotando'
$args = @('pack', '-u', 'Reunioes', '-v', $Versao, '-p', $saida, '-e', 'Reunioes.exe', '-o', $releases,
    '--packTitle', 'Reuniões', '--packAuthors', 'Vinícius Vieira', '--icon', (Join-Path $app 'icone\reunioes.ico'))
if ($Notas) { $n = Join-Path $env:TEMP 'reunioes-notas.md'; Set-Content $n $Notas -Encoding utf8; $args += @('--releaseNotes', $n) }
vpk @args
if ($LASTEXITCODE) { throw 'vpk pack falhou' }

if ($Publicar) {
    Write-Host '> publicando no GitHub'
    vpk upload github --repoUrl $repo --token $token -o $releases --publish --releaseName "Reuniões $Versao" --tag "v$Versao"
    if ($LASTEXITCODE) { throw 'vpk upload falhou' }
}
Write-Host "`nPronto: $releases"
Get-ChildItem $releases -Filter "*$Versao*" | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize
