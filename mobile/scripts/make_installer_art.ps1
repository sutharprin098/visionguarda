# Generates the NSIS installer artwork electron-builder actually consumes.
#
# The existing build/installerSidebar.png could never work: NSIS wants a 164x314
# BMP, and that file was a 1024x1024 JPEG carrying a .png extension. electron-
# builder silently fell back to NSIS's stock sidebar, which is why no branding
# appeared in the installer.
#
# Sizes are fixed by NSIS/electron-builder, not by taste:
#   installerSidebar  164 x 314  BMP   (the tall left panel)
#   installerHeader   150 x  57  BMP   (the strip on later pages)
# Written as 24-bit BMP — NSIS's MUI2 does not read PNG for these slots.

Add-Type -AssemblyName System.Drawing

$buildDir = "D:\camAI\desktop\build"
$logoPath = Join-Path $buildDir "icon.png"
$logo = [System.Drawing.Image]::FromFile($logoPath)

# Sampled from the icon's own corners so the panel reads as one artwork with it
# rather than a tile pasted on an unrelated colour — at 164px wide the seam
# around the icon's rounded square is very visible if these drift.
# Sample INSIDE the rounded square, not at the literal corners — those fall
# outside the rounded rect and are transparent, which sampled as pure black and
# made the icon tile stand out more, not less.
$probe = New-Object System.Drawing.Bitmap $logo
$inset = [int]($probe.Width * 0.16)
$bgTop    = $probe.GetPixel($inset, $inset)
$bgBottom = $probe.GetPixel($probe.Width - $inset - 1, $probe.Height - $inset - 1)
$probe.Dispose()
"  sampled bg: top=#{0:X2}{1:X2}{2:X2}  bottom=#{3:X2}{4:X2}{5:X2}" -f $bgTop.R,$bgTop.G,$bgTop.B,$bgBottom.R,$bgBottom.G,$bgBottom.B
$accent   = [System.Drawing.Color]::FromArgb(255, 78, 201, 154)
$textMain = [System.Drawing.Color]::FromArgb(255, 244, 244, 245)
$textDim  = [System.Drawing.Color]::FromArgb(255, 150, 156, 178)

function New-Panel {
    param([int]$W, [int]$H, [int]$LogoSize, [int]$LogoY, [bool]$WithText, [int]$TitleSize, [string]$OutFile)

    $bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    # Grayscale AA, not ClearType: subpixel rendering bakes red/blue fringes into
    # the bitmap, which look like artefacts on this dark panel and cannot be
    # undone by the installer.
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Diagonal gradient, same direction as the icon's own.
    $rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $bgTop, $bgBottom, 45.0)
    $g.FillRectangle($brush, $rect)

    $logoX = [int](($W - $LogoSize) / 2)
    $g.DrawImage($logo, $logoX, $LogoY, $LogoSize, $LogoSize)

    if ($WithText) {
        $fmt = New-Object System.Drawing.StringFormat
        $fmt.Alignment = [System.Drawing.StringAlignment]::Center

        $fTitle = New-Object System.Drawing.Font("Segoe UI", $TitleSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $bTitle = New-Object System.Drawing.SolidBrush $textMain
        $g.DrawString("CamAI", $fTitle, $bTitle, [float]($W / 2), [float]($LogoY + $LogoSize + 14), $fmt)

        $fSub = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $bSub = New-Object System.Drawing.SolidBrush $textDim
        $g.DrawString("AI CCTV Analytics", $fSub, $bSub, [float]($W / 2), [float]($LogoY + $LogoSize + 38), $fmt)

        # Thin accent rule, picking up the ring's green.
        $pen = New-Object System.Drawing.Pen($accent, 2)
        $g.DrawLine($pen, [float](($W / 2) - 26), [float]($LogoY + $LogoSize + 60), [float](($W / 2) + 26), [float]($LogoY + $LogoSize + 60))
        $pen.Dispose(); $fTitle.Dispose(); $bTitle.Dispose(); $fSub.Dispose(); $bSub.Dispose()
    }

    $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $g.Dispose(); $brush.Dispose(); $bmp.Dispose()

    $f = Get-Item $OutFile
    "  {0,-24} {1} bytes" -f $f.Name, $f.Length
}

"=== generating NSIS artwork ==="
New-Panel -W 164 -H 314 -LogoSize 96 -LogoY 58  -WithText $true  -TitleSize 22 -OutFile (Join-Path $buildDir "installerSidebar.bmp")
New-Panel -W 150 -H 57  -LogoSize 44 -LogoY 6   -WithText $false -TitleSize 0  -OutFile (Join-Path $buildDir "installerHeader.bmp")

$logo.Dispose()

"`n=== verify (must be 164x314 / 150x57, format Bmp) ==="
foreach ($n in @("installerSidebar.bmp", "installerHeader.bmp")) {
    $p = Join-Path $buildDir $n
    $i = [System.Drawing.Image]::FromFile($p)
    "  {0,-24} {1} x {2}   format={3}" -f $n, $i.Width, $i.Height, $i.RawFormat
    $i.Dispose()
}
