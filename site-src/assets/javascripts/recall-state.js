/** Private, portable practice history. Self-report is not a proficiency score. */
globalThis.LearningRecall = (() => {
  const DAY = 86400000;
  const ratings = new Set(['again', 'remembered', 'mastered']);
  const tiePriority = { mastered: 0, remembered: 1, again: 2 };
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const empty = () => ({ version: 2, cards: {} });
  function dayKey(value) {
    const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(value)).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function validate(value) {
    if (!value || value.version !== 2 || !value.cards || typeof value.cards !== 'object' || Array.isArray(value.cards)) throw new Error('Unsupported review backup');
    if (Object.keys(value.cards).length > 10000) throw new Error('Backup too large');
    for (const [id, card] of Object.entries(value.cards)) {
      if (!/^(expressions|vocabulary|speaking)-[a-f0-9]{16}$/.test(id)) throw new Error('Unknown card ID');
      if (!card || !Array.isArray(card.history) || card.history.length > 10000 || !Number.isFinite(Date.parse(card.due))) throw new Error('Invalid review history');
      for (const h of card.history) if (!h || !ratings.has(h.rating) || typeof h.at !== 'string' || !Number.isFinite(Date.parse(h.at))) throw new Error('Invalid review event');
    }
    return value;
  }
  function compareEvents(a, b) {
    // Equal-time conflicts conservatively prefer "again", independent of merge order.
    return Date.parse(a.at) - Date.parse(b.at) || tiePriority[a.rating] - tiePriority[b.rating] || a.at.localeCompare(b.at);
  }
  function dailyEvents(history) {
    const days = new Map();
    for (const event of [...history].sort(compareEvents)) days.set(dayKey(event.at), event);
    return [...days.values()];
  }
  function reviewDays(card) { return dailyEvents(card?.history ?? []).length; }
  function dueFromHistory(history) {
    const daily = dailyEvents(history), last = daily.at(-1);
    if (!last) return new Date(0).toISOString(); // Legacy labels have no recoverable practice date.
    const earlier = daily.slice(0, -1), lastAgain = earlier.findLastIndex(h => h.rating === 'again');
    const successes = earlier.slice(lastAgain + 1).filter(h => h.rating !== 'again').length;
    const days = last.rating === 'again' ? 1 : [2, 4, 7, 14, 30][Math.min(successes, 4)];
    return new Date(Date.parse(last.at) + days * DAY).toISOString();
  }
  function merge(a, b) {
    validate(a); validate(b); const out = empty();
    for (const id of [...new Set([...Object.keys(a.cards), ...Object.keys(b.cards)])].sort()) {
      // Keep original timestamp/rating events, including historical same-day changes.
      const history = [...new Map([...(a.cards[id]?.history ?? []), ...(b.cards[id]?.history ?? [])]
        .map(h => [`${h.at}\u0000${h.rating}`, { ...h }])).values()].sort(compareEvents);
      const legacy = [a.cards[id]?.legacy_rating, b.cards[id]?.legacy_rating]
        .filter(r => ratings.has(r)).sort((x, y) => tiePriority[x] - tiePriority[y]).at(-1);
      out.cards[id] = { history, due: dueFromHistory(history), ...(legacy ? { legacy_rating: legacy } : {}) };
    }
    return validate(out);
  }
  function record(state, id, rating, now = new Date()) {
    if (!ratings.has(rating)) throw new Error('Invalid rating');
    // Real events remain portable; repeated clicks on a JST day do not add review days.
    const event = { at: now.toISOString(), rating };
    return merge(state, { version: 2, cards: { [id]: { history: [event], due: event.at } } });
  }
  function dueIds(state, ids, now = new Date(), limit = 5) {
    return [...new Set(ids)].filter(id => !state.cards[id] || Date.parse(dueFromHistory(state.cards[id].history)) <= +now)
      .sort((a, b) => (state.cards[a] ? Date.parse(dueFromHistory(state.cards[a].history)) : 0)
        - (state.cards[b] ? Date.parse(dueFromHistory(state.cards[b].history)) : 0)).slice(0, limit);
  }
  return { empty, validate, record, merge, dueIds, dayKey, reviewDays };
})();
