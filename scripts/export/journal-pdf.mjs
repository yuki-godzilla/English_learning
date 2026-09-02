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

const coverPath = path.join(scratchDir, "cover.html");
await fs.writeFile(coverPath, `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Yuki × Chappy English Journal</title>
<style>
  @page { size: letter; margin: 0.7in; }
  * { box-sizing: border-box; }
  body { color: #17233d; font-family: "Yu Gothic UI", "Meiryo", sans-serif; }
  .eyebrow { color: #31708f; font-size: 11pt; font-weight: 700; letter-spacing: .06em; }
  h1 { margin: 8px 0 6px; color: #172b4d; font-size: 30pt; line-height: 1.2; }
  .subtitle { margin: 0 0 24px; color: #52647b; font-size: 13pt; }
  .rule { border: 0; border-top: 3px solid #2f9e8f; margin: 18px 0; }
  h2 { margin: 22px 0 10px; color: #172b4d; font-size: 16pt; }
  ol { margin: 0; padding-left: 24px; columns: 2; column-gap: 28px; }
  li { margin: 0 0 7px; break-inside: avoid; font-size: 10pt; line-height: 1.35; }
  .footer { margin-top: 28px; padding: 12px 14px; background: #edf7f6; border-left: 4px solid #2f9e8f; font-size: 10pt; line-height: 1.45; }
</style></head><body>
<div class="eyebrow">YUKI × CHAPPY · ENGLISH LEARNING</div>
<h1>English Journal</h1>
<p class="subtitle">全セッション・成長評価・Study Banks をまとめた学習記録</p>
<hr class="rule">
<h2>収録内容</h2>
<ol>${sessions.map((session) => `<li><strong>Session ${session.session}</strong> — ${escapeHtml(session.title)}<br><span>${escapeHtml(session.date)}</span></li>`).join("")}</ol>
<div class="footer"><strong>このPDFについて</strong><br>会話記録、英語力の成長・評価、表現・語彙・発音・スピーキングの学習バンクを一冊にまとめています。個人情報や社内の詳細は学習記録として必要な範囲で匿名化しています。</div>
</body></html>`, "utf8");

const pages = [
  { label: "cover", path: coverPath },
  ...sessions.map((session) => ({ label: `session-${session.id}`, path: path.join(siteRoot, "sessions", session.id, "index.html") })),
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

console.log(`Journal PDF created: ${path.relative(root, outputPath)}`);
