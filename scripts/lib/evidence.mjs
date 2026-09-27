/** Shared, conservative interpretation. Never changes a learner's ratings. */
export const stages = { emerging: '形成中', established: '安定', strong: '強い' };
export function ratingLabel(session, metric) {
  const value = session?.ratings?.[metric];
  return Number.isInteger(value) ? `L${value}・${stages[session.within_level_stage?.[metric]] ?? '段階未記録'}` : 'N/A';
}
export function pronunciationBasis(session) {
  if (!Number.isInteger(session?.ratings?.Pronunciation)) return 'not_rated';
  return session.pronunciation_evidence?.holistic_audio_review === true ? 'direct_review' : 'legacy_limited';
}
export function buildReportModel(progress, analytics) {
  const latest = progress.sessions.at(-1);
  const previous = progress.sessions.at(-2);
  const first = progress.sessions[0];
  const metrics = progress.qualitative_metrics.map(metric => ({
    metric, current: ratingLabel(latest, metric), previous: ratingLabel(previous, metric),
    first: ratingLabel(first, metric), evidence: latest.metric_evidence?.[metric] ?? null,
    lastObserved: [...progress.sessions].reverse().find(s => Number.isInteger(s.ratings?.[metric])),
  }));
  const { earlier, recent, ready } = analytics.comparison;
  const describe = (key, name) => {
    const before = earlier[key], after = recent[key];
    if (!ready || !Number.isFinite(before) || !Number.isFinite(after)) return `${name}: 比較不能（独立した比較群が不足）。`;
    return `${name}: ${before} → ${after}（${after === before ? '同値' : after < before ? '減少' : '増加'}）。`;
  };
  return {
    latest, previous, first, metrics,
    initialSummary: `初回S${first.session}から今回S${latest.session}まで。比較可能な${metrics.filter(m => m.first !== 'N/A' && m.current !== 'N/A').length}観点中、整数Lが上がった観点は${metrics.filter(m => Number.isInteger(first.ratings[m.metric]) && Number.isInteger(latest.ratings[m.metric]) && latest.ratings[m.metric] > first.ratings[m.metric]).length}。同一L内の小さな変化は根拠説明と併読。`,
    automaticity: describe('repair_per_100_words', '修復マーカー/100語') + describe('lexical_search_per_100_words', '語彙検索/100語') + describe('mean_words_per_segment', '平均区間語数'),
    fillerSummary: describe('filler_per_100_words', 'Planning fillers/100語'),
    pronunciation: metrics.find(m => m.metric === 'Pronunciation'),
  };
}

/** Four distinct sessions are needed; baseline never silently becomes rolling. */
export function selectComparisonWindows(sessions) {
  const eligible = sessions.filter(s => s.coverage_band === 'high' && s.spontaneous_segments >= 15);
  const ready = eligible.length >= 4;
  return {
    ready,
    baseline: ready ? eligible.slice(0, 2).map(s => s.session) : [],
    previous: ready ? eligible.slice(-4, -2).map(s => s.session) : [],
    recent: ready ? eligible.slice(-2).map(s => s.session) : [],
  };
}

export function speechMode(turn, annotation) {
  // A manual label cannot turn typed text or known reading into spontaneous speech.
  if (turn.source === 'typed') return 'typed';
  if (turn.source === 'read_aloud_asr') return 'read_aloud';
  if (turn.source !== 'voice_asr') return 'unclear';
  return annotation ?? turn.speech_mode ?? 'spontaneous';
}
