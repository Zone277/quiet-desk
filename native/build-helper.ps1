param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'bin'))
$ErrorActionPreference = 'Stop'
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw '.NET Framework 4.x x64 compiler is required to build the desktop helper' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$helperPath = Join-Path $OutputDirectory 'windows_desktop_host.exe'
& $compilerPath /nologo /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll "/out:$helperPath" (Join-Path $PSScriptRoot 'windows_desktop_host.cs')
if ($LASTEXITCODE -ne 0) { throw "Desktop helper compilation failed: $LASTEXITCODE" }
Write-Output "QUIETDESK_HELPER_BUILT $helperPath"
