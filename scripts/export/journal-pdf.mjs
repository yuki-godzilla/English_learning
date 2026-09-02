/** Create one print-ready PDF containing the whole English Journal. */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadJournal } from "../lib/journal-parser.mjs";
import { projectRoot as root } from "../lib/project.mjs";

const chromeCandidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const chrome = chromeCandidates.find(existsSync);
if (!chrome) throw new Error("Chrome or Microsoft Edge is required to create the Journal PDF.");

const python = path.join(
  process.env.USERPROFILE ?? "C:/Users/user",
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "python.exe",
);
if (!existsSync(python)) throw new Error("The bundled Python runtime is required to merge the Journal PDF.");
const outputPath = path.join(root, "output", "pdf", "yuki-chappy-english-journal.pdf");
const scratchDir = path.join(root, "tmp", "pdf-journal");
const siteRoot = path.join(root, "site");
const journal = await loadJournal();
const sessions = [...journal.sessions].sort((a, b) => b.date.localeCompare(a.date) || b.session - a.session);
const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

await fs.access(siteRoot);
await fs.rm(scratchDir, { recursive: true, force: true });
await fs.mkdir(scratchDir, { recursive: true });
await fs.mkdir(path.dirname(outputPath), { recursive: true });
const latestDailyNotes = sessions.slice(0, 3);

// The Session Index is deliberately included as an all-history summary, while
// its older Daily Notes are intentionally absent from this compact PDF. Remove
// only those card links in a temporary same-directory print copy so the PDF
// never contains dead internal destinations.
const sessionIndexPath = path.join(siteRoot, "sessions", "index.html");
const sessionIndexPrintPath = path.join(siteRoot, "sessions", "journal-index-print.html");
const sessionIndexHtml = await fs.readFile(sessionIndexPath, "utf8");
const sessionIndexPrintHtml = sessionIndexHtml.replace(
  /(<article class="session-card" data-session-item[\s\S]*?<h2>)<a\b[^>]*>([\s\S]*?)<\/a>(<\/h2>)/g,
  "$1$2$3",
);
await fs.writeFile(sessionIndexPrintPath, sessionIndexPrintHtml, "utf8");

// Learning cards are interactive on the web.  The PDF is a static reading
// artifact, so render their answers open without changing the source site.
const sessionPrintPaths = [];
for (const session of latestDailyNotes) {
  const sourcePath = path.join(siteRoot, "sessions", session.id, "index.html");
  const printPath = path.join(siteRoot, "sessions", session.id, "journal-print.html");
  const html = await fs.readFile(sourcePath, "utf8");
  const printableHtml = html
    .replace(/<details class="recall-card"/g, '<details class="recall-card" open')
    .replace(/<summary>/g, '<summary><span class="print-question-label">Question</span>');
  await fs.writeFile(printPath, printableHtml, "utf8");
  sessionPrintPaths.push(printPath);
}

const coverPath = path.join(scratchDir, "cover.html");
await fs.writeFile(coverPath, `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Yuki × Chappy English Journal</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { color: #1f2937; font-family: "Yu Gothic UI", "Meiryo", sans-serif; }
  .eyebrow { color: #1d5fa7; font-size: 11pt; font-weight: 700; letter-spacing: .06em; }
  h1 { margin: 8px 0 6px; color: #163a5f; font-size: 30pt; line-height: 1.2; }
  .subtitle { margin: 0 0 24px; color: #4b5563; font-size: 13pt; }
  .rule { border: 0; border-top: 3px solid #0f766e; margin: 18px 0; }
  h2 { margin: 22px 0 10px; color: #163a5f; font-size: 16pt; }
  ol { margin: 0; padding-left: 24px; columns: 2; column-gap: 28px; }
  li { margin: 0 0 7px; break-inside: avoid; font-size: 10pt; line-height: 1.35; }
  .footer { margin-top: 28px; padding: 12px 14px; background: #ecfdf5; border-left: 4px solid #047857; font-size: 10pt; line-height: 1.45; }
</style></head><body>
<div class="eyebrow">YUKI × CHAPPY · ENGLISH LEARNING</div>
<h1>English Journal</h1>
<p class="subtitle">全履歴を追える、最新状態の学習記録</p>
<hr class="rule">
<h2>収録内容</h2>
<ol>${sessions.map((session) => `<li><strong>Session ${session.session}</strong> — ${escapeHtml(session.title)}<br><span>${escapeHtml(session.date)}</span></li>`).join("")}</ol>
<div class="footer"><strong>このPDFについて</strong><br>全Session Index、直近3回のDaily Note、全履歴の英語力推移、3種類のStudy Bankを一冊にまとめています。Daily Noteの原本はJournalに保持し、PDFでは最新の学習状況を読みやすく確認します。</div>
</body></html>`, "utf8");

const pages = [
  { label: "cover", path: coverPath },
  { label: "session-index", path: sessionIndexPrintPath },
  ...latestDailyNotes.map((session, index) => ({ label: `session-${session.id}`, path: sessionPrintPaths[index] })),
  { label: "growth", path: path.join(siteRoot, "progress", "index.html") },
  { label: "expressions", path: path.join(siteRoot, "review", "expressions", "index.html") },
  { label: "vocabulary", path: path.join(siteRoot, "review", "vocabulary", "index.html") },
  { label: "speaking", path: path.join(siteRoot, "review", "speaking", "index.html") },
];

const inputs = [];
for (const page of pages) {
  await fs.access(page.path);
  const pdfPath = path.join(scratchDir, `${page.label}.pdf`);
  execFileSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--allow-file-access-from-files",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(page.path).href,
  ], { stdio: "pipe", windowsHide: true });
  inputs.push(pdfPath);
}

const merger = String.raw`
from pathlib import Path
from pypdf import PdfReader, PdfWriter
import sys

output = Path(sys.argv[1])
writer = PdfWriter()
for source in sys.argv[2:]:
    writer.append(source)
with output.open("wb") as stream:
    writer.write(stream)
reader = PdfReader(str(output))
if len(reader.pages) < 2:
    raise RuntimeError("The merged Journal PDF has too few pages.")
print(f"Created {output.name}: {len(reader.pages)} pages")
`;
execFileSync(python, ["-c", merger, outputPath, ...inputs], { stdio: "inherit", windowsHide: true });
await fs.rm(scratchDir, { recursive: true, force: true });
await fs.rm(sessionIndexPrintPath, { force: true });
await Promise.all(sessionPrintPaths.map((printPath) => fs.rm(printPath, { force: true })));

console.log(`Journal PDF created: ${path.relative(root, outputPath)}`);
