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
