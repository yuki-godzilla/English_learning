[CmdletBinding()]
param(
    [ValidateSet('tiny.en', 'base.en', 'small.en')]
    [string]$Model = 'small.en',

    [switch]$SkipModelDownload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvRoot = Join-Path $projectRoot '.venv-pronunciation'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'
$requirementsPath = Join-Path $projectRoot 'requirements-pronunciation.lock.txt'
$modelRoot = Join-Path $projectRoot 'tmp\pronunciation-models'
$modelPath = Join-Path $modelRoot "faster-whisper-$Model"
$downloadScript = Join-Path $PSScriptRoot 'download-pronunciation-model.py'
$environmentPath = Join-Path $projectRoot 'tmp\pronunciation-environment.json'

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath"
    }
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($null -ne $pyLauncher) {
        $created = $false
        foreach ($versionSelector in @('-3.12', '-3.11')) {
            & $pyLauncher.Source $versionSelector -c 'import sys' 2>$null
            if ($LASTEXITCODE -eq 0) {
                Invoke-CheckedCommand -FilePath $pyLauncher.Source -Arguments @($versionSelector, '-m', 'venv', $venvRoot)
                $created = $true
                break
            }
        }
        if (-not $created) {
            throw 'Python 3.11 or 3.12 was not found through the Python launcher.'
        }
    }
    else {
        $python = Get-Command python -ErrorAction SilentlyContinue
        if ($null -eq $python) {
            throw 'Python 3.11 or 3.12 is required. Install Python, then run this setup again.'
        }
        Invoke-CheckedCommand -FilePath $python.Source -Arguments @('-m', 'venv', $venvRoot)
    }
}

Invoke-CheckedCommand -FilePath $venvPython -Arguments @(
    '-m', 'pip', 'install', '--disable-pip-version-check', '--requirement', $requirementsPath
)

if (-not $SkipModelDownload) {
    New-Item -ItemType Directory -Force -Path $modelRoot | Out-Null
    Invoke-CheckedCommand -FilePath $venvPython -Arguments @(
        $downloadScript, '--model', $Model, '--output-root', $modelRoot
    )
}

& $venvPython -c 'import av, faster_whisper, parselmouth'
if ($LASTEXITCODE -ne 0) {
    throw 'The local pronunciation modules could not be imported.'
}

$modelReady = Test-Path -LiteralPath (Join-Path $modelPath 'model.bin')
$ffmpegAvailable = $null -ne (Get-Command ffmpeg -ErrorAction SilentlyContinue)
$appxCommand = Get-Command Get-AppxPackage -ErrorAction SilentlyContinue
$soundRecorderAvailable = $false
if ($null -ne $appxCommand) {
    $soundRecorderAvailable = $null -ne (Get-AppxPackage -Name Microsoft.WindowsSoundRecorder -ErrorAction SilentlyContinue)
}

$result = [ordered]@{
    status = if ($modelReady) { 'local_enhanced_ready' } else { 'local_modules_ready_model_missing' }
    python = $venvPython
    model = $Model
    modelPath = $modelPath
    modelReady = $modelReady
    bundledMediaDecoder = 'PyAV'
    systemFfmpegDetected = $ffmpegAvailable
    systemFfmpegRequired = $false
    windowsSoundRecorderDetected = $soundRecorderAvailable
    manualAudioFileFallback = (Join-Path $projectRoot 'tmp\pronunciation-recordings\inbox')
    modules = [ordered]@{
        imports = 'verified'
        requirements = $requirementsPath
    }
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $environmentPath) | Out-Null
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $environmentPath -Encoding UTF8
$result | ConvertTo-Json -Depth 6
