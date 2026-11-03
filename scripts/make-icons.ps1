Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "public\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Icon([int]$size, [string]$name) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml("#0b0e0c"))

  $pad = [double]$size * 0.075
  $side = $size - ($pad * 2)
  $radius = $side * 0.25
  $path = New-RoundedPath ([float]$pad) ([float]$pad) ([float]$side) ([float]$side) ([float]$radius)
  $lime = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#c9f76f"))
  $g.FillPath($lime, $path)

  $u = $side / 32.0
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#0b0e0c"), [float]($u * 2.5))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  $g.DrawLine($pen, [float]($pad + 9 * $u), [float]($pad + 10.5 * $u), [float]($pad + 23 * $u), [float]($pad + 10.5 * $u))
  $g.DrawLine($pen, [float]($pad + 9 * $u), [float]($pad + 16 * $u), [float]($pad + 18.5 * $u), [float]($pad + 16 * $u))
  $g.DrawLine($pen, [float]($pad + 9 * $u), [float]($pad + 21.5 * $u), [float]($pad + 14.5 * $u), [float]($pad + 21.5 * $u))

  $dot = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#0b0e0c"))
  $dotSize = [float]($u * 4.2)
  $g.FillEllipse($dot, [float]($pad + 20.4 * $u), [float]($pad + 19.4 * $u), $dotSize, $dotSize)

  $target = Join-Path $outDir $name
  $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

  $dot.Dispose()
  $pen.Dispose()
  $lime.Dispose()
  $path.Dispose()
  $g.Dispose()
  $bitmap.Dispose()
  Write-Host "wrote $target"
}

New-Icon 192 "icon-192.png"
New-Icon 512 "icon-512.png"
New-Icon 180 "apple-touch-icon.png"
New-Icon 32 "favicon-32.png"

# Maskable icons need the mark inside the 80% safe zone; the glyph already sits
# well within it because of the lime square inset.
Copy-Item (Join-Path $outDir "icon-512.png") (Join-Path $outDir "icon-maskable-512.png") -Force
Write-Host "wrote $outDir\icon-maskable-512.png"
