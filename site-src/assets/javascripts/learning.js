function initializeLearningPage() {
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
  try { const saved = localStorage.getItem(storageKey); if (saved) state = api.validate(JSON.parse(saved)); }
  catch { storageOK = false; }
  const message = document.querySelector('[data-recall-message]');
  const say = text => { if (message) message.textContent = text; };
  const save = () => { if (!storageOK) return; try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { storageOK = false; say('このブラウザでは保存できません。履歴をファイルに保存してください。'); } };
  const recallCards = [...document.querySelectorAll('[data-recall-id]')];
  function refresh() {
    const queue = document.querySelector('[data-due-queue]');
    const due = new Set(api.dueIds(state, [...new Set([...queue?.querySelectorAll('[data-recall-id]') ?? []].map(c => c.dataset.recallId))]));
    for (const card of recallCards) {
      const item = state.cards[card.dataset.recallId], rating = item?.history.at(-1)?.rating;
      for (const button of card.querySelectorAll('[data-recall-rating]')) button.setAttribute('aria-pressed', String(button.dataset.recallRating === rating));
      const status = card.querySelector('[data-recall-status]');
      if (status) status.textContent = item ? '次回目安 ' + new Date(item.due).toLocaleDateString('ja-JP') + ' / ' + item.history.length + '回（自己申告）' : '未復習';
      if (queue?.contains(card)) card.hidden = !due.has(card.dataset.recallId);
    }
  }
  for (const card of recallCards) {
    const id = card.dataset.recallId;
    const stable = /^(expressions|vocabulary|speaking)-[a-f0-9]{16}$/.test(id);
    if (stable && !state.cards[id]) {
      try {
        const legacy = localStorage.getItem('learning-recall:' + card.dataset.legacyRecallId);
        if (['again','remembered','mastered'].includes(legacy)) {
          // No historical date was recorded. Preserve the label, but do not invent an event.
          state.cards[id] = { history: [], due: new Date(0).toISOString(), legacy_rating: legacy };
          save();
        }
      } catch { storageOK = false; }
    }
    for (const button of card.querySelectorAll('[data-recall-rating]')) {
      if (button.dataset.recallBound) continue;
      button.dataset.recallBound = 'true';
      button.addEventListener('click', () => {
        if (stable) { state = api.record(state,id,button.dataset.recallRating); save(); refresh(); }
        else { const status = card.querySelector('[data-recall-status]'); if (status) status.textContent = '練習しました（今回のみ）'; }
      });
    }
  }
  const exportButton = document.querySelector('[data-recall-export]');
  exportButton?.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'english-review-history.json'; link.click(); URL.revokeObjectURL(url);
  });
  document.querySelector('[data-recall-import]')?.addEventListener('change', async event => {
    try {
      const file = event.target.files[0]; if (!file || file.size > 2000000) throw new Error('size');
      const imported = api.validate(JSON.parse(await file.text()));
      state = api.merge(state, imported); save(); refresh(); say('履歴を統合しました。外部送信はしていません。');
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
