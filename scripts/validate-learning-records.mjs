import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const recordsRoot = path.join(root, "learning-records");
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

for (const [file, markdown] of contentByFile) {
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
for (const [file, markdown] of contentByFile) {
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
    const { session_id: sessionId, session_datetime_jst: dateTime } = metadata;
    if (!sessionId || !dateTime) {
      errors.push(`${relative(file)}: session-meta needs session_id and session_datetime_jst`);
      continue;
    }
    if (sessionIds.has(sessionId)) {
      errors.push(
        `Duplicate session_id ${sessionId}: ${sessionIds.get(sessionId)} and ${relative(file)}`,
      );
    }
    sessionIds.set(sessionId, relative(file));
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

const trackedText = [...contentByFile.values()].join("\n");
if (/[A-Z]:\\(?:Users|Documents|Desktop)\\/i.test(trackedText)) {
  errors.push("Learning records contain a workstation-specific absolute path");
}
if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(trackedText)) {
  errors.push("Learning records contain an email address");
}

if (errors.length) {
  console.error(`Learning-record validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Learning-record validation passed: ${recordFiles.length} Markdown files, ${sessionIds.size} sessions.`,
  );
}
