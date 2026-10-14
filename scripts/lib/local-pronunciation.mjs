/** A completed, bounded local audio assessment is separate from a holistic L. */
const VERSION = 'local-gopt-consensus-v1';
const METHOD = 'local_phoneme_assessment';
const SCOPE = 'phoneme_accuracy_only';
const textPresent = value => typeof value === 'string' && value.trim().length > 0;
const textList = value => Array.isArray(value) && value.every(textPresent);
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function methodErrors(policy) {
  const errors = [], method = policy?.adopted_local_pronunciation_method;
  if (policy?.version !== 'environment-evidence-v1') errors.push('verified assessment policy required');
  if (policy?.capabilities?.[METHOD] !== true || policy?.method_origins?.[METHOD] !== 'local') errors.push('verified local capability required');
  if (method?.version !== VERSION || method?.method !== METHOD || method?.scope !== SCOPE
    || method?.primary !== 'GOPT' || method?.secondary !== 'CTC GOP-SA' || method?.quality !== 'Whisper/Praat') errors.push('adopted bounded method required');
  if (!validDate(method?.adopted_on)) errors.push('valid method adoption date required');
  if (typeof method?.validation_source !== 'string'
    || !/^learning-records\/resources\/[a-z0-9-]+\.json$/.test(method.validation_source)) errors.push('tracked validation source required');
  return errors;
}

function assessmentErrors(session, policy) {
  const assessment = session?.pronunciation_assessment;
  if (!assessment) return ['no completed local phoneme assessment'];
  const errors = methodErrors(policy);
  if (assessment.version !== VERSION || assessment.status !== 'assessed_limited'
    || assessment.method !== METHOD || assessment.scope !== SCOPE) errors.push('completed phoneme-only scope required');
  if (!validDate(assessment.reviewed_on) || assessment.reviewed_on < (session.date ?? '')
    || assessment.reviewed_on < (policy?.adopted_local_pronunciation_method?.adopted_on ?? '')) errors.push('valid retrospective review date required');
  if (!['read_aloud', 'spontaneous'].includes(assessment.task_kind)) errors.push('explicit audio task required');
  if (!['medium', 'low'].includes(assessment.confidence)) errors.push('bounded model confidence required');
  if (!['verified', 'task_reference_unverified_wording'].includes(assessment.reference_confidence)) errors.push('reference confidence required');
  if (!textPresent(assessment.summary_ja) || !textList(assessment.strengths_ja)
    || !textList(assessment.review_points_ja) || !textList(assessment.practice_chunks)
    || (assessment.strengths_ja.length + assessment.review_points_ja.length === 0)) errors.push('concrete findings and practice arrays required');
  if (!Array.isArray(assessment.evidence_refs) || !assessment.evidence_refs.length) errors.push('audio evidence references required');
  else {
    const ids = new Set();
    for (const ref of assessment.evidence_refs) {
      if (!textPresent(ref?.id) || ids.has(ref.id)) errors.push('unique audio evidence IDs required');
      ids.add(ref?.id);
      if (typeof ref?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256)) errors.push('audio source hash required');
      if (!Number.isFinite(ref?.duration_seconds) || ref.duration_seconds <= 0
        || !Number.isFinite(ref?.coverage_seconds) || Math.abs(ref.duration_seconds - ref.coverage_seconds) > 0.05
        || ref.source_unchanged !== true || ref.all_audio_processed !== true) errors.push('unchanged complete recording coverage required');
    }
  }
  return errors;
}

export function localPronunciationEligibility(session, policy) {
  const reasons = assessmentErrors(session, policy);
  return { eligible: reasons.length === 0, reasons };
}

/** Never supplies a rating, fills a missing L, or changes the original evidence. */
export function limitedPronunciationAssessment(session, policy) {
  return localPronunciationEligibility(session, policy).eligible ? session.pronunciation_assessment : null;
}

export function validateLocalPronunciationAssessments(progress) {
  const errors = [];
  if (progress.assessment_policy?.adopted_local_pronunciation_method) {
    errors.push(...methodErrors(progress.assessment_policy).map(e => `local pronunciation method: ${e}`));
  }
  for (const session of progress.sessions ?? []) {
    if (!session.pronunciation_assessment) continue;
    errors.push(...assessmentErrors(session, progress.assessment_policy).map(e => `local pronunciation S${session.session}: ${e}`));
  }
  return errors;
}

/** Shared by Site/PDF; raw model scores and private paths never enter the view. */
export function limitedPronunciationHtml(session, policy, { headingLevel = 2 } = {}) {
  const assessment = limitedPronunciationAssessment(session, policy);
  if (!assessment) return '';
  const level = [2, 3, 4].includes(headingLevel) ? headingLevel : 2;
  const duration = assessment.evidence_refs.reduce((sum, ref) => sum + ref.duration_seconds, 0);
  const list = values => values.length ? `<ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : '';
  const reference = assessment.reference_confidence === 'verified' ? '確認済みの課題原文' : '課題原文に基づく参照。実際に発した全語との一致は未確認';
  return `<section class="local-pronunciation-assessment"><h${level}>音素の評価</h${level}>
<p>${escapeHtml(assessment.summary_ja)}</p>
<p class="note">${assessment.task_kind === 'read_aloud' ? '音読' : '自発発話'} ${assessment.evidence_refs.length}録音・全${duration.toFixed(1)}秒。GOPTを主方式、CTC GOP-SAを補助に使用。モデル上の音素適合に範囲を限定。確度: ${assessment.confidence === 'medium' ? '中' : '低'}。評価日: ${escapeHtml(assessment.reviewed_on)}。</p>
${assessment.strengths_ja.length ? `<p><strong>確認できた良さ</strong></p>${list(assessment.strengths_ja)}` : ''}
${assessment.review_points_ja.length ? `<p><strong>次に確かめる点</strong></p>${list(assessment.review_points_ja)}` : ''}
${assessment.practice_chunks.length ? `<p><strong>練習に使う短いまとまり</strong></p>${list(assessment.practice_chunks)}` : ''}
<p class="note">参照: ${reference}。低いモデル出力は確認候補として扱い、個別音の誤りとは断定しません。強勢・リズム・つながり・抑揚や総合Lはこの評価の対象外です。</p></section>`;
}
