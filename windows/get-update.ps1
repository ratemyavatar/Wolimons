# ===========================================================================
#  Wolimons - get update.bat
#
#  Downloads the newest update.bat (and setup.bat if you ask for it) straight
#  into the folder this script is sitting in. That is normally the "windows"
#  folder inside the site, e.g.
#
#      C:\Users\Administrator\Documents\wolimons\windows
#
#  You do not have to type that path anywhere. The script works out where it
#  is and puts the file next to itself.
#
#  Use it when you only want the one file and not the whole repo again.
#
#  How to run it, in PowerShell:
#
#      cd C:\Users\Administrator\Documents\wolimons\windows
#      powershell -ExecutionPolicy Bypass -File .\get-update.ps1
#
#  Options:
#      -All              also refresh setup.bat
#      -Branch <name>    take it from a different branch
#      -To <folder>      put it somewhere else instead of next to this script
#
#  Administrator is not needed.
# ===========================================================================

[CmdletBinding()]
param(
  [string] $Branch = 'arena/01a013ce-wolimons',
  [string] $To     = '',
  [switch] $All
)

$ErrorActionPreference = 'Stop'

$repo  = 'ratemyavatar/Wolimons'
$files = @('update.bat')
if ($All) { $files += 'setup.bat' }

# --- where does it go -------------------------------------------------------
# $PSScriptRoot is the folder this file is in. If the script was pasted into
# the window rather than run from a file there is no such folder, so fall back
# to wherever the prompt currently is.
if ($To) {
  $dest = $To
} elseif ($PSScriptRoot) {
  $dest = $PSScriptRoot
} else {
  $dest = (Get-Location).Path
}

try {
  $dest = (Resolve-Path -LiteralPath $dest -ErrorAction Stop).Path
} catch {
  throw "That folder does not exist: $dest"
}

Write-Host ''
Write-Host 'Wolimons - get update.bat'
Write-Host '========================='
Write-Host ''
Write-Host "Branch : $Branch"
Write-Host "Folder : $dest"
Write-Host ''

# Old Windows boxes still default to TLS 1.0 and github will not talk to them.
try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

$cr = [string][char]13
$lf = [string][char]10
$ok = $true

foreach ($name in $files) {

  # The branch name has a slash in it. That is fine in the URL, it is part of
  # the path, but it must not be escaped.
  $url  = "https://raw.githubusercontent.com/$repo/$Branch/windows/$name"
  $path = Join-Path $dest $name

  Write-Host "$name" -NoNewline
  Write-Host ' ... ' -NoNewline

  # --- download -------------------------------------------------------------
  try {
    $text = (Invoke-WebRequest -Uri $url -UseBasicParsing).Content
  } catch {
    Write-Host 'FAILED'
    Write-Host "  Could not download it: $($_.Exception.Message)"
    Write-Host "  $url"
    $ok = $false
    continue
  }

  # A missing file on raw github is a 404 page, not an error, on some setups.
  if (-not $text -or $text.Length -lt 500) {
    Write-Host 'FAILED'
    Write-Host '  What came back is too small to be the real file.'
    $ok = $false
    continue
  }
  if ($text -notmatch '^@echo off') {
    Write-Host 'FAILED'
    Write-Host '  What came back is not a batch file. Check the branch name.'
    $ok = $false
    continue
  }

  # --- line endings ---------------------------------------------------------
  # Raw github hands out Unix line endings and cmd.exe mis-reads those, so put
  # the carriage returns back before it touches the disk.
  $text = $text.Replace($cr, '').Replace($lf, $cr + $lf)

  # --- keep the old one -----------------------------------------------------
  if (Test-Path -LiteralPath $path) {
    $stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
    $bak   = "$path.$stamp.bak"
    Copy-Item -LiteralPath $path -Destination $bak -Force
  } else {
    $bak = ''
  }

  # WriteAllText, not Out-File, because Out-File adds its own line endings and
  # can put a byte order mark at the front that cmd.exe chokes on.
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))

  # --- check it actually landed properly ------------------------------------
  $b   = [IO.File]::ReadAllBytes($path)
  $bad = 0
  for ($i = 0; $i -lt $b.Length; $i++) {
    if ($b[$i] -eq 10 -and ($i -eq 0 -or $b[$i - 1] -ne 13)) { $bad++ }
  }
  $bom = ($b.Length -ge 3 -and $b[0] -eq 239 -and $b[1] -eq 187 -and $b[2] -eq 191)

  if ($bad -gt 0 -or $bom) {
    Write-Host 'BROKEN'
    if ($bad) { Write-Host "  $bad lines came out wrong. Run this again." }
    if ($bom) { Write-Host '  There is a byte order mark on the front. Run this again.' }
    if ($bak) {
      Copy-Item -LiteralPath $bak -Destination $path -Force
      Write-Host '  Your old copy has been put back.'
    }
    $ok = $false
    continue
  }

  $kb = [math]::Round($b.Length / 1kb, 1)
  Write-Host "OK  ($kb KB)"
  if ($bak) { Write-Host "     old copy kept as $(Split-Path $bak -Leaf)" }
}

Write-Host ''
if ($ok) {
  Write-Host 'Done. Double-click update.bat to update the site.'
  Write-Host 'You do not need to run it as administrator.'
} else {
  Write-Host 'Something did not work. Nothing important was changed.'
}
Write-Host ''

if (-not $ok) { exit 1 }
