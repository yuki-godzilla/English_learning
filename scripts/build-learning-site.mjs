import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputRoot = path.join(root, ".generated-site-docs");
const recordsRoot = path.join(root, "learning-records");

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

function parseTableRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"))
    .map((line) => line.trim().slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 3)
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
    .filter((cells) => !/^(Expression|Word \/ IPA|Word \/ Chunk|目的|Metric|テスト種別)/i.test(stripMarkdown(cells[0])));
}

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

const tracker = JSON.parse(await fs.readFile(path.join(root, "english_progress_tracker.json"), "utf8"));
const dailyNotesRoot = path.join(recordsRoot, "daily-notes");
const dailyNoteFiles = (await fs.readdir(dailyNotesRoot))
  .filter((file) => /^\d{4}-\d{2}\.md$/.test(file))
  .sort();
const dailyDocuments = await Promise.all(dailyNoteFiles.map((file) => fs.readFile(path.join(dailyNotesRoot, file), "utf8")));
const daily = dailyDocuments.join("\n\n");
const archive = await fs.readFile(path.join(recordsRoot, "archive", "google-docs-final-2026-08-31.md"), "utf8");
const currentExpression = await fs.readFile(path.join(recordsRoot, "banks", "expression-bank.md"), "utf8");
const currentVocabulary = await fs.readFile(path.join(recordsRoot, "banks", "vocabulary-bank.md"), "utf8");
const currentSpeaking = await fs.readFile(path.join(recordsRoot, "banks", "pronunciation-speaking-bank.md"), "utf8");

const sessionCatalog = JSON.parse(
  await fs.readFile(path.join(recordsRoot, "session-catalog.json"), "utf8"),
);
if (!Array.isArray(sessionCatalog.sessions)) {
  throw new Error("session-catalog.json must contain a sessions array");
}
const sessionDefinitions = sessionCatalog.sessions.map((entry) => {
  const required = ["session_number", "session_id", "date", "title", "tags", "remember", "prompt", "source_path", "source_anchor"];
  if (required.some((key) => entry[key] == null) || !Array.isArray(entry.tags)) {
    throw new Error(`Invalid session catalog entry: ${JSON.stringify(entry)}`);
  }
  return {
    session: Number(entry.session_number),
    id: entry.session_id,
    date: entry.date,
    title: entry.title,
    tags: entry.tags,
    remember: entry.remember,
    prompt: entry.prompt,
    sourcePath: entry.source_path,
    sourceAnchor: entry.source_anchor,
  };
});

const allSessionMetadata = dailyDocuments.flatMap((document) =>
  [...document.matchAll(/<!--\s*session-meta:\s*(\{.*?\})\s*-->/g)].map((match) => JSON.parse(match[1])),
);
const trackerByNumber = new Map(tracker.sessions.map((session) => [session.session, session]));
const knownSessionIds = new Set(sessionDefinitions.map((session) => session.id));
const usedSessionNumbers = new Set(sessionDefinitions.map((session) => session.session));
for (const metadata of allSessionMetadata) {
  const knownDefinition = sessionDefinitions.find((session) => session.id === metadata.session_id);
  if (knownDefinition && metadata.session_number != null && Number(metadata.session_number) !== knownDefinition.session) {
    throw new Error(`session-meta ${metadata.session_id} must use Session ${knownDefinition.session}`);
  }
}
const newSessionMetadata = allSessionMetadata
  .filter((metadata) => !knownSessionIds.has(metadata.session_id))
  .sort((a, b) => String(a.session_datetime_jst).localeCompare(String(b.session_datetime_jst)) || String(a.session_id).localeCompare(String(b.session_id)));
const reservedSessionNumbers = new Set();
for (const metadata of newSessionMetadata) {
  if (metadata.session_number == null) continue;
  const explicitNumber = Number(metadata.session_number);
  if (!Number.isInteger(explicitNumber) || explicitNumber < 1) {
    throw new Error(`session-meta ${metadata.session_id} has an invalid session_number`);
  }
  if (usedSessionNumbers.has(explicitNumber) || reservedSessionNumbers.has(explicitNumber)) {
    throw new Error(`session-meta ${metadata.session_id} reuses Session ${explicitNumber}`);
  }
  reservedSessionNumbers.add(explicitNumber);
}

let nextSessionNumber = Math.max(...usedSessionNumbers) + 1;
for (const metadata of newSessionMetadata) {
  while (usedSessionNumbers.has(nextSessionNumber) || reservedSessionNumbers.has(nextSessionNumber)) nextSessionNumber += 1;
  const sessionNumber = metadata.session_number == null ? nextSessionNumber : Number(metadata.session_number);
  usedSessionNumbers.add(sessionNumber);
  if (metadata.session_number == null) nextSessionNumber += 1;
  const date = String(metadata.session_datetime_jst).slice(0, 10);
  const trackerSession = trackerByNumber.get(sessionNumber);
  sessionDefinitions.push({
    session: sessionNumber,
    id: metadata.session_id,
    date,
    title: metadata.title ?? `English Conversation Session ${sessionNumber}`,
    tags: Array.isArray(metadata.site_tags) && metadata.site_tags.length ? metadata.site_tags : ["English Conversation"],
    remember: metadata.site_remember ?? firstSentence(trackerSession?.evidence_note_ja ?? metadata.title ?? "このセッションで話したことを振り返る。"),
    prompt: metadata.site_prompt ?? "What was your main takeaway from this session, and why does it matter to you?",
  });
}
for (const trackerSession of tracker.sessions) {
  if (!sessionDefinitions.some((session) => session.session === trackerSession.session)) {
    throw new Error(`Tracker Session ${trackerSession.session} has no matching Daily Note session-meta record`);
  }
}
sessionDefinitions.sort((a, b) => b.date.localeCompare(a.date) || b.session - a.session);

const sessionDefinitionByNumber = new Map(sessionDefinitions.map((session) => [session.session, session]));
const sessionDefinitionById = new Map(sessionDefinitions.map((session) => [session.id, session]));

const currentBodies = new Map();
for (const document of dailyDocuments) {
  const metadataMatches = [...document.matchAll(/<!--\s*session-meta:\s*(\{.*?\})\s*-->/g)];
  for (let index = 0; index < metadataMatches.length; index += 1) {
    const match = metadataMatches[index];
    const metadata = JSON.parse(match[1]);
    const end = metadataMatches[index + 1]?.index ?? document.length;
    const definition = sessionDefinitionById.get(metadata.session_id);
    if (!definition) throw new Error(`No session definition found for ${metadata.session_id}`);
    currentBodies.set(definition.session, document.slice(match.index, end));
  }
}

const archiveStarts = [...archive.matchAll(/<a\s+id=["']session-(\d{4}-\d{2}-\d{2}-\d{2})["']\s*><\/a>/gi)]
  .map((match) => {
    const definition = sessionDefinitionById.get(match[1]);
    return definition ? { session: definition.session, index: match.index } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.index - b.index);
if (archiveStarts.length !== sessionCatalog.sessions.length) {
  throw new Error("Every catalog session must have one fixed anchor in the migration archive");
}
const archiveDailyEnd = archive.search(/^# \*\*2\\\. 表現バンク/m);
if (archiveDailyEnd < 0) throw new Error("Archive Daily Notes boundary not found");
const archiveBodies = new Map();
for (let index = 0; index < archiveStarts.length; index += 1) {
  const start = archiveStarts[index];
  const end = archiveStarts[index + 1]?.index ?? archiveDailyEnd;
  archiveBodies.set(start.session, archive.slice(start.index, end));
}

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
    .replace(/^\[[^\n]+\]\([^\n]+\).*$/gm, (line) => line.includes("ページ先頭") || line.includes("Session Index") ? "" : line)
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

  for (const fileName of [
    "microgrid-data-center-grid.png",
    "electricity-demand-chart.png",
    "local-cloud-hybrid-ai.png",
    "2026-08-19-hybrid-ai-comparison.png",
  ]) {
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

const mediaBySession = new Map([
  [8, [
    {
      file: "2026-08-27-microgrid-diagram.png",
      alt: "主系統、地域電源、蓄電池、制御装置、データセンターをつなぐマイクログリッドの概念図",
      caption: "Microgridがデータセンターと電力網を支える構造を、会話内容から整理した自作概念図。",
      sourcePrefix: "参考資料",
      sourceLabel: "U.S. Department of Energy, Office of Electricity — Microgrids, Large Electric Loads & Grid Support",
      sourceUrl: "https://www.energy.gov/oe/articles/microgrids-large-electric-loads-grid-support-how-leverage-microgrids-support-utilities",
      notice: "図そのものは Yuki × Chappy が作成しました。U.S. Department of Energyによる推奨・承認を示すものではありません。",
    },
    {
      file: "electricity-demand-chart.png",
      alt: "2015年から2030年までの米国の用途別電力需要増加を示す積み上げ棒グラフ",
      caption: "米国の用途別電力需要増加、2015–2030（学習画面向けにトリミング）。",
      sourceLabel: "IEA (2026), Electricity 2026 — Demand",
      sourceUrl: "https://www.iea.org/reports/electricity-2026/demand",
      licenseLabel: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      notice: "This is a work derived by Yuki × Chappy from IEA material and Yuki × Chappy is solely liable and responsible for this derived work. The derived work is not endorsed by the IEA or its Member countries in any manner.",
    },
  ]],
  [6, [
    { file: "2026-08-19-hybrid-ai-comparison.png", alt: "Local AI、Cloud AI、Hybrid AIの用途と強みを比較した図", caption: "速度、プライバシー、難易度を基準にしたAIの使い分け。", sourceLabel: "Session 6の会話内容", sourceUrl: "#session-6-record" },
  ]],
]);

const archiveExpression = extractRange(archive, /^# \*\*2\\\. 表現バンク/m, /^# \*\*3\\\. 語彙バンク/m);
const archiveVocabulary = extractRange(archive, /^# \*\*3\\\. 語彙バンク/m, /^# \*\*4\\\. 発音バンク/m);
const archiveSpeaking = extractRange(archive, /^# \*\*4\\\. 発音バンク/m, /^# 英語力の成長評価/m);

function mergeBankRows(current, historical) {
  const merged = [];
  const seen = new Set();
  for (const cells of [...parseTableRows(current), ...parseTableRows(historical)]) {
    const key = normalizeKey(cells[0]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(cells.slice(0, 3));
  }
  return merged;
}

const expressionRows = mergeBankRows(currentExpression, archiveExpression);
const vocabularyRows = mergeBankRows(currentVocabulary, archiveVocabulary);
const speakingRows = mergeBankRows(currentSpeaking, archiveSpeaking);

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
  const sourceSession = sourceSessionNumber(cells[2]);
  const source = sourceSession
    ? `<a href="../../sessions/${sessionDefinitionByNumber.get(sourceSession).id}/">Session ${sourceSession}</a>`
    : escapeHtml(stripMarkdown(cells[2]) || "移行記録");
  const search = escapeHtml(`${title} ${stripMarkdown(cells[1])}`);
  return `<article class="review-card" data-review-item data-search="${search}">
  <div class="card-meta">${escapeHtml(kind)} · ${source}</div>
  <h2>${escapeHtml(title)}</h2>
  <div class="review-example">${detail}</div>
</article>`;
}

function latestRows(rows, sessionNumber, limit) {
  return rows.filter((row) => sourceSessionNumber(row[2]) === sessionNumber).slice(0, limit);
}

function recallCard(summary, answer, key) {
  return `<details class="recall-card" data-recall-id="${escapeHtml(key)}">
  <summary>${summary}</summary>
  <div class="recall-answer">${answer}
    <div class="recall-rating" aria-label="この端末での復習状態">
      <button type="button" data-recall-rating="again">もう一度</button>
      <button type="button" data-recall-rating="remembered">思い出せた</button>
      <button type="button" data-recall-rating="mastered">定着</button>
      <span data-recall-status aria-live="polite"></span>
    </div>
  </div>
</details>`;
}

const latestDefinition = sessionDefinitions[0];
const latestSessionTracker = trackerByNumber.get(latestDefinition.session);
const latestTracker = latestSessionTracker
  ?? [...tracker.sessions].sort((a, b) => b.session - a.session)[0];
if (!latestTracker) throw new Error("english_progress_tracker.json has no evaluation sessions");
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

新しい順に、話題と「覚えておきたいこと」から選べます。タイトルを開くと、30秒の振り返り、復習、会話記録へ進みます。

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
  const source = `<a href="${escapeHtml(media.sourceUrl)}">${escapeHtml(media.sourceLabel)}</a>`;
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
  const placements = session.session === 8
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
  const rawBody = currentBodies.get(session.session) ?? archiveBodies.get(session.session);
  if (!rawBody) throw new Error(`No Daily Note content found for Session ${session.session}`);
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
  <article class="learning-card"><div class="card-meta">Remember</div><h3>話したこと</h3><p>${escapeHtml(session.remember)}</p></article>
  <article class="learning-card"><div class="card-meta">Growth</div><h3>今回できたこと</h3><p>${escapeHtml(redactLearnerText(firstSentence(trackerSession?.evidence_note_ja ?? session.remember)))}</p></article>
  ${trackerSession?.evidence_quote ? `<article class="learning-card"><div class="card-meta">My English in Context</div><h3>発話の記録（修正前）</h3><p lang="en">${escapeHtml(redactLearnerText(truncate(trackerSession.evidence_quote, 190)))}</p></article>` : ""}
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
const firstTracker = [...tracker.sessions].sort((a, b) => a.session - b.session)[0];
const nextFocusByMetric = {
  "Task achievement": "話す前に結論を一文で決め、理由と例を一つずつ加える。",
  "Fluency & coherence": "長い説明でも、Main point → reason → example → conclusion の順を保つ。",
  "Lexical resource": "新しく覚えた表現を、次の会話で一度自分から使う。",
  "Grammar control": "時制と単数・複数を意識し、短い文を安定させてからつなぐ。",
  "Interaction & repair": "分からない点を確認した後、自分の言葉で要点を言い直す。",
  Pronunciation: "同じ60秒課題を直接録音し、比較できる発音データを一つ増やす。",
};
const nextFocusEntry = Object.entries(latestTracker.ratings)
  .filter(([, level]) => Number.isInteger(level))
  .sort((a, b) => a[1] - b[1])[0];
const nextFocus = nextFocusByMetric[nextFocusEntry?.[0]] ?? "次の会話で、今日の表現を一つ自分から使う。";

const progress = `---
title: 成長
hide:
  - toc
---

# 英語力の成長

数値より先に、実際にできた行動を確認します。これは公式試験の結果ではなく、会話と測定記録に基づく学習用の評価です。

<div class="learning-grid growth-highlights">
  <article class="learning-card"><div class="card-meta">Latest Win</div><h3>今回できたこと</h3><p>${escapeHtml(redactLearnerText(firstSentence(latestTracker.evidence_note_ja)))}</p></article>
  <article class="learning-card"><div class="card-meta">From Session 1</div><h3>初回からの変化</h3><p>Session 1では「${escapeHtml(redactLearnerText(firstSentence(firstTracker.evidence_note_ja, 90)))}」という出発点でした。今は経験・背景・自分の解釈をつないで長く議論できます。</p></article>
  <article class="learning-card"><div class="card-meta">Next Milestone</div><h3>次に一つ伸ばす</h3><p>${escapeHtml(nextFocus)}</p></article>
</div>

## Current Snapshot

<div class="metric-grid">
${Object.entries(latestTracker.ratings).map(([metric, level]) => `<article class="metric-card"><div class="card-meta">${escapeHtml(metric)}</div><h3>${escapeHtml(metricJa[metric] ?? metric)}</h3><div class="metric-value">${level == null ? "N/A" : `L${level}`}</div><p>${level == null ? `Session ${latestTracker.session}では直接測定していません。` : `Session ${latestTracker.session}の会話から根拠を確認済み。`}</p></article>`).join("\n")}
</div>

<div class="latest-win"><strong>今回の成長</strong><br>${escapeHtml(redactLearnerText(latestTracker.evidence_note_ja))}</div>

## 発音の扱い

Session ${latestTracker.session}は直接音声を測定していないため **N/A** です。最後に直接測定した記録は Session ${lastPronunciation.session}（${formatDateJa(lastPronunciation.date)}）の **L${lastPronunciation.ratings.Pronunciation}** です。未測定を能力低下として扱いません。

## 成長グラフ

<figure class="figure-frame"><a href="../assets/generated/english-growth-evidence-dashboard.png"><img src="../assets/generated/english-growth-evidence-dashboard.png" alt="Session 1からSession ${latestTracker.session}までの英語力成長グラフ" loading="lazy"></a><figcaption>会話で確認できた行動の推移。タップすると原寸表示。</figcaption></figure>

## 資格スコア目安

各テスト種別は、その技能について最後に根拠が得られたSessionを表示します。測定していない技能に新しい予測点は追加しません。

<div class="score-grid">
${Object.entries(testDefinitions).map(([testId, definition]) => {
  const estimateSession = latestEstimateFor(testId);
  const estimate = estimateSession.estimates[testId];
  return `<article class="score-card"><div class="card-meta">Latest evidence: Session ${estimateSession.session}</div><h3>${escapeHtml(definition.label_ja)}</h3><div class="score-value">${escapeHtml(estimate.display)}</div><p>${escapeHtml(estimate.comment_ja)}</p><p><strong>確度:</strong> ${escapeHtml(estimate.confidence)}</p></article>`;
}).join("\n")}
</div>

??? note "読み方"
    予測レンジは受験計画の参考です。Listening、Reading、Writing、発音を直接測っていない場合は、その制約を明記しています。

<details class="recall-card"><summary>資格スコア予測の補助グラフ</summary><div class="recall-answer"><figure class="figure-frame"><a href="../assets/generated/english-test-score-estimate-trends.png"><img src="../assets/generated/english-test-score-estimate-trends.png" alt="試験種別ごとの資格スコア予測履歴" loading="lazy"></a><figcaption>履歴点が少ないため、現在は上のカードを主表示として使います。</figcaption></figure></div></details>
`;

const sourceLinks = new Map();
for (const markdown of [daily, archive]) {
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
- 追跡対象画像の出典・利用条件とプライバシー確認は、リポジトリ内の \`docs/media-attribution.md\` と \`docs/image-privacy-review.json\` で管理します。

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
await copyGenerated(path.join(root, "site-theme", "assets", "stylesheets", "learning.css"), path.join("assets", "stylesheets", "learning.css"));
await copyGenerated(path.join(root, "site-theme", "assets", "javascripts", "learning.js"), path.join("assets", "javascripts", "learning.js"));

const mediaSources = [
  path.join(root, "assets"),
  path.join(recordsRoot, "archive", "assets"),
];
const approvedMediaFiles = new Set([...mediaBySession.values()].flat().map((media) => media.file));
for (const fileName of approvedMediaFiles) {
  let copied = false;
  for (const directory of mediaSources) {
    const source = path.join(directory, fileName);
    try {
      await fs.access(source);
    } catch {
      continue;
    }
    await copyGenerated(source, path.join("assets", "media", fileName));
    copied = true;
    break;
  }
  if (!copied) throw new Error(`Approved learning-site image not found: ${fileName}`);
}
await copyGenerated(path.join(root, "output", "english-growth-evidence-dashboard.png"), path.join("assets", "generated", "english-growth-evidence-dashboard.png"));
await copyGenerated(path.join(root, "output", "english-test-score-estimate-trends.png"), path.join("assets", "generated", "english-test-score-estimate-trends.png"));

console.log(`Prepared learning site: ${sessionDefinitions.length} sessions, ${expressionRows.length} expressions, ${vocabularyRows.length} vocabulary items, ${speakingRows.length} speaking items.`);
