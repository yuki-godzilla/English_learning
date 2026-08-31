import fs from "node:fs/promises";
import path from "node:path";
import { loadJournal } from "../lib/journal-parser.mjs";
import { projectRoot as root, recordsRoot } from "../lib/project.mjs";

const generatedRoot = path.join(root, ".generated-site-docs");
const siteRoot = path.join(root, "site");
const tracker = JSON.parse(await fs.readFile(path.join(recordsRoot, "progress.json"), "utf8"));
const journal = await loadJournal();
const failures = [];

function fail(message) {
  failures.push(message);
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

const expectedGenerated = [
  "index.md",
  "sessions/index.md",
  "review/index.md",
  "review/expressions.md",
  "review/vocabulary.md",
  "review/speaking.md",
  "progress/index.md",
  "library/index.md",
];

for (const relative of expectedGenerated) {
  if (!await exists(path.join(generatedRoot, relative))) fail(`Generated source is missing: ${relative}`);
}

const sessionMetadataIds = new Set(journal.sessions.map((session) => session.id));

const sessionSources = (await walk(path.join(generatedRoot, "sessions")))
  .filter((file) => /\d{4}-\d{2}-\d{2}-\d{2}\.md$/.test(file));
if (sessionSources.length < tracker.sessions.length) fail(`Expected at least ${tracker.sessions.length} generated session pages, found ${sessionSources.length}`);
const generatedSessionIds = new Set(sessionSources.map((file) => path.basename(file, ".md")));
for (const sessionId of sessionMetadataIds) {
  if (!generatedSessionIds.has(sessionId)) fail(`Journal session-meta has no generated page: ${sessionId}`);
}

function normalizedReference(rawReference) {
  let normalized = String(rawReference ?? "").trim().replace(/^<|>$/g, "");
  normalized = normalized
    .replace(/&#x([0-9a-f]+);?/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);?/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/&colon;/gi, ":");
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the undecoded value so malformed escapes cannot hide a checked scheme.
  }
  return normalized.replace(/[\u0000-\u0020\u007f]+/g, "").toLocaleLowerCase();
}

function isDangerousReference(rawReference) {
  const normalized = normalizedReference(rawReference);
  return /^(?:javascript|vbscript|file):/.test(normalized)
    || /^data:(?:text\/(?:html|xml)|application\/(?:xhtml\+xml|xml)|image\/svg\+xml)/.test(normalized);
}

for (const source of (await walk(generatedRoot)).filter((file) => file.endsWith(".md"))) {
  const markdown = await fs.readFile(source, "utf8");
  if (/<(?:script|iframe|object|embed|base)\b|<meta\b[^>]*http-equiv\s*=\s*["']?refresh|\son[a-z]+\s*=/i.test(markdown)) {
    fail(`${path.relative(root, source)} contains executable or embedded HTML`);
  }
  const references = [
    ...[...markdown.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)].map((match) => match[1]),
    ...[...markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map((match) => match[1]),
  ];
  for (const reference of references) {
    if (isDangerousReference(reference)) fail(`${path.relative(root, source)} contains a dangerous URL scheme`);
  }
}

for (const source of sessionSources) {
  const markdown = await fs.readFile(source, "utf8");
  const dateMatch = path.basename(source).match(/^(\d{4})-(\d{2})-(\d{2})-\d{2}\.md$/);
  const [, year, month, day] = dateMatch;
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
  const expectedDateLabel = `${Number(year)}年${Number(month)}月${Number(day)}日（${weekday}）`;
  if (!markdown.includes(expectedDateLabel)) fail(`${path.relative(root, source)} has an incorrect or missing weekday; expected ${expectedDateLabel}`);
  const imageCount = [...markdown.matchAll(/(?:<img\b|!\[)/g)].length;
  if (imageCount > 2) fail(`${path.relative(root, source)} contains ${imageCount} images; the session limit is 2`);
  if (!markdown.includes("## 30秒で振り返る")) fail(`${path.relative(root, source)} has no 30-second recap`);
  if (!markdown.includes("## 今すぐ復習")) fail(`${path.relative(root, source)} has no active-recall section`);
}

let sessionEightSource = null;
for (const source of sessionSources) {
  const markdown = await fs.readFile(source, "utf8");
  if (markdown.includes("Session 8 ·")) {
    sessionEightSource = source;
    break;
  }
}
if (!sessionEightSource) {
  fail("Session 8 source is missing");
} else {
  const sessionEight = await fs.readFile(sessionEightSource, "utf8");
  for (const required of [
    "2026-08-27-microgrid-diagram.png",
    "U.S. Department of Energy, Office of Electricity",
    "IEA (2026), Electricity 2026 — Demand",
    "CC BY 4.0",
    "This is a work derived by Yuki × Chappy from IEA material",
    "The derived work is not endorsed by the IEA or its Member countries in any manner.",
  ]) {
    if (!sessionEight.includes(required)) fail(`Session 8 is missing required image attribution: ${required}`);
  }
  if (sessionEight.includes("microgrid-data-center-grid.png")) {
    fail("Session 8 distributes the archived DOE raster instead of the project-created concept diagram");
  }
}

const referencedMedia = new Set();
for (const source of sessionSources) {
  const markdown = await fs.readFile(source, "utf8");
  for (const match of markdown.matchAll(/assets\/media\/([^"')\s>]+)/g)) referencedMedia.add(match[1]);
}
const generatedMediaRoot = path.join(generatedRoot, "assets", "media");
const generatedMedia = await exists(generatedMediaRoot) ? (await walk(generatedMediaRoot)).map((file) => path.basename(file)) : [];
for (const fileName of generatedMedia) {
  if (!referencedMedia.has(fileName)) fail(`Generated media is not used by a learner page: ${fileName}`);
}
if (generatedMedia.includes("microgrid-data-center-grid.png")) {
  fail("The learner site contains the archive-only DOE raster");
}

if (!await exists(siteRoot)) fail("Built site directory is missing");
const siteFiles = await walk(siteRoot);
const htmlFiles = siteFiles.filter((file) => file.endsWith(".html"));
if (htmlFiles.length < 17) fail(`Expected at least 17 HTML pages, found ${htmlFiles.length}`);

const bannedPatterns = [
  [/AGENTS\.md/gi, "AGENTS.md"],
  [/english_progress_tracker\.json/gi, "raw progress JSON"],
  [/learning-records[\\/]progress\.json/gi, "raw progress JSON"],
  [/media-manifest\.json/gi, "raw media manifest"],
  [/google-docs-final-\d{4}-\d{2}-\d{2}\.md/gi, "archive snapshot filename"],
  [/[A-Z]:\\(?:Users|English_Learning)\\/g, "Windows absolute path"],
  [/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "email address"],
  [/\b(?:Daigas Group|Osaka Gas)\b|大阪ガス/gi, "specific employer name"],
  [/\b(?:The University of Osaka|Osaka University|Institute of Laser Engineering)\b|大阪大学|レーザー科学研究所/gi, "specific research affiliation"],
  [/(?:daigasgroup\.com|osaka-u\.ac\.jp)/gi, "organization-specific source URL"],
  [/\b(?:laser fusion|fast[ -]ignition|inertial confinement fusion)\b|レーザー核融合|核融合研究|高速点火/gi, "identifying research topic"],
  [/\bSMAI\b/gi, "non-public product name"],
  [/\baround twenty vendor engineers\b|約20名のベンダーエンジニア/gi, "identifying team detail"],
  [/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/g, "unconverted GitHub alert"],
  [/github\.com\/yuki-godzilla\/English_learning/gi, "repository maintenance link"],
];

function localTarget(fromFile, rawReference) {
  const withoutFragment = rawReference.split("#", 1)[0].split("?", 1)[0];
  if (!withoutFragment || /^(?:[a-z]+:|\/\/)/i.test(withoutFragment)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    decoded = withoutFragment;
  }
  if (decoded.startsWith("/English_learning/")) decoded = decoded.slice("/English_learning/".length);
  else if (decoded === "/English_learning" || decoded === "/English_learning/") decoded = "";
  else if (decoded.startsWith("/")) return null;

  const resolved = decoded
    ? path.resolve(path.dirname(fromFile), decoded)
    : path.join(siteRoot, "index.html");
  const relativeToSite = path.relative(siteRoot, resolved);
  if (relativeToSite.startsWith("..") || path.isAbsolute(relativeToSite)) {
    fail(`${path.relative(siteRoot, fromFile)} references a path outside the built site: ${rawReference}`);
    return null;
  }
  return resolved;
}

async function targetExists(target) {
  if (await exists(target)) {
    const stat = await fs.stat(target);
    return stat.isDirectory() ? exists(path.join(target, "index.html")) : true;
  }
  if (!path.extname(target)) return exists(path.join(target, "index.html"));
  return false;
}

for (const htmlFile of htmlFiles) {
  const relative = path.relative(siteRoot, htmlFile);
  const html = await fs.readFile(htmlFile, "utf8");

  for (const [pattern, label] of bannedPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(html)) fail(`${relative} exposes ${label}`);
  }

  const hasNoIndex = [...html.matchAll(/<meta\b[^>]*>/gi)].some((match) =>
    /\bname=["']robots["']/i.test(match[0]) && /\bcontent=["'][^"']*noindex/i.test(match[0]),
  );
  if (!hasNoIndex) fail(`${relative} is missing the noindex robots directive`);

  for (const imageTag of html.matchAll(/<img\b[^>]*>/gi)) {
    const alt = imageTag[0].match(/\balt=["']([^"']*)["']/i)?.[1]?.trim();
    if (!alt) fail(`${relative} contains an image without useful alt text`);
  }

  for (const reference of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const raw = reference[1];
    if (isDangerousReference(raw)) {
      fail(`${relative} contains a dangerous URL scheme`);
      continue;
    }
    if (/^(?:https?:|mailto:|tel:|data:|#)/i.test(raw)) continue;
    const target = localTarget(htmlFile, raw);
    if (target && !await targetExists(target)) {
      fail(`${relative} has a broken local reference: ${raw}`);
    }
  }
}

const homeHtml = await fs.readFile(path.join(siteRoot, "index.html"), "utf8");
if (!homeHtml.includes("learning-bottom-nav")) fail("Home page is missing the mobile bottom navigation");
for (const label of ["ホーム", "記録", "復習", "成長", "資料"]) {
  if (!homeHtml.includes(`<span>${label}</span>`)) fail(`Mobile bottom navigation is missing: ${label}`);
}
if (await exists(path.join(siteRoot, "sitemap.xml")) || await exists(path.join(siteRoot, "sitemap.xml.gz"))) {
  fail("The noindex learning site must not publish a sitemap");
}

const searchIndexPath = path.join(siteRoot, "search", "search_index.json");
if (!await exists(searchIndexPath)) {
  fail("MkDocs search index is missing");
} else {
  const searchIndex = (await fs.readFile(searchIndexPath, "utf8")).toLocaleLowerCase();
  for (const keyword of ["godzilla", "vibe", "microgrid", "pronunciation"]) {
    if (!searchIndex.includes(keyword)) fail(`Search index does not contain expected keyword: ${keyword}`);
  }
  for (const [pattern, label] of bannedPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(searchIndex)) fail(`Search index exposes ${label}`);
  }
}

if (failures.length) {
  console.error(`Learning site validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Learning site validation passed: ${sessionSources.length} sessions, ${htmlFiles.length} HTML pages, local links and image alt text checked.`);
