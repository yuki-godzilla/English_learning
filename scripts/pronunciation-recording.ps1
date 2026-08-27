[CmdletBinding()]
param(
    [ValidateSet('Status', 'Start', 'Collect')]
    [string]$Action = 'Status',

    [string]$StatePath,

    [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$workRoot = Join-Path $projectRoot 'tmp\pronunciation-recordings'
$inboxRoot = Join-Path $workRoot 'inbox'

if ([string]::IsNullOrWhiteSpace($StatePath)) {
    $StatePath = Join-Path $workRoot 'recording-state.json'
}

function Get-SoundRecorderPackage {
    $package = Get-AppxPackage -Name Microsoft.WindowsSoundRecorder -ErrorAction SilentlyContinue
    if ($null -eq $package) {
        throw 'Windows Sound Recorder is not installed.'
    }
    return $package
}

function Get-RecordingScanRoots {
    param([Parameter(Mandatory = $true)][string]$PackageFamilyName)

    $roots = [System.Collections.Generic.List[string]]::new()
    $packageRoot = Join-Path $env:LOCALAPPDATA "Packages\$PackageFamilyName"
    if (Test-Path -LiteralPath $packageRoot) {
        $roots.Add($packageRoot)
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

$package = Get-SoundRecorderPackage
$scanRoots = Get-RecordingScanRoots -PackageFamilyName $package.PackageFamilyName

if ($Action -eq 'Status') {
    $ffmpegAvailable = $null -ne (Get-Command ffmpeg -ErrorAction SilentlyContinue)
    $whisperAvailable = $null -ne (Get-Command whisper -ErrorAction SilentlyContinue)
    Write-JsonResult -Value @{
        status = 'capture_ready'
        app = 'Windows Sound Recorder'
        packageFamily = $package.PackageFamilyName
        version = $package.Version.ToString()
        workRoot = $workRoot
        scanRootCount = $scanRoots.Count
        localFfmpegDetected = $ffmpegAvailable
        localWhisperDetected = $whisperAvailable
        analysisReadiness = 'Chappy must verify a direct audio-capable analysis method separately.'
    }
    exit 0
}

if ($Action -eq 'Start') {
    New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
    $snapshot = Get-AudioCandidates -Roots $scanRoots
    $state = [ordered]@{
        schemaVersion = 1
        startedAtUtc = [DateTime]::UtcNow.ToString('o')
        packageFamily = $package.PackageFamilyName
        scanRoots = $scanRoots
        snapshot = $snapshot
    }
    $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StatePath -Encoding UTF8

    if (-not $NoLaunch) {
        $appId = "shell:AppsFolder\$($package.PackageFamilyName)!App"
        Start-Process -FilePath 'explorer.exe' -ArgumentList $appId
    }

    Write-JsonResult -Value @{
        status = 'recording_app_ready'
        statePath = $StatePath
        instructions = @(
            'Press Ctrl+R in Sound Recorder to start.',
            'Press Esc to stop and save.',
            'Then tell Chappy that the recording is finished.'
        )
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $StatePath)) {
    throw "Recording state was not found: $StatePath. Run Action=Start first."
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
$manifestPath = Join-Path $workRoot 'latest-recording.json'
$manifest = [ordered]@{
    schemaVersion = 1
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    capturedPath = $captured.FullName
    sourcePath = [string]$selected.path
    bytes = $captured.Length
    sha256 = $sha256
    containerSignatureVerified = $true
    directAudioReviewRequired = $true
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-JsonResult -Value @{
    status = 'recording_collected'
    recording = $manifest
    manifestPath = $manifestPath
    note = 'File capture is verified. Pronunciation scoring still requires direct audio-capable analysis.'
}
