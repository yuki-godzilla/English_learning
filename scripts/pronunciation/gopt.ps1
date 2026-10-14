[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$AudioPath,
    [Parameter(Mandatory = $true)][string]$ReferencePath,
    [string]$OutputDirectory,
    [ValidateRange(1, 50)][int]$PhoneLimit = 50,
    [ValidateSet(0, 1)][int]$MfccDither = 1,
    [switch]$CompareChunking
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$goptProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$goptPython = Join-Path $goptProjectRoot '.venv-pronunciation\Scripts\python.exe'
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $goptProjectRoot ('tmp\pronunciation-comparison\gopt-runs\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$goptArguments = @((Join-Path $PSScriptRoot 'gopt\run.py'), '--audio', $AudioPath,
    '--reference', $ReferencePath, '--output-dir', $OutputDirectory, '--phone-limit', "$PhoneLimit", '--mfcc-dither', "$MfccDither")
if ($CompareChunking) { $goptArguments += '--compare-chunking' }
& $goptPython @goptArguments
if ($LASTEXITCODE -ne 0) { throw "Local GOPT evaluation failed with exit code $LASTEXITCODE" }
