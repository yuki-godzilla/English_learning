import fs from "node:fs/promises";
import path from "node:path";
import { loadJournal } from "../lib/journal-parser.mjs";
import { analyzeTranscripts } from "../transcripts/analyze.mjs";
import { buildReportModel, ratingLabel, pronunciationBasis } from "../lib/evidence.mjs";
import { tableRows as sharedTableRows } from '../lib/markdown-table.mjs';
import { projectRoot as root, recordsRoot } from "../lib/project.mjs";

const outputRoot = path.join(root, ".generated-site-docs");

function assertGeneratedPath(target) {
  const resolved = path.resolve(target);
  if (resolved !== path.resolve(outputRoot) && !resolved.startsWith(`${path.resolve(outputRoot)}${path.sep}`)) {
    throw new Error(`Refusing to write outside generated site directory: ${resolved}`);
  }
}

async function writeGenerated(relativePath, content) {
  const target = path.join(outputRoot, relativePath);
  assertGeneratedPath(target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content.replaceAll("\r\n", "\n"), "utf8");
}

async function copyGenerated(source, relativePath) {
  const target = path.join(outputRoot, relativePath);
  assertGeneratedPath(target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripMarkdown(value) {
  return String(value ?? "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\\`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inlineMarkdown(value) {
  let html = escapeHtml(String(value ?? ""));
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  return html;
}

function truncate(value, maxLength = 150) {
  const text = stripMarkdown(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trim()}…`;
}

function firstSentence(value, maxLength = 180) {
  const text = stripMarkdown(value);
  const match = text.match(/^.*?[。！？]/);
  return truncate(match?.[0] ?? text, maxLength);
}

function redactLearnerText(value) {
  return String(value ?? "")
    .replace(/\[([^\]]*(?:Daigas|Osaka Gas|大阪ガス|University of Osaka|Osaka University|Institute of Laser Engineering|大阪大学|レーザー科学研究所)[^\]]*)\]\(https?:\/\/[^)]+\)/gi, "$1")
    .replace(/https?:\/\/(?:www\.)?(?:daigasgroup\.com|[^/]*osaka-u\.ac\.jp)\/[^\s)]+/gi, "")
    .replace(/\bDaigas Group\b/gi, "the target energy company")
    .replace(/\bOsaka Gas\b/gi, "the target energy company")
    .replace(/大阪ガス/g, "応募先のエネルギー企業")
    .replace(/\bInstitute of Laser Engineering\b/gi, "university research institute")
    .replace(/レーザー科学研究所/g, "大学の研究機関")
    .replace(/\bThe University of Osaka\b/gi, "a university research institute")
    .replace(/\bOsaka University\b/gi, "a university research institute")
    .replace(/大阪大学/g, "大学の研究機関")
    .replace(/\b(?:laser fusion|fast[ -]ignition|inertial confinement fusion)\b/gi, "advanced-energy research")
    .replace(/レーザー核融合|核融合研究|高速点火/g, "先端エネルギー研究")
    .replace(/\bSMAI\b/g, "the investment-support app")
    .replace(/\baround twenty vendor engineers\b/gi, "an external engineering team")
    .replace(/約20名のベンダーエンジニア/g, "複数の外部エンジニア");
}

function formatDateJa(date) {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}年${month}月${day}日（${weekday}）`;
}

function normalizeKey(value) {
  return stripMarkdown(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.!?。！？]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTableRows(markdown) { return sharedTableRows(markdown).filter(c => !/^(目的|Metric|テスト種別)/i.test(stripMarkdown(c[0]))); }

function extractRange(markdown, startPattern, endPattern) {
  const start = markdown.search(startPattern);
  if (start < 0) return "";
  const rest = markdown.slice(start);
  const endRelative = rest.search(endPattern);
  return endRelative < 0 ? rest : rest.slice(0, endRelative);
}

function removeSection(markdown, headingPattern, nextHeadingPattern) {
  const start = markdown.search(headingPattern);
  if (start < 0) return markdown;
  const rest = markdown.slice(start);
  const next = rest.slice(1).search(nextHeadingPattern);
  return next < 0
    ? markdown.slice(0, start)
    : `${markdown.slice(0, start)}${rest.slice(next + 1)}`;
}

const tracker = JSON.parse(await fs.readFile(path.join(recordsRoot, "progress.json"), "utf8"));
const mediaManifest = JSON.parse(await fs.readFile(path.join(recordsRoot, "media-manifest.json"), "utf8"));
const journal = await loadJournal();
const speakingAnalytics = await analyzeTranscripts();
const sessionDefinitions = [...journal.sessions];
const trackerByNumber = new Map(tracker.sessions.map((session) => [session.session, session]));
for (const trackerSession of tracker.sessions) {
  if (!sessionDefinitions.some((session) => session.session === trackerSession.session)) {
    throw new Error(`Progress Session ${trackerSession.session} has no matching Journal session-meta record`);
  }
}
sessionDefinitions.sort((a, b) => b.date.localeCompare(a.date) || b.session - a.session);

const sessionDefinitionByNumber = new Map(sessionDefinitions.map((session) => [session.session, session]));
const sessionDefinitionById = new Map(sessionDefinitions.map((session) => [session.id, session]));
const currentBodies = new Map(sessionDefinitions.map((session) => [session.session, session.raw]));

function convertGithubAlerts(markdown) {
  const types = {
    NOTE: "note",
    TIP: "tip",
    IMPORTANT: "abstract",
    WARNING: "warning",
    CAUTION: "danger",
  };
  return markdown.replace(
    /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\r?\n((?:>[^\n]*(?:\r?\n|$))*)/gm,
    (_, label, quotedBody) => {
      const body = quotedBody
        .replace(/^> ?/gm, "    ")
        .trimEnd();
      return `!!! ${types[label]} "${label}"\n\n${body}`;
    },
  );
}

function cleanSessionBody(markdown, session) {
  let body = markdown
    .replace(/<!--.*?-->/gs, "")
    .replace(/<a\s+id=["'][^"']+["']\s*><\/a>/g, "")
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^\[[^\n]+\]\([^\n]+\).*$/gm, (line) => line.includes("ページ先頭") || line.includes("目次") || line.includes("Session Index") ? "" : line)
    .replace(/^> \*\*Session[^\n]*$/gm, "")
    .replace(/^> \*\*主な話題[^\n]*$/gm, "")
    .replace(/^## Session \d+[^\n]*$/gm, "")
    .replace(/^## .*?(?:2026|8月).*?(?:\n|$)/m, "")
    .replace(/^### 資格スコア予測[\s\S]*?(?=^### 学習バンク更新|^### 次回)/m, "")
    .replace(/^### 学習バンク更新[\s\S]*?(?=^### 次回)/m, "")
    .replace(/^## 学習バンク更新[\s\S]*?(?=^## 次回|^## Sources)/m, "")
    .replace(/^### Study Banks Update[\s\S]*?(?=^### Next|^## Next)/m, "")
    .replace(/^### Visual \/ Figure\s*$/gm, "")
    .replace(/^## \*\*Visual \/ Figure\*\*\s*$/gm, "")
    .replace(/^\*\s*$/gm, "")
    .replace(/^─{3,}\s*$/gm, "")
    .replace(/^(#{2,4}) \*\*(.*?)\*\*\s*$/gm, "$1 $2")
    .replace(/\\\./g, ".")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  for (const fileName of new Set([
    "microgrid-data-center-grid.png",
    "2026-08-27-microgrid-diagram.png",
    "electricity-demand-chart.png",
    "2026-08-27-electricity-demand-growth.png",
    "local-cloud-hybrid-ai.png",
    "2026-08-19-hybrid-ai-comparison.png",
    "2026-09-24-model-benchmark-comparison.png",
    ...mediaManifest.files
      .filter((entry) => entry.status === "published" && entry.session_id)
      .map((entry) => path.basename(entry.path)),
  ])) {
    body = body.replace(new RegExp(`^.*!\\[[^\\]]*\\]\\([^\\n)]*${fileName.replaceAll(".", "\\.")}[^\\n]*$`, "gm"), "");
  }

  body = body
    .replace(/!\[([^\]]*)\]\((?:\.\.\/)*assets\/([^/)]+)\)/g, "![$1](../assets/media/$2)")
    .replace(/\([^)]*banks\/expression-bank\.md[^)]*\)/g, "(../review/expressions.md)")
    .replace(/\([^)]*banks\/vocabulary-bank\.md[^)]*\)/g, "(../review/vocabulary.md)")
    .replace(/\([^)]*banks\/pronunciation-speaking-bank\.md[^)]*\)/g, "(../review/speaking.md)")
    .replace(/\([^)]*session-index\.md[^)]*\)/g, "(index.md)")
    .replace(/\([^)]*latest\.md[^)]*\)/g, "(../index.md)");

  if (session.session <= 5 || session.session === 7 || session.session === 8) {
    body = body.replace(/^## ([^\n]{100,})$/gm, "$1");
  }
  if (/^## (?!#)/m.test(body)) {
    body = body.replace(/^(#{2,5}) (?!#)/gm, "$1# ");
  }
  return redactLearnerText(convertGithubAlerts(body));
}

const mediaBySession = new Map();
for (const item of mediaManifest.files.filter((entry) => entry.status === "published" && entry.session_id)) {
  const session = sessionDefinitionById.get(item.session_id);
  if (!session) throw new Error(`Media references an unknown session: ${item.path}`);
  const entries = mediaBySession.get(session.session) ?? [];
  entries.push({
    ...item,
    file: path.basename(item.path),
    sourceLabel: item.creator ?? "Media source",
    sourceUrl: item.source_url,
    licenseLabel: item.license,
    licenseUrl: item.license_url,
  });
  mediaBySession.set(session.session, entries);
}

function uniqueBankRows(markdown) {
  const rows = [];
  const seen = new Set();
  for (const cells of parseTableRows(markdown)) {
    const key = normalizeKey(cells[0]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(cells.slice(0, 3));
  }
  return rows;
}

const expressionRows = uniqueBankRows(journal.sections.expressions);
const vocabularyRows = uniqueBankRows(journal.sections.vocabulary);
const speakingRows = uniqueBankRows(journal.sections.speaking);

function sourceSessionNumber(source) {
  const anchoredSession = String(source).match(/#session-(\d{4}-\d{2}-\d{2}-\d{2})/i);
  if (anchoredSession) {
    const definition = sessionDefinitionById.get(anchoredSession[1]);
    if (definition) return definition.session;
  }
  const plain = stripMarkdown(source);
  const explicit = plain.match(/Session\s*(\d+)/i);
  if (explicit) return Number(explicit[1]);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (const session of sessionDefinitions) {
    const [year, month, day] = session.date.split("-").map(Number);
    const patterns = [
      new RegExp(`${year}[-/]0?${month}[-/]0?${day}`),
      new RegExp(`${month}月\\s*0?${day}`),
      new RegExp(`${monthNames[month - 1]}\\s*0?${day}`, "i"),
    ];
    if (patterns.some((pattern) => pattern.test(plain))) return session.session;
  }
  return null;
}

function reviewCard(cells, kind) {
  const title = stripMarkdown(cells[0]);
  const detail = inlineMarkdown(cells[1]);
  const kindClass = ({ Expression: "expression", Vocabulary: "vocabulary", Speaking: "speaking" })[kind] ?? "default";
  const sourceSession = sourceSessionNumber(cells[2]);
  const source = sourceSession
    ? `<a href="../../sessions/${sessionDefinitionByNumber.get(sourceSession).id}/">Session ${sourceSession}</a>`
    : escapeHtml(stripMarkdown(cells[2]) || "移行記録");
  const search = escapeHtml(`${title} ${stripMarkdown(cells[1])}`);
  return `<article class="review-card review-card--${kindClass}" data-review-item data-search="${search}">
  <div class="card-meta">${escapeHtml(kind)} · ${source}</div>
  <h2>${escapeHtml(title)}</h2>
  <div class="review-example">${detail}</div>
</article>`;
}

function latestRows(rows, sessionNumber, limit) {
  return rows.filter((row) => sourceSessionNumber(row[2]) === sessionNumber).slice(0, limit);
}

const bankLedger = JSON.parse(await fs.readFile(path.join(recordsRoot, 'resources/bank-ledger.json'), 'utf8'));
function recallCard(summary, answer, key) {
  const bank = key.startsWith('expression-') ? 'expressions' : key.startsWith('vocabulary-') ? 'vocabulary' : key.startsWith('speaking-') ? 'speaking' : null;
  const plainKey = key.replace(/^[^-]+-/, '');
  const identity = bankLedger.items.find(item => item.bank === bank && normalizeKey(item.key) === plainKey)?.id;
  return `<details class="recall-card" data-recall-id="${escapeHtml(identity ?? key)}" data-legacy-recall-id="${escapeHtml(key)}">
  <summary>${summary}</summary>
  <div class="recall-answer">${answer}
    <div class="recall-rating" aria-label="この端末での復習状態">
      <button type="button" data-recall-rating="again">もう一度</button>
      <button type="button" data-recall-rating="remembered">思い出せた</button>
      <button type="button" data-recall-rating="mastered">自信あり（自己申告）</button>
      <span data-recall-status aria-live="polite"></span>
    </div>
  </div>
</details>`;
}

const latestDefinition = sessionDefinitions[0];
const latestSessionTracker = trackerByNumber.get(latestDefinition.session);
const latestTracker = latestSessionTracker
  ?? [...tracker.sessions].sort((a, b) => b.session - a.session)[0];
if (!latestTracker) throw new Error("learning-records/progress.json has no evaluation sessions");
const latestWinText = latestSessionTracker?.evidence_note_ja ?? latestDefinition.remember;
const latestExpressions = latestRows(expressionRows, latestDefinition.session, 2);
const latestVocabulary = latestRows(vocabularyRows, latestDefinition.session, 1);
const latestSpeaking = latestRows(speakingRows, latestDefinition.session, 1);
const olderExpression = expressionRows.find((row) => {
  const sessionNumber = sourceSessionNumber(row[2]);
  return sessionNumber && sessionNumber !== latestDefinition.session;
});
const priorityVocabulary = vocabularyRows.find((row) => /要復習|Review Priority/i.test(stripMarkdown(row[1]))) ?? latestVocabulary[0];
const reviewExpressions = [latestExpressions[0], olderExpression].filter(Boolean);
const reviewVocabulary = priorityVocabulary ? [priorityVocabulary] : [];
const reviewSpeaking = latestSpeaking[0] ?? speakingRows[0];

const homeReviewCards = [
  ...reviewExpressions.map((row) => recallCard(escapeHtml(truncate(row[1], 70)), `<strong>${escapeHtml(stripMarkdown(row[0]))}</strong>`, `expression-${normalizeKey(row[0])}`)),
  ...reviewVocabulary.map((row) => recallCard(`この語を説明できますか？ ${escapeHtml(stripMarkdown(row[0]).split("/")[0])}`, inlineMarkdown(row[1]), `vocabulary-${normalizeKey(row[0])}`)),
  ...(reviewSpeaking ? [recallCard(`声に出す：${escapeHtml(stripMarkdown(reviewSpeaking[0]))}`, inlineMarkdown(reviewSpeaking[1]), `speaking-${normalizeKey(reviewSpeaking[0])}`)] : []),
].join("\n");

const homePromptCard = recallCard(
  "60秒で話す",
  `<strong>${escapeHtml(latestDefinition.prompt)}</strong><br>Main point → reason → example → conclusion の順で話します。`,
  `prompt-${latestDefinition.id}`,
);

assertGeneratedPath(outputRoot);
await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });

const home = `---
title: ホーム
hide:
  - toc
---

<section class="learning-hero">
  <div class="learning-kicker">Yuki × Chappy English Journal</div>
  <h1>話したことを、次に話せる英語へ。</h1>
  <p>会話を読み返し、表現を思い出し、成長を実感するための学習ホームです。</p>
  <div class="learning-actions">
    <a class="learning-action" href="sessions/${latestDefinition.id}/">最新セッションを振り返る</a>
    <a class="learning-action secondary" href="review/">5分復習を始める</a>
  </div>
</section>

## Continue Learning

<article class="session-card">
  <div class="card-meta">Session ${latestDefinition.session} · ${formatDateJa(latestDefinition.date)}</div>
  <h2><a href="sessions/${latestDefinition.id}/">${escapeHtml(latestDefinition.title)}</a></h2>
  <p>${escapeHtml(latestDefinition.remember)}</p>
  <div class="learning-tags">${latestDefinition.tags.map((tag) => `<span class="learning-tag">${escapeHtml(tag)}</span>`).join("")}</div>
</article>

## 今回できたこと

<div class="latest-win">
  <strong>今回できたこと</strong><br>
  ${escapeHtml(redactLearnerText(firstSentence(latestWinText)))}
</div>

## 今日の5分復習

${homeReviewCards}

${homePromptCard}

## 学習の全体像

<div class="learning-grid">
  <article class="learning-card"><div class="card-meta">Sessions</div><h3>${sessionDefinitions.length}回の会話記録</h3><p>日常、AI、エネルギー、キャリア、文化の話題を記録しています。</p><a href="sessions/">すべて見る →</a></article>
  <article class="learning-card"><div class="card-meta">Review</div><h3>表現・語彙・スピーキング</h3><p>横長の表ではなく、一項目ずつ読める復習カードです。</p><a href="review/">復習する →</a></article>
  <article class="learning-card"><div class="card-meta">Growth</div><h3>現在の強みと次の重点</h3><p>数値だけでなく、実際にできた行動から成長を確認します。</p><a href="progress/">成長を見る →</a></article>
</div>

## 最近のセッション

<div class="session-grid">
${sessionDefinitions.slice(0, 3).map((session) => `<article class="session-card"><div class="card-meta">Session ${session.session} · ${formatDateJa(session.date)}</div><h2><a href="sessions/${session.id}/">${escapeHtml(session.title)}</a></h2><p>${escapeHtml(session.remember)}</p></article>`).join("\n")}
</div>
`;

const sessionIndex = `---
title: すべてのセッション
hide:
  - toc
---

# すべてのセッション

新しい順に、話題と「覚えておきたいこと」から選べます。タイトルを開くと、30秒の振り返り、復習、会話記録へ進みます。Journal PDFでは、ここに全履歴を載せ、詳しいDaily Noteは最新3回を収録します。

<label for="session-filter"><strong>セッションを検索</strong></label>
<input id="session-filter" class="review-filter" type="search" placeholder="話題、英語、タグで絞り込む" data-session-filter>
<div class="tag-filter" aria-label="テーマで絞り込む">
  <button type="button" data-session-tag="" aria-pressed="true">すべて</button>
  ${[...new Set(sessionDefinitions.flatMap((session) => session.tags))].map((tag) => `<button type="button" data-session-tag="${escapeHtml(normalizeKey(tag))}" aria-pressed="false">${escapeHtml(tag)}</button>`).join("\n  ")}
</div>
<p class="card-meta" data-session-result aria-live="polite"></p>

<div class="session-grid">
${sessionDefinitions.map((session) => {
  const trackerSession = trackerByNumber.get(session.session);
  return `<article class="session-card" data-session-item data-search="${escapeHtml(redactLearnerText(`${session.title} ${session.tags.join(" ")} ${session.remember} ${trackerSession?.evidence_quote ?? ""}`))}" data-tags="${escapeHtml(session.tags.map(normalizeKey).join("||"))}"><div class="card-meta">Session ${session.session} · ${formatDateJa(session.date)}</div><h2><a href="${session.id}/">${escapeHtml(session.title)}</a></h2><div class="learning-tags">${session.tags.map((tag) => `<span class="learning-tag">${escapeHtml(tag)}</span>`).join("")}</div><p><strong>Remember:</strong> ${escapeHtml(session.remember)}</p></article>`;
}).join("\n")}
</div>
`;

function figureMarkup(media) {
  const source = media.sourceUrl
    ? `<a href="${escapeHtml(media.sourceUrl)}">${escapeHtml(media.sourceLabel)}</a>`
    : escapeHtml(media.sourceLabel);
  const sourcePrefix = escapeHtml(media.sourcePrefix ?? "出典");
  const license = media.licenseUrl && media.licenseLabel
    ? ` · License: <a href="${escapeHtml(media.licenseUrl)}">${escapeHtml(media.licenseLabel)}</a>`
    : "";
  const notice = media.notice ? `<span class="figure-notice">${escapeHtml(media.notice)}</span>` : "";
  return `<figure class="figure-frame"><a href="../../assets/media/${media.file}"><img src="../../assets/media/${media.file}" alt="${escapeHtml(media.alt)}" loading="lazy"></a><figcaption>${escapeHtml(media.caption)} ${sourcePrefix}: ${source}${license} · タップすると原寸表示${notice}</figcaption></figure>`;
}

function insertAfterFirstParagraph(markdown, headingPattern, figure) {
  const heading = markdown.match(headingPattern);
  if (!heading || heading.index == null) return { markdown, inserted: false };
  const contentStart = heading.index + heading[0].length;
  const paragraphStartRelative = markdown.slice(contentStart).search(/\S/);
  if (paragraphStartRelative < 0) return { markdown, inserted: false };
  const paragraphStart = contentStart + paragraphStartRelative;
  const paragraphEndRelative = markdown.slice(paragraphStart).search(/\n\s*\n/);
  const paragraphEnd = paragraphEndRelative < 0 ? markdown.length : paragraphStart + paragraphEndRelative;
  return {
    markdown: `${markdown.slice(0, paragraphEnd)}\n\n${figure}${markdown.slice(paragraphEnd)}`,
    inserted: true,
  };
}

function placeSessionMedia(markdown, session, media) {
  if (!media.length) return markdown;
  let placed = markdown;
  const insertedItems = new Set();
  const placements = session.session === 12
    ? [[/^#### GPT-5\.6とGPT-6 Astraの選び方\s*$/m, media[0]]]
    : session.session === 8
    ? [
        [/^#### 1\. AIデータセンターと電力需要\s*$/m, media[1]],
        [/^#### 2\. Microgridが担う役割\s*$/m, media[0]],
      ]
    : session.session === 6
      ? [[/^#### 1\. Local AI・Cloud AI・Hybrid AI\s*$/m, media[0]]]
      : [];
  for (const [headingPattern, item] of placements) {
    if (!item) continue;
    const result = insertAfterFirstParagraph(placed, headingPattern, figureMarkup(item));
    placed = result.markdown;
    if (result.inserted) insertedItems.add(item);
  }
  const remaining = media.filter((item) => !insertedItems.has(item));
  if (remaining.length) {
    placed = `${remaining.map(figureMarkup).join("\n")}\n\n${placed}`;
  }
  return placed;
}

function sessionRecallCards(session) {
  const cards = [];
  for (const row of latestRows(expressionRows, session.session, 2)) {
    cards.push(recallCard(escapeHtml(truncate(row[1], 85)), `<strong>${escapeHtml(stripMarkdown(row[0]))}</strong>`, `expression-${normalizeKey(row[0])}`));
  }
  for (const row of latestRows(vocabularyRows, session.session, 1)) {
    cards.push(recallCard(`${escapeHtml(stripMarkdown(row[0]).split("/")[0])} はどんな意味？`, inlineMarkdown(row[1]), `vocabulary-${normalizeKey(row[0])}`));
  }
  for (const row of latestRows(speakingRows, session.session, 1)) {
    cards.push(recallCard(`声に出す：${escapeHtml(stripMarkdown(row[0]))}`, inlineMarkdown(row[1]), `speaking-${normalizeKey(row[0])}`));
  }
  cards.push(recallCard("このテーマを60秒で話す", `<strong>${escapeHtml(session.prompt)}</strong><br>Main point → reason → example → conclusion`, `prompt-${session.id}`));
  return cards.join("\n");
}

function sessionNavigation(index) {
  const newer = sessionDefinitions[index - 1];
  const older = sessionDefinitions[index + 1];
  return `<nav class="session-navigation" aria-label="前後のセッション">${newer ? `<a href="../${newer.id}/">← 新しい記録<br><strong>Session ${newer.session}</strong></a>` : "<span></span>"}${older ? `<a href="../${older.id}/">古い記録 →<br><strong>Session ${older.session}</strong></a>` : ""}</nav>`;
}

for (const [index, session] of sessionDefinitions.entries()) {
  const trackerSession = trackerByNumber.get(session.session);
  const rawBody = currentBodies.get(session.session);
  if (!rawBody) throw new Error(`No Journal content found for Session ${session.session}`);
  const cleanedBody = cleanSessionBody(rawBody, session);
  const media = mediaBySession.get(session.session) ?? [];
  const body = placeSessionMedia(cleanedBody, session, media);
  const page = `---
title: "Session ${session.session} · ${session.title}"
description: "${escapeHtml(session.remember)}"
---

# ${escapeHtml(session.title)}

<div class="session-meta">Session ${session.session} · ${formatDateJa(session.date)} · ${trackerSession?.ratings?.Pronunciation == null ? "Pronunciation N/A" : `Pronunciation L${trackerSession.ratings.Pronunciation}`}</div>

<div class="learning-tags">${session.tags.map((tag) => `<span class="learning-tag">${escapeHtml(tag)}</span>`).join("")}</div>

## 30秒で振り返る

<div class="learning-grid">
  <article class="learning-card learning-card--remember"><div class="card-meta">Remember</div><h3>話したこと</h3><p>${escapeHtml(session.remember)}</p></article>
  <article class="learning-card learning-card--growth"><div class="card-meta">Growth</div><h3>今回できたこと</h3><p>${escapeHtml(redactLearnerText(firstSentence(trackerSession?.evidence_note_ja ?? session.remember)))}</p></article>
  ${trackerSession?.evidence_quote ? `<article class="learning-card learning-card--context"><div class="card-meta">My English in Context</div><h3>発話の記録（修正前）</h3><p lang="en">${escapeHtml(redactLearnerText(truncate(trackerSession.evidence_quote, 190)))}</p></article>` : ""}
</div>

## 今すぐ復習

${sessionRecallCards(session)}

<a id="session-${session.session}-record"></a>
## セッション記録

${body}

${sessionNavigation(index)}
`;
  await writeGenerated(path.join("sessions", `${session.id}.md`), page);
}

function reviewPage(title, intro, rows, kind) {
  return `---
title: ${title}
hide:
  - toc
search:
  exclude: true
---

# ${title}

${intro}

<label for="review-filter"><strong>検索</strong></label>
<input id="review-filter" class="review-filter" type="search" placeholder="英語または日本語で絞り込む" data-review-filter>
<p class="card-meta" data-review-result aria-live="polite"></p>

<div class="review-list">
${rows.map((row) => reviewCard(row, kind)).join("\n")}
</div>
`;
}

const reviewHome = `---
title: 今日の5分復習
hide:
  - toc
---

# 今日の5分復習

読むだけで終わらず、いったん思い出してから答えを開くページです。

復習状態はこの端末のブラウザだけに保存します。Gitや別端末へは送信しません。

<div class="recall-tools"><button type="button" data-recall-export>復習履歴を保存</button> <label>別端末の履歴を取り込む <input type="file" accept="application/json" data-recall-import></label><p data-recall-message aria-live="polite">日数の連続記録は競いません。今日は一つ思い出せれば十分です。</p></div>

## 今日の復習候補（最大5項目）

<div data-due-queue>${[
  ...expressionRows.map(row => recallCard(escapeHtml(truncate(row[1],80)), `<strong>${escapeHtml(stripMarkdown(row[0]))}</strong>`, `expression-${normalizeKey(row[0])}`)),
  ...vocabularyRows.map(row => recallCard(escapeHtml(stripMarkdown(row[0])), inlineMarkdown(row[1]), `vocabulary-${normalizeKey(row[0])}`)),
  ...speakingRows.map(row => recallCard(escapeHtml(stripMarkdown(row[0])), inlineMarkdown(row[1]), `speaking-${normalizeKey(row[0])}`)),
].join('\n')}</div>

## 1. 表現を思い出す

${reviewExpressions.map((row) => recallCard(escapeHtml(truncate(row[1], 80)), `<strong>${escapeHtml(stripMarkdown(row[0]))}</strong>`, `expression-${normalizeKey(row[0])}`)).join("\n")}

## 2. 語彙を説明する

${reviewVocabulary.map((row) => recallCard(`${escapeHtml(stripMarkdown(row[0]).split("/")[0])} はどんな意味？`, inlineMarkdown(row[1]), `vocabulary-${normalizeKey(row[0])}`)).join("\n")}

## 3. 声に出す

${latestSpeaking.map((row) => recallCard(escapeHtml(stripMarkdown(row[0])), inlineMarkdown(row[1]), `speaking-${normalizeKey(row[0])}`)).join("\n")}

## 4. 60秒で話す

${recallCard("最新テーマを60秒で話す", `<strong>${escapeHtml(latestDefinition.prompt)}</strong><br>Main point → reason → example → conclusion`, `prompt-${latestDefinition.id}`)}

## Bankを探す

<div class="learning-grid">
  <article class="learning-card"><h3><a href="expressions/">表現</a></h3><p>次の会話でそのまま再利用する言い回し。</p></article>
  <article class="learning-card"><h3><a href="vocabulary/">語彙</a></h3><p>意味、Collocation、Exampleを確認する。</p></article>
  <article class="learning-card"><h3><a href="speaking/">発音・スピーキング</a></h3><p>声に出すチャンクと練習ポイント。</p></article>
</div>
`;

const metricJa = {
  "Task achievement": "課題達成",
  "Fluency & coherence": "流暢さ・一貫性",
  "Lexical resource": "語彙運用",
  "Grammar control": "文法運用",
  "Interaction & repair": "対話・言い直し",
  Pronunciation: "発音",
};
const testDefinitions = tracker.test_score_estimates.definitions;
const estimateSessions = tracker.test_score_estimates.estimate_sessions;
const latestEstimateFor = (testId) => [...estimateSessions].reverse().find((session) => session.estimates?.[testId]);
const lastPronunciation = [...tracker.sessions].reverse().find((session) => Number.isInteger(session.ratings.Pronunciation));
const latestObservedByMetric = new Map(
  tracker.qualitative_metrics.map((metric) => [
    metric,
    [...tracker.sessions].reverse().find((session) => Number.isInteger(session.ratings[metric])),
  ]),
);
const firstTracker = [...tracker.sessions].sort((a, b) => a.session - b.session)[0];
const nextFocusByMetric = {
  "Task achievement": "話す前に結論を一文で決め、理由と例を一つずつ加える。",
  "Fluency & coherence": "長い説明でも、Main point → reason → example → conclusion の順を保つ。",
  "Lexical resource": "新しく覚えた表現を、次の会話で一度自分から使う。",
  "Grammar control": "時制と単数・複数を意識し、短い文を安定させてからつなぐ。",
  "Interaction & repair": "分からない点を確認した後、自分の言葉で要点を言い直す。",
  Pronunciation: "同じ60秒課題を直接録音し、比較できる発音データを一つ増やす。",
};
const nextFocusEntry = tracker.qualitative_metrics
  .map((metric) => [metric, latestObservedByMetric.get(metric)?.ratings[metric]])
  .filter(([, level]) => Number.isInteger(level))
  .sort((a, b) => a[1] - b[1])[0];
const nextFocus = nextFocusByMetric[nextFocusEntry?.[0]] ?? "次の会話で、今日の表現を一つ自分から使う。";
const levelClass = (level) => {
  if (!Number.isInteger(level)) return "level-na";
  if (level <= 2) return "level-support";
  if (level === 3) return "level-transition";
  return "level-independent";
};
const withinLevelStageJa = {
  emerging: "形成中",
  established: "安定",
  strong: "強い",
};


const rawSessions = speakingAnalytics.sessions;
const latestRawSession = rawSessions.at(-1);
const totalUsableRawSegments = rawSessions.reduce((sum, session) => sum + session.usable_yuki_segments, 0);
const coverageBandJa = { high: "高", medium: "中", low: "低" };

function compactNumber(value, suffix = "") {
  return Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : "N/A";
}

function sparklineSvg(data, key, label) {
  const points = data.filter((session) => Number.isFinite(session[key]));
  if (!points.length) return "<p>比較可能なraw transcriptがありません。</p>";
  const width = 360;
  const height = 118;
  const padX = 28;
  const padTop = 16;
  const padBottom = 28;
  const values = points.map((session) => session[key]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = Math.max(0.5, rawMax - rawMin);
  const min = Math.max(0, rawMin - span * 0.15);
  const max = rawMax + span * 0.15;
  const minSession = Math.min(...points.map((session) => session.session));
  const maxSession = Math.max(...points.map((session) => session.session));
  const x = (session) => padX + ((session - minSession) / Math.max(1, maxSession - minSession)) * (width - padX * 2);
  const y = (value) => padTop + ((max - value) / Math.max(0.001, max - min)) * (height - padTop - padBottom);
  const polyline = points.map((session) => `${x(session.session)},${y(session[key])}`).join(" ");
  const circles = points.map((session) => {
    const markerClass = session.coverage_band === "low" ? "fingerprint-point--low" : session.coverage_band === "medium" ? "fingerprint-point--medium" : "fingerprint-point--high";
    return `<circle class="${markerClass}" cx="${x(session.session)}" cy="${y(session[key])}" r="5"><title>Session ${session.session}: ${session[key]} / usable recovered ${Math.round(session.usable_segment_ratio * 100)}% (${session.coverage_band})</title></circle>`;
  }).join("");
  return `<svg class="fingerprint-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">
    <line x1="${padX}" y1="${height - padBottom}" x2="${width - padX}" y2="${height - padBottom}" class="fingerprint-axis"/>
    <polyline points="${polyline}" class="fingerprint-line"/>
    <g class="fingerprint-points">${circles}</g>
    <text x="${padX}" y="${height - 7}" class="fingerprint-label">S${minSession}</text>
    <text x="${width - padX}" y="${height - 7}" text-anchor="end" class="fingerprint-label">S${maxSession}</text>
  </svg>`;
}

const fingerprintDefinitions = [
  ["filler_per_100_words", "Planning fillers", "uh / um / hmm per 100 words", "低いほど良いとは限らず、思考の間をどう作るかを見る。"],
  ["repair_markers_per_100_words", "Repair markers", "repair markers per 100 words", "I mean / how can I say / direct correction など。修復能力と負荷の両方を示す。"],
  ["avg_words_per_segment", "Output length", "words per ASR segment", "ASR segmentは厳密な会話turnではないため、同じ収録方式の中でだけ読む。"],
  ["long_segment_share_pct", "Long-segment share", "20+ word segments (%)", "長い説明を維持する傾向の補助指標。長ければ常に良いわけではない。"],
];

const speakingFingerprintMarkup = rawSessions.length
  ? `<div class="fingerprint-grid">${fingerprintDefinitions.map(([key, title, subtitle, note]) => {
      const latest = latestRawSession?.[key];
      const suffix = key.endsWith("_pct") ? "%" : "";
      return `<article class="fingerprint-card">
        <div class="card-meta">${escapeHtml(subtitle)}</div>
        <h3>${escapeHtml(title)}</h3>
        <div class="fingerprint-value">${compactNumber(latest, suffix)}</div>
        ${sparklineSvg(rawSessions, key, title)}
        <p>${escapeHtml(note)}</p>
      </article>`;
    }).join("\n")}</div>`
  : "<p>raw transcriptの比較可能データはまだありません。</p>";


const currentHabitCards = latestRawSession ? [
  ["Planning fillers", compactNumber(latestRawSession.filler_per_100_words), "uh / um / hmm / 100 words", "planning timeの取り方を見る。無理にゼロを目指さない。"],
  ["you know", compactNumber(latestRawSession.you_know_per_100_words), "uses / 100 words", "便利なdiscourse markerだが、連続すると癖として聞こえやすい。"],
  ["Repair", compactNumber(latestRawSession.repair_markers_per_100_words), "markers / 100 words", "I mean / how can I say / direct correction。修復できること自体は強み。"],
  ["Article / preposition", "Qualitative", "ASR-sensitive", "the・前置詞は音声認識誤差が大きいため自動エラー率を出さず、Wrap-upの高確度例だけ追う。"],
].map(([title, value, unit, note]) => `<article class="habit-card"><div class="card-meta">${escapeHtml(unit)}</div><h3>${escapeHtml(title)}</h3><div class="habit-value">${escapeHtml(value)}</div><p>${escapeHtml(note)}</p></article>`).join("\n") : "";

const reportModel = buildReportModel(tracker, speakingAnalytics);
const { earlier: earlierSpeech, recent: recentSpeech } = speakingAnalytics.comparison;
const comparisonReady = speakingAnalytics.comparison.ready && earlierSpeech.segments > 0 && recentSpeech.segments > 0 &&
  earlierSpeech.sessions.every((number) => rawSessions.find((session) => session.session === number)?.coverage_band === "high") &&
  recentSpeech.sessions.every((number) => rawSessions.find((session) => session.session === number)?.coverage_band === "high");
const comparisonDefinitions = [
  ["repair_per_100_words", "Repair markers", "/ 100 words", "修復する力ではなく、表面化した修復の頻度"],
  ["you_know_per_100_words", "you know", "/ 100 words", "談話標識。少なさだけを良しとしない"],
  ["lexical_search_per_100_words", "Explicit lexical search", "/ 100 words", "how can I say / I want to say"],
  ["japanese_fallback_pct", "Japanese-script segments", "% of segments", "日本語文字を含む区間のみ。ローマ字の日本語は検出対象外"],
  ["mean_words_per_segment", "Mean output length", "words / segment", "発話長は概ね維持されているか"],
  ["long_segment_share_pct", "20+ word share", "% of segments", "長い説明の比率"],
];
const comparisonRows = comparisonReady ? comparisonDefinitions.map(([key, label, unit, note], index) => {
  const before = earlierSpeech[key];
  const after = recentSpeech[key];
  const max = Math.max(before, after, 0.2) * 1.12;
  const x1 = Math.max(3, Math.min(97, before / max * 94));
  const x2 = Math.max(3, Math.min(97, after / max * 94));
  const maintained = index >= 4 && before > 0 && Math.abs(after - before) / before < 0.15;
  const change = after === before ? "同値" : maintained ? "小変動" : `${after < before ? "↓" : "↑"} ${before ? Math.round(Math.abs(after - before) / before * 100) : "—"}%`;
  return `<div class="comparison-row"><div class="comparison-name"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(note)}</small></div><span class="comparison-before">${before} <small>${unit}</small></span><div class="delta-track" aria-label="Earlier ${before}, Recent ${after}"><span class="delta-line" style="left:${Math.min(x1, x2)}%;width:${Math.abs(x2 - x1)}%"></span><span class="delta-dot delta-dot--earlier" style="left:${x1}%"></span><span class="delta-dot delta-dot--recent" style="left:${x2}%"></span></div><span class="comparison-after">${after} <small>${unit}</small></span><span class="comparison-change">${change}</span></div>`;
}).join("\n") : "<p>比較に十分な自発発話データがありません。</p>";
const outputStable = comparisonReady && Math.abs(recentSpeech.mean_words_per_segment - earlierSpeech.mean_words_per_segment) / earlierSpeech.mean_words_per_segment < 0.15;
const repairDown = comparisonReady && recentSpeech.repair_per_100_words < earlierSpeech.repair_per_100_words * 0.8;
const insightText = outputStable && repairDown
  ? "Speaking length is broadly maintained, while visible repair burden has decreased."
  : "The comparable samples show a descriptive change; more matched spontaneous speech is needed to interpret it.";
const insightJa = outputStable && repairDown
  ? "平均区間語数を大きく落とさず、修復マーカーが減っています。認知負荷や能力の改善を直接測った値ではありません。"
  : "条件の近い自発発話を続けて観察し、変化の方向を確かめます。";
const evidenceStrength = comparisonReady && earlierSpeech.sessions.length >= 2 && recentSpeech.sessions.length >= 2 ? "MODERATE" : "LOW";
const distributionRows = recentSpeech.buckets.filter(b => b.label !== '0' || b.count > 0).map((bucket) => `<div class="distribution-row"><span>${bucket.label} words</span><span class="distribution-bar"><i style="width:${bucket.percent ?? 0}%"></i></span><strong>${bucket.percent ?? 'N/A'}%</strong></div>`).join("\n");
const coverageRows = rawSessions.map((session) => `<div class="coverage-item"><strong>S${session.session}</strong><span class="coverage-bar"><i style="width:${Math.round(session.usable_segment_ratio * 100)}%"></i></span><span>${Math.round(session.usable_segment_ratio * 100)}%</span><em>${session.coverage_band.toUpperCase()}</em></div>`).join("\n");
const profileRows = tracker.qualitative_metrics.map((metric) => {
  const observed = latestObservedByMetric.get(metric);
  const level = latestTracker.ratings[metric];
  const history = observed && observed.session !== latestTracker.session ? ` / 過去 S${observed.session} ${ratingLabel(observed, metric)}${metric === 'Pronunciation' && pronunciationBasis(observed) === 'legacy_limited' ? '（旧基準・限定根拠）' : ''}` : '';
  return `<div class="profile-row ${levelClass(level)}"><span>${escapeHtml(metricJa[metric])}</span><strong>${ratingLabel(latestTracker, metric)}</strong><small>今回 S${latestTracker.session}${history}</small></div>`;
}).join("\n");
const recentEvidence = tracker.sessions.slice(-5).flatMap((session) => Object.entries(session.metric_evidence ?? {}).map(([metric, evidence]) => ({ metric, evidence, session: session.session })));
const recentEvidenceFor = (metric) => { const e = [...recentEvidence].reverse().find(item => item.metric === metric && item.evidence?.observed)?.evidence; return e?.display_summary_ja ?? e?.observed ?? '比較可能な記述はありません。'; };
const grammarFocus = (latestTracker.pattern_observations?.length ? latestTracker.pattern_observations : [{ pattern: 'Grammar control', status: '未細分化', note: recentEvidenceFor('Grammar control') }])
  .map(item => `<div class="grammar-row"><strong>${escapeHtml(item.pattern)}</strong><span>${escapeHtml(item.status)}</span><small>${escapeHtml(item.note)}</small></div>`).join("\n");
const estimateTableRows = Object.entries(testDefinitions).map(([testId, definition]) => {
  const evidence = latestEstimateFor(testId);
  return `<tr><th scope="row">${escapeHtml(definition.label_ja)}</th><td>${escapeHtml(evidence.estimates[testId].display)}</td><td>S${evidence.session}</td><td>${escapeHtml(evidence.estimates[testId].confidence)}</td></tr>`;
}).join("\n");

const progress = `---
title: 成長
hide:
  - toc
---

# English Growth Dashboard

<p class="growth-intro">最新評価 S${latestTracker.session} · 回収済み発話 S${rawSessions[0]?.session ?? '—'}–S${latestRawSession?.session ?? '—'}。個人学習用の観察値で、公式試験結果ではありません。</p>

<section class="growth-page growth-page--now"><h2>WHERE I AM NOW <small>現在の英語力</small></h2>
<div class="profile-grid">${profileRows}</div>
<div class="growth-three-cards">
  <article><strong>STRENGTHS</strong><p>${escapeHtml(firstSentence(recentEvidenceFor("Interaction & repair"), 65))}</p></article>
  <article><strong>DEVELOPING</strong><p>${escapeHtml(firstSentence(recentEvidenceFor("Fluency & coherence"), 65))}</p></article>
  <article><strong>NEXT BOTTLENECK</strong><p>${escapeHtml(firstSentence(recentEvidenceFor("Grammar control"), 65))}</p></article>
</div>
<div class="before-now"><strong>INITIAL → CURRENT</strong><p>${escapeHtml(reportModel.initialSummary)}</p></div>
<figure class="figure-frame growth-trend"><a href="../assets/generated/english-growth-evidence-dashboard.png"><img src="../assets/generated/english-growth-evidence-dashboard.png" alt="全履歴の6観点評価。今回の発音: ${ratingLabel(latestTracker, 'Pronunciation')}。過去の最終記録 S${lastPronunciation?.session ?? '—'}は現基準の音声総合審査と区別。" loading="lazy"></a><figcaption>横軸はSession、縦軸はL評価。N/Aは欠測、線で補間しません。発音の過去値は旧基準・限定根拠を含みます。段階は形成中 / 安定 / 強い。</figcaption></figure>
</section>

<section class="growth-page growth-page--change"><h2>HOW MY SPEAKING IS CHANGING <small>話し方の変化</small></h2>
<p>固定基準 Earlier: ${earlierSpeech.sessions.map(n => `S${n}`).join(' + ') || '比較待ち'} · Recent: ${recentSpeech.sessions.map(n => `S${n}`).join(' + ') || '比較待ち'}。各群80%以上・自発15区間以上の別々の2回。音読・入力・復唱等は除外。</p>
<div class="comparison-header"><span>EARLIER</span><span>BEFORE → NOW</span><span>RECENT</span></div>
<div class="comparison-chart">${comparisonRows}</div>
<article class="growth-insight"><strong>MAIN OBSERVATION · descriptive evidence</strong><p>${insightText}</p><p>${insightJa}</p><small>Evidence strength: ${evidenceStrength}。複数のsource-backed sessionを比較しましたが、ASR区間は独立標本ではなく、収録条件・話題も完全一致しません。統計的有意差や能力レベル上昇は示しません。</small></article>
<h3>SPONTANEOUS OUTPUT DISTRIBUTION</h3>
<div class="distribution-chart">${distributionRows}</div>
<p class="distribution-stats">Recent S${recentSpeech.sessions.join(" + S")} · Median ${recentSpeech.median}語 · Middle 50% ${recentSpeech.q1}–${recentSpeech.q3}語 · P90 ${recentSpeech.p90}語 · 20+語 ${recentSpeech.long_segment_share_pct}%</p>
<h3>RAW EVIDENCE COVERAGE</h3>
<div class="coverage-strip">${coverageRows}</div>
<p class="growth-caveat">割合は<strong>回収済みYuki区間のうち利用できる割合</strong>で、全録音の完備率ではありません。LOWの回は主要比較から除外。ASR区間は厳密な会話turnではありません。</p>
</section>

<section class="growth-page growth-page--next"><h2>WHAT TO WORK ON NEXT <small>次の重点</small></h2>
<div class="controlled-flow"><article><strong>COMMUNICATION</strong><p>${escapeHtml(firstSentence(recentEvidenceFor('Task achievement'), 95))}</p></article><span>↓</span><article><strong>AUTOMATICITY · OBSERVED COUNTS</strong><p>${escapeHtml(reportModel.automaticity)}能力の自動採点ではありません。</p></article><span>↓</span><article><strong>CONTROLLED ACCURACY</strong><p>${escapeHtml(firstSentence(recentEvidenceFor('Grammar control'), 95))}</p></article></div>
<div class="growth-three-cards"><article><strong>HABIT · TRACK</strong><p>Planning fillersと“you know”。減少そのものを目標にせず、考える間と会話の自然さを一緒に確認する。</p></article><article><strong>STRENGTH · KEEP</strong><p>自発的なself-repairと話題の軌道修正。修復能力は強み、過度な修復負荷だけを観察する。</p></article><article><strong>TARGET · PRACTISE</strong><p>語が詰まったら日本語へ移る前に短い英語で言い換え、長い説明はmain pointを先に置く。</p></article></div>
<h3>GRAMMAR EVIDENCE · 観察範囲</h3>
<div class="grammar-tracker">${grammarFocus}</div>
<p class="growth-caveat">状態はJournal・Wrap-upで確認された質的な重点。ASRの短い機能語や語尾から自動エラー率を作らず、1例だけで「再発」や「改善」を断定しません。</p>
<h3 class="fingerprint-heading">SESSION-BY-SESSION FINGERPRINT <small>補助指標</small></h3>
${speakingFingerprintMarkup}
<p class="growth-caveat">${escapeHtml(reportModel.fillerSummary)}減少だけで上達とは判定しません。LOW coverage点は白抜き。各点の詳細はSiteでhoverできます。</p>
<h3 class="estimate-heading">ESTIMATED EXTERNAL-TEST RANGES</h3>
<figure class="figure-frame growth-estimates"><a href="../assets/generated/english-test-score-estimate-trends.png"><img src="../assets/generated/english-test-score-estimate-trends.png" alt="各資格の最新推定レンジ。試験ごとに別尺度、最終根拠Sessionと確度を併記。" loading="lazy"></a><figcaption>公式試験の結果ではありません。推定レンジを横線で示し、本人申告の実績値とは分離。各試験の尺度・測定時点が違うため、横位置を試験間で比較しません。</figcaption></figure>
<table class="estimate-table"><thead><tr><th>試験</th><th>推定レンジ</th><th>最終根拠</th><th>確度</th></tr></thead><tbody>${estimateTableRows}</tbody></table>
<p class="growth-caveat">これは受験結果ではなく学習用目安です。Listening / Reading / Writingなど新しく測っていない技能は最終根拠Sessionを据え置き、試験間で横棒の位置を比較しません。</p>
</section>
`;

const sourceLinks = new Map();
for (const markdown of [journal.markdown]) {
  for (const match of markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
    const label = stripMarkdown(match[1]);
    const url = match[2];
    if (/(?:daigasgroup\.com|osaka-u\.ac\.jp)/i.test(url)) continue;
    if (label && !sourceLinks.has(url)) sourceLinks.set(url, label);
  }
}
const library = `---
title: 資料
hide:
  - toc
---

# 資料

セッションで実際に参照した記事・公式資料です。運用ルールや生の評価JSONは学習導線から分離しています。

## Sources

${[...sourceLinks].slice(0, 40).map(([url, label]) => `- [${label}](${url})`).join("\n")}

## 画像とライセンス

- Microgrid概念図は、[U.S. Department of Energy, Office of Electricityの解説](https://www.energy.gov/oe/articles/microgrids-large-electric-loads-grid-support-how-leverage-microgrids-support-utilities)を参考に、会話内容から Yuki × Chappy が作成しました。DOEによる推奨・承認を示すものではありません。
- 電力需要グラフ: [IEA (2026), Electricity 2026 — Demand](https://www.iea.org/reports/electricity-2026/demand), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。学習画面向けにトリミングした派生表示であり、責任主体と非推奨表示は画像直下に明記しています。
- 英語力・資格スコアのグラフは、このリポジトリの評価データから自動生成しています。
- 追跡対象画像の出典・利用条件とプライバシー確認は、学習画面とは分離したメディア台帳で一元管理します。

## このサイトについて

- 学習記録の正本はリポジトリ内のMarkdownと評価JSONです。
- この閲覧面は正本から自動生成し、手作業で別内容を管理しません。
- 画像は概念整理、比較、根拠データ、成長確認に必要な場合だけ掲載します。
- 検索エンジン向けには **noindex** を設定し、アクセス解析は使用しません。
`;

await writeGenerated("index.md", home);
await writeGenerated(path.join("sessions", "index.md"), sessionIndex);
await writeGenerated(path.join("review", "index.md"), reviewHome);
await writeGenerated(path.join("review", "expressions.md"), reviewPage("表現バンク", "次の会話で再利用したい文・言い回しです。", expressionRows, "Expression"));
await writeGenerated(path.join("review", "vocabulary.md"), reviewPage("語彙バンク", "語義、Collocation、Exampleを一項目ずつ確認します。", vocabularyRows, "Vocabulary"));
await writeGenerated(path.join("review", "speaking.md"), reviewPage("発音・スピーキング", "実際に声に出すチャンクと練習ポイントです。未測定の項目を採点結果として扱いません。", speakingRows, "Speaking"));
await writeGenerated(path.join("progress", "index.md"), progress);
await writeGenerated(path.join("library", "index.md"), library);
await writeGenerated("404.md", "# ページが見つかりません\n\n[学習ホームへ戻る](index.md)\n");
await copyGenerated(path.join(root, "site-src", "assets", "stylesheets", "learning.css"), path.join("assets", "stylesheets", "learning.css"));
await copyGenerated(path.join(root, "site-src", "assets", "stylesheets", "journal-print.css"), path.join("assets", "stylesheets", "journal-print.css"));
await copyGenerated(path.join(root, "site-src", "assets", "javascripts", "learning.js"), path.join("assets", "javascripts", "learning.js"));
await copyGenerated(path.join(root, "site-src", "assets", "javascripts", "recall-state.js"), path.join("assets", "javascripts", "recall-state.js"));

for (const media of [...mediaBySession.values()].flat()) {
  await copyGenerated(path.join(root, media.path), path.join("assets", "media", media.file));
}
await copyGenerated(path.join(recordsRoot, "media/progress/english-growth-evidence-dashboard.png"), path.join("assets", "generated", "english-growth-evidence-dashboard.png"));
await copyGenerated(path.join(recordsRoot, "media/progress/english-test-score-estimate-trends.png"), path.join("assets", "generated", "english-test-score-estimate-trends.png"));

console.log(`Prepared learning site: ${sessionDefinitions.length} sessions, ${expressionRows.length} expressions, ${vocabularyRows.length} vocabulary items, ${speakingRows.length} speaking items.`);
