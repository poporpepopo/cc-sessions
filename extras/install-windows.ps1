# Windows setup for cc-sessions (the Windows counterpart of the "ln -s" steps in README).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File extras\install-windows.ps1
#
# Puts three files under your home folder. No registry, no PATH change, no admin rights:
#   ~\.local\bin\ccs.cmd              ccs for PowerShell / cmd.exe
#   ~\.local\bin\ccs                  ccs for Git Bash (the "!" line of /sessions runs it)
#   ~\.claude\commands\sessions.md    the /sessions command (a copy: copy it again after git pull)
# The two wrappers hold the path of this repository: run this script again if you move it.
param(
  [string]$BinDir = (Join-Path $env:USERPROFILE '.local\bin'),
  [string]$CommandsDir = (Join-Path $env:USERPROFILE '.claude\commands')
)
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path $BinDir, $CommandsDir | Out-Null

# cmd.exe reads a .cmd in the OEM code page (932 on a Japanese system)
$oem = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
$cmd = "@call `"$repo\bin\ccs.cmd`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $BinDir 'ccs.cmd'), $cmd, $oem)

# sh script: LF only, UTF-8 without BOM. Arguments are passed as they are (no /path conversion).
$script = ($repo -replace '\\', '/') + '/bin/ccs'
$quoted = "'" + ($script -replace "'", "'\''") + "'"
$sh = @(
  '#!/bin/sh'
  '# ccs for Git Bash on Windows. Written by cc-sessions/extras/install-windows.ps1'
  'export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"'
  "if command -v py >/dev/null 2>&1; then exec py -3 $quoted `"`$@`"; fi"
  "exec python $quoted `"`$@`""
  ''
) -join "`n"
[IO.File]::WriteAllText((Join-Path $BinDir 'ccs'), $sh, (New-Object Text.UTF8Encoding $false))

Copy-Item -Force (Join-Path $repo 'extras\sessions.md') (Join-Path $CommandsDir 'sessions.md')

Write-Host "ccs.cmd, ccs -> $BinDir"
Write-Host "sessions.md  -> $CommandsDir"
if (($env:Path -split ';' | ForEach-Object { $_.TrimEnd('\') }) -notcontains $BinDir.TrimEnd('\')) {
  Write-Host "Note: $BinDir is not in PATH. Add it to type just 'ccs' in a terminal (/sessions works without it)."
}
Write-Host "Next: add the folder below to CLAUDE_CODE_PLUGIN_DIRS in ~\.claude\settings.json (see README)."
Write-Host "  $repo"
