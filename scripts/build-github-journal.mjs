import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const recordsRoot = path.join(root, "learning-records");
const outputPath = path.join(recordsRoot, "journal.md");
const checkOnly = process.argv.includes("--check");

const catalog = JSON.parse(
  await fs.readFile(path.join(recordsRoot, "session-catalog.json"), "utf8"),
);

if (!Array.isArray(catalog.sessions) || catalog.sessions.length === 0) {
  throw new Error("session-catalog.json must contain at least one session");
}

const sessions = [...catalog.sessions].sort(
  (left, right) => right.session_number - left.session_number,
);
const sourceCache = new Map();

async function readRecord(relativePath) {
  if (!sourceCache.has(relativePath)) {
    sourceCache.set(
      relativePath,
      await fs.readFile(path.join(recordsRoot, relativePath), "utf8"),
    );
  }
  return sourceCache.get(relativePath);
}

function canonicalTargetMap() {
  return new Map(
    sessions.map((session) => [
      `${session.source_path}#${session.source_anchor}`,
      `#${session.source_anchor}`,
    ]),
  );
}

const targetMap = canonicalTargetMap();
targetMap.set("banks/expression-bank.md", "#journal-expression-bank");
targetMap.set("banks/vocabulary-bank.md", "#journal-vocabulary-bank");
targetMap.set("banks/pronunciation-speaking-bank.md", "#journal-speaking-bank");
targetMap.set("growth.md", "#journal-growth");
targetMap.set("latest.md#five-minute-review", "#journal-five-minute-review");
targetMap.set("session-index.md", "#journal-sessions");

function rewriteRelativeLinks(markdown, sourcePath) {
  return markdown.replace(
    /(!?\[[^\]]*\]\()([^)]+)(\))/g,
    (whole, opening, rawTarget, closing) => {
      const target = rawTarget.trim().replace(/^<|>$/g, "");
      if (/^(?:https?:|mailto:|#)/i.test(target)) return whole;

      const hashIndex = target.indexOf("#");
      const filePart = hashIndex < 0 ? target : target.slice(0, hashIndex);
      const fragment = hashIndex < 0 ? "" : target.slice(hashIndex);
      if (!filePart) return whole;

      const absolute = path.resolve(
        path.dirname(path.join(recordsRoot, sourcePath)),
        filePart,
      );
      const relative = path.relative(recordsRoot, absolute).replaceAll("\\", "/");
      const normalized = `${relative}${fragment}`;
      const mapped =
        targetMap.get(normalized) ??
        [...targetMap.entries()].find(
          ([source]) =>
            source.endsWith(".md") &&
            normalized.startsWith(`${source}#`),
        )?.[1];
      return `${opening}${mapped ?? normalized}${closing}`;
    },
  );
}

function extractSession(markdown, session) {
  const anchor = `<a id="${session.source_anchor}"></a>`;
  const start = markdown.indexOf(anchor);
  if (start < 0) {
    throw new Error(`Missing ${anchor} in ${session.source_path}`);
  }

  const nextAnchor = markdown.indexOf('<a id="session-', start + anchor.length);
  const nextMetadata = markdown.indexOf(
    "<!-- session-meta:",
    start + anchor.length,
  );
  const archiveSections = markdown.slice(start + anchor.length).search(/^# \*\*2\\\./m);
  const archiveEnd =
    archiveSections < 0 ? -1 : start + anchor.length + archiveSections;
  const candidates = [nextAnchor, nextMetadata, archiveEnd].filter(
    (position) => position > start,
  );
  const end = candidates.length ? Math.min(...candidates) : markdown.length;

  return markdown.slice(start, end).trim();
}

function stripDocumentHeader(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  let headingSeen = false;
  const body = [];
  for (const line of lines) {
    if (!headingSeen && /^# /.test(line)) {
      headingSeen = true;
      continue;
    }
    if (headingSeen && body.length === 0 && line.trim() === "") continue;
    if (
      headingSeen &&
      body.length === 0 &&
      /^\[.*\]\(.*\)(?: · \[.*\]\(.*\))*$/.test(line)
    ) {
      continue;
    }
    if (headingSeen) body.push(line);
  }
  return body.join("\n").trim();
}

function stripFixedAnchors(markdown) {
  return markdown.replace(/^<a id="[^"]+"><\/a>\s*$/gm, "").trim();
}

function extractFiveMinuteReview(markdown) {
  const startMarker = '<a id="five-minute-review"></a>';
  const start = markdown.indexOf(startMarker);
  if (start < 0) throw new Error("latest.md is missing five-minute-review");
  const end = markdown.indexOf("\n## 3. ", start);
  return markdown
    .slice(start + startMarker.length, end < 0 ? markdown.length : end)
    .trim()
    .replace(/^## 2\. 今日の5分復習\s*/, "")
    .trim();
}

const tableOfContents = sessions
  .map(
    (session) =>
      `  - [Session ${session.session_number} — ${session.title}](#${session.source_anchor})`,
  )
  .join("\n");

const sessionSections = [];
for (const session of sessions) {
  const source = await readRecord(session.source_path);
  const extracted = extractSession(source, session);
  const rewritten = rewriteRelativeLinks(extracted, session.source_path)
    .replaceAll("(#month-2026-08-top)", "(#journal-contents)")
    .replace(
      /\]\(#(?:8月-15|2026-08-08)[^)]+\)/g,
      `](#${session.source_anchor})`,
    );
  sessionSections.push(rewritten);
}

const latest = await readRecord("latest.md");
const fiveMinuteReview = rewriteRelativeLinks(
  extractFiveMinuteReview(latest),
  "latest.md",
);

const growth = rewriteRelativeLinks(
  stripDocumentHeader(await readRecord("growth.md")),
  "growth.md",
);

const banks = [
  ["journal-expression-bank", "表現バンク / Expression Bank", "banks/expression-bank.md"],
  ["journal-vocabulary-bank", "語彙バンク / Vocabulary Bank", "banks/vocabulary-bank.md"],
  ["journal-speaking-bank", "発音・スピーキングバンク / Pronunciation & Speaking Bank", "banks/pronunciation-speaking-bank.md"],
];
const bankSections = [];
for (const [anchor, title, sourcePath] of banks) {
  const body = stripFixedAnchors(
    rewriteRelativeLinks(
      stripDocumentHeader(await readRecord(sourcePath)),
      sourcePath,
    ),
  );
  bankSections.push(`<a id="${anchor}"></a>\n\n# ${title}\n\n${body}`);
}

const journal = `<!-- This file is generated by scripts/build-github-journal.mjs. Do not edit it directly. -->

# Yuki × Chappy English Journal

> 一冊を開き、目次から今日の復習・全セッション・成長・学習バンクへ移動できます。

<a id="journal-contents"></a>

## 目次

- [今日の5分復習](#journal-five-minute-review)
- [英会話セッション](#journal-sessions)
${tableOfContents}
- [英語力の成長・評価](#journal-growth)
- [表現バンク](#journal-expression-bank)
- [語彙バンク](#journal-vocabulary-bank)
- [発音・スピーキングバンク](#journal-speaking-bank)

<a id="journal-five-minute-review"></a>

# 今日の5分復習

${fiveMinuteReview}

[目次へ戻る](#journal-contents)

<a id="journal-sessions"></a>

# 英会話セッション / Sessions

${sessionSections.join("\n\n[目次へ戻る](#journal-contents)\n\n---\n\n")}

[目次へ戻る](#journal-contents)

<a id="journal-growth"></a>

# 英語力の成長・評価 / Growth & Evaluation

${growth}

[目次へ戻る](#journal-contents)

${bankSections.join("\n\n[目次へ戻る](#journal-contents)\n\n")}

[目次へ戻る](#journal-contents)
`;

const normalizedJournal = journal.replaceAll("\r\n", "\n");

if (checkOnly) {
  let current;
  try {
    current = (await fs.readFile(outputPath, "utf8")).replaceAll("\r\n", "\n");
  } catch {
    throw new Error("learning-records/journal.md is missing; run npm run journal:build");
  }
  if (current !== normalizedJournal) {
    throw new Error("learning-records/journal.md is stale; run npm run journal:build");
  }
  console.log(`GitHub journal is current: ${sessions.length} sessions.`);
} else {
  await fs.writeFile(outputPath, normalizedJournal, "utf8");
  console.log(`Built learning-records/journal.md: ${sessions.length} sessions.`);
}
