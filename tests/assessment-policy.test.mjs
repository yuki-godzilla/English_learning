import test from 'node:test';
import assert from 'node:assert/strict';
import { assessmentEligibility, assessedResultSet, evaluatedMetrics, examEstimateEligibility, assessedSessionBody, requiredDescriptorComponents, reportChartProgress, qualitativeObservations } from '../scripts/lib/report-presentation.mjs';

function fixture(metric='Task achievement') {
  const session={session:24,ratings:{[metric]:3},within_level_stage:{[metric]:'established'},metric_evidence:{[metric]:{assessment_status:'observed',provenance:{rubric_version:'whole-session-v4',task_kind:'spontaneous',turn_indices:[1]},scope:{coherence_checked:true,delivery_checked:true}}},pronunciation_evidence:{holistic_audio_review:true}};
  const method=metric==='Pronunciation'?'holistic_pronunciation_review':metric==='Fluency & coherence'?'spontaneous_delivery_review':'contextual_text_review';
  const review={method,completed:true,result_kind:'numeric_assessment',rubric_scope_supported:true,source:'transcript',source_kind:'voice_asr',turn_indices:[1],evidence_confidence:'medium',independent_content:true,asr_ambiguity_excluded:true,entire_recording_reviewed:true,
    descriptor_coverage:{rubric_version:'whole-session-v4',level:3,stage:'established',descriptor:'Reviewed descriptor',components:Object.fromEntries(requiredDescriptorComponents(metric,3).map(c=>[c,{verified:true,evidence_type:metric==='Pronunciation'?'direct_sound_prosody':c==='spontaneous_delivery'?'direct_spontaneous_delivery':metric==='Grammar control'?'verified_wording':'contextual_meaning',turn_indices:[1]}]))}};
  const policy={version:'environment-evidence-v1',capabilities:{[method]:true},evidence_reviews:{24:{[metric]:review}}};
  return {session,policy,review,method,metric};
}

test('unknown capability, missing evidence and unresolved ASR never produce an assessed result',()=>{
  const {session,policy,review,method,metric}=fixture();
  assert.deepEqual(evaluatedMetrics(session,[metric],policy),[metric]);
  delete policy.capabilities[method];assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
  policy.capabilities[method]=true;review.turn_indices=[];assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
  review.turn_indices=[1];review.asr_ambiguity_excluded=false;assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
  review.asr_ambiguity_excluded=true;review.evidence_confidence='low';assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
  review.evidence_confidence='medium';delete review.turn_indices;assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
});
test('qualitative observations also need a verified method and completed, contextual evidence',()=>{
  const {session,policy,review,method}=fixture();review.result_kind='qualitative_observation';review.observation_ja='An observed meaning-bearing explanation';
  assert.equal(qualitativeObservations(session,policy).length,1);
  policy.capabilities[method]=false;assert.deepEqual(qualitativeObservations(session,policy),[]);
  policy.capabilities[method]=true;review.asr_ambiguity_excluded=false;assert.deepEqual(qualitativeObservations(session,policy),[]);
});
test('a completed contextual ASR review cannot replace mandatory grammar-form evidence',()=>{
  const {session,policy,review,metric}=fixture('Grammar control');
  assert.equal(review.completed,true);assert.equal(review.rubric_scope_supported,true);
  assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
  review.source_kind='typed';review.method='written_text_review';policy.capabilities.written_text_review=true;
  session.metric_evidence[metric].provenance.task_kind='typed';
  assert.equal(assessmentEligibility(session,metric,policy).eligible,true);
  review.descriptor_coverage.components.grammatical_form_accuracy.verified=false;
  assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
});
test('descriptor coverage is bound to the actual proposed level, stage and rubric',()=>{
  const {session,policy,review,metric}=fixture();
  for (const [key,value] of [['level',4],['stage','strong'],['rubric_version','other']]) {
    const old=review.descriptor_coverage[key];review.descriptor_coverage[key]=value;
    assert.equal(assessmentEligibility(session,metric,policy).eligible,false);review.descriptor_coverage[key]=old;
  }
});
test('unsupported current grades are gaps in chart views and original historical records remain unchanged',()=>{
  const {session,policy,metric}=fixture('Grammar control');policy.effective_from_session=24;
  const old={...session,session:12},progress={sessions:[old,session],qualitative_metrics:[metric],assessment_policy:policy};
  const before=JSON.stringify(progress),view=reportChartProgress(progress);
  assert.equal(view.sessions[0].ratings[metric],3);assert.equal(view.sessions[1].ratings[metric],null);
  assert.equal(view.sessions[1].within_level_stage[metric],null);assert.equal(JSON.stringify(progress),before);
});
test('reading, repetition and supplied content do not establish independent production',()=>{
  const {session,policy,review,metric}=fixture();
  for (const task of ['read_aloud','repetition','model_repetition','cued_use','unknown']) {
    session.metric_evidence[metric].provenance.task_kind=task;
    assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
  }
  session.metric_evidence[metric].provenance.task_kind='spontaneous';review.independent_content=false;
  assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
  // A normal conversation prompt remains compatible with learner-origin content.
  review.independent_content=true;session.metric_evidence[metric].provenance.support_kinds=['conversation_prompt'];
  assert.equal(assessmentEligibility(session,metric,policy).eligible,true);
});
test('successful decode, ASR match, threshold changes and pitch do not qualify pronunciation',()=>{
  const {session,policy,review,metric}=fixture('Pronunciation');
  for (const method of ['recording_quality_measurement','asr_timing_measurement','pitch_measurement']) {
    review.method=method;policy.capabilities[method]=true;
    session.pronunciation_evidence={direct_audio_processed:true,asr_match_percent:99,quiet_percent:30,pitch_median:128};
    assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
  }
  review.method='holistic_pronunciation_review';session.pronunciation_evidence.holistic_audio_review=true;
  assert.equal(assessmentEligibility(session,metric,policy).eligible,true);
  review.completed=false;assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
});
test('a new external method needs approval and an actual completed review',()=>{
  const {session,policy,review,method,metric}=fixture('Pronunciation');
  policy.method_origins={[method]:'external'};
  assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
  review.external_transfer_authorized=true;review.completed=false;
  assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
  review.completed=true;assert.equal(assessmentEligibility(session,metric,policy).eligible,true);
});
test('read-aloud timing cannot stand in for spontaneous delivery',()=>{
  const {session,policy,review,metric}=fixture('Fluency & coherence');
  assert.equal(assessmentEligibility(session,metric,policy).eligible,true);
  session.metric_evidence[metric].scope.delivery_checked=false;
  assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
  session.metric_evidence[metric].scope.delivery_checked=true;session.metric_evidence[metric].provenance.task_kind='read_aloud';
  assert.equal(assessmentEligibility(session,metric,policy).eligible,false);
});
test('missing results are not zero, carried forward or re-averaged into an overall grade',()=>{
  const {session,policy,metric}=fixture();
  const original=JSON.stringify(session);
  assert.deepEqual(assessedResultSet(session,[metric,'Pronunciation'],policy),{metrics:[metric],denominator:1,overall:null});
  session.ratings[metric]=null;
  assert.deepEqual(assessedResultSet(session,[metric,'Pronunciation'],policy),{metrics:[],denominator:0,overall:null});
  session.ratings[metric]=3;assert.equal(JSON.stringify(session),original);
});
test('new exam estimates require relevant tasks and verified methods rather than conversational ratings',()=>{
  const {policy}=fixture();
  assert.equal(examEstimateEligibility({},policy),false);
  const review={methodology_id:'timed-task-v1',task_evidence_reviewed:true,conditions_comparable:true,required_methods:['standardized_speaking_task_review']};
  assert.equal(examEstimateEligibility(review,policy),false);
  policy.capabilities.standardized_speaking_task_review=true;assert.equal(examEstimateEligibility(review,policy),true);
  review.task_evidence_reviewed=false;assert.equal(examEstimateEligibility(review,policy),false);
});
test('reader-only filtering removes empty pronunciation sections while preserving historical verified notes',()=>{
  const text='### 発音・スピーキング\n\nN/A only.\n\n### 成長メモ\n\nActual success.\n';
  const original=text, unassessed={session:23,ratings:{Pronunciation:null}};
  assert.equal(assessedSessionBody(text,unassessed,{},23),'### 成長メモ\n\nActual success.\n');
  assert.equal(assessedSessionBody(text,{session:12,ratings:{Pronunciation:3}},{},23),original);
});
