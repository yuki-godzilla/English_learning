import test from 'node:test';
import assert from 'node:assert/strict';
import { speechMode, selectComparisonWindows, buildReportModel, pronunciationBasis } from '../scripts/lib/evidence.mjs';
import { analyzeYukiTurns } from '../scripts/transcripts/analyze.mjs';
import { tableRows } from '../scripts/lib/markdown-table.mjs';
import { validateScoringEvidence } from '../scripts/lib/scoring-contract.mjs';
import { skillTimeline } from '../scripts/charts/skill-timeline.mjs';
const turn = (text, source='voice_asr', index=1) => ({ type:'turn',speaker:'yuki',source,text,index });
test('typed and known read-aloud are never spontaneous, even with an override', () => {
  assert.equal(speechMode(turn('abc','typed'),'spontaneous'),'typed');
  assert.equal(speechMode(turn('abc','read_aloud_asr'),'spontaneous'),'read_aloud');
  assert.equal(analyzeYukiTurns([turn('abc','typed'),turn('abc','read_aloud_asr',2)]).spontaneous_segments,0);
});
test('redaction, repetition, unknown source excluded; counts partition the rest', () => {
  const a = analyzeYukiTurns([turn('[REDACTED_WORK_INFO]'),turn('abc','voice_asr',2),turn('x','other',3)],new Map([[2,'repetition']]));
  assert.equal(a.spontaneous_segments,0); assert.equal(a.speech_mode_counts.repetition,1); assert.equal(a.speech_mode_counts.unclear,1);
});
test('phrases cannot be created across ASR boundaries', () => {
  const a = analyzeYukiTurns([turn('you'),turn('know', 'voice_asr',2)]);
  assert.equal(a.you_know_count,0);
});
test('empty and sparse windows wait instead of overlapping', () => {
  for(let n=0;n<4;n++) assert.equal(selectComparisonWindows(Array.from({length:n},(_,i)=>({session:i+1,coverage_band:'high',spontaneous_segments:20}))).ready,false);
});
test('baseline stays fixed when series grows; rolling comparison remains separate', () => {
  const s=Array.from({length:8},(_,i)=>({session:i+1,coverage_band:'high',spontaneous_segments:20}));
  const w=selectComparisonWindows(s); assert.deepEqual(w.baseline,[1,2]); assert.deepEqual(w.previous,[5,6]); assert.deepEqual(w.recent,[7,8]);
});
test('parser handles escaped pipes and code spans', () => {
  assert.deepEqual(tableRows('| a \\| b | `x|y` | Source |'),[['a | b','`x|y`','Source']]);
});
test('legacy audio is not relabelled as holistic', () => {
  assert.equal(pronunciationBasis({ratings:{Pronunciation:3},pronunciation_evidence:{direct_audio_processed:true}}),'legacy_limited');
});
test('dynamic narrative follows reversal and supports all-NA charts', () => {
  const p={qualitative_metrics:['Pronunciation'],sessions:[{session:1,ratings:{Pronunciation:null}}]};
  const a={comparison:{ready:true,earlier:{repair_per_100_words:1},recent:{repair_per_100_words:3}}};
  assert.match(buildReportModel(p,a).automaticity,/増加/); assert.match(skillTimeline(p),/N\/A/);
  a.comparison.ready=false; assert.match(buildReportModel(p,a).automaticity,/比較不能/);
});
test('new scoring rejects missing references and invalid comparison', () => {
  const s={session:17,ratings:{Grammar:3},metric_evidence:{Grammar:{comparison:'stable',provenance:{rubric_version:'whole-session-v3',task_kind:'spontaneous',support:'independent',preparation_seconds:null,turn_indices:[99],next_observation:'new task'}}}};
  assert.equal(validateScoringEvidence(s,['Grammar'],new Set([1])).length,2);
});
