function Select-RecordingCandidate {
    param([object[]]$Candidates)
    $items = @($Candidates | Where-Object { $null -ne $_ })
    if ($items.Count -gt 1) { return @{ status = 'ambiguous_recordings'; candidates = $items; selected = $null } }
    if ($items.Count -eq 0) { return @{ status = 'not_found'; candidates = @(); selected = $null } }
    return @{ status = 'selected'; candidates = $items; selected = $items[0] }
}
