import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, recordsRoot } from '../scripts/lib/project.mjs';
import { speechMode, selectComparisonWindows, buildReportModel, pronunciationBasis } from '../scripts/lib/evidence.mjs';
import { analyzeYukiTurns } from '../scripts/transcripts/analyze.mjs';
import { tableRows } from '../scripts/lib/markdown-table.mjs';
import { validateScoringEvidence, validateRecentChangeReview, validateConversationQuality } from '../scripts/lib/scoring-contract.mjs';
import { skillTimeline, timelineLabelIndices } from '../scripts/charts/skill-timeline.mjs';
const turn = (text, source='voice_asr', index=1) => ({ type:'turn',speaker:'yuki',source,text,index });
test('timeline keeps latest label without overlapping an adjacent regular tick', () => {
  assert.deepEqual(timelineLabelIndices(21),[0,3,7,11,15,20]);
  assert.deepEqual(timelineLabelIndices(1),[0]);
  assert.deepEqual(timelineLabelIndices(0),[]);
});
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
test('recent change needs both real examples; current success alone is unconfirmed', () => {
  const o={metric:'Task achievement',behavior:'Independent reason',earlier:null,current:{session:21,turn_indices:[3],observation:'Own reason'},comparison_conditions:'No matched earlier task',decision:'unconfirmed',confidence:'low',next_observation:'A natural reason in the next discussion'};
  const s={session:21,recent_change_review:{version:'recent-change-v1',summary:'Current success, change unconfirmed',observations:[o]}};
  const refs=new Map([[20,new Set([1])],[21,new Set([3])]]);
  assert.deepEqual(validateRecentChangeReview(s,['Task achievement'],refs),[]);
  o.decision='stable'; assert.match(validateRecentChangeReview(s,['Task achievement'],refs).join(' '),/earlier/);
  o.earlier={session:20,turn_indices:[1],observation:'Own earlier reason'};
  assert.deepEqual(validateRecentChangeReview(s,['Task achievement'],refs),[]);
  o.earlier.turn_indices=[99]; assert.match(validateRecentChangeReview(s,['Task achievement'],refs).join(' '),/earlier/);
});
test('recent-change contract does not rewrite historical records or grant audio scores', () => {
  assert.deepEqual(validateRecentChangeReview({session:20},[],new Map()),[]);
  const o={metric:'Pronunciation',behavior:'Sound clarity',earlier:{session:20,turn_indices:[],alternative_evidence:'Historical note, limited',observation:'Prior note'},current:{session:21,turn_indices:[1],observation:'Recording processed'},comparison_conditions:'Different readings',decision:'observed_gain',confidence:'low',next_observation:'Direct review'};
  const s={session:21,recent_change_review:{version:'recent-change-v1',summary:'Claim',observations:[o]}};
  assert.match(validateRecentChangeReview(s,['Pronunciation'],new Map([[21,new Set([1])]])).join(' '),/holistic/);
});

const qualityFixture = () => ({conversation_quality:{source:'learning-records/transcripts/example.jsonl',observations:[{kind:'scope_mismatch',assistant_turns:[1],learner_turns:[2],note:'Astra answered a different scope; Yuki clarified it.'}]}});
const qualitySpeakers = new Map([[1,'chappy'],[2,'yuki'],[3,'chappy']]);
test('conversation-quality evidence keeps responsibility with the actual speaker', () => {
  const s=qualityFixture(),o=s.conversation_quality.observations[0];
  assert.deepEqual(validateConversationQuality(s,qualitySpeakers,s.conversation_quality.source),[]);
  o.assistant_turns=[2];o.learner_turns=[1];
  const errors=validateConversationQuality(s,qualitySpeakers,s.conversation_quality.source).join(' ');
  assert.match(errors,/assistant_turns turn 2 must refer to chappy/);
  assert.match(errors,/learner_turns turn 1 must refer to yuki/);
});
test('conversation-quality references reject missing, duplicate and wrong-session evidence', () => {
  for (const id of [99,1.5,'1']) {
    const s=qualityFixture();s.conversation_quality.observations[0].assistant_turns=[id];
    assert.match(validateConversationQuality(s,qualitySpeakers).join(' '),/missing or invalid turn/);
  }
  for (const field of ['assistant_turns','learner_turns']) {
    const s=qualityFixture(),o=s.conversation_quality.observations[0];
    o[field]=[o[field][0],o[field][0]];
    assert.match(validateConversationQuality(s,qualitySpeakers).join(' '),new RegExp(`duplicate ${field}`));
    delete o[field];
    assert.match(validateConversationQuality(s,qualitySpeakers).join(' '),new RegExp(`${field} must be an array`));
  }
  const s=qualityFixture();
  assert.match(validateConversationQuality(s,qualitySpeakers,'learning-records/transcripts/another-session.jsonl').join(' '),/source does not match/);
  s.conversation_quality.observations[0].assistant_turns=[];s.conversation_quality.observations[0].learner_turns=[];
  assert.match(validateConversationQuality(s,qualitySpeakers).join(' '),/at least one transcript reference/);
});
test('a quality observation may concern one speaker and may reuse a turn in a different observation', () => {
  assert.deepEqual(validateConversationQuality({},new Map()),[]);
  const s=qualityFixture();s.conversation_quality.observations[0].learner_turns=[];
  s.conversation_quality.observations.push({kind:'repetitive_question',assistant_turns:[1],learner_turns:[],note:'The same turn also repeated an earlier question.'});
  assert.deepEqual(validateConversationQuality(s,qualitySpeakers),[]);
});
test('scoring and recent-change references cannot duplicate evidence or admit assistant turns', () => {
  const s={session:17,ratings:{Grammar:3},metric_evidence:{Grammar:{comparison:'not_comparable',provenance:{rubric_version:'whole-session-v3',task_kind:'spontaneous',support:'independent',preparation_seconds:null,turn_indices:[2],next_observation:'Another explanation'}}}};
  const learnerIds=new Set([...qualitySpeakers].filter(([,speaker])=>speaker==='yuki').map(([id])=>id));
  assert.deepEqual(validateScoringEvidence(s,['Grammar'],learnerIds),[]);
  for (const ids of [[1],[2,2],[2.5]]) {
    s.metric_evidence.Grammar.provenance.turn_indices=ids;
    assert.match(validateScoringEvidence(s,['Grammar'],learnerIds).join(' '),/invalid transcript references/);
  }
  const o={metric:'Grammar',behavior:'Self-repair',earlier:null,current:{session:21,turn_indices:[2,2],observation:'A current repair'},comparison_conditions:'No earlier comparison',decision:'unconfirmed',confidence:'medium',next_observation:'Another independent repair'};
  const recent={session:21,recent_change_review:{version:'recent-change-v1',summary:'Current observation, change unconfirmed',observations:[o]}};
  assert.match(validateRecentChangeReview(recent,['Grammar'],new Map([[21,learnerIds]])).join(' '),/invalid current change reference/);
  o.current.turn_indices=[1];
  assert.match(validateRecentChangeReview(recent,['Grammar'],new Map([[21,learnerIds]])).join(' '),/invalid current change reference/);
});
test('saved quality observations resolve to the transcript and correct speakers', async () => {
  const progress=JSON.parse(await fs.readFile(path.join(recordsRoot,'progress.json'),'utf8'));
  const coverage=JSON.parse(await fs.readFile(path.join(recordsRoot,'transcripts/coverage.json'),'utf8'));
  let checked=0;
  for (const s of progress.sessions.filter(s=>s.conversation_quality)) {
    const entry=coverage.sessions.find(c=>c.session_number===s.session);
    const source=`learning-records/transcripts/${entry.file}`;
    const rows=(await fs.readFile(path.join(projectRoot,source),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
    const speakers=new Map(rows.filter(t=>t.type==='turn').map(t=>[t.index,t.speaker]));
    assert.deepEqual(validateConversationQuality(s,speakers,source),[],`Session ${s.session}`);
    checked+=s.conversation_quality.observations.length;
  }
  assert.ok(checked>0);
});
