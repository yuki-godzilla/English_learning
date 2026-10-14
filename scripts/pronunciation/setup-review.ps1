[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'setup-gopt.ps1')
$reviewRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
& (Join-Path $reviewRoot '.venv-pronunciation\Scripts\python.exe') (Join-Path $PSScriptRoot 'gopt\setup_ctc.py')
if ($LASTEXITCODE -ne 0) { throw 'Local secondary phoneme setup failed.' }
