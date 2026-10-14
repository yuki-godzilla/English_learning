function Get-OptionalRecordingProperty {
    param([object]$Value, [string]$Name)
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Collections.IDictionary]) {
        if ($Value.Contains($Name)) { return $Value[$Name] }
        return $null
    }
    $property = $Value.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
    return $null
}

function Resolve-RecordingAnalysisConditions {
    param(
        [object]$Capture,
        [System.Collections.IDictionary]$BoundParameters,
        [string]$TaskKind = 'read_aloud',
        [string]$ExpectedFile,
        [string]$ExpectedText,
        [string]$PromptId,
        [string]$BenchmarkPath
    )
    $conditions = Get-OptionalRecordingProperty -Value $Capture -Name 'conditions'
    if (-not $BoundParameters.ContainsKey('TaskKind')) {
        $savedTask = [string](Get-OptionalRecordingProperty -Value $conditions -Name 'taskKind')
        if (-not [string]::IsNullOrWhiteSpace($savedTask)) { $TaskKind = $savedTask }
    }
    if ($TaskKind -notin @('read_aloud', 'spontaneous')) { throw "Unknown recording taskKind: $TaskKind" }
    if (-not $BoundParameters.ContainsKey('PromptId')) {
        $PromptId = [string](Get-OptionalRecordingProperty -Value $conditions -Name 'promptId')
    }
    if ([string]::IsNullOrWhiteSpace($PromptId)) { $PromptId = 'unknown-reference' }

    # Reference overrides form one choice. An explicit file must not inherit a
    # saved text, and an explicitly cleared reference must not revive old data.
    $explicitReference = $BoundParameters.ContainsKey('ExpectedText') -or $BoundParameters.ContainsKey('ExpectedFile')
    if ($explicitReference) {
        if (-not $BoundParameters.ContainsKey('ExpectedText')) { $ExpectedText = $null }
        if (-not $BoundParameters.ContainsKey('ExpectedFile')) { $ExpectedFile = $null }
    }
    else {
        $ExpectedText = [string](Get-OptionalRecordingProperty -Value $conditions -Name 'expectedText')
        $ExpectedFile = [string](Get-OptionalRecordingProperty -Value $conditions -Name 'expectedFile')
    }
    $referenceOrigin = if ($explicitReference) { 'explicit_reference' } else { 'saved_reference' }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedText)) { $ExpectedFile = $null }
    elseif (-not [string]::IsNullOrWhiteSpace($ExpectedFile)) { $ExpectedText = $null }
    elseif (-not $explicitReference -and $TaskKind -eq 'read_aloud' -and $PromptId -eq 'pronunciation-benchmark-v1') {
        $ExpectedFile = $BenchmarkPath
        $referenceOrigin = 'identified_benchmark'
    }
    else { $referenceOrigin = 'no_preserved_reference' }
    $hasReference = -not [string]::IsNullOrWhiteSpace($ExpectedText) -or -not [string]::IsNullOrWhiteSpace($ExpectedFile)
    return [pscustomobject]@{
        taskKind = $TaskKind
        expectedText = $ExpectedText
        expectedFile = $ExpectedFile
        promptId = $PromptId
        referenceOrigin = $referenceOrigin
        runPhonemeReview = ($TaskKind -eq 'read_aloud' -and $hasReference)
    }
}

function Invoke-RecordingAnalysisStep {
    param([Parameter(Mandatory = $true)][scriptblock]$Step)
    # Native failure codes remain available even when a wrapper throws. Clear a
    # previous step's code before invoking a new one, then propagate failure.
    $global:LASTEXITCODE = 0
    try { & $Step }
    catch {
        if ($global:LASTEXITCODE -ne 0) { exit $global:LASTEXITCODE }
        throw
    }
    if ($global:LASTEXITCODE -ne 0) { exit $global:LASTEXITCODE }
}
