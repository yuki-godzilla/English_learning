[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$goptProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$goptPython = Join-Path $goptProjectRoot '.venv-pronunciation\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $goptPython)) {
    throw 'Run pronunciation:setup first to create the existing local Python environment.'
}
& $goptPython (Join-Path $PSScriptRoot 'gopt\setup.py')
if ($LASTEXITCODE -ne 0) { throw "GOPT setup failed with exit code $LASTEXITCODE" }
