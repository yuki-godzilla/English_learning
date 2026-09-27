import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('recorder rejects ambiguity instead of selecting the newest file', {skip:process.platform!=='win32'},()=>{
  const result=execFileSync('powershell',['-NoProfile','-Command',". ./scripts/pronunciation/candidate-selection.ps1; @((Select-RecordingCandidate @()).status, (Select-RecordingCandidate @(@{path='one'})).status, (Select-RecordingCandidate @(@{path='one'},@{path='two'})).status) | ConvertTo-Json"],{encoding:'utf8',windowsHide:true});
  assert.deepEqual(JSON.parse(result),['not_found','selected','ambiguous_recordings']);
});
