param(
  [ValidateSet('Start', 'Snapshot')][string]$Action = 'Start',
  [string]$RunDirectory
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$portable = Join-Path $workspace 'release/QuietDesk 0.1.0.exe'
$runRoot = Join-Path $workspace 'test-results/stage8'
$source = Join-Path $workspace 'tests/platform/stage8-desktop-diagnostic.cs'
$diagnostic = Join-Path $runRoot 'stage8-desktop-diagnostic.exe'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $portable -PathType Leaf)) { throw "Portable missing: $portable" }
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw "C# compiler missing: $compiler" }
New-Item -ItemType Directory -Force -Path $runRoot | Out-Null

function Invoke-ScopedSnapshot([string]$directory) {
  $resolvedRoot = (Resolve-Path -LiteralPath $runRoot).Path.TrimEnd('\') + '\'
  $resolvedDirectory = (Resolve-Path -LiteralPath $directory).Path
  if (-not $resolvedDirectory.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'RunDirectory must be inside the ignored test-results/stage8 directory.'
  }

  & $compiler /nologo /target:exe /platform:x64 /r:System.Web.Extensions.dll ('/out:' + $diagnostic) $source
  if ($LASTEXITCODE -ne 0) { throw "Diagnostic compile failed: exit $LASTEXITCODE" }
  $raw = & $diagnostic
  if ($LASTEXITCODE -ne 0) { throw "Diagnostic failed: exit $LASTEXITCODE" }
  $scoped = $raw | ConvertFrom-Json -AsHashtable

  $nativeChecks = @()
  $nativeHosts = @($scoped.quietDeskWindows | Where-Object { $_.parentClass -in @('WorkerW', 'Progman') })
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'QuietDesk.exe'")
  foreach ($window in $nativeHosts) {
    $owner = $processes | Where-Object { $_.ProcessId -eq $window.pid } | Select-Object -First 1
    $helper = if ($owner -and $owner.ExecutablePath) {
      Join-Path (Split-Path -Parent $owner.ExecutablePath) 'resources/native/windows_desktop_host.exe'
    } else { $null }
    if ($helper -and (Test-Path -LiteralPath $helper -PathType Leaf)) {
      $decimalHwnd = [Convert]::ToInt64($window.hwnd.Substring(2), 16)
      $inspectRaw = & $helper inspect $decimalHwnd
      $nativeChecks += @{ hwnd = $window.hwnd; helperSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $helper).Hash;
        inspectExitCode = $LASTEXITCODE; inspect = ($inspectRaw | ConvertFrom-Json -AsHashtable) }
    } else {
      $nativeChecks += @{ hwnd = $window.hwnd; status = 'NOT_RUN'; reason = 'Running packaged helper path unavailable' }
    }
  }

  $snapshot = [ordered]@{
    capturedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    windowsBuild = (Get-CimInstance Win32_OperatingSystem).BuildNumber
    portableSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $portable).Hash
    diagnostic = $scoped
    nativeInspect = $nativeChecks
    interpretation = 'Handle, parent, style and visibility diagnostics only; Win+D and occlusion require direct observation.'
  }
  $path = Join-Path $resolvedDirectory ('snapshot-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json')
  $snapshot | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $path -Encoding utf8
  Write-Output "SNAPSHOT $path"
  Write-Output "QuietDeskProcesses=$(@($scoped.quietDesk).Count) NativeParentCandidates=$($nativeHosts.Count)"
}

if ($Action -eq 'Snapshot') {
  if (-not $RunDirectory) { throw 'Snapshot requires -RunDirectory from the earlier Start output.' }
  Invoke-ScopedSnapshot $RunDirectory
  return
}

if ($RunDirectory) { throw 'Start creates a fresh run directory; do not provide -RunDirectory.' }
$existing = @(Get-CimInstance Win32_Process -Filter "Name = 'QuietDesk.exe'")
if ($existing.Count -gt 0) { throw 'A QuietDesk.exe process is already running. Close it normally first; this script will not terminate it.' }
$devProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'electron.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($workspace) -and $_.CommandLine -match 'electron-vite|vite' })
if ($devProcesses.Count -gt 0) { throw 'A QuietDesk development server/process is running. Stop it normally before this desktop test.' }

$runId = 'manual-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$directory = Join-Path $runRoot $runId
$data = Join-Path $directory 'userData'
New-Item -ItemType Directory -Path $data -Force | Out-Null
$context = [ordered]@{
  createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  workspaceHead = (& git -C $workspace rev-parse HEAD).Trim()
  sourceToBinaryCommitBinding = 'UNVERIFIED: portable contains no embedded Git SHA'
  portable = $portable
  portableSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $portable).Hash
  portableFileVersion = (Get-Item -LiteralPath $portable).VersionInfo.FileVersion
  userData = $data
  database = (Join-Path $data 'data/quietdesk.sqlite3')
  normalMode = 'QUIETDESK_FORCE_FALLBACK unset'
}
$context | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $directory 'context.json') -Encoding utf8

# Scope all overrides to this launcher process; the portable child inherits them.
$names = @('QUIETDESK_TEST_USER_DATA', 'QUIETDESK_FORCE_FALLBACK', 'QUIETDESK_SHOW_ALL_WINDOWS',
  'ELECTRON_RENDERER_URL', 'QUIETDESK_STORAGE_SMOKE_MODE', 'QUIETDESK_TEST_NOW',
  'QUIETDESK_TEST_FAIL_NEXT_CAPTURE_SUBMIT')
$old = @{}
foreach ($name in $names) { $old[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
  [Environment]::SetEnvironmentVariable('QUIETDESK_TEST_USER_DATA', $data, 'Process')
  foreach ($name in $names | Where-Object { $_ -ne 'QUIETDESK_TEST_USER_DATA' }) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
  # The application is explicitly meant to be visible and controlled by the user.
  $launcher = Start-Process -FilePath $portable -PassThru
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $old[$name], 'Process') }
}
Write-Output "RUN_DIRECTORY $directory"
Write-Output "ISOLATED_USER_DATA $data"
Write-Output "PORTABLE_LAUNCHER_PID $($launcher.Id)"
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $ready = @(Get-CimInstance Win32_Process -Filter "Name = 'QuietDesk.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($data) }).Count -gt 0
  if ($ready) { break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { Write-Warning 'Packaged child did not become visible within 20 seconds; inspect the run directory and launch state.' }
if ($ready) { Start-Sleep -Seconds 2 }
Invoke-ScopedSnapshot $directory
