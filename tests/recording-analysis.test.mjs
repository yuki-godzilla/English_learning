import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const windowsOnly = { skip: process.platform !== 'win32' };
function powershell(script) {
  return spawnSync('powershell', ['-NoProfile', '-Command', `Set-StrictMode -Version Latest; $ErrorActionPreference='Stop'; . ./scripts/pronunciation/analysis-routing.ps1; ${script}`],
    { encoding: 'utf8', windowsHide: true });
}

test('Analyze restores optional conditions safely and explicit references override the saved reference as one choice', windowsOnly, () => {
  const result = powershell(`
    function Resolve-Fixture {
      [CmdletBinding()] param([object]$Capture,[string]$ExpectedFile,[string]$ExpectedText,[string]$PromptId,[string]$TaskKind='read_aloud')
      Resolve-RecordingAnalysisConditions -Capture $Capture -BoundParameters $PSBoundParameters -ExpectedFile $ExpectedFile -ExpectedText $ExpectedText -PromptId $PromptId -TaskKind $TaskKind -BenchmarkPath 'benchmark.md'
    }
    $saved = [pscustomobject]@{conditions=[pscustomobject]@{taskKind='read_aloud';expectedFile='old.md';expectedText='old text';promptId='old-task'}}
    @(
      (Resolve-Fixture -Capture ([pscustomobject]@{})),
      (Resolve-Fixture -Capture ([pscustomobject]@{conditions=$null})),
      (Resolve-Fixture -Capture ([pscustomobject]@{conditions=[pscustomobject]@{}})),
      (Resolve-Fixture -Capture ([pscustomobject]@{conditions=[pscustomobject]@{expectedFile='saved.md'}})),
      (Resolve-Fixture -Capture $saved -ExpectedFile 'new.md'),
      (Resolve-Fixture -Capture $saved -ExpectedText 'new text'),
      (Resolve-Fixture -Capture $saved -ExpectedFile 'new.md' -ExpectedText 'new text'),
      (Resolve-Fixture -Capture $saved)
    ) | ConvertTo-Json -Depth 6
  `);
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  for (const row of rows.slice(0, 3)) {
    assert.equal(row.runPhonemeReview, false);
    assert.equal(row.promptId, 'unknown-reference');
    assert.equal(row.referenceOrigin, 'no_preserved_reference');
  }
  assert.equal(rows[3].expectedFile, 'saved.md'); assert.equal(rows[3].runPhonemeReview, true);
  assert.equal(rows[4].expectedFile, 'new.md'); assert.equal(rows[4].expectedText, '');
  assert.equal(rows[5].expectedText, 'new text'); assert.equal(rows[5].expectedFile, '');
  assert.equal(rows[6].expectedText, 'new text'); assert.equal(rows[6].expectedFile, '');
  assert.equal(rows[7].expectedText, 'old text'); assert.equal(rows[7].expectedFile, '');
});

test('unknown recordings never receive the benchmark; spontaneous and deliberately cleared references stay quality-only', windowsOnly, () => {
  const result = powershell(`
    @(
      (Resolve-RecordingAnalysisConditions -Capture ([pscustomobject]@{conditions=[pscustomobject]@{promptId='unknown-reference'}}) -BoundParameters @{} -BenchmarkPath 'benchmark.md'),
      (Resolve-RecordingAnalysisConditions -Capture ([pscustomobject]@{}) -BoundParameters @{PromptId='pronunciation-benchmark-v1'} -PromptId 'pronunciation-benchmark-v1' -BenchmarkPath 'benchmark.md'),
      (Resolve-RecordingAnalysisConditions -Capture ([pscustomobject]@{conditions=[pscustomobject]@{promptId='pronunciation-benchmark-v1'}}) -BoundParameters @{} -BenchmarkPath 'benchmark.md'),
      (Resolve-RecordingAnalysisConditions -Capture ([pscustomobject]@{conditions=[pscustomobject]@{promptId='pronunciation-benchmark-v1';expectedText='old'}}) -BoundParameters @{ExpectedFile=''} -ExpectedFile '' -BenchmarkPath 'benchmark.md'),
      (Resolve-RecordingAnalysisConditions -Capture ([pscustomobject]@{conditions=[pscustomobject]@{taskKind='spontaneous';expectedText='question prompt'}}) -BoundParameters @{} -BenchmarkPath 'benchmark.md'),
      (Resolve-RecordingAnalysisConditions -Capture ([pscustomobject]@{conditions=[pscustomobject]@{taskKind='spontaneous';expectedFile='saved.md'}}) -BoundParameters @{TaskKind='read_aloud'} -TaskKind 'read_aloud' -BenchmarkPath 'benchmark.md')
    ) | ConvertTo-Json -Depth 6
  `);
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  assert.equal(rows[0].runPhonemeReview, false); assert.equal(rows[0].expectedFile, '');
  for (const row of rows.slice(1, 3)) {
    assert.equal(row.runPhonemeReview, true); assert.equal(row.expectedFile, 'benchmark.md');
    assert.equal(row.referenceOrigin, 'identified_benchmark');
  }
  assert.equal(rows[3].runPhonemeReview, false);
  assert.equal(rows[4].runPhonemeReview, false); assert.equal(rows[4].taskKind, 'spontaneous');
  assert.equal(rows[5].runPhonemeReview, true); assert.equal(rows[5].taskKind, 'read_aloud');
});

test('native analysis failures propagate their exit code, including a wrapper that throws', windowsOnly, () => {
  for (const [code, wrapperThrows] of [[7, false], [9, true]]) {
    const result = powershell(`Invoke-RecordingAnalysisStep -Step { & powershell -NoProfile -Command 'exit ${code}'; ${wrapperThrows ? "throw 'wrapper failure'" : ''} }; Write-Output 'must not continue'`);
    assert.equal(result.status, code, result.stderr);
    assert.doesNotMatch(result.stdout, /must not continue/);
  }
  const success = powershell("$global:LASTEXITCODE=19; Invoke-RecordingAnalysisStep -Step { Write-Output 'completed' }; exit 0");
  assert.equal(success.status, 0, success.stderr); assert.match(success.stdout, /completed/);
});
