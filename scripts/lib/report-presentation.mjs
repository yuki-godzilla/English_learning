import { limitedPronunciationAssessment, validateLocalPronunciationAssessments } from './local-pronunciation.mjs';
export { localPronunciationEligibility, limitedPronunciationAssessment, limitedPronunciationHtml, validateLocalPronunciationAssessments } from './local-pronunciation.mjs';
/** Available methods and actual evidence are separate gates, both fail closed. */
export function requiredDescriptorComponents(metric, level) {
  const common={
    'Task achievement':['purpose_content','support_attribution'],
    'Lexical resource':['contextual_vocabulary','learner_origin','support_attribution'],
    'Grammar control':['learner_constructions','grammatical_form_accuracy'],
    'Interaction & repair':['learner_interaction','support_attribution'],
    'Fluency & coherence':['coherent_content','spontaneous_delivery'],
    Pronunciation:['sound_accuracy','stress_rhythm_linking_intonation'],
  };
  if (!common[metric] || !Number.isInteger(level) || level<1 || level>5) return [];
  const components=[...common[metric]];
  if (metric==='Task achievement' && level>=4) components.push('independent_purpose_development');
  if (metric==='Task achievement' && level===5) components.push('complex_unfamiliar_adaptation');
  if (metric==='Lexical resource' && level>=4) components.push('broad_flexible_paraphrase');
  if (metric==='Lexical resource' && level===5) components.push('precise_wording_collocations');
  if (metric==='Interaction & repair' && level>=4) components.push('independent_direction_repair');
  if (metric==='Interaction & repair' && level===5) components.push('nuanced_adaptation');
  return components;
}

function descriptorCoverageSupported(session, metric, review, policy) {
  const coverage=review.descriptor_coverage, p=session.metric_evidence?.[metric]?.provenance;
  if (!coverage?.descriptor || !['emerging','established','strong'].includes(coverage?.stage)
    || coverage?.rubric_version!==p?.rubric_version || coverage?.level!==session.ratings?.[metric]
    || coverage?.stage!==session.within_level_stage?.[metric]) return false;
  const required=requiredDescriptorComponents(metric,coverage.level);
  const typeFor = component => ['learner_constructions','grammatical_form_accuracy','precise_wording_collocations'].includes(component)
    ? 'verified_wording' : ['sound_accuracy','stress_rhythm_linking_intonation'].includes(component)
      ? 'direct_sound_prosody' : component==='spontaneous_delivery' ? 'direct_spontaneous_delivery' : 'contextual_meaning';
  return required.length>0 && required.every(component=>{
    const item=coverage.components?.[component];
    if (item?.verified!==true || item.evidence_type!==typeFor(component) || !Array.isArray(item.turn_indices) || !item.turn_indices.length
      || item.turn_indices.some(id=>!review.turn_indices.includes(id))) return false;
    if (item.evidence_type==='verified_wording') return (review.source_kind==='typed' && policy.capabilities?.written_text_review===true)
      || (review.source_kind==='direct_audio' && policy.capabilities?.exact_audio_wording_review===true);
    if (item.evidence_type==='direct_sound_prosody') return review.method==='holistic_pronunciation_review';
    if (item.evidence_type==='direct_spontaneous_delivery') return review.method==='spontaneous_delivery_review' && p.task_kind==='spontaneous';
    return true;
  });
}

export function assessmentEligibility(session, metric, policy) {
  const review = policy?.evidence_reviews?.[session?.session]?.[metric];
  const evidence = session?.metric_evidence?.[metric];
  const p = evidence?.provenance;
  const reject = reason => ({eligible:false, reason});
  if (policy?.version !== 'environment-evidence-v1' || !review) return reject('no_method_review');
  if (policy.capabilities?.[review.method] !== true) return reject('method_unavailable');
  if (policy.method_origins?.[review.method] === 'external' && review.external_transfer_authorized !== true) return reject('external_transfer_unapproved');
  if (review.completed !== true || review.rubric_scope_supported !== true) return reject('review_incomplete');
  if (!review.source || !Array.isArray(review.turn_indices) || !review.turn_indices.length || review.turn_indices.some(i=>!p?.turn_indices?.includes(i))) return reject('no_evidence');
  if (review.result_kind !== 'numeric_assessment' || !descriptorCoverageSupported(session,metric,review,policy)) return reject('descriptor_not_verified');
  if (!['medium','high'].includes(review.evidence_confidence)) return reject('uncertain_evidence');
  if (metric === 'Pronunciation') {
    if (review.method !== 'holistic_pronunciation_review' || session.pronunciation_evidence?.holistic_audio_review !== true || review.entire_recording_reviewed !== true) return reject('no_sound_prosody_review');
  } else {
    if (!['spontaneous','typed'].includes(p?.task_kind) || review.independent_content !== true) return reject('not_independent_production');
    if (review.source_kind === 'voice_asr' && review.asr_ambiguity_excluded !== true) return reject('unresolved_asr');
    if (!['voice_asr','typed','direct_audio'].includes(review.source_kind)) return reject('unknown_source');
    if (metric === 'Fluency & coherence') {
      if (review.method !== 'spontaneous_delivery_review' || evidence?.scope?.coherence_checked !== true || evidence?.scope?.delivery_checked !== true) return reject('no_spontaneous_delivery_review');
    } else if (!['contextual_text_review','written_text_review','exact_audio_wording_review'].includes(review.method)) return reject('wrong_method');
  }
  return {eligible:true, reason:'reviewed', scope:review.display_scope_ja};
}

export function evaluatedMetrics(session, metrics, policy) {
  return metrics.filter(metric => assessmentEligibility(session,metric,policy).eligible
    && Number.isInteger(session?.ratings?.[metric])
    && session.metric_evidence?.[metric]?.assessment_status === 'observed');
}

/** A selection count, never a six-skill composite or a grade conversion. */
export function assessedResultSet(session, metrics, policy) {
  const selected=evaluatedMetrics(session,metrics,policy);
  return {metrics:selected, denominator:selected.length, overall:null};
}

export function currentEvidenceNote(session, metrics, policy) {
  const names={'Task achievement':'目的達成','Lexical resource':'語彙運用','Grammar control':'文法運用','Interaction & repair':'対話・修復','Fluency & coherence':'流暢さ・構成',Pronunciation:'発音'};
  const selected=evaluatedMetrics(session,metrics,policy);
  if (!selected.length) return '';
  return `確認済みの方法・実発話・各Lの記述子に基づく評価: ${selected.map(m=>names[m]??m).join(' / ')}。方法と証拠の範囲が異なる過去の点数差を、能力の変化率にはしません。`;
}

export const metricNameJa = {'Task achievement':'目的達成','Lexical resource':'語彙運用','Grammar control':'文法運用','Interaction & repair':'対話・修復','Fluency & coherence':'流暢さ・構成',Pronunciation:'発音'};
export const confidenceNameJa = value => ({high:'高',medium:'中',low:'低'}[value] ?? '未確認');
export function supportNameJa(session,metric) {
  const names={conversation_prompt:'通常の質問',structure_cue:'構成の合図',lexical_cue:'語の提示',model_supplied:'完成文の提示',unknown:'条件不明'};
  const kinds=session.metric_evidence?.[metric]?.provenance?.support_kinds;
  return Array.isArray(kinds) ? kinds.length ? kinds.map(k=>names[k]??'条件不明').join('・') : '言語支援なし' : '条件未記録';
}
export function assessmentExample(session, metric, policy) {
  const review=policy?.evidence_reviews?.[session.session]?.[metric];
  if (!assessmentEligibility(session,metric,policy).eligible) return null;
  return {text:session.metric_evidence[metric].display_summary_ja ?? session.metric_evidence[metric].observed,
    turns:review.example_turn_indices ?? review.turn_indices,
    confidence:confidenceNameJa(session.metric_evidence[metric].confidence)};
}

export function qualitativeObservations(session, policy) {
  return Object.entries(policy?.evidence_reviews?.[session?.session] ?? {})
    .filter(([,review])=>review.completed===true&&review.result_kind==='qualitative_observation'&&review.observation_ja
      && policy.capabilities?.[review.method]===true&&review.source&&Array.isArray(review.turn_indices)&&review.turn_indices.length
      && ['medium','high'].includes(review.evidence_confidence)
      && (review.source_kind!=='voice_asr'||review.asr_ambiguity_excluded===true)
      && (policy.method_origins?.[review.method]!=='external'||review.external_transfer_authorized===true))
    .map(([metric,review])=>({metric,text:review.observation_ja,scope:review.display_scope_ja}));
}

export function validateAssessmentPolicy(progress, turnsBySession, modes = new Map(), sources = new Map()) {
  const policy=progress.assessment_policy, errors=validateLocalPronunciationAssessments(progress);
  if (policy?.version !== 'environment-evidence-v1') return ['missing environment/evidence assessment policy'];
  if (!policy.environment_reviewed_on || policy.history_policy !== 'preserve_without_rescoring') errors.push('assessment policy: date/history boundary required');
  for (const [number,reviews] of Object.entries(policy.evidence_reviews ?? {})) {
    const session=progress.sessions.find(s=>s.session===Number(number));
    if (!session) {errors.push(`assessment policy: unknown session ${number}`);continue;}
    for (const [metric,review] of Object.entries(reviews)) {
      if (!progress.qualitative_metrics.includes(metric)) errors.push(`assessment policy: unknown metric ${metric}`);
      const coverage=review.descriptor_coverage;
      const descriptor=(progress.rubric_versions?.[coverage?.rubric_version]?.descriptor_overrides?.[metric]
        ?? progress.metric_rubrics?.[metric])?.[coverage?.level];
      if (review.result_kind==='numeric_assessment' && (!descriptor || coverage?.descriptor!==descriptor)) errors.push(`assessment policy: descriptor mismatch ${number}/${metric}`);
      if (sources.has(Number(number)) && review.source !== sources.get(Number(number))) errors.push(`assessment policy: wrong evidence source ${number}/${metric}`);
      if (review.example_turn_indices?.some(id=>!review.turn_indices?.includes(id))) errors.push(`assessment policy: example outside reviewed evidence ${number}/${metric}`);
      for (const id of review.turn_indices ?? []) {
        if (!turnsBySession.get(Number(number))?.has(id)) errors.push(`assessment policy: missing learner turn ${number}/${id}`);
        if (metric !== 'Pronunciation' && modes.has(`${number}/${id}`) && !['spontaneous','typed'].includes(modes.get(`${number}/${id}`))) errors.push(`assessment policy: supplied/reading evidence ${number}/${id}`);
      }
      if (review.result_kind==='numeric_assessment' && review.completed && !assessmentEligibility(session,metric,policy).eligible) errors.push(`assessment policy: unsupported completed review ${number}/${metric}`);
    }
  }
  for (const session of progress.sessions) {
    if (session.session < policy.numeric_contract_from_session) continue;
    for (const metric of progress.qualitative_metrics) {
      if (Number.isInteger(session.ratings?.[metric]) && !assessmentEligibility(session,metric,policy).eligible) errors.push(`assessment policy: unsupported numeric assessment ${session.session}/${metric}`);
    }
  }
  return errors;
}

/** Plot gaps for unsupported new-policy results; never mutate stored history. */
export function reportChartProgress(progress) {
  const policy=progress.assessment_policy;
  if (!policy) return progress;
  return {...progress,sessions:progress.sessions.map(session=>{
    if (session.session < policy.effective_from_session) return session;
    const included=new Set(evaluatedMetrics(session,progress.qualitative_metrics,policy));
    return {...session,ratings:Object.fromEntries(Object.entries(session.ratings).map(([metric,value])=>[metric,included.has(metric)?value:null])),
      within_level_stage:Object.fromEntries(Object.entries(session.within_level_stage ?? {}).map(([metric,value])=>[metric,included.has(metric)?value:null]))};
  })};
}

/** New examination estimates need relevant measured tasks, not conversation Ls. */
export function examEstimateEligibility(review, policy) {
  return Boolean(review?.methodology_id && review?.task_evidence_reviewed === true
    && review?.conditions_comparable === true && review?.required_methods?.length
    && review.required_methods.every(method=>policy?.capabilities?.[method] === true
      && (policy.method_origins?.[method] !== 'external' || review.external_transfer_authorized === true)));
}

/** Hide unassessed placeholders in reader copies, preserving canonical history. */
export function assessedSessionBody(markdown, session, policy, currentSession) {
  const showPronunciation=Boolean(limitedPronunciationAssessment(session,policy)) || (session?.session === currentSession
    ? evaluatedMetrics(session,['Pronunciation'],policy).length > 0
    : Number.isInteger(session?.ratings?.Pronunciation));
  let output=markdown;
  if (!showPronunciation) {
    output=output.replace(/^### [^\r\n]*(?:発音・スピーキング|Pronunciation)[^\r\n]*\r?\n[\s\S]*?(?=^#{1,3} |$(?![\s\S]))/gm,'');
    output=output.replace(/^\|[^\r\n]*\|[^\r\n]*N\/A[^\r\n]*\|[^\r\n]*$/gm,line=>/Pronunciation|発音/.test(line)?'':line);
  }
  return output;
}

// These export-only URLs become internal PDF destinations after chapter merging.
export const PDF_CHAPTER_LINK_PREFIX = 'https://journal.invalid/chapter/';
export const pdfChapterLink = label => `${PDF_CHAPTER_LINK_PREFIX}${label}`;
export function pdfContents(sessionId) {
  return [
    {label: 'growth-summary', title: '評価 / Evaluation'},
    {label: 'vocabulary', title: '語彙 / Vocabulary Bank'},
    {label: 'expressions', title: '表現 / Expression Bank'},
    {label: 'speaking', title: 'Speaking Bank'},
    {label: `session-${sessionId}`, title: '最新のセッション'},
    {label: 'session-index', title: '全セッションの一覧'},
    {label: 'growth', title: '成長の根拠・評価履歴'},
  ];
}
