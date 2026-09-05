/** Postflight validation for the integrated Current Learning Journal PDF. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadJournal } from "../lib/journal-parser.mjs";
import { projectRoot as root } from "../lib/project.mjs";

const python = path.join(
  process.env.USERPROFILE ?? "C:/Users/user",
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "python.exe",
);
if (!existsSync(python)) throw new Error("The bundled Python runtime is required to validate the Journal PDF.");

const pdfPath = path.join(root, "output", "pdf", "yuki-chappy-english-journal.pdf");
if (!existsSync(pdfPath)) throw new Error("Journal PDF is missing. Run npm run journal:pdf first.");

function tableRows(markdown) {
  return markdown.split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"))
    .map((line) => line.trim().slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 3)
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
    .filter((cells) => !/^(Expression|Word \/ IPA|Word \/ Chunk)/i.test(cells[0]));
}

function plain(value) {
  return String(value).replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`\\]/g, "").trim();
}

function normalized(value) {
  return plain(value).normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const inspector = String.raw`
from pathlib import Path
import json
import sys
from pypdf import PdfReader

reader = PdfReader(str(Path(sys.argv[1])))

def outline_titles(items):
    result = []
    for item in items:
        if isinstance(item, list):
            result.extend(outline_titles(item))
        else:
            title = getattr(item, "title", None)
            if title:
                result.append(str(title))
    return result

uris = []
actions = []
widgets = 0
page_sizes = []
texts = []
for page in reader.pages:
    page_sizes.append([float(page.mediabox.width), float(page.mediabox.height)])
    texts.append(page.extract_text() or "")
    annotations = page.get("/Annots") or []
    for annotation_ref in annotations:
        annotation = annotation_ref.get_object()
        if str(annotation.get("/Subtype", "")) == "/Widget":
            widgets += 1
        action = annotation.get("/A")
        if action:
            action = action.get_object()
            action_type = str(action.get("/S", ""))
            uri = str(action.get("/URI", ""))
            file_spec = str(action.get("/F", ""))
            actions.append({"type": action_type, "uri": uri, "file": file_spec})
            if uri:
                uris.append(uri)

print(json.dumps({
    "pages": len(reader.pages),
    "page_sizes": page_sizes,
    "outlines": outline_titles(reader.outline),
    "uris": uris,
    "actions": actions,
    "widgets": widgets,
    "text": "\n".join(texts),
}, ensure_ascii=False))
`;

const inventory = JSON.parse(execFileSync(python, ["-c", inspector, pdfPath], {
  encoding: "utf8",
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  maxBuffer: 32 * 1024 * 1024,
  windowsHide: true,
}));
const journal = await loadJournal();
const sessions = [...journal.sessions].sort((a, b) => b.date.localeCompare(a.date) || b.session - a.session);
const latest = sessions.slice(0, 3);
const failures = [];
const fail = (message) => failures.push(message);

if (inventory.pages < 10) fail(`Journal PDF has only ${inventory.pages} pages`);
for (const [index, [width, height]] of inventory.page_sizes.entries()) {
  if (Math.abs(width - 595.28) > 3 || Math.abs(height - 841.89) > 3) fail(`Page ${index + 1} is not A4 (${width.toFixed(1)} × ${height.toFixed(1)} pt)`);
}

const expectedOutlines = [
  "Cover",
  "Session Index",
  ...latest.map((session) => `Session ${session.session} — ${session.title}`),
  "English Growth & Evaluation",
  "Expression Bank",
  "Vocabulary Bank",
  "Pronunciation & Speaking Bank",
];
for (const title of expectedOutlines) {
  if (!inventory.outlines.includes(title)) fail(`PDF bookmark is missing: ${title}`);
}
if (inventory.widgets) fail(`PDF contains ${inventory.widgets} interactive Widget annotation(s)`);
for (const action of inventory.actions) {
  if (/^(?:file:|[a-z]:[\\/])/i.test(action.uri) || /^(?:file:|[a-z]:[\\/])/i.test(action.file)) {
    fail(`PDF contains a local-file action: ${action.uri || action.file}`);
  }
}
if (/(?:file:\/\/\/[a-z]:|\b[a-z]:\\Users\\)/i.test(inventory.text)) fail("PDF text exposes a local Windows path");

const normalizedText = normalized(inventory.text);
for (const requiredText of ["履歴点が少ないため", "朝の集中時間", "資格スコア予測の補助グラフ"]) {
  if (!normalizedText.includes(normalized(requiredText))) fail(`Static Growth content is missing: ${requiredText}`);
}

const banks = {
  expressions: tableRows(journal.sections.expressions),
  vocabulary: tableRows(journal.sections.vocabulary),
  speaking: tableRows(journal.sections.speaking),
};
for (const [name, rows] of Object.entries(banks)) {
  if (!normalizedText.includes(normalized(`全${rows.length}項目`))) fail(`${name} bank count is not printed (${rows.length})`);
  for (const cells of rows) {
    let key = plain(cells[0]);
    if (name === "vocabulary" || name === "speaking") key = key.split(" /")[0];
    if (!normalizedText.includes(normalized(key))) fail(`${name} bank item is missing from PDF: ${key}`);
  }
}

if (failures.length) {
  console.error(`Journal PDF postflight failed with ${failures.length} issue(s):`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`Journal PDF postflight passed: ${inventory.pages} A4 pages, ${inventory.outlines.length} bookmarks, no local-file or Widget actions.`);
console.log(`Printed Study Banks: ${banks.expressions.length} expressions, ${banks.vocabulary.length} vocabulary items, ${banks.speaking.length} speaking items.`);
