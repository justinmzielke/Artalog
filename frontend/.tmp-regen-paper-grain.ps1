Add-Type -AssemblyName System.Drawing

$width = 1024
$height = 1024
$seed = 431
$rng = New-Object System.Random($seed)

# Start with centered noise field.
$values = New-Object 'double[]' ($width * $height)
for ($y = 0; $y -lt $height; $y++) {
  for ($x = 0; $x -lt $width; $x++) {
    $idx = $y * $width + $x
    $values[$idx] = ($rng.NextDouble() * 2.0) - 1.0
  }
}

# Smooth to remove digital speckle and keep organic paper grain.
for ($pass = 0; $pass -lt 4; $pass++) {
  $next = New-Object 'double[]' ($width * $height)
  for ($y = 0; $y -lt $height; $y++) {
    for ($x = 0; $x -lt $width; $x++) {
      $sum = 0.0
      $count = 0
      for ($ky = -1; $ky -le 1; $ky++) {
        for ($kx = -1; $kx -le 1; $kx++) {
          $sx = ($x + $kx + $width) % $width
          $sy = ($y + $ky + $height) % $height
          $sum += $values[$sy * $width + $sx]
          $count++
        }
      }
      $next[$y * $width + $x] = $sum / $count
    }
  }
  $values = $next
}

# Normalize and add a gentle non-linear curve to boost contrast of grain detail.
$min = [double]::PositiveInfinity
$max = [double]::NegativeInfinity
for ($i = 0; $i -lt $values.Length; $i++) {
  if ($values[$i] -lt $min) { $min = $values[$i] }
  if ($values[$i] -gt $max) { $max = $values[$i] }
}
$range = [Math]::Max(0.0001, $max - $min)

$bmp = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
for ($y = 0; $y -lt $height; $y++) {
  for ($x = 0; $x -lt $width; $x++) {
    $idx = $y * $width + $x
    $n = (($values[$idx] - $min) / $range) # 0..1
    $c = [Math]::Pow($n, 1.6)              # contrast curve

    # Transparent base + black grain alpha only: avoids overall gray tint.
    $alpha = [int][Math]::Round(8 + (96 * $c))
    $alpha = [Math]::Max(0, [Math]::Min(110, $alpha))

    $pixel = [System.Drawing.Color]::FromArgb($alpha, 0, 0, 0)
    $bmp.SetPixel($x, $y, $pixel)
  }
}

$outPath = "src/assets/paper-grain.png"
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "Regenerated $outPath"
