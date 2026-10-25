$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectPath = Split-Path -Parent $PSScriptRoot
foreach ($iconSize in @(192,512)) {
    $bitmap = New-Object System.Drawing.Bitmap($iconSize,$iconSize)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#142e32'))
    $scale = $iconSize / 512.0
    $graphics.ScaleTransform($scale,$scale)
    $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#a9ebd5'),19)
    $graphics.TranslateTransform(256,256)
    $graphics.RotateTransform(-38)
    $graphics.DrawEllipse($pen,-157,-82,314,164)
    $graphics.RotateTransform(38)
    $graphics.DrawEllipse($pen,-63,-63,126,126)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#f3c688'))
    $graphics.FillEllipse($brush,83,-127,52,52)
    $bitmap.Save((Join-Path $projectPath "public/icon-$iconSize.png"),[System.Drawing.Imaging.ImageFormat]::Png)
    $brush.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
