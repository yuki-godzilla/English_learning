import test from 'node:test';
import assert from 'node:assert/strict';
import { localPronunciationEligibility, limitedPronunciationAssessment, limitedPronunciationHtml,
  validateLocalPronunciationAssessments, assessedSessionBody, evaluatedMetrics, assessedResultSet, reportChartProgress } from '../scripts/lib/report-presentation.mjs';
import { validateAssessmentPolicy } from '../scripts/lib/report-presentation.mjs';
import { growthSummaryHtml } from '../scripts/lib/learning-plan.mjs';

function fixture() {
  const assessment={version:'local-gopt-consensus-v1',status:'assessed_limited',method:'local_phoneme_assessment',
    reviewed_on:'2026-10-15',task_kind:'read_aloud',scope:'phoneme_accuracy_only',
    evidence_refs:[{id:'saved-reading-01',sha256:'a'.repeat(64),duration_seconds:50.304,coverage_seconds:50.304,source_unchanged:true,all_audio_processed:true}],
    summary_ja:'モデル上の音素適合を確認した。',strengths_ja:['複数の語で音素適合が安定した。'],
    review_points_ja:['候補を原音と照合する。'],practice_chunks:['a practical improvement'],confidence:'medium',reference_confidence:'verified'};
  const session={session:23,date:'2026-10-14',ratings:{Pronunciation:null},within_level_stage:{Pronunciation:null},pronunciation_assessment:assessment};
  const policy={version:'environment-evidence-v1',effective_from_session:23,environment_reviewed_on:'2026-10-15',history_policy:'preserve_without_rescoring',capabilities:{local_phoneme_assessment:true,holistic_pronunciation_review:false},
    method_origins:{local_phoneme_assessment:'local'},
    adopted_local_pronunciation_method:{version:'local-gopt-consensus-v1',method:'local_phoneme_assessment',scope:'phoneme_accuracy_only',
      validation_source:'learning-records/resources/pronunciation-method-validation.json',adopted_on:'2026-10-15',primary:'GOPT',secondary:'CTC GOP-SA',quality:'Whisper/Praat'}};
  return {session,policy,assessment,progress:{sessions:[session],qualitative_metrics:['Pronunciation'],assessment_policy:policy}};
}

test('a complete local phoneme assessment is visible without creating a holistic L or changing evidence',()=>{
  const {session,policy,assessment,progress}=fixture(),before=JSON.stringify(progress);
  assert.equal(localPronunciationEligibility(session,policy).eligible,true);
  assert.equal(limitedPronunciationAssessment(session,policy),assessment);
  assert.deepEqual(evaluatedMetrics(session,['Pronunciation'],policy),[]);
  assert.deepEqual(assessedResultSet(session,['Pronunciation'],policy),{metrics:[],denominator:0,overall:null});
  assert.equal(reportChartProgress(progress).sessions[0].ratings.Pronunciation,null);
  assert.equal(JSON.stringify(progress),before);
  assert.deepEqual(validateLocalPronunciationAssessments(progress),[]);
  assert.deepEqual(validateAssessmentPolicy(progress,new Map()),[]);
});

test('a method name alone, an external method or a missing adoption record cannot publish local assessment',()=>{
  for (const mutation of [
    f=>{f.policy.capabilities.local_phoneme_assessment=false;},
    f=>{f.policy.method_origins.local_phoneme_assessment='external';},
    f=>{delete f.policy.adopted_local_pronunciation_method;},
    f=>{f.policy.adopted_local_pronunciation_method.scope='holistic';},
    f=>{f.policy.adopted_local_pronunciation_method.validation_source='tmp/private-result.json';},
  ]) {
    const f=fixture();mutation(f);
    assert.equal(limitedPronunciationAssessment(f.session,f.policy),null);
    assert.equal(limitedPronunciationHtml(f.session,f.policy),'');
    assert.ok(validateLocalPronunciationAssessments(f.progress).length>0);
  }
});

test('a truncated, changed, missing or duplicate recording cannot pass the whole-audio gate',()=>{
  for (const mutation of [
    a=>{a.evidence_refs[0].coverage_seconds=10;},
    a=>{a.evidence_refs[0].source_unchanged=false;},
    a=>{a.evidence_refs[0].all_audio_processed=false;},
    a=>{a.evidence_refs[0].sha256='missing';},
    a=>{a.evidence_refs=[];},
    a=>{a.evidence_refs.push({...a.evidence_refs[0]});},
    a=>{a.evidence_refs[0].duration_seconds=0;},
  ]) {
    const f=fixture();mutation(f.assessment);
    assert.equal(localPronunciationEligibility(f.session,f.policy).eligible,false);
  }
});

test('the canonical assessment validator rejects a limited assessment with incomplete coverage',()=>{
  const {assessment,progress}=fixture();assessment.evidence_refs[0].coverage_seconds=20;
  assert.match(validateAssessmentPolicy(progress,new Map()).join(' '),/unchanged complete recording coverage required/);
});

test('quality measurements alone, unbounded confidence and future/reference-free reviews stay unpublished',()=>{
  for (const mutation of [
    a=>{a.status='technical_incomplete';},
    a=>{a.method='recording_quality_measurement';},
    a=>{a.scope='timing_pitch_only';},
    a=>{a.confidence='high';},
    a=>{delete a.reference_confidence;},
    a=>{a.reviewed_on='2026-10-13';},
    a=>{a.reviewed_on='2026-02-31';},
    a=>{a.strengths_ja=[];a.review_points_ja=[];},
    a=>{a.summary_ja='';},
  ]) {
    const f=fixture();mutation(f.assessment);
    assert.equal(limitedPronunciationHtml(f.session,f.policy),'');
  }
});

test('limited report output labels uncertainty, escapes content and omits private evidence and raw scores',()=>{
  const {session,policy,assessment}=fixture();
  assessment.reference_confidence='task_reference_unverified_wording';assessment.confidence='low';
  assessment.summary_ja='<script>unsafe</script>';
  assessment.evidence_refs[0].private_path='C:\\private\\recording.wav';
  assessment.raw_model_score=1.9;
  const html=limitedPronunciationHtml(session,policy);
  assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.match(html,/モデル上の音素適合/);assert.match(html,/確度: 低/);assert.match(html,/実際に発した全語との一致は未確認/);
  assert.match(html,/全50\.3秒/);assert.match(html,/個別音の誤りとは断定しません/);
  assert.doesNotMatch(html,/C:\\private|recording\.wav|1\.9|saved-reading-01|a{64}/);
});

test('confirmed limited reviews survive report filtering while empty pronunciation sections remain hidden',()=>{
  const {session,policy}=fixture();
  const text='### 発音・スピーキング\n\nCompleted local phone findings.\n\n### 成長メモ\n\nActual success.\n';
  assert.equal(assessedSessionBody(text,session,policy,23),text);
  delete session.pronunciation_assessment;
  assert.equal(assessedSessionBody(text,session,policy,23),'### 成長メモ\n\nActual success.\n');
  const historical={...session,session:12,ratings:{Pronunciation:3}};
  assert.equal(assessedSessionBody(text,historical,policy,23),text);
});

test('a retrospective review remains an additive record beside the unchanged historical L',()=>{
  const {session,policy,progress}=fixture();session.session=12;session.date='2026-09-06';session.ratings.Pronunciation=3;
  session.pronunciation_evidence={holistic_audio_review:false,analysis_method:'legacy limited procedure'};
  const before=JSON.stringify(session);
  assert.equal(localPronunciationEligibility(session,policy).eligible,true);
  assert.equal(reportChartProgress(progress).sessions[0].ratings.Pronunciation,3);
  assert.equal(JSON.stringify(session),before);
});

test('the PDF summary presents eligible phoneme findings even when no holistic metrics are scored',()=>{
  const {progress}=fixture();
  const html=growthSummaryHtml(progress,{session:23,goal:'Use one practical chunk.'});
  assert.match(html,/<h2>音素の評価<\/h2>/);
  assert.match(html,/モデル上の音素適合/);
  assert.doesNotMatch(html,/<table class="assessment-table">|L[1-5] \/|Pronunciation/);
});

test('review candidates need no invented strength or compulsory practice chunk',()=>{
  const {session,policy,assessment}=fixture();
  assessment.strengths_ja=[];assessment.practice_chunks=[];
  assert.equal(localPronunciationEligibility(session,policy).eligible,true);
  const html=limitedPronunciationHtml(session,policy);
  assert.match(html,/次に確かめる点/);
  assert.doesNotMatch(html,/確認できた良さ|練習に使う短いまとまり/);
});
