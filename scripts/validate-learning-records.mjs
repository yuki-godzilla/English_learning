import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const recordsRoot = path.join(root, "learning-records");
const migrationSnapshot = "learning-records/archive/google-docs-final-2026-08-31.md";
const requiredFiles = [
  "latest.md",
  "session-index.md",
  "banks/expression-bank.md",
  "banks/vocabulary-bank.md",
  "banks/pronunciation-speaking-bank.md",
];

const errors = [];

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function anchors(markdown) {
  return new Set(
    [...markdown.matchAll(/<a\s+id=["']([^"']+)["']\s*><\/a>/gi)].map(
      (match) => match[1],
    ),
  );
}

function linkTargets(markdown) {
  return [...markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map(
    (match) => match[1].trim().replace(/^<|>$/g, ""),
  );
}

function splitTarget(target) {
  const hashIndex = target.indexOf("#");
  if (hashIndex === -1) return { file: target, fragment: "" };
  return {
    file: target.slice(0, hashIndex),
    fragment: decodeURIComponent(target.slice(hashIndex + 1)),
  };
}

function tableRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function bankKey(cell, bankName) {
  const bold = cell.match(/\*\*([^*]+)\*\*/)?.[1] ?? cell;
  const base = bankName === "vocabulary-bank.md" ? bold.split("/")[0] : bold;
  return base
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”‘’"'`*_]/g, "")
    .replace(/[.!?。！？]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

for (const required of requiredFiles) {
  try {
    await fs.access(path.join(recordsRoot, required));
  } catch {
    errors.push(`Missing required file: learning-records/${required}`);
  }
}

const recordFiles = (await walk(recordsRoot)).filter((file) =>
  file.endsWith(".md"),
);
const contentByFile = new Map();
for (const file of recordFiles) {
  contentByFile.set(file, await fs.readFile(file, "utf8"));
}

const sessionCatalogPath = path.join(recordsRoot, "session-catalog.json");
let sessionCatalog;
try {
  sessionCatalog = JSON.parse(await fs.readFile(sessionCatalogPath, "utf8"));
} catch {
  errors.push("Missing or invalid learning-records/session-catalog.json");
}
const catalogSessions = Array.isArray(sessionCatalog?.sessions) ? sessionCatalog.sessions : [];
if (sessionCatalog && !Array.isArray(sessionCatalog.sessions)) {
  errors.push("learning-records/session-catalog.json must contain a sessions array");
}
const catalogById = new Map();
const catalogByNumber = new Map();
const catalogTargets = new Set();
for (const session of catalogSessions) {
  const required = ["session_number", "session_id", "date", "title", "tags", "remember", "prompt", "source_path", "source_anchor"];
  if (required.some((key) => session[key] == null) || !Array.isArray(session.tags)) {
    errors.push("session-catalog.json contains an incomplete session entry");
    continue;
  }
  if (!Number.isInteger(session.session_number) || session.session_number < 1) {
    errors.push(`session-catalog.json has an invalid session_number for ${session.session_id}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date)) {
    errors.push(`session-catalog.json has an invalid date for ${session.session_id}`);
  }
  if (catalogById.has(session.session_id)) {
    errors.push(`session-catalog.json has a duplicate session_id: ${session.session_id}`);
  }
  if (catalogByNumber.has(session.session_number)) {
    errors.push(`session-catalog.json has a duplicate session_number: ${session.session_number}`);
  }
  const target = `${session.source_path}#${session.source_anchor}`;
  if (catalogTargets.has(target)) {
    errors.push(`session-catalog.json has a duplicate source target: ${target}`);
  }
  catalogById.set(session.session_id, session);
  catalogByNumber.set(session.session_number, session);
  catalogTargets.add(target);
  const source = path.resolve(recordsRoot, session.source_path);
  if (!source.startsWith(recordsRoot + path.sep) || !source.endsWith(".md")) {
    errors.push(`session-catalog.json has an invalid source_path: ${session.source_path}`);
    continue;
  }
  const sourceMarkdown = contentByFile.get(source);
  if (!sourceMarkdown) {
    errors.push(`session-catalog.json references a missing source file: ${session.source_path}`);
  } else if (!anchors(sourceMarkdown).has(session.source_anchor)) {
    errors.push(`session-catalog.json references a missing fixed anchor: ${target}`);
  }
}

for (const [file, markdown] of contentByFile) {
  if (/(?<!\]\()https?:\/\/[^\s)]+/i.test(markdown)) {
    errors.push(`${relative(file)}: raw URL must be a named Markdown link`);
  }
  if (relative(file) === migrationSnapshot) continue;
  for (const target of linkTargets(markdown)) {
    if (/^(?:https?:|mailto:)/i.test(target)) continue;
    const { file: linkedFile, fragment } = splitTarget(target);
    const resolved = linkedFile
      ? path.resolve(path.dirname(file), linkedFile)
      : file;
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      errors.push(`${relative(file)}: link escapes the repository: ${target}`);
      continue;
    }
    try {
      await fs.access(resolved);
    } catch {
      errors.push(`${relative(file)}: missing link target: ${target}`);
      continue;
    }
    if (fragment && resolved.endsWith(".md")) {
      const linkedMarkdown =
        contentByFile.get(resolved) ?? (await fs.readFile(resolved, "utf8"));
      if (!anchors(linkedMarkdown).has(fragment)) {
        errors.push(`${relative(file)}: missing fixed anchor: ${target}`);
      }
    }
  }
}

const sessionIds = new Map();
const sessionNumbers = new Map();
const sessionNumberById = new Map();
for (const [file, markdown] of contentByFile) {
  if (relative(file) === migrationSnapshot) continue;
  const sessions = [
    ...markdown.matchAll(/<!--\s*session-meta:\s*(\{.*?\})\s*-->/g),
  ];
  let previousDate = null;
  for (const match of sessions) {
    let metadata;
    try {
      metadata = JSON.parse(match[1]);
    } catch {
      errors.push(`${relative(file)}: invalid session-meta JSON`);
      continue;
    }
    const { session_number: sessionNumber, session_id: sessionId, session_datetime_jst: dateTime } = metadata;
    if (!Number.isInteger(sessionNumber) || sessionNumber < 1 || !sessionId || !dateTime) {
      errors.push(`${relative(file)}: session-meta needs a positive session_number, session_id, and session_datetime_jst`);
      continue;
    }
    if (sessionIds.has(sessionId)) {
      errors.push(
        `Duplicate session_id ${sessionId}: ${sessionIds.get(sessionId)} and ${relative(file)}`,
      );
    }
    sessionIds.set(sessionId, relative(file));
    sessionNumberById.set(sessionId, sessionNumber);
    if (sessionNumbers.has(sessionNumber)) {
      errors.push(
        `Duplicate session_number ${sessionNumber}: ${sessionNumbers.get(sessionNumber)} and ${relative(file)}`,
      );
    }
    sessionNumbers.set(sessionNumber, relative(file));
    if (!anchors(markdown).has(`session-${sessionId}`)) {
      errors.push(`${relative(file)}: missing anchor session-${sessionId}`);
    }
    const parsedDate = Date.parse(dateTime);
    if (Number.isNaN(parsedDate)) {
      errors.push(`${relative(file)}: invalid session_datetime_jst for ${sessionId}`);
    } else if (previousDate !== null && parsedDate > previousDate) {
      errors.push(`${relative(file)}: sessions are not newest-first near ${sessionId}`);
    }
    previousDate = parsedDate;
  }
}

for (const [sessionId, file] of sessionIds) {
  const catalogSession = catalogById.get(sessionId);
  if (!catalogSession) continue;
  if (catalogSession.session_number !== sessionNumberById.get(sessionId)) {
    errors.push(`session-catalog.json does not match the Daily Note number for ${sessionId}`);
  }
  const expectedSource = file.replace(/^learning-records\//, "");
  if (catalogSession.source_path !== expectedSource || catalogSession.source_anchor !== `session-${sessionId}`) {
    errors.push(`session-catalog.json does not point to the canonical Daily Note for ${sessionId}`);
  }
}

const sessionIndexMarkdown = contentByFile.get(path.join(recordsRoot, "session-index.md")) ?? "";
const indexTargets = new Set(linkTargets(sessionIndexMarkdown));
for (const session of catalogSessions) {
  const target = `${session.source_path}#${session.source_anchor}`;
  if (!indexTargets.has(target)) {
    errors.push(`Session Index is missing Session ${session.session_number}: ${target}`);
  }
}
for (const [sessionId, file] of sessionIds) {
  if (catalogById.has(sessionId)) continue;
  const source = file.replace(/^learning-records\//, "");
  const target = `${source}#session-${sessionId}`;
  if (!indexTargets.has(target)) {
    errors.push(`Session Index is missing Daily Note ${sessionId}: ${target}`);
  }
}

for (const bankName of [
  "expression-bank.md",
  "vocabulary-bank.md",
  "pronunciation-speaking-bank.md",
]) {
  const file = path.join(recordsRoot, "banks", bankName);
  const markdown = contentByFile.get(file) ?? "";
  const rows = tableRows(markdown).filter(
    (cells) => cells[0] && !/^(Expression|Word \/ IPA|Word \/ Chunk)/i.test(cells[0]),
  );
  const seen = new Set();
  for (const cells of rows) {
    if (cells.length !== 3) {
      errors.push(`${relative(file)}: expected 3 cells, found ${cells.length}`);
      continue;
    }
    const key = bankKey(cells[0], bankName);
    if (!key) errors.push(`${relative(file)}: empty bank key`);
    else if (seen.has(key)) errors.push(`${relative(file)}: duplicate bank key: ${key}`);
    else seen.add(key);
    if (!cells[2] || !cells[2].includes("](")) {
      errors.push(`${relative(file)}: Source must contain a session link for ${key}`);
    }
  }
}

const trackerText = await fs.readFile(path.join(root, "english_progress_tracker.json"), "utf8");
const rootReportFiles = (await fs.readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /session-report\.html?$/i.test(entry.name))
  .map((entry) => path.join(root, entry.name));
const rootReportTexts = await Promise.all(rootReportFiles.map((file) => fs.readFile(file, "utf8")));
const trackedText = [...contentByFile.values(), JSON.stringify(sessionCatalog), trackerText, ...rootReportTexts].join("\n");
if (/[A-Z]:\\(?:Users|Documents|Desktop)\\/i.test(trackedText)) {
  errors.push("Learning records contain a workstation-specific absolute path");
}
if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(trackedText)) {
  errors.push("Learning records contain an email address");
}

const privacyPatterns = [
  [/\b(?:Daigas Group|Osaka Gas)\b|大阪ガス/gi, "specific employer name"],
  [/\b(?:The University of Osaka|Osaka University|Institute of Laser Engineering)\b|大阪大学|レーザー科学研究所/gi, "specific research affiliation"],
  [/(?:daigasgroup\.com|osaka-u\.ac\.jp)/gi, "organization-specific source URL"],
  [/\b(?:laser fusion|fast[ -]ignition|inertial confinement fusion)\b|レーザー核融合|核融合研究|高速点火/gi, "identifying research topic"],
  [/\bSMAI\b/gi, "non-public product name"],
  [/\baround twenty vendor engineers\b|約20名のベンダーエンジニア/gi, "identifying team detail"],
];
for (const [pattern, label] of privacyPatterns) {
  if (pattern.test(trackedText)) errors.push(`Learning records contain ${label}`);
}

const imageReviewPath = path.join(root, "docs", "image-privacy-review.json");
let imageReview;
try {
  imageReview = JSON.parse(await fs.readFile(imageReviewPath, "utf8"));
} catch {
  errors.push("Missing or invalid docs/image-privacy-review.json");
}
if (imageReview) {
  const reviewed = new Map();
  for (const item of imageReview.files ?? []) {
    if (!item.path || !/^[a-f0-9]{64}$/i.test(item.sha256 ?? "")) {
      errors.push("Image privacy review contains an invalid entry");
      continue;
    }
    if (reviewed.has(item.path)) errors.push(`Duplicate image privacy review entry: ${item.path}`);
    reviewed.set(item.path, item.sha256.toLowerCase());
  }
  const assetFiles = [
    ...(await walk(path.join(root, "assets"))),
    ...(await walk(path.join(recordsRoot, "archive", "assets"))),
  ].filter((file) => /\.(?:png|jpe?g|webp|svg)$/i.test(file));
  const actualPaths = new Set(assetFiles.map(relative));
  for (const file of assetFiles) {
    const filePath = relative(file);
    const digest = createHash("sha256").update(await fs.readFile(file)).digest("hex");
    if (!reviewed.has(filePath)) {
      errors.push(`Image needs a manual privacy review: ${filePath}`);
    } else if (reviewed.get(filePath) !== digest) {
      errors.push(`Image changed after its privacy review: ${filePath}`);
    }
  }
  for (const reviewedPath of reviewed.keys()) {
    if (!actualPaths.has(reviewedPath)) errors.push(`Image privacy review references a missing asset: ${reviewedPath}`);
  }
}

if (errors.length) {
  console.error(`Learning-record validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Learning-record validation passed: ${recordFiles.length} Markdown files, ${Math.max(catalogById.size, sessionIds.size)} cataloged sessions.`,
  );
}
