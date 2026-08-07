[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$buildDir = Join-Path $repoRoot 'build'
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

function New-RoundedPath {
  param(
    [System.Drawing.RectangleF]$Rectangle,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($Rectangle.X, $Rectangle.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rectangle.X, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Set-HighQualityGraphics {
  param([System.Drawing.Graphics]$Graphics)

  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
}

function Add-StarField {
  param(
    [System.Drawing.Graphics]$Graphics,
    [int]$Width,
    [int]$Height,
    [int]$Seed,
    [int]$Count
  )

  $random = [System.Random]::new($Seed)
  for ($index = 0; $index -lt $Count; $index++) {
    $alpha = $random.Next(22, 100)
    $size = [single]($random.NextDouble() * 1.5 + 0.4)
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($alpha, 255, 255, 255))
    try {
      $Graphics.FillEllipse($brush, [single]$random.NextDouble() * $Width, [single]$random.NextDouble() * $Height, $size, $size)
    } finally {
      $brush.Dispose()
    }
  }
}

function New-OrbitSidebar {
  param([string]$Path)

  $bitmap = [System.Drawing.Bitmap]::new(164, 314, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    Set-HighQualityGraphics $graphics
    $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      [System.Drawing.Rectangle]::new(0, 0, 164, 314),
      [System.Drawing.Color]::FromArgb(255, 4, 7, 14),
      [System.Drawing.Color]::FromArgb(255, 13, 22, 38),
      32.0
    )
    $graphics.FillRectangle($background, 0, 0, 164, 314)
    $background.Dispose()
    Add-StarField $graphics 164 314 2401 88

    $glowPath = New-RoundedPath ([System.Drawing.RectangleF]::new(17, 18, 130, 278)) 18
    $panel = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(82, 18, 27, 44))
    $panelBorder = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(82, 255, 255, 255), 1)
    $graphics.FillPath($panel, $glowPath)
    $graphics.DrawPath($panelBorder, $glowPath)
    $panel.Dispose()
    $panelBorder.Dispose()
    $glowPath.Dispose()

    $cyanPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(225, 63, 208, 255), 2.2)
    $orangePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(238, 255, 130, 67), 2.8)
    $softPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(72, 255, 255, 255), 1)
    $graphics.DrawEllipse($softPen, 24, 81, 116, 47)
    $graphics.DrawArc($cyanPen, 27, 70, 110, 67, 196, 254)
    $graphics.DrawArc($orangePen, 50, 62, 64, 84, 10, 292)
    $cyanPen.Dispose()
    $orangePen.Dispose()
    $softPen.Dispose()

    $coreGradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      [System.Drawing.Rectangle]::new(60, 76, 44, 44),
      [System.Drawing.Color]::FromArgb(255, 255, 126, 65),
      [System.Drawing.Color]::FromArgb(255, 63, 208, 255),
      40.0
    )
    $graphics.FillEllipse($coreGradient, 60, 76, 44, 44)
    $coreGradient.Dispose()
    $inner = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 7, 11, 20))
    $graphics.FillEllipse($inner, 70, 86, 24, 24)
    $inner.Dispose()

    $titleFont = [System.Drawing.Font]::new('Segoe UI', 20, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $smallFont = [System.Drawing.Font]::new('Segoe UI', 8.5, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $labelFont = [System.Drawing.Font]::new('Segoe UI', 8, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(245, 250, 252, 255))
    $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(172, 189, 202, 222))
    $accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 63, 208, 255))
    try {
      $graphics.DrawString('ORBIT', $titleFont, $white, 43, 154)
      $graphics.DrawString('YOUR GAMES. ONE UNIVERSE.', $labelFont, $accent, 25, 185)
      $graphics.DrawString("Fast. Focused. Controller-first.", $smallFont, $muted, 25, 209)
      $graphics.DrawString('VERSION 0.0.0.3', $labelFont, $muted, 25, 266)
    } finally {
      $titleFont.Dispose()
      $smallFont.Dispose()
      $labelFont.Dispose()
      $white.Dispose()
      $muted.Dispose()
      $accent.Dispose()
    }

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function New-OrbitHeader {
  param([string]$Path)

  $bitmap = [System.Drawing.Bitmap]::new(150, 57, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    Set-HighQualityGraphics $graphics
    $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      [System.Drawing.Rectangle]::new(0, 0, 150, 57),
      [System.Drawing.Color]::FromArgb(255, 7, 11, 20),
      [System.Drawing.Color]::FromArgb(255, 18, 28, 48),
      0.0
    )
    $graphics.FillRectangle($background, 0, 0, 150, 57)
    $background.Dispose()

    $orangePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(245, 255, 130, 67), 2)
    $cyanPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(230, 63, 208, 255), 1.5)
    $graphics.DrawEllipse($cyanPen, 104, 8, 37, 37)
    $graphics.DrawArc($orangePen, 111, 5, 24, 44, 18, 300)
    $orangePen.Dispose()
    $cyanPen.Dispose()

    $titleFont = [System.Drawing.Font]::new('Segoe UI', 16, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $labelFont = [System.Drawing.Font]::new('Segoe UI', 7.5, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(248, 255, 255, 255))
    $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(176, 188, 204, 226))
    try {
      $graphics.DrawString('ORBIT', $titleFont, $white, 12, 10)
      $graphics.DrawString('SETUP  -  0.0.0.3', $labelFont, $muted, 13, 34)
    } finally {
      $titleFont.Dispose()
      $labelFont.Dispose()
      $white.Dispose()
      $muted.Dispose()
    }

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function New-OrbitIcon {
  param([string]$Path)

  $bitmap = [System.Drawing.Bitmap]::new(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    Set-HighQualityGraphics $graphics
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $tilePath = New-RoundedPath ([System.Drawing.RectangleF]::new(9, 9, 238, 238)) 54
    $tileBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      [System.Drawing.Rectangle]::new(9, 9, 238, 238),
      [System.Drawing.Color]::FromArgb(255, 255, 126, 65),
      [System.Drawing.Color]::FromArgb(255, 63, 208, 255),
      42.0
    )
    $graphics.FillPath($tileBrush, $tilePath)
    $tileBrush.Dispose()
    $tilePath.Dispose()

    $shadow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(52, 0, 0, 0))
    $graphics.FillEllipse($shadow, 49, 56, 166, 157)
    $shadow.Dispose()
    $core = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(246, 6, 9, 17))
    $graphics.FillEllipse($core, 48, 49, 160, 160)
    $core.Dispose()
    $orbitPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(226, 255, 255, 255), 8)
    $graphics.DrawArc($orbitPen, 39, 73, 178, 110, 195, 290)
    $orbitPen.Dispose()
    $accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    $graphics.FillEllipse($accent, 189, 85, 18, 18)
    $accent.Dispose()

    $pngStream = [System.IO.MemoryStream]::new()
    try {
      $bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
      $pngBytes = $pngStream.ToArray()
      $fileStream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
      $writer = [System.IO.BinaryWriter]::new($fileStream)
      try {
        $writer.Write([UInt16]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]1)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$pngBytes.Length)
        $writer.Write([UInt32]22)
        $writer.Write($pngBytes)
      } finally {
        $writer.Dispose()
      }
    } finally {
      $pngStream.Dispose()
    }
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function New-OrbitAppxAsset {
  param(
    [string]$Path,
    [int]$Width,
    [int]$Height,
    [switch]$Wide
  )

  $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    Set-HighQualityGraphics $graphics
    $graphics.Clear([System.Drawing.Color]::FromArgb(255, 5, 7, 12))

    $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      [System.Drawing.Rectangle]::new(0, 0, $Width, $Height),
      [System.Drawing.Color]::FromArgb(255, 10, 16, 29),
      [System.Drawing.Color]::FromArgb(255, 20, 34, 55),
      28.0
    )
    $graphics.FillRectangle($background, 0, 0, $Width, $Height)
    $background.Dispose()

    $logoSize = if ($Wide) { [Math]::Floor($Height * 0.64) } else { [Math]::Floor([Math]::Min($Width, $Height) * 0.72) }
    $logoX = if ($Wide) { [Math]::Floor($Height * 0.18) } else { [Math]::Floor(($Width - $logoSize) / 2) }
    $logoY = [Math]::Floor(($Height - $logoSize) / 2)
    $stroke = [Math]::Max(2.0, $logoSize * 0.055)

    $accentPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(245, 64, 208, 255), $stroke)
    $warmPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(245, 255, 126, 65), $stroke)
    $core = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 4, 7, 14))
    $satellite = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    try {
      $graphics.FillEllipse($core, $logoX, $logoY, $logoSize, $logoSize)
      $graphics.DrawArc($accentPen, $logoX - ($logoSize * 0.07), $logoY + ($logoSize * 0.14), $logoSize * 1.14, $logoSize * 0.7, 195, 290)
      $graphics.DrawArc($warmPen, $logoX + ($logoSize * 0.18), $logoY - ($logoSize * 0.04), $logoSize * 0.64, $logoSize * 1.08, 15, 295)
      $dot = [Math]::Max(3.0, $logoSize * 0.11)
      $graphics.FillEllipse($satellite, $logoX + ($logoSize * 0.78), $logoY + ($logoSize * 0.26), $dot, $dot)
    } finally {
      $accentPen.Dispose()
      $warmPen.Dispose()
      $core.Dispose()
      $satellite.Dispose()
    }

    if ($Wide) {
      $fontSize = [Math]::Max(18.0, $Height * 0.22)
      $font = [System.Drawing.Font]::new('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(250, 255, 255, 255))
      try {
        $graphics.DrawString('ORBIT', $font, $brush, [single]($Height * 0.98), [single]($Height * 0.35))
      } finally {
        $font.Dispose()
        $brush.Dispose()
      }
    }

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

New-OrbitSidebar (Join-Path $buildDir 'installerSidebar.bmp')
Copy-Item -LiteralPath (Join-Path $buildDir 'installerSidebar.bmp') -Destination (Join-Path $buildDir 'uninstallerSidebar.bmp') -Force
New-OrbitHeader (Join-Path $buildDir 'installerHeader.bmp')
New-OrbitIcon (Join-Path $buildDir 'icon.ico')
Copy-Item -LiteralPath (Join-Path $buildDir 'icon.ico') -Destination (Join-Path $buildDir 'installerIcon.ico') -Force
Copy-Item -LiteralPath (Join-Path $buildDir 'icon.ico') -Destination (Join-Path $buildDir 'uninstallerIcon.ico') -Force

$appxAssetDir = Join-Path $buildDir 'appx'
New-Item -ItemType Directory -Force -Path $appxAssetDir | Out-Null
New-OrbitAppxAsset (Join-Path $appxAssetDir 'StoreLogo.png') 50 50
New-OrbitAppxAsset (Join-Path $appxAssetDir 'Square44x44Logo.png') 44 44
New-OrbitAppxAsset (Join-Path $appxAssetDir 'Square150x150Logo.png') 150 150
New-OrbitAppxAsset (Join-Path $appxAssetDir 'Wide310x150Logo.png') 310 150 -Wide
New-OrbitAppxAsset (Join-Path $appxAssetDir 'SplashScreen.png') 620 300 -Wide

Write-Host "ORBIT installer branding generated in $buildDir"
