[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$AudioPath,
    [Parameter(Mandatory = $true)][string]$ReferencePath,
    [string]$OutputDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$reviewRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $reviewRoot ('tmp\pronunciation-reviews\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
}
& (Join-Path $reviewRoot '.venv-pronunciation\Scripts\python.exe') (Join-Path $PSScriptRoot 'gopt\review_segmented.py') --audio $AudioPath --reference $ReferencePath --output-dir $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw "Local phoneme review failed with exit code $LASTEXITCODE" }
