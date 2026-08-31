import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadJournal } from "../lib/journal-parser.mjs";
import { projectRoot as root, recordsRoot } from "../lib/project.mjs";

const failures = [];
const fail = (message) => failures.push(message);
const journalPath = path.join(recordsRoot, "journal.md");

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function walk(directory) {
  const output = [];
  if (!await exists(directory)) return output;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(target));
    else output.push(target);
  }
  return output;
}

const normalizeRelative = (target) => path.relative(root, target).replaceAll("\\", "/");
function tableRows(markdown) {
  return markdown.split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"))
    .map((line) => line.trim().slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 3)
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
    .filter((cells) => !/^(Expression|Word \/ IPA|Word \/ Chunk)/i.test(cells[0]));
}

let journal;
let progress;
let manifest;
try {
  [journal, progress, manifest] = await Promise.all([
    loadJournal(),
    fs.readFile(path.join(recordsRoot, "progress.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(recordsRoot, "media-manifest.json"), "utf8").then(JSON.parse),
  ]);
} catch (error) {
  console.error(`Content check could not load the three canonical inputs: ${error.message}`);
  process.exit(1);
}

for (const [name, section] of Object.entries(journal.sections)) {
  if (!section) fail(`Journal section is missing: ${name}`);
}
if (!journal.markdown.startsWith("# Yuki × Chappy English Journal")) fail("Journal must begin with its learner-facing title");
if (!journal.markdown.includes("この一冊が学習記録の正本です")) fail("Journal must identify itself as the human-readable source of truth");

const seenIds = new Set();
const seenNumbers = new Set();
for (const [index, session] of journal.sessions.entries()) {
  if (!Number.isInteger(session.session) || session.session < 1) fail(`Invalid session number: ${session.id}`);
  if (!/^\d{4}-\d{2}-\d{2}-\d{2}$/.test(session.id)) fail(`Invalid session id: ${session.id}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date)) fail(`Invalid date: ${session.id}`);
  if (!session.title || !session.remember || !session.prompt || !Array.isArray(session.tags) || !session.tags.length) fail(`Incomplete session metadata: ${session.id}`);
  if (seenIds.has(session.id)) fail(`Duplicate session id: ${session.id}`);
  if (seenNumbers.has(session.session)) fail(`Duplicate session number: ${session.session}`);
  seenIds.add(session.id);
  seenNumbers.add(session.session);
  if (!journal.markdown.includes(`(#session-${session.id})`)) fail(`Table of contents has no link to Session ${session.session}`);
  if (!session.raw.includes(`<a id="session-${session.id}"></a>`)) fail(`Session ${session.session} has no fixed anchor`);
  const previous = journal.sessions[index - 1];
  if (previous && (session.date > previous.date || session.session >= previous.session)) fail("Journal sessions must be ordered newest first with decreasing session numbers");
}

if (!Array.isArray(progress.sessions) || !progress.sessions.length) fail("Progress data has no sessions");
for (const session of progress.sessions ?? []) {
  const journalSession = journal.sessions.find((entry) => entry.session === session.session);
  if (!journalSession) { fail(`Progress Session ${session.session} has no Journal session`); continue; }
  if (journalSession.date !== session.date) fail(`Session ${session.session} date differs between Journal and progress data`);
  for (const metric of progress.qualitative_metrics ?? []) {
    const rating = session.ratings?.[metric];
    if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) fail(`Session ${session.session} has an invalid ${metric} rating`);
  }
}

const latestProgress = progress.sessions?.at(-1);
if (latestProgress) {
  for (const [metric, rating] of Object.entries(latestProgress.ratings ?? {})) {
    const expected = rating == null ? "N/A" : `L${rating}`;
    if (!journal.sections.growth.includes(expected)) fail(`Growth section does not show ${metric}: ${expected}`);
  }
}
for (const requiredImage of ["media/progress/english-growth-evidence-dashboard.png", "media/progress/english-test-score-estimate-trends.png"]) {
  if (!journal.sections.growth.includes(requiredImage)) fail(`Growth section is missing ${requiredImage}`);
}

for (const [name, markdown] of Object.entries({ expressions: journal.sections.expressions, vocabulary: journal.sections.vocabulary, speaking: journal.sections.speaking })) {
  const rows = tableRows(markdown);
  if (!rows.length) fail(`${name} bank has no entries`);
  const keys = new Set();
  for (const cells of rows) {
    const key = cells[0].replace(/[*_`]/g, "").normalize("NFKC").toLocaleLowerCase().trim();
    if (keys.has(key)) fail(`${name} bank has a duplicate entry: ${key}`);
    keys.add(key);
    if (!/#session-\d{4}-\d{2}-\d{2}-\d{2}/.test(cells[2])) fail(`${name} bank entry has no fixed Session source: ${cells[0]}`);
  }
}

for (const match of journal.markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
  const reference = match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];
  if (/^(?:https?:|mailto:|#)/i.test(reference)) continue;
  const [relative, anchor] = reference.split("#", 2);
  const target = path.resolve(path.dirname(journalPath), decodeURIComponent(relative));
  if (!await exists(target)) { fail(`Journal has a broken local link: ${reference}`); continue; }
  if (anchor && target.endsWith(".md")) {
    const targetText = await fs.readFile(target, "utf8");
    if (!targetText.includes(`id="${anchor}"`) && !targetText.includes(`(#${anchor})`)) fail(`Journal has a broken anchor link: ${reference}`);
  }
}

for (const relativeDocument of ["README.md", "docs/maintenance.md", "AGENTS.md", "yuki-chappy-english-session-rules.md", "learning-records/archive/README.md"]) {
  const documentPath = path.join(root, relativeDocument);
  const markdown = await fs.readFile(documentPath, "utf8");
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const reference = match[1].trim().replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|#)/i.test(reference)) continue;
    const [relative, anchor] = reference.split("#", 2);
    const target = path.resolve(path.dirname(documentPath), decodeURIComponent(relative));
    if (!await exists(target)) { fail(`${relativeDocument} has a broken local link: ${reference}`); continue; }
    if (anchor && target.endsWith(".md")) {
      const targetText = await fs.readFile(target, "utf8");
      if (!targetText.includes(`id="${anchor}"`)) fail(`${relativeDocument} has a broken explicit anchor link: ${reference}`);
    }
  }
}

if (!Array.isArray(manifest.files) || !manifest.files.length) fail("Media manifest has no files");
const manifestPaths = new Set();
for (const entry of manifest.files ?? []) {
  if (!entry.path || !entry.status || !entry.role || !entry.sha256) { fail(`Incomplete media manifest entry: ${JSON.stringify(entry)}`); continue; }
  if (manifestPaths.has(entry.path)) fail(`Duplicate media manifest path: ${entry.path}`);
  manifestPaths.add(entry.path);
  const target = path.join(root, entry.path);
  if (!await exists(target)) { fail(`Manifest file is missing: ${entry.path}`); continue; }
  const digest = crypto.createHash("sha256").update(await fs.readFile(target)).digest("hex");
  if (digest !== entry.sha256) fail(`Media changed without a new visual review and hash: ${entry.path}`);
  if (["published", "generated"].includes(entry.status) && (!entry.alt || !entry.caption || !entry.creator || !entry.license)) fail(`Published media metadata is incomplete: ${entry.path}`);
}
for (const directory of [path.join(recordsRoot, "media"), path.join(recordsRoot, "archive", "media")]) {
  for (const file of await walk(directory)) {
    const relative = normalizeRelative(file);
    if (!manifestPaths.has(relative)) fail(`Media file is not registered in the manifest: ${relative}`);
  }
}

const siteBuilder = await fs.readFile(path.join(root, "scripts", "site", "build.mjs"), "utf8");
if (/recordsRoot,\s*["']archive["']/.test(siteBuilder)) fail("Learning Site runtime must not read the fixed archive");
for (const legacyInput of ["daily-notes", "session-catalog.json", "session-index.md", "latest.md", "growth.md"]) {
  if (siteBuilder.includes(legacyInput)) fail(`Learning Site still depends on legacy input: ${legacyInput}`);
}

for (const [pattern, label] of [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "email address"],
  [/\b(?:api[_-]?key|secret|token)\s*[:=]\s*["'][^"']+["']/i, "credential-like value"],
  [/\b(?:Daigas Group|Osaka Gas|大阪ガス)\b/i, "specific employer name"],
]) {
  if (pattern.test(journal.markdown)) fail(`Journal contains ${label}`);
}

if (failures.length) {
  console.error(`Content validation failed with ${failures.length} issue(s):`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`Content validation passed: ${journal.sessions.length} sessions, ${progress.sessions.length} evaluations, ${manifest.files.length} media records.`);
