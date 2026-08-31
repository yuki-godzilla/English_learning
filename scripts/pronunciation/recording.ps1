[CmdletBinding()]
param(
    [ValidateSet('Status', 'Start', 'Collect', 'Analyze')]
    [string]$Action = 'Status',

    [string]$StatePath,

    [string]$AudioPath,

    [string]$ExpectedFile,

    [string]$ExpectedText,

    [ValidateSet('read_aloud', 'spontaneous')]
    [string]$TaskKind = 'read_aloud',

    [ValidateSet('tiny.en', 'base.en', 'small.en')]
    [string]$Model,

    [switch]$NoLaunch,

    [switch]$ForceManualCapture
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$workRoot = Join-Path $projectRoot 'tmp\pronunciation-recordings'
$inboxRoot = Join-Path $workRoot 'inbox'
$environmentPath = Join-Path $projectRoot 'tmp\pronunciation-environment.json'

if ([string]::IsNullOrWhiteSpace($Model)) {
    if (Test-Path -LiteralPath $environmentPath) {
        $environmentState = Get-Content -Raw -LiteralPath $environmentPath | ConvertFrom-Json
        $Model = [string]$environmentState.model
    }
    if ([string]::IsNullOrWhiteSpace($Model)) {
        $Model = 'small.en'
    }
}

if ([string]::IsNullOrWhiteSpace($StatePath)) {
    $StatePath = Join-Path $workRoot 'recording-state.json'
}

function Get-SoundRecorderPackage {
    if ($null -eq (Get-Command Get-AppxPackage -ErrorAction SilentlyContinue)) {
        return $null
    }
    $package = Get-AppxPackage -Name Microsoft.WindowsSoundRecorder -ErrorAction SilentlyContinue
    return $package
}

function Get-RecordingScanRoots {
    param([string]$PackageFamilyName)

    $roots = [System.Collections.Generic.List[string]]::new()
    if (-not [string]::IsNullOrWhiteSpace($PackageFamilyName)) {
        $packageRoot = Join-Path $env:LOCALAPPDATA "Packages\$PackageFamilyName"
        if (Test-Path -LiteralPath $packageRoot) {
            $roots.Add($packageRoot)
        }
    }

    $documentsRoot = [Environment]::GetFolderPath('MyDocuments')
    foreach ($folderName in @('Sound recordings', 'Sound Recordings')) {
        if (-not [string]::IsNullOrWhiteSpace($documentsRoot)) {
            $candidate = Join-Path $documentsRoot $folderName
            if (Test-Path -LiteralPath $candidate) {
                $roots.Add($candidate)
            }
        }

        if (-not [string]::IsNullOrWhiteSpace($env:OneDrive)) {
            $candidate = Join-Path (Join-Path $env:OneDrive 'Documents') $folderName
            if (Test-Path -LiteralPath $candidate) {
                $roots.Add($candidate)
            }
        }
    }

    New-Item -ItemType Directory -Force -Path $inboxRoot | Out-Null
    $roots.Add($inboxRoot)

    return @($roots | Select-Object -Unique)
}

function Get-AudioCandidates {
    param([Parameter(Mandatory = $true)][string[]]$Roots)

    $audioExtensions = @('.aac', '.flac', '.m4a', '.mp3', '.mp4', '.ogg', '.wav', '.webm', '.wma')
    $items = foreach ($root in $Roots) {
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }

        Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Length -gt 1024 -and
                $audioExtensions -contains $_.Extension.ToLowerInvariant()
            } |
            ForEach-Object {
                [pscustomobject]@{
                    path = $_.FullName
                    length = $_.Length
                    lastWriteUtc = $_.LastWriteTimeUtc.ToString('o')
                    lastWriteTicks = $_.LastWriteTimeUtc.Ticks
                }
            }
    }

    return @($items)
}

function Test-AudioContainerSignature {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    try {
        $buffer = New-Object byte[] 64
        $read = $stream.Read($buffer, 0, $buffer.Length)
    }
    finally {
        $stream.Dispose()
    }

    if ($read -lt 12) {
        return $false
    }

    $extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()
    $ascii = [Text.Encoding]::ASCII
    switch ($extension) {
        '.wav' { return $ascii.GetString($buffer, 0, 4) -eq 'RIFF' -and $ascii.GetString($buffer, 8, 4) -eq 'WAVE' }
        '.m4a' { return $ascii.GetString($buffer, 4, 4) -eq 'ftyp' }
        '.mp4' { return $ascii.GetString($buffer, 4, 4) -eq 'ftyp' }
        '.mp3' { return $ascii.GetString($buffer, 0, 3) -eq 'ID3' -or ($buffer[0] -eq 0xFF -and ($buffer[1] -band 0xE0) -eq 0xE0) }
        '.aac' { return $buffer[0] -eq 0xFF -and ($buffer[1] -band 0xF0) -eq 0xF0 }
        '.flac' { return $ascii.GetString($buffer, 0, 4) -eq 'fLaC' }
        '.ogg' { return $ascii.GetString($buffer, 0, 4) -eq 'OggS' }
        '.webm' { return $buffer[0] -eq 0x1A -and $buffer[1] -eq 0x45 -and $buffer[2] -eq 0xDF -and $buffer[3] -eq 0xA3 }
        '.wma' { return $buffer[0] -eq 0x30 -and $buffer[1] -eq 0x26 -and $buffer[2] -eq 0xB2 -and $buffer[3] -eq 0x75 }
        default { return $false }
    }
}

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)

    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try {
        $bytes = $algorithm.ComputeHash($stream)
    }
    finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
    return -join ($bytes | ForEach-Object { $_.ToString('X2') })
}

function Write-JsonResult {
    param([Parameter(Mandatory = $true)][hashtable]$Value)
    $Value | ConvertTo-Json -Depth 8
}

$package = if ($ForceManualCapture) { $null } else { Get-SoundRecorderPackage }
$packageFamilyName = if ($null -eq $package) { $null } else { $package.PackageFamilyName }
$scanRoots = @(Get-RecordingScanRoots -PackageFamilyName $packageFamilyName)
$venvPython = Join-Path $projectRoot '.venv-pronunciation\Scripts\python.exe'
$modelPath = Join-Path $projectRoot "tmp\pronunciation-models\faster-whisper-$Model"
$manifestPath = Join-Path $workRoot 'latest-recording.json'
$analysisPath = Join-Path $workRoot 'latest-analysis.json'
$analysisMarkdownPath = Join-Path $workRoot 'latest-analysis.md'

if ($Action -eq 'Status') {
    $ffmpegAvailable = $null -ne (Get-Command ffmpeg -ErrorAction SilentlyContinue)
    $whisperAvailable = $null -ne (Get-Command whisper -ErrorAction SilentlyContinue)
    $localModulesReady = $false
    if (Test-Path -LiteralPath $venvPython) {
        & $venvPython -c 'import av, faster_whisper, parselmouth' 2>$null
        $localModulesReady = $LASTEXITCODE -eq 0
    }
    $localModelReady = Test-Path -LiteralPath (Join-Path $modelPath 'model.bin')
    $analysisProfile = if ($localModulesReady -and $localModelReady) {
        'local_enhanced_ready'
    }
    elseif ($localModulesReady) {
        'local_modules_ready_model_missing'
    }
    else {
        'capture_only'
    }
    Write-JsonResult -Value @{
        status = if ($null -eq $package) { 'manual_capture_ready' } else { 'capture_ready' }
        captureBackend = if ($null -eq $package) { 'manual_audio_file' } else { 'Windows Sound Recorder' }
        packageFamily = $packageFamilyName
        version = if ($null -eq $package) { $null } else { $package.Version.ToString() }
        workRoot = $workRoot
        manualInbox = $inboxRoot
        scanRootCount = $scanRoots.Count
        localFfmpegDetected = $ffmpegAvailable
        localWhisperDetected = $whisperAvailable
        bundledMediaDecoder = if ($localModulesReady) { 'PyAV' } else { $null }
        systemFfmpegRequired = $false
        localModel = $Model
        localModelReady = $localModelReady
        localSpeechRecognitionBackend = if ($localModulesReady) { 'faster-whisper' } else { $null }
        analysisProfile = $analysisProfile
        analysisReadiness = if ($analysisProfile -eq 'local_enhanced_ready') {
            'Local waveform, pitch, pause, timing, and ASR-based intelligibility evidence are available.'
        }
        else {
            'Run npm run pronunciation:setup. Until then, record Pronunciation as N/A.'
        }
    }
    exit 0
}

if ($Action -eq 'Analyze') {
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "Collected recording manifest was not found: $manifestPath. Run Action=Collect first."
    }
    if (-not (Test-Path -LiteralPath $venvPython)) {
        throw 'The local pronunciation environment is not ready. Run npm run pronunciation:setup first.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $modelPath 'model.bin'))) {
        throw "The local speech model is not ready: $modelPath. Run npm run pronunciation:setup first."
    }

    $analyzer = Join-Path $PSScriptRoot 'analyze.py'
    $arguments = @(
        $analyzer,
        '--manifest', $manifestPath,
        '--model-dir', $modelPath,
        '--task-kind', $TaskKind,
        '--output', $analysisPath,
        '--markdown-output', $analysisMarkdownPath
    )
    if (-not [string]::IsNullOrWhiteSpace($ExpectedText)) {
        $arguments += @('--expected-text', $ExpectedText)
    }
    else {
        if ([string]::IsNullOrWhiteSpace($ExpectedFile) -and $TaskKind -eq 'read_aloud') {
            $ExpectedFile = Join-Path $projectRoot 'learning-records\resources\pronunciation-benchmark.md'
        }
        if (-not [string]::IsNullOrWhiteSpace($ExpectedFile)) {
            $arguments += @('--expected-file', $ExpectedFile)
        }
    }

    & $venvPython @arguments
    exit $LASTEXITCODE
}

if ($Action -eq 'Start') {
    New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
    $snapshot = Get-AudioCandidates -Roots $scanRoots
    $state = [ordered]@{
        schemaVersion = 1
        startedAtUtc = [DateTime]::UtcNow.ToString('o')
        packageFamily = $packageFamilyName
        scanRoots = $scanRoots
        snapshot = $snapshot
    }
    $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StatePath -Encoding UTF8

    if (-not $NoLaunch -and $null -ne $package) {
        $appId = "shell:AppsFolder\$($package.PackageFamilyName)!App"
        Start-Process -FilePath 'explorer.exe' -ArgumentList $appId
    }

    Write-JsonResult -Value @{
        status = if ($null -eq $package) { 'manual_recording_required' } else { 'recording_app_ready' }
        statePath = $StatePath
        manualInbox = $inboxRoot
        instructions = if ($null -eq $package) {
            @(
                'Record with an available local app.',
                "Export or copy the completed audio file into: $inboxRoot",
                'Then tell Chappy that the recording is finished.'
            )
        }
        else {
            @(
                'Press Ctrl+R in Sound Recorder to start.',
                'Press Esc to stop and save.',
                'Then tell Chappy that the recording is finished.'
            )
        }
    }
    exit 0
}

if (-not [string]::IsNullOrWhiteSpace($AudioPath)) {
    if (-not (Test-Path -LiteralPath $AudioPath -PathType Leaf)) {
        throw "The specified audio file was not found: $AudioPath"
    }
    $audioItem = Get-Item -LiteralPath $AudioPath
    $selected = [pscustomobject]@{
        path = $audioItem.FullName
        length = $audioItem.Length
        lastWriteUtc = $audioItem.LastWriteTimeUtc.ToString('o')
        lastWriteTicks = $audioItem.LastWriteTimeUtc.Ticks
    }
}
else {
    if (-not (Test-Path -LiteralPath $StatePath)) {
        throw "Recording state was not found: $StatePath. Run Action=Start first, or provide -AudioPath."
    }

    $state = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
    $startedAtUtc = [DateTime]::Parse(
        [string]$state.startedAtUtc,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
    )
    $beforeByPath = @{}
    foreach ($entry in @($state.snapshot)) {
        if ($null -eq $entry) {
            continue
        }
        $beforeByPath[[string]$entry.path] = $entry
    }

    $current = Get-AudioCandidates -Roots @($state.scanRoots)
    $newOrChanged = foreach ($entry in $current) {
        $entryWriteTime = [DateTime]::Parse(
            [string]$entry.lastWriteUtc,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::RoundtripKind
        )
        if ($entryWriteTime -lt $startedAtUtc.AddSeconds(-5)) {
            continue
        }

        $before = $beforeByPath[[string]$entry.path]
        if ($null -eq $before -or
            [long]$before.length -ne [long]$entry.length -or
            [long]$before.lastWriteTicks -ne [long]$entry.lastWriteTicks) {
            $entry
        }
    }

    $selected = $newOrChanged |
        Sort-Object -Property @{ Expression = 'lastWriteTicks'; Descending = $true }, @{ Expression = 'length'; Descending = $true } |
        Select-Object -First 1
}

if ($null -eq $selected) {
    throw "No new Sound Recorder audio file was found. If the app keeps the file internal, export or copy it into: $inboxRoot, then run Action=Collect again."
}

if (-not (Test-AudioContainerSignature -Path ([string]$selected.path))) {
    throw "The newest candidate does not have a recognized audio container signature: $($selected.path)"
}

$extension = [IO.Path]::GetExtension([string]$selected.path).ToLowerInvariant()
$captureName = '{0}-pronunciation{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $extension
$capturePath = Join-Path $workRoot $captureName
Copy-Item -LiteralPath ([string]$selected.path) -Destination $capturePath

$captured = Get-Item -LiteralPath $capturePath
$sha256 = Get-Sha256Hex -Path $capturePath
$manifest = [ordered]@{
    schemaVersion = 2
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    capturedPath = $captured.FullName
    sourcePath = [string]$selected.path
    bytes = $captured.Length
    sha256 = $sha256
    containerSignatureVerified = $true
    directAudioReviewRequired = $true
    nextAction = 'npm run pronunciation:analyze'
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-JsonResult -Value @{
    status = 'recording_collected'
    recording = $manifest
    manifestPath = $manifestPath
    note = 'File capture is verified. Pronunciation scoring still requires direct audio-capable analysis.'
}
