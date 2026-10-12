import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { projectRoot, recordsRoot } from '../scripts/lib/project.mjs';
import path from 'node:path';
import { loadJournal } from '../scripts/lib/journal-parser.mjs';
import { validateLearningPlan, resolveActiveItems, buildLearningBrief, learningBriefHtml, growthSummaryHtml, pdfChapterOrder } from '../scripts/lib/learning-plan.mjs';
import { validateScoringEvidence } from '../scripts/lib/scoring-contract.mjs';
import { skillTimeline } from '../scripts/charts/skill-timeline.mjs';
const progress = JSON.parse(await fs.readFile(path.join(recordsRoot,'progress.json'),'utf8'));
const ledger = JSON.parse(await fs.readFile(path.join(recordsRoot,'resources/bank-ledger.json'),'utf8'));
const journal = await loadJournal();
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);

test('v6 migration preserves the approved historical assessments and exam estimates', () => {
  assert.equal(hash(progress.sessions.filter(s=>s.session<=22)), '270f646eebbbd030458800c3ce58133b7dffd4a9f45a59c5a4b64d4a0ee76987');
  // Historical exam estimates are intentionally not recalculated by this migration.
  assert.equal(hash(progress.test_score_estimates.estimate_sessions.filter(s=>s.session<=22)), 'eaea9716d23b73421ed28d55a25da52981718884fe70d29f713b7808a543062f');
});
test('current plan resolves existing Bank IDs without adding a lesson or mastery event', () => {
  const p=clone(progress);p.learning_plan.reuse_observations=[];
  assert.deepEqual(validateLearningPlan(p,ledger), []);
  const items=resolveActiveItems(journal,progress.learning_plan,ledger);
  assert.ok(items.length >= 5 && items.length <= 8); assert.ok(items.every(item=>item.expression && item.detail && item.source));
  assert.ok(Array.isArray(progress.learning_plan.reuse_observations));
  assert.ok(progress.learning_plan.effective_from_session>=23);
});
test('duplicate, missing, retired IDs and obligatory probes are rejected', () => {
  const p=clone(progress);p.learning_plan.active_items[1].id=p.learning_plan.active_items[0].id;
  assert.match(validateLearningPlan(p,ledger).join(' '),/duplicate/);
  p.learning_plan.active_items[0].id='not-a-bank-item';
  p.learning_plan.assessment_cadence.mandatory=true;
  assert.match(validateLearningPlan(p,ledger).join(' '),/optional/);
  const l=clone(ledger);l.items.find(i=>i.id===progress.learning_plan.active_items[0].id).retired_reason='test';
  assert.match(validateLearningPlan(progress,l).join(' '),/invalid/);
});
test('delayed reuse requires real later-day evidence and no supplied language', () => {
  const p=clone(progress), plan=p.learning_plan;
  const observation={bank_item_id:plan.active_items[0].id,session:22,introduced_session:21,kind:'delayed_independent_use',turn_indices:[85],support_kinds:['conversation_prompt'],evidence_note:'Synthetic validation fixture, not recorded learning.'};
  plan.reuse_observations=[observation];
  const turns=new Map([[22,new Set([85])]]);
  assert.match(validateLearningPlan(p,ledger,turns).join(' '),/later calendar day/);
  observation.introduced_session=20;
  assert.deepEqual(validateLearningPlan(p,ledger,turns),[]);
  observation.support_kinds=['model_supplied'];
  assert.match(validateLearningPlan(p,ledger,turns).join(' '),/supplied language/);
  observation.kind='transfer_use';observation.support_kinds=[];
  assert.match(validateLearningPlan(p,ledger,turns).join(' '),/changed context/);
  observation.changed_context='Different purpose';observation.turn_indices=[999];
  assert.match(validateLearningPlan(p,ledger,turns).join(' '),/turn references/);
});
function fixture(metric='Task achievement') {
  return {session:23,ratings:{[metric]:4},metric_evidence:{[metric]:{assessment_status:'observed',comparison:'not_comparable',provenance:{rubric_version:'whole-session-v4',task_kind:'spontaneous',support:'independent',support_kinds:['conversation_prompt'],task_goal:'Clarify an intended meaning',preparation_seconds:null,turn_indices:[1],next_observation:'Another ordinary conversation'}}}};
}
test('ordinary questions do not by themselves invalidate independent task achievement', () => {
  assert.deepEqual(validateScoringEvidence(fixture(),['Task achievement'],new Set([1])),[]);
});
test('text-only fluency is not capped at L3 and presented as a complete rating', () => {
  const s=fixture('Fluency & coherence'),e=s.metric_evidence['Fluency & coherence'];
  s.ratings['Fluency & coherence']=3;e.scope={coherence_checked:true,delivery_checked:false};
  assert.match(validateScoringEvidence(s,['Fluency & coherence'],new Set([1])).join(' '),/integrated rating/);
  s.ratings['Fluency & coherence']=null;e.assessment_status='insufficient_evidence';
  assert.deepEqual(validateScoringEvidence(s,['Fluency & coherence'],new Set([1])),[]);
});
test('new scores cannot silently cross the old rubric or hide incomplete assessment', () => {
  const s=fixture(),e=s.metric_evidence['Task achievement'];
  e.comparison='stable';e.provenance.comparison_session=22;e.provenance.comparison_conditions='Similar purpose';
  assert.match(validateScoringEvidence(s,['Task achievement'],new Set([1])).join(' '),/cross-version/);
  e.provenance.rubric_comparison_note='Purpose-specific descriptor changed; compare only a shared behavior';
  assert.deepEqual(validateScoringEvidence(s,['Task achievement'],new Set([1])),[]);
  e.assessment_status='technical_incomplete';
  assert.match(validateScoringEvidence(s,['Task achievement'],new Set([1])).join(' '),/cannot have a score/);
});
test('brief derives success from saved evidence and separates new planning', () => {
  const p=clone(progress);const latest=Math.max(...journal.sessions.map(s=>s.session));p.learning_plan.effective_from_session=latest+1;
  const b=buildLearningBrief(journal,p,ledger),before=hash(p);
  assert.equal(b.session,latest);assert.match(b.planningNote,/過去の成果/);
  assert.equal(b.success,p.sessions.find(s=>s.session===latest).assessment_summary?.observed_success?.meaning_ja ?? '今回の成功は、保存済みの根拠からまだ特定されていません。');
  const html=learningBriefHtml({...b,title:'<script>bad()</script>'});
  assert.ok(!html.includes('<script>bad()'));assert.match(html,/独立使用・習得の実績とは区別/);
  assert.match(html,/5分復習/);assert.match(growthSummaryHtml(progress,b),/以前 → 今回 → 判断/);
  assert.equal(hash(p),before);
});
test('technical incomplete work is visible on the first page', () => {
  const p=clone(progress);p.sessions.at(-1).metric_evidence.Pronunciation.assessment_status='technical_incomplete';
  const html=learningBriefHtml(buildLearningBrief(journal,p,ledger));
  assert.match(html,/class="warning"/);assert.match(html,/評価未完了/);
});
test('PDF keeps latest three, all-index and all Banks but puts learning first', () => {
  const chapters=pdfChapterOrder(journal.sessions);
  const recent=[...journal.sessions].sort((a,b)=>b.date.localeCompare(a.date)||b.session-a.session).slice(0,3);
  assert.deepEqual(chapters.map(c=>c.label),['cover',`session-${recent[0].id}`,'growth-summary','session-index',...recent.slice(1).map(s=>`session-${s.id}`),'growth','expressions','vocabulary','speaking']);
  assert.deepEqual(chapters.filter(c=>c.session).map(c=>c.session),recent.map(s=>s.session));
  assert.throws(()=>pdfChapterOrder([]),/No sessions/);
});
test('timeline explicitly marks, rather than connects, a rubric boundary', () => {
  const metric='Task achievement';
  const p={qualitative_metrics:[metric],sessions:[{session:22,ratings:{[metric]:3},metric_evidence:{[metric]:{provenance:{rubric_version:'whole-session-v3'}}}},{session:23,ratings:{[metric]:4},metric_evidence:{[metric]:{provenance:{rubric_version:'whole-session-v4'}}}}]};
  assert.match(skillTimeline(p),/Rubric boundary/);
  assert.ok(!skillTimeline(p).includes('stroke-width="2" fill="none"'));
});
test('canonical rules contain the current learning, fairness and report contracts', async () => {
  const rules=await fs.readFile(path.join(projectRoot,'AGENTS.md'),'utf8');
  for(const marker of ['personalized-learning-cycle-v1','fair-support-and-measurement-v1','learning-first-report-v1']) assert.ok(rules.includes(marker));
  assert.equal(progress.scoring_protocol.provenance_contract.version,'whole-session-v4');
  assert.equal(progress.methodology.report_assessment_policy.pronunciation_status,'evaluate_every_recording_within_verified_capabilities');
});
