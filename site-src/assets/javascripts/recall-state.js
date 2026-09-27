/** Private, portable practice history. Self-report is not a proficiency score. */
globalThis.LearningRecall = (() => {
  const DAY = 86400000;
  const ratings = new Set(['again', 'remembered', 'mastered']);
  const empty = () => ({ version: 2, cards: {} });
  function validate(value) {
    if (!value || value.version !== 2 || !value.cards || typeof value.cards !== 'object' || Array.isArray(value.cards)) throw new Error('Unsupported review backup');
    if (Object.keys(value.cards).length > 10000) throw new Error('Backup too large');
    for (const [id, card] of Object.entries(value.cards)) {
      if (!/^(expressions|vocabulary|speaking)-[a-f0-9]{16}$/.test(id)) throw new Error('Unknown card ID');
      if (!Array.isArray(card.history) || card.history.length > 10000 || !Number.isFinite(Date.parse(card.due))) throw new Error('Invalid review history');
      for (const h of card.history) if (!ratings.has(h.rating) || !Number.isFinite(Date.parse(h.at))) throw new Error('Invalid review event');
    }
    return value;
  }
  function record(state, id, rating, now = new Date()) {
    if (!ratings.has(rating)) throw new Error('Invalid rating');
    const next = JSON.parse(JSON.stringify(state)), prior = next.cards[id]?.history ?? [];
    const last = prior.at(-1);
    // Repeated clicks on the same day do not increase the interval.
    const today = now.toISOString().slice(0,10);
    const earlier = prior.filter(h => h.at.slice(0,10) < today);
    const lastAgain = earlier.findLastIndex(h => h.rating === 'again');
    const successes = new Set(earlier.slice(lastAgain + 1).filter(h => h.rating !== 'again').map(h => h.at.slice(0,10))).size;
    const days = rating === 'again' ? 1 : [2, 4, 7, 14, 30][Math.min(successes,4)];
    if (last?.at.slice(0,10) === now.toISOString().slice(0,10)) prior.pop();
    prior.push({ at: now.toISOString(), rating });
    next.cards[id] = { history: prior, due: new Date(+now + days * DAY).toISOString() };
    return validate(next);
  }
  function merge(a, b) {
    validate(a); validate(b); const out = empty();
    for (const id of new Set([...Object.keys(a.cards), ...Object.keys(b.cards)])) {
      const history = [...new Map([...(a.cards[id]?.history ?? []), ...(b.cards[id]?.history ?? [])].map(h => [h.at, h])).values()].sort((x,y) => x.at.localeCompare(y.at));
      const candidates = [a.cards[id],b.cards[id]].filter(Boolean).sort((x,y) => (x.history.at(-1)?.at ?? '').localeCompare(y.history.at(-1)?.at ?? ''));
      out.cards[id] = { history, due: candidates.at(-1).due };
    }
    return validate(out);
  }
  function dueIds(state, ids, now = new Date(), limit = 5) {
    return ids.filter(id => !state.cards[id] || Date.parse(state.cards[id].due) <= +now)
      .sort((a,b) => (Date.parse(state.cards[a]?.due) || 0) - (Date.parse(state.cards[b]?.due) || 0)).slice(0,limit);
  }
  return { empty, validate, record, merge, dueIds };
})();
