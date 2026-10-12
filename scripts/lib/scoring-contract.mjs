import { V4_FIRST_SESSION, SUPPORT_KINDS, ASSESSMENT_STATUSES } from './learning-plan.mjs';
const validTurnReferences = (ids, available) => Array.isArray(ids)
  && ids.every(id => Number.isInteger(id) && available.has(id))
  && new Set(ids).size === ids.length;
/** New records need traceable observations; legacy scores remain unchanged. */
export function validateScoringEvidence(session, metrics, turnIds) {
  const errors = [];
  if (session.session < 17) return errors;
  for (const metric of metrics) {
    const evidence = session.metric_evidence?.[metric];
    const p = evidence?.provenance;
    const v4 = session.session >= V4_FIRST_SESSION;
    if (!p || p.rubric_version !== (v4 ? 'whole-session-v4' : 'whole-session-v3')) { errors.push(`${metric}: missing rubric version`); continue; }
    if (!['spontaneous', 'read_aloud', 'mixed', 'not_observed'].includes(p.task_kind) || !['independent', 'prompted', 'modelled', 'mixed', 'unknown'].includes(p.support)) errors.push(`${metric}: missing task/support conditions`);
    if (!Object.hasOwn(p, 'preparation_seconds') || (p.preparation_seconds !== null && (!Number.isFinite(p.preparation_seconds) || p.preparation_seconds < 0))) errors.push(`${metric}: preparation must be measured or null`);
    if (!validTurnReferences(p.turn_indices, turnIds)) errors.push(`${metric}: invalid transcript references`);
    if (Number.isInteger(session.ratings?.[metric]) && !p.turn_indices?.length && !p.alternative_evidence) errors.push(`${metric}: no evidence reference`);
    if (evidence.comparison !== 'not_comparable' && (!Number.isInteger(p.comparison_session) || p.comparison_session >= session.session || !p.comparison_conditions)) errors.push(`${metric}: unsupported comparison`);
    if (!p.next_observation) errors.push(`${metric}: missing next observation`);
    if (metric === 'Pronunciation' && Number.isInteger(session.ratings?.[metric]) && session.pronunciation_evidence?.holistic_audio_review !== true) errors.push('Pronunciation: holistic audio review required');
    if (v4) {
      if (!Array.isArray(p.support_kinds) || p.support_kinds.some(k => !SUPPORT_KINDS.includes(k))) errors.push(`${metric}: explicit support kinds required`);
      if (!p.task_goal?.trim()) errors.push(`${metric}: actual communication purpose required`);
      if (!ASSESSMENT_STATUSES.includes(evidence.assessment_status)) errors.push(`${metric}: assessment status required`);
      if (Number.isInteger(session.ratings?.[metric]) && evidence.assessment_status !== 'observed') errors.push(`${metric}: incomplete observation cannot have a score`);
      if (evidence.comparison !== 'not_comparable' && p.comparison_session < V4_FIRST_SESSION && !p.rubric_comparison_note?.trim()) errors.push(`${metric}: cross-version comparison needs explanation`);
      if (metric === 'Fluency & coherence') {
        if (typeof evidence.scope?.coherence_checked !== 'boolean' || typeof evidence.scope?.delivery_checked !== 'boolean') errors.push(`${metric}: separate coherence/delivery scope required`);
        if (Number.isInteger(session.ratings?.[metric]) && (!evidence.scope?.coherence_checked || !evidence.scope?.delivery_checked)) errors.push(`${metric}: integrated rating requires coherence and delivery evidence`);
      }
    }
  }
  return errors;
}

/** New small-change reviews cannot substitute a flat score for a comparison. */
export function validateRecentChangeReview(session, metrics, turnsBySession) {
  if (session.session < 21) return [];
  const errors = [];
  const review = session.recent_change_review;
  if (review?.version !== 'recent-change-v1' || !review.summary?.trim() || !Array.isArray(review.observations) || review.observations.length < 1 || review.observations.length > 3) return ['missing recent-change review'];
  const decisions = new Set(['observed_gain', 'stable', 'mixed', 'observed_loss', 'unconfirmed']);
  const checkReference = (ref, current) => {
    if (!ref || !Number.isInteger(ref.session) || (current ? ref.session !== session.session : ref.session >= session.session) || !ref.observation?.trim()) return false;
    if (!validTurnReferences(ref.turn_indices, turnsBySession.get(ref.session) ?? new Set())) return false;
    return ref.turn_indices.length > 0 || Boolean(ref.alternative_evidence?.trim());
  };
  for (const o of review.observations) {
    if (!metrics.includes(o.metric) || !o.behavior?.trim() || !decisions.has(o.decision) || !['high', 'medium', 'low'].includes(o.confidence) || !o.comparison_conditions?.trim() || !o.next_observation?.trim()) errors.push('incomplete recent-change observation');
    if (!checkReference(o.current, true)) errors.push('invalid current change reference');
    if (o.earlier !== null ? !checkReference(o.earlier, false) : o.decision !== 'unconfirmed') errors.push('invalid earlier change reference');
    if (o.metric === 'Pronunciation' && o.decision !== 'unconfirmed' && session.pronunciation_evidence?.holistic_audio_review !== true) errors.push('pronunciation change requires direct holistic review');
  }
  return errors;
}

/** Conversation-quality references identify responsibility without changing learner ratings. */
export function validateConversationQuality(session, turnSpeakers, expectedSource) {
  const quality = session.conversation_quality;
  if (!quality) return [];
  const errors = [];
  if (expectedSource && quality.source !== expectedSource) errors.push('conversation quality: source does not match the session transcript');
  if (!Array.isArray(quality.observations)) return [...errors, 'conversation quality: observations must be an array'];
  for (const [index, observation] of quality.observations.entries()) {
    const label = `conversation quality observation ${index + 1}`;
    for (const [field, speaker] of [['assistant_turns', 'chappy'], ['learner_turns', 'yuki']]) {
      const ids = observation?.[field];
      if (!Array.isArray(ids)) {
        errors.push(`${label}: ${field} must be an array`);
        continue;
      }
      if (new Set(ids).size !== ids.length) errors.push(`${label}: duplicate ${field} references`);
      for (const id of ids) {
        if (!Number.isInteger(id) || !turnSpeakers.has(id)) errors.push(`${label}: ${field} has a missing or invalid turn ${id}`);
        else if (turnSpeakers.get(id) !== speaker) errors.push(`${label}: ${field} turn ${id} must refer to ${speaker}`);
      }
    }
    if (Array.isArray(observation?.assistant_turns) && Array.isArray(observation?.learner_turns)
      && observation.assistant_turns.length + observation.learner_turns.length === 0) errors.push(`${label}: at least one transcript reference is required`);
  }
  return errors;
}
