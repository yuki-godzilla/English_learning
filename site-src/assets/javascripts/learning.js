let cleanupRecallPage = () => {};
function initializeLearningPage() {
  cleanupRecallPage();
  const recallListeners = [];
  const listen = (target, type, handler) => {
    if (!target) return;
    target.addEventListener(type, handler);
    recallListeners.push(() => target.removeEventListener(type, handler));
  };
  cleanupRecallPage = () => recallListeners.forEach(remove => remove());
  const currentPath = new URL(window.location.href).pathname.replace(/\/+$/, "/");
  const bottomLinks = [...document.querySelectorAll(".learning-bottom-nav a")];
  for (const [index, link] of bottomLinks.entries()) {
    const targetPath = new URL(link.href, window.location.href).pathname.replace(/\/+$/, "/");
    const isCurrent = index === 0 ? currentPath === targetPath : currentPath.startsWith(targetPath);
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  const api = globalThis.LearningRecall;
  const storageKey = 'learning-recall-history-v2';
  let state = api.empty(), storageOK = true;
  const readStored = () => {
    const saved = localStorage.getItem(storageKey);
    return saved ? api.merge(api.empty(), api.validate(JSON.parse(saved))) : api.empty();
  };
  try { state = readStored(); }
  catch { storageOK = false; }
  const say = text => {
    for (const message of document.querySelectorAll('[data-recall-message]')) message.textContent = text;
    if (!storageOK) for (const recovery of document.querySelectorAll('[data-recall-recovery]')) recovery.hidden = false;
  };
  const readLatest = () => {
    if (!storageOK) return;
    try { state = api.merge(state, readStored()); }
    catch { storageOK = false; say('保存領域を読み込めません。元データは上書きせず、履歴をファイルに保存してください。'); }
  };
  const save = () => {
    if (!storageOK) return false;
    try { localStorage.setItem(storageKey, JSON.stringify(state)); return true; }
    catch { storageOK = false; say('このブラウザでは保存できません。履歴をファイルに保存してください。'); return false; }
  };
  // Web Locks serialize overlapping same-origin read/modify/write transactions.
  // Older browsers still read/merge immediately before a synchronous write,
  // but cannot guarantee serialization of truly simultaneous tab writes.
  const withStorageLock = action => globalThis.navigator?.locks?.request
    ? navigator.locks.request(storageKey, action) : Promise.resolve().then(action);
  const editState = change => withStorageLock(() => {
    readLatest();
    state = change(state);
    const persisted = save();
    refresh();
    return persisted;
  });
  const recallCards = [...document.querySelectorAll('[data-recall-id]')];
  function refresh() {
    for (const card of recallCards) {
      const item = state.cards[card.dataset.recallId], rating = item?.history.at(-1)?.rating;
      for (const button of card.querySelectorAll('[data-recall-rating]')) button.setAttribute('aria-pressed', String(button.dataset.recallRating === rating));
      const status = card.querySelector('[data-recall-status]');
      if (status) status.textContent = item?.history.length ? '次回目安 ' + new Date(item.due).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) + ' / ' + api.reviewDays(item) + '日（自己申告）'
        : item?.legacy_rating ? '以前の自己申告あり（日付不明）' : '未復習';
    }
    for (const queue of document.querySelectorAll('[data-due-queue]')) {
      const cards = [...queue.querySelectorAll('[data-recall-id]')];
      const configured = Number(queue.dataset.recallLimit ?? 5);
      const limit = Number.isInteger(configured) && configured > 0 ? configured : 5;
      const due = new Set(api.dueIds(state, cards.map(c => c.dataset.recallId), new Date(), limit));
      for (const card of cards) card.hidden = !due.has(card.dataset.recallId);
      const queueMessage = queue.querySelector('[data-recall-queue-message]');
      if (queueMessage) {
        queueMessage.hidden = due.size > 0;
        queueMessage.textContent = due.size ? '' : queue.dataset.recallEmpty ?? '今日の復習候補はありません。ここで終えて大丈夫です。';
      }
    }
  }
  listen(window, 'storage', event => {
    if (event.key !== storageKey || (event.storageArea && event.storageArea !== localStorage)) return;
    if (!event.newValue) return;
    try { state = api.merge(state, api.validate(JSON.parse(event.newValue))); refresh(); }
    catch { say('別の画面の履歴を読み込めません。現在の履歴は保持しました。'); }
  });
  // A tab left open over midnight must reconsider the queue and day-bound count.
  listen(window, 'focus', () => { readLatest(); refresh(); });
  listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') { readLatest(); refresh(); } });
  const legacyCards = [];
  for (const card of recallCards) {
    const id = card.dataset.recallId;
    const stable = /^(expressions|vocabulary|speaking)-[a-f0-9]{16}$/.test(id);
    if (stable && !state.cards[id]) {
      try {
        const legacy = localStorage.getItem('learning-recall:' + card.dataset.legacyRecallId);
        if (['again','remembered','mastered'].includes(legacy)) {
          // No historical date was recorded. Preserve the label, but do not invent an event.
          legacyCards.push({ id, rating: legacy });
        }
      } catch { storageOK = false; }
    }
    for (const button of card.querySelectorAll('[data-recall-rating]')) {
      listen(button, 'click', async () => {
        if (stable) {
          try {
            const persisted = await editState(current => api.record(current, id, button.dataset.recallRating));
            if (!persisted) say('今回はこの画面だけに保持しています。履歴をファイルに保存してください。');
          } catch { say('復習履歴を更新できません。現在の履歴は保持しました。'); }
        }
        else { const status = card.querySelector('[data-recall-status]'); if (status) status.textContent = '練習しました（今回のみ）'; }
      });
    }
  }
  if (legacyCards.length) void editState(current => {
    const next = structuredClone(current);
    for (const card of legacyCards) if (!next.cards[card.id]) next.cards[card.id] = { history: [], due: new Date(0).toISOString(), legacy_rating: card.rating };
    return next;
  }).catch(() => say('以前の履歴を引き継げません。元データは保持しました。'));
  for (const exportButton of document.querySelectorAll('[data-recall-export]')) listen(exportButton, 'click', async () => {
    try {
      await withStorageLock(readLatest);
      const url = URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = 'english-review-history.json'; link.click(); URL.revokeObjectURL(url);
    } catch { say('履歴ファイルを保存できません。現在の履歴は保持しました。'); }
  });
  listen(document.querySelector('[data-recall-import]'), 'change', async event => {
    try {
      const file = event.target.files[0]; if (!file || file.size > 2000000) throw new Error('size');
      const imported = api.validate(JSON.parse(await file.text()));
      const persisted = await editState(current => api.merge(current, imported));
      say(persisted ? '履歴を統合して保存しました。外部送信はしていません。' : '履歴はこの画面へ統合しました。ブラウザ保存はできないため、履歴をファイルに保存してください。');
    } catch { say('対応形式の復習履歴JSONを選んでください。既存履歴は保持しました。'); }
  });
  if (!storageOK) say('保存領域を読み込めません。元データは上書きせず、履歴ファイルを確認してください。');
  refresh();

  const sessionFilter = document.querySelector("[data-session-filter]");
  const sessionCards = [...document.querySelectorAll("[data-session-item]")];
  const sessionTagButtons = [...document.querySelectorAll("[data-session-tag]")];
  const sessionResult = document.querySelector("[data-session-result]");
  if (sessionFilter && sessionCards.length) {
    let selectedTag = "";
    const applySessionFilter = () => {
      const query = sessionFilter.value.normalize("NFKC").toLocaleLowerCase().trim();
      const shortLatinQuery = /^[a-z0-9+#.-]{1,3}$/.test(query);
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tokenPattern = shortLatinQuery ? new RegExp(`(^|[^a-z0-9])${escapedQuery}([^a-z0-9]|$)`) : null;
      let visible = 0;
      for (const card of sessionCards) {
        const haystack = (card.dataset.search ?? "").normalize("NFKC").toLocaleLowerCase();
        const tags = (card.dataset.tags ?? "").split("||");
        const textMatches = !query || (tokenPattern ? tokenPattern.test(haystack) : haystack.includes(query));
        const match = textMatches && (!selectedTag || tags.includes(selectedTag));
        card.hidden = !match;
        if (match) visible += 1;
      }
      if (sessionResult) sessionResult.textContent = `${visible}件を表示`;
    };
    sessionFilter.addEventListener("input", applySessionFilter);
    for (const button of sessionTagButtons) {
      button.addEventListener("click", () => {
        selectedTag = button.dataset.sessionTag ?? "";
        for (const candidate of sessionTagButtons) candidate.setAttribute("aria-pressed", String(candidate === button));
        applySessionFilter();
      });
    }
    applySessionFilter();
  }

  const filter = document.querySelector("[data-review-filter]");
  const cards = [...document.querySelectorAll("[data-review-item]")];
  const result = document.querySelector("[data-review-result]");

  if (filter && cards.length) {
    const applyFilter = () => {
      const query = filter.value.normalize("NFKC").toLocaleLowerCase().trim();
      let visible = 0;
      for (const card of cards) {
        const haystack = (card.dataset.search ?? "").normalize("NFKC").toLocaleLowerCase();
        const match = !query || haystack.includes(query);
        card.hidden = !match;
        if (match) visible += 1;
      }
      if (result) result.textContent = `${visible}件を表示`;
    };
    filter.addEventListener("input", applyFilter);
    applyFilter();
  }
}

if (window.document$) {
  window.document$.subscribe(initializeLearningPage);
} else {
  document.addEventListener("DOMContentLoaded", initializeLearningPage);
}
