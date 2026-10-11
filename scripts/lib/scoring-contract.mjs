/** New records need traceable observations; legacy scores remain unchanged. */
export function validateScoringEvidence(session, metrics, turnIds) {
  const errors = [];
  if (session.session < 17) return errors;
  for (const metric of metrics) {
    const evidence = session.metric_evidence?.[metric];
    const p = evidence?.provenance;
    if (!p || p.rubric_version !== 'whole-session-v3') { errors.push(`${metric}: missing rubric version`); continue; }
    if (!['spontaneous', 'read_aloud', 'mixed', 'not_observed'].includes(p.task_kind) || !['independent', 'prompted', 'modelled', 'mixed', 'unknown'].includes(p.support)) errors.push(`${metric}: missing task/support conditions`);
    if (!Object.hasOwn(p, 'preparation_seconds') || (p.preparation_seconds !== null && (!Number.isFinite(p.preparation_seconds) || p.preparation_seconds < 0))) errors.push(`${metric}: preparation must be measured or null`);
    if (!Array.isArray(p.turn_indices) || p.turn_indices.some(id => !turnIds.has(id))) errors.push(`${metric}: invalid transcript references`);
    if (Number.isInteger(session.ratings?.[metric]) && !p.turn_indices?.length && !p.alternative_evidence) errors.push(`${metric}: no evidence reference`);
    if (evidence.comparison !== 'not_comparable' && (!Number.isInteger(p.comparison_session) || p.comparison_session >= session.session || !p.comparison_conditions)) errors.push(`${metric}: unsupported comparison`);
    if (!p.next_observation) errors.push(`${metric}: missing next observation`);
    if (metric === 'Pronunciation' && Number.isInteger(session.ratings?.[metric]) && session.pronunciation_evidence?.holistic_audio_review !== true) errors.push('Pronunciation: holistic audio review required');
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
    if (!Array.isArray(ref.turn_indices) || ref.turn_indices.some(id => !turnsBySession.get(ref.session)?.has(id))) return false;
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
