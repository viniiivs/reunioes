# Desenha o icone do app (onda de som que vira linhas de texto) em varios tamanhos
# e monta reunioes.ico (entradas PNG) + reunioes.png (256) para a interface.
Add-Type -AssemblyName System.Drawing
$pasta = $PSScriptRoot

function Arred([System.Drawing.Drawing2D.GraphicsPath]$g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $r = [Math]::Min($r, [Math]::Min($w, $h) / 2)
    $d = $r * 2
    $g.AddArc($x, $y, $d, $d, 180, 90)
    $g.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $g.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $g.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $g.CloseFigure()
}

function Desenhar([int]$n) {
    $bmp = New-Object System.Drawing.Bitmap $n, $n
    $gr = [System.Drawing.Graphics]::FromImage($bmp)
    $gr.SmoothingMode = 'AntiAlias'
    $gr.PixelOffsetMode = 'HighQuality'
    $u = $n / 32.0   # grade de 32 unidades
    $m = if ($n -le 20) { 0 } else { 1 }

    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    Arred $tile ($m * $u) ($m * $u) ((32 - 2 * $m) * $u) ((32 - 2 * $m) * $u) (7 * $u)
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF 0, $n), ([System.Drawing.Color]::FromArgb(255, 16, 122, 115)), ([System.Drawing.Color]::FromArgb(255, 10, 88, 83))
    $gr.FillPath($grad, $tile)

    $tinta = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 242, 245, 244))
    $marca = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($n -le 24) {
        # versao simplificada: 2 barras + 2 linhas, traço de 3 unidades
        foreach ($b in @(@(6, 11, 10), @(11, 7, 18))) { Arred $marca ($b[0] * $u) ($b[1] * $u) (3.5 * $u) ($b[2] * $u) (1.75 * $u) }
        foreach ($l in @(@(10.5, 11), @(18, 7))) { Arred $marca (17 * $u) ($l[0] * $u) ($l[1] * $u) (3.5 * $u) (1.75 * $u) }
    } else {
        # 3 barras (onda) centradas em y=16, depois 3 linhas de texto
        foreach ($b in @(@(6, 4), @(9.5, 7), @(13, 5))) {
            $h = $b[1] * 2
            Arred $marca ($b[0] * $u) ((16 - $b[1]) * $u) (2.4 * $u) ($h * $u) (1.2 * $u)
        }
        foreach ($l in @(@(10.3, 10), @(14.8, 8), @(19.3, 5))) { Arred $marca (17.5 * $u) ($l[0] * $u) ($l[1] * $u) (2.4 * $u) (1.2 * $u) }
    }
    $gr.FillPath($tinta, $marca)
    $gr.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    if ($n -eq 256) { $bmp.Save((Join-Path $pasta 'reunioes.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
    $bmp.Dispose()
    return , $ms.ToArray()
}

$tamanhos = 16, 20, 24, 32, 40, 48, 64, 256
$imgs = foreach ($t in $tamanhos) { , (Desenhar $t) }
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$tamanhos.Count)
$off = 6 + 16 * $tamanhos.Count
for ($i = 0; $i -lt $tamanhos.Count; $i++) {
    $t = $tamanhos[$i]; $b = if ($t -ge 256) { 0 } else { $t }
    $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$imgs[$i].Length); $w.Write([uint32]$off)
    $off += $imgs[$i].Length
}
foreach ($im in $imgs) { $w.Write($im) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $pasta 'reunioes.ico'), $out.ToArray())
"ok: reunioes.ico ($($out.Length) bytes)"
