import { buildLearningBrief, learningBriefHtml, growthSummaryHtml, pdfChapterOrder } from '../lib/learning-plan.mjs';
import { PDF_CHAPTER_LINK_PREFIX, pdfChapterLink, pdfContents } from '../lib/report-presentation.mjs';
/** Create one print-ready PDF containing the current English Journal. */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadJournal } from "../lib/journal-parser.mjs";
import { tableRows as sharedTableRows } from '../lib/markdown-table.mjs';
import { projectRoot as root } from "../lib/project.mjs";
import { findPdfBrowser, findPdfPython } from "../pdf/runtime.mjs";

const chrome = findPdfBrowser();
const python = findPdfPython();

const outputPath = path.join(root, "output", "pdf", "yuki-chappy-english-journal.pdf");
await fs.mkdir(path.join(root, 'tmp'), { recursive: true });
const scratchDir = await fs.mkdtemp(path.join(root, 'tmp', 'pdf-journal-'));
const lockPath = path.join(root, 'tmp', 'journal-pdf.lock');
const lock = await fs.open(lockPath, 'wx').catch(() => { throw new Error('PDF export already running. Inspect tmp/journal-pdf.lock before recovering an interrupted run.'); });
await lock.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
const candidatePath = path.join(scratchDir, 'candidate.pdf');
const siteRoot = path.join(root, "site");
const journal = await loadJournal();
const progress = JSON.parse(await fs.readFile(path.join(root, 'learning-records/progress.json'), 'utf8'));
const ledger = JSON.parse(await fs.readFile(path.join(root, 'learning-records/resources/bank-ledger.json'), 'utf8'));
const learningBrief = buildLearningBrief(journal, progress, ledger);
const sessions = [...journal.sessions].sort((a, b) => b.date.localeCompare(a.date) || b.session - a.session);
const latestDailyNotes = sessions.slice(0, 3);
const sessionByNumber = new Map(sessions.map((session) => [session.session, session]));

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

const tableRows = sharedTableRows;

function removeLocalLinkTargets(html) {
  // Only neutralize learner-facing anchors. Stylesheet <link> elements must
  // retain their local hrefs so the dedicated print theme is actually loaded.
  return html.replace(/<a\b[^>]*>/gi, (tag) => tag
    .replace(/\s+href=(['"])(?!(?:https?:|mailto:|#))[^'"]+\1/i, "")
    .replace(/\s+href=(['"])file:[^'"]+\1/i, ""));
}

function makeStaticPrintHtml(html, { questionLabels = false, staticDisclosures = false } = {}) {
  let output = removeLocalLinkTargets(html)
    .replace(/<details\b(?![^>]*\bopen\b)([^>]*)>/gi, "<details$1 open>");
  if (questionLabels) {
    output = output.replace(/<details class="recall-card" open>\s*<summary>/gi, '<details class="recall-card" open><summary><span class="print-question-label">Question</span>');
  }
  if (staticDisclosures) {
    output = output
      .replace(/<details\b[^>]*>/gi, '<section class="print-disclosure">')
      .replace(/<\/details>/gi, "</section>")
      .replace(/<summary>/gi, '<h3 class="print-disclosure-title">')
      .replace(/<\/summary>/gi, "</h3>")
      .replace(/class="recall-answer"/gi, 'class="print-disclosure-body"');
  }
  return output.replace("</head>", `<style>
    @page { size: A4; margin: 16mm 14mm 18mm; }
    .print-disclosure { margin: 4mm 0; padding: 4mm; background: #f7f9fc; border: 1px solid #cbd5e1; break-inside: avoid; }
    .print-disclosure-title { margin: 0 0 3mm !important; color: #163a5f !important; font-size: 12.5pt !important; }
    .print-disclosure-body { color: #1f2937; }
  </style></head>`);
}

const bankTheme = {
  expressions: {
    title: "表現バンク / Expression Bank",
    intro: "全セッションから蓄積した、再利用価値の高い表現。新しい項目から順に掲載しています。",
    color: "#1d4ed8",
    tint: "#eff6ff",
    headers: ["Expression", "Meaning / Usage / Example", "Source"],
  },
  vocabulary: {
    title: "語彙バンク / Vocabulary Bank",
    intro: "意味・発音・品詞・自然な組み合わせ・例文を、一つの行で確認できる全履歴です。",
    color: "#047857",
    tint: "#ecfdf5",
    headers: ["Word / IPA / POS", "Meaning / Collocation / Example", "Source"],
  },
  speaking: {
    title: "発音・スピーキングバンク / Pronunciation & Speaking Bank",
    intro: "強勢、rhythm、音の対比、意味チャンクをまとめた全履歴です。録音評価ではない項目は本文で明示しています。",
    color: "#6d28d9",
    tint: "#f5f3ff",
    headers: ["Word / Chunk", "Speaking / Focus / Practice", "Source"],
  },
};

function bankSource(cell) {
  const matches = [...cell.matchAll(/\[Session\s+(\d+)\]/gi)];
  if (!matches.length) return escapeHtml(cell.replace(/[*_`]/g, ""));
  return matches.map((match) => {
    const number = Number(match[1]);
    const session = sessionByNumber.get(number);
    return `<strong>Session ${number}</strong>${session ? `<br>${escapeHtml(session.date)}` : ""}`;
  }).join("<br>");
}

function bankHtml(kind, rows) {
  const theme = bankTheme[kind];
  const tableBody = rows.map((cells) => `<tr>
    <td class="bank-item">${inlineMarkdown(cells[0])}</td>
    <td>${inlineMarkdown(cells[1])}</td>
    <td class="bank-source">${bankSource(cells[2])}</td>
  </tr>`).join("\n");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(theme.title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1f2937; background: #ffffff; font-family: "Yu Gothic UI", "Meiryo", sans-serif; font-size: 10.5pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { margin: 0 0 3mm; color: ${theme.color}; font-size: 23pt; line-height: 1.22; }
  .intro { margin: 0 0 6mm; padding: 3mm 4mm; color: #1f2937; background: ${theme.tint}; border-left: 4px solid ${theme.color}; }
  .count { color: #4b5563; font-size: 10.5pt; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th { padding: 2.6mm 2.8mm; color: #ffffff; background: ${theme.color}; border: 1px solid ${theme.color}; font-size: 10.5pt; line-height: 1.35; text-align: left; }
  td { padding: 2.6mm 2.8mm; color: #1f2937; background: #ffffff; border: 1px solid #cbd5e1; vertical-align: top; font-size: 10.5pt; line-height: 1.5; overflow-wrap: anywhere; }
  tbody tr:nth-child(even) td { background: ${theme.tint}; }
  th:nth-child(1), td:nth-child(1) { width: 30%; }
  th:nth-child(2), td:nth-child(2) { width: 54%; }
  th:nth-child(3), td:nth-child(3) { width: 16%; }
  .bank-item strong { color: ${theme.color}; }
  .bank-source { text-align: center; white-space: normal; }
  .bank-source strong { color: #163a5f; }
  code { padding: 0.1em 0.25em; color: #1f2937; background: #f3f4f6; border-radius: 2px; font-family: "Cascadia Mono", Consolas, monospace; font-size: 9.5pt; }
</style></head><body>
<h1>${escapeHtml(theme.title)}</h1>
<p class="intro">${escapeHtml(theme.intro)} <span class="count">全${rows.length}項目</span></p>
<table aria-label="${escapeHtml(theme.title)}"><thead><tr>${theme.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>
${tableBody}
</tbody></table>
</body></html>`;
}

function sessionIndexHtml() {
  const rows = sessions.map((session) => `<tr>
    <td class="session-number">${latestDailyNotes.some(note => note.session === session.session) ? `<a href="${pdfChapterLink(`session-${session.id}`)}"><strong>Session ${session.session}</strong></a>` : `<strong>Session ${session.session}</strong>`}</td>
    <td>${escapeHtml(session.date)}</td>
    <td class="session-title">${escapeHtml(session.title)}</td>
    <td>${escapeHtml(session.remember)}</td>
  </tr>`).join("\n");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Session Index</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1f2937; background: #ffffff; font-family: "Yu Gothic UI", "Meiryo", sans-serif; font-size: 10.5pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { margin: 0 0 3mm; color: #163a5f; font-size: 24pt; line-height: 1.2; }
  .intro { margin: 0 0 5mm; color: #4b5563; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th { padding: 2.3mm; color: #ffffff; background: #163a5f; border: 1px solid #163a5f; font-size: 10.5pt; text-align: left; }
  td { padding: 2.3mm; color: #1f2937; background: #ffffff; border: 1px solid #cbd5e1; vertical-align: top; overflow-wrap: anywhere; }
  tbody tr:nth-child(even) td { background: #f7f9fc; }
  th:nth-child(1), td:nth-child(1) { width: 13%; }
  th:nth-child(2), td:nth-child(2) { width: 15%; }
  th:nth-child(3), td:nth-child(3) { width: 28%; }
  th:nth-child(4), td:nth-child(4) { width: 44%; }
  .session-number, .session-title { color: #163a5f; }
</style></head><body>
<h1>すべてのセッション / Session Index</h1>
<p class="intro">全${sessions.length}回を新しい順に掲載。Daily Notesの詳細は直近3回を収録し、過去回はこの一覧から要点を確認できます。</p>
<table aria-label="Session Index"><thead><tr><th>Session</th><th>Date</th><th>Title</th><th>One-line summary</th></tr></thead><tbody>
${rows}
</tbody></table>
</body></html>`;
}

await fs.access(siteRoot);
await fs.mkdir(path.dirname(outputPath), { recursive: true });

const temporarySitePaths = [];
try {
  // The PDF index uses the same four information roles as the former Google
  // Docs index, but without links to Daily Notes that are not embedded.
  const sessionIndexPrintPath = path.join(scratchDir, "session-index.html");
  await fs.writeFile(sessionIndexPrintPath, sessionIndexHtml(), "utf8");

  const sessionPrintPaths = [];
  for (const session of latestDailyNotes) {
    const sourcePath = path.join(siteRoot, "sessions", session.id, "index.html");
    const printPath = path.join(siteRoot, "sessions", session.id, "journal-print.html");
    const html = await fs.readFile(sourcePath, "utf8");
    await fs.writeFile(printPath, makeStaticPrintHtml(html, { questionLabels: true }), "utf8");
    temporarySitePaths.push(printPath);
    sessionPrintPaths.push(printPath);
  }

  const growthPath = path.join(siteRoot, "progress", "index.html");
  const growthPrintPath = path.join(siteRoot, "progress", "journal-print.html");
  await fs.writeFile(growthPrintPath, makeStaticPrintHtml(await fs.readFile(growthPath, "utf8"), { staticDisclosures: true }), "utf8");
  temporarySitePaths.push(growthPrintPath);

  const coverPath = path.join(scratchDir, "cover.html");
  const contents = pdfContents(latestDailyNotes[0].id).map(item => ({...item, href: pdfChapterLink(item.label)}));
  await fs.writeFile(coverPath, learningBriefHtml(learningBrief, contents), "utf8");
  const growthSummaryPath = path.join(scratchDir, "growth-summary.html");
  await fs.writeFile(growthSummaryPath, growthSummaryHtml(progress, learningBrief), "utf8");

  const bankPaths = {};
  for (const [kind, section] of Object.entries({
    expressions: journal.sections.expressions,
    vocabulary: journal.sections.vocabulary,
    speaking: journal.sections.speaking,
  })) {
    const rows = tableRows(section);
    const bankPath = path.join(scratchDir, `${kind}.html`);
    await fs.writeFile(bankPath, bankHtml(kind, rows), "utf8");
    bankPaths[kind] = bankPath;
  }

  const chapterPaths = {
    cover: coverPath, 'growth-summary': growthSummaryPath,
    'session-index': sessionIndexPrintPath, growth: growthPrintPath,
    ...bankPaths,
    ...Object.fromEntries(latestDailyNotes.map((session, index) => [`session-${session.id}`, sessionPrintPaths[index]])),
  };
  const pages = pdfChapterOrder(sessions).map(chapter => ({...chapter, path: chapterPaths[chapter.label]}));

  function renderChapter(page, pdfPath) {
    execFileSync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--user-data-dir=${path.join(scratchDir, "browser-profile", page.label)}`,
      "--allow-file-access-from-files",
      "--no-pdf-header-footer",
      "--run-all-compositor-stages-before-draw",
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(page.path).href,
    ], { stdio: "pipe", windowsHide: true, timeout: 120000 });
  }
  const inputs = [];
  for (const page of pages) {
    await fs.access(page.path);
    const pdfPath = path.join(scratchDir, `${page.label}.pdf`);
    console.log(`Rendering PDF chapter: ${page.title}`);
    renderChapter(page,pdfPath);
    inputs.push({ path: pdfPath, title: page.title, label: page.label });
  }

  // Once pagination is known, print page numbers alongside the clickable links.
  const countPages = paths => JSON.parse(execFileSync(python,['-c',
    'import json,sys; from pypdf import PdfReader; print(json.dumps([len(PdfReader(p).pages) for p in json.loads(sys.argv[1])]))',
    JSON.stringify(paths)],{encoding:'utf8',windowsHide:true}));
  const chapterCounts=countPages(inputs.map(input=>input.path));
  let offset=1;
  const chapterStarts=new Map(inputs.map((input,index)=>{const start=offset;offset+=chapterCounts[index];return [input.label,start];}));
  await fs.writeFile(coverPath,learningBriefHtml(learningBrief,contents.map(item=>({...item,title:`${item.title} · p.${chapterStarts.get(item.label)}`}))),'utf8');
  renderChapter(pages[0],inputs[0].path);
  if (countPages([inputs[0].path])[0]!==chapterCounts[0]) throw new Error('Printed contents changed the cover page count; chapter numbering is unsafe.');

  const manifestPath = path.join(scratchDir, "merge-manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify({ inputs, linkPrefix: PDF_CHAPTER_LINK_PREFIX }, null, 2), "utf8");
  const merger = String.raw`
from io import BytesIO
from pathlib import Path
import json
import sys

from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Link
from pypdf.generic import ArrayObject, NameObject
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

output = Path(sys.argv[1])
manifest = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
writer = PdfWriter()
chapter_starts = {}
for entry in manifest["inputs"]:
    reader = PdfReader(entry["path"])
    start_page = len(writer.pages)
    chapter_starts[entry["label"]] = start_page
    for page in reader.pages:
        writer.add_page(page)
    writer.add_outline_item(entry["title"], start_page)

for page in writer.pages:
    for reference in page.get("/Annots") or []:
        annotation = reference.get_object()
        action = annotation.get("/A")
        if not action:
            continue
        uri = str(action.get_object().get("/URI", ""))
        if not uri.startswith(manifest["linkPrefix"]):
            continue
        label = uri[len(manifest["linkPrefix"]):]
        if label not in chapter_starts:
            raise RuntimeError(f"Unknown PDF chapter link: {label}")
        annotation.pop(NameObject("/A"))
        annotation[NameObject("/Dest")] = ArrayObject([
            writer.pages[chapter_starts[label]].indirect_reference, NameObject("/Fit")])

for index, page in enumerate(writer.pages, start=1):
    overlay_buffer = BytesIO()
    overlay = canvas.Canvas(overlay_buffer, pagesize=A4)
    overlay.setFillColor(HexColor("#4B5563"))
    overlay.setFont("Helvetica", 8.5)
    overlay.drawString(14 * mm, 8 * mm, "Contents")
    overlay.drawRightString(A4[0] - 14 * mm, 8 * mm, str(index))
    overlay.save()
    overlay_buffer.seek(0)
    page.merge_page(PdfReader(overlay_buffer).pages[0], over=True)
    writer.add_annotation(index - 1, Link(rect=(14 * mm, 7 * mm, 29 * mm, 11 * mm), target_page_index=0))
    page.compress_content_streams()

writer.add_metadata({
    "/Title": "Yuki × Astra English Journal",
    "/Author": "Yuki × Astra",
    "/Subject": "Current Learning Journal",
})
writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
with output.open("wb") as stream:
    writer.write(stream)

reader = PdfReader(str(output))
if len(reader.pages) < 2:
    raise RuntimeError("The merged Journal PDF has too few pages.")
print(f"Created {output.name}: {len(reader.pages)} pages")
`;
  execFileSync(python, ["-c", merger, candidatePath, manifestPath], { stdio: "inherit", windowsHide: true });
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts/pdf/validate-journal-pdf.mjs'), candidatePath], { stdio: 'inherit', windowsHide: true });
  } catch (error) {
    await fs.copyFile(candidatePath, path.join(root, 'tmp', 'journal-failed-candidate.pdf'));
    throw error;
  }
  // Do not replace the last usable PDF until candidate postflight succeeds.
  await fs.rename(candidatePath, outputPath);
} finally {
  await Promise.all(temporarySitePaths.map((printPath) => fs.rm(printPath, { force: true })));
  await fs.rm(scratchDir, { recursive: true, force: true });
  await lock.close();
  await fs.rm(lockPath, { force: true });
}

console.log(`Journal PDF created: ${path.relative(root, outputPath)}`);
