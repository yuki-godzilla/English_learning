function initializeLearningPage() {
  const currentPath = new URL(window.location.href).pathname.replace(/\/+$/, "/");
  const bottomLinks = [...document.querySelectorAll(".learning-bottom-nav a")];
  for (const [index, link] of bottomLinks.entries()) {
    const targetPath = new URL(link.href, window.location.href).pathname.replace(/\/+$/, "/");
    const isCurrent = index === 0 ? currentPath === targetPath : currentPath.startsWith(targetPath);
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  const ratingLabels = {
    again: "もう一度に設定",
    remembered: "思い出せたに設定",
    mastered: "定着に設定",
  };
  for (const card of document.querySelectorAll("[data-recall-id]")) {
    const storageKey = `learning-recall:${card.dataset.recallId}`;
    const buttons = [...card.querySelectorAll("[data-recall-rating]")];
    const status = card.querySelector("[data-recall-status]");
    const showRating = (rating) => {
      for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.recallRating === rating));
      if (status) status.textContent = rating ? ratingLabels[rating] ?? "保存済み" : "未設定";
    };
    let saved = "";
    try {
      saved = window.localStorage.getItem(storageKey) ?? "";
    } catch {
      saved = "";
    }
    showRating(saved);
    for (const button of buttons) {
      button.addEventListener("click", () => {
        const rating = button.dataset.recallRating;
        try {
          window.localStorage.setItem(storageKey, rating);
        } catch {
          // The interaction still works when storage is unavailable.
        }
        showRating(rating);
      });
    }
  }

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
