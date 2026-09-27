/** Postflight validation for the integrated Current Learning Journal PDF. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadJournal } from "../lib/journal-parser.mjs";
import { tableRows as sharedTableRows } from '../lib/markdown-table.mjs';
import { projectRoot as root } from "../lib/project.mjs";
import { findPdfPython } from "./runtime.mjs";

const python = findPdfPython();

const pdfPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "output", "pdf", "yuki-chappy-english-journal.pdf");
if (!existsSync(pdfPath)) throw new Error("Journal PDF is missing. Run npm run journal:pdf first.");

const tableRows = sharedTableRows;

function plain(value) {
  return String(value).replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`\\]/g, "").trim();
}

function normalized(value) {
  return plain(value).normalize("NFKC").replaceAll('⻑','長').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
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

def outline_pages(items):
    result = {}
    for item in items:
        if isinstance(item, list):
            result.update(outline_pages(item))
        else:
            result[str(item.title)] = reader.get_destination_page_number(item)
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
    "outline_pages": outline_pages(reader.outline),
    "pages": len(reader.pages),
    "page_sizes": page_sizes,
    "outlines": outline_titles(reader.outline),
    "uris": uris,
    "actions": actions,
    "widgets": widgets,
    "page_texts": texts,
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
for (const requiredText of ["WHERE I AM NOW", "HOW MY SPEAKING IS CHANGING", "WHAT TO WORK ON NEXT", "RAW EVIDENCE COVERAGE", "ESTIMATED EXTERNAL-TEST RANGES"]) {
  if (!normalizedText.includes(normalized(requiredText))) fail(`Static Growth content is missing: ${requiredText}`);
}
const growthStart = inventory.outline_pages['English Growth & Evaluation'];
const expressionStart = inventory.outline_pages['Expression Bank'];
if (growthStart < 0 || expressionStart <= growthStart) fail("Growth-to-Bank page boundary could not be identified");
else {
  const growthPages = expressionStart - growthStart;
  if (growthPages > 4) fail(`Growth section uses ${growthPages} pages; maximum target is 4 without shrinking body text`);
  for (let index = growthStart; index < expressionStart; index += 1) {
    if ((inventory.page_texts[index] ?? "").trim().length < 120) fail(`Growth page ${index + 1} appears nearly empty or orphaned`);
  }
}

const banks = {
  expressions: tableRows(journal.sections.expressions),
  vocabulary: tableRows(journal.sections.vocabulary),
  speaking: tableRows(journal.sections.speaking),
};
for (const [name, rows] of Object.entries(banks)) {
  const names = { expressions: 'Expression Bank', vocabulary: 'Vocabulary Bank', speaking: 'Pronunciation & Speaking Bank' };
  const start = inventory.outline_pages[names[name]];
  const next = Object.keys(banks)[Object.keys(banks).indexOf(name) + 1];
  const end = next ? inventory.outline_pages[names[next]] : inventory.pages;
  const bankText = normalized(inventory.page_texts.slice(start, end).join('\n'));
  if (start < 0 || end <= start) fail(`${name} section boundaries missing`);
  if (!bankText.includes(normalized(`全${rows.length}項目`))) fail(`${name} bank count is not printed (${rows.length})`);
  for (const cells of rows) {
    let key = plain(cells[0]);
    if (name === "vocabulary" || name === "speaking") key = key.split(" /")[0];
    if (!bankText.includes(normalized(key))) fail(`${name} bank item is missing from its section: ${key}`);
    const meaning = plain(cells[1]).slice(0, 28);
    if (!bankText.includes(normalized(meaning))) fail(`${name} bank explanation missing: ${key}`);
    for (const source of cells[2].matchAll(/Session\s+(\d+)/g)) if (!bankText.includes(normalized(`Session ${source[1]}`))) fail(`${name} Source missing: ${source[1]}`);
  }
}

if (failures.length) {
  console.error(`Journal PDF postflight failed with ${failures.length} issue(s):`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`Journal PDF postflight passed: ${inventory.pages} A4 pages, ${inventory.outlines.length} bookmarks, no local-file or Widget actions.`);
console.log(`Printed Study Banks: ${banks.expressions.length} expressions, ${banks.vocabulary.length} vocabulary items, ${banks.speaking.length} speaking items.`);
