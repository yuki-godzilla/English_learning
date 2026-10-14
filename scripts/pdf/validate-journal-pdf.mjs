import { pdfChapterOrder } from '../lib/learning-plan.mjs';
import { pdfContents, PDF_CHAPTER_LINK_PREFIX, evaluatedMetrics, limitedPronunciationAssessment } from '../lib/report-presentation.mjs';
/** Postflight validation for the integrated Current Learning Journal PDF. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from 'node:fs/promises';
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
links = []
page_ids = {page.indirect_reference.idnum: index for index, page in enumerate(reader.pages)}
for page_index, page in enumerate(reader.pages):
    page_sizes.append([float(page.mediabox.width), float(page.mediabox.height)])
    texts.append(page.extract_text() or "")
    annotations = page.get("/Annots") or []
    for annotation_ref in annotations:
        annotation = annotation_ref.get_object()
        if str(annotation.get("/Subtype", "")) == "/Widget":
            widgets += 1
        action = annotation.get("/A")
        dest = annotation.get("/Dest")
        if dest is None and action and str(action.get_object().get("/S", "")) == "/GoTo":
            dest = action.get_object().get("/D")
        if dest is not None:
            target = page_ids.get(getattr(dest[0], "idnum", None), -1) if isinstance(dest, list) else -1
            links.append({"page":page_index,"target":target})
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
    "links": links,
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
const progress=JSON.parse(await fs.readFile(path.join(root,'learning-records/progress.json'),'utf8'));
const failures = [];
const fail = (message) => failures.push(message);

if (inventory.pages < 10) fail(`Journal PDF has only ${inventory.pages} pages`);
for (const [index, [width, height]] of inventory.page_sizes.entries()) {
  if (Math.abs(width - 595.28) > 3 || Math.abs(height - 841.89) > 3) fail(`Page ${index + 1} is not A4 (${width.toFixed(1)} × ${height.toFixed(1)} pt)`);
}

const expectedOutlines = pdfChapterOrder(sessions).map(chapter => chapter.title);
if (JSON.stringify(inventory.outlines) !== JSON.stringify(expectedOutlines)) fail('PDF chapters are not in learning-first order');
const chapters=pdfChapterOrder(sessions);
const expectedContents=pdfContents(latest[0].id).map(item=>inventory.outline_pages[chapters.find(c=>c.label===item.label)?.title]);
const firstPageTargets=inventory.links.filter(l=>l.page===0&&l.target!==0).map(l=>l.target);
if (JSON.stringify(firstPageTargets.sort((a,b)=>a-b)) !== JSON.stringify(expectedContents.sort((a,b)=>a-b))) fail('First-page contents do not link to all expected chapter pages');
for (const item of pdfContents(latest[0].id)) {
  const number=inventory.outline_pages[chapters.find(c=>c.label===item.label)?.title]+1;
  if (!normalized(inventory.page_texts[0]).includes(normalized(`${item.title} p.${number}`))) fail(`Printed contents page number is missing/wrong: ${item.title}`);
}
for (const link of inventory.links) if (link.target < 0 || link.target >= inventory.pages) fail(`Broken internal PDF link from page ${link.page+1}`);
for (let page=0;page<inventory.pages;page++) if (!inventory.links.some(l=>l.page===page&&l.target===0)) fail(`Page ${page+1} has no return-to-contents link`);
if (inventory.uris.some(uri=>uri.startsWith(PDF_CHAPTER_LINK_PREFIX))) fail('Export-only contents URLs were not converted to internal PDF links');
function chapterRange(title) {
  const start = inventory.outline_pages[title];
  if (!Number.isInteger(start) || start < 0) return null;
  const next = Object.values(inventory.outline_pages).filter(p => p > start);
  return [start, next.length ? Math.min(...next) : inventory.pages];
}
const briefRange = chapterRange('Learning Brief');
if (!briefRange || briefRange[1] - briefRange[0] !== 1) fail('Learning Brief must fit one readable page');
const summaryRange = chapterRange('English Growth & Evaluation');
if (!summaryRange || summaryRange[1] - summaryRange[0] > 2) fail('Current growth summary exceeds two pages');
if (summaryRange) {
  const summary=inventory.page_texts.slice(...summaryRange).join('\n');
  const current=progress.sessions.find(s=>s.session===latest[0].session);
  for (const metric of progress.qualitative_metrics.filter(m=>!evaluatedMetrics(current,progress.qualitative_metrics,progress.assessment_policy).includes(m))) {
    if (normalized(summary).includes(normalized(metric))) fail(`Current evaluation displays an unassessed metric: ${metric}`);
  }
  const audioReview=limitedPronunciationAssessment(current,progress.assessment_policy);
  if(audioReview) {
    for(const text of [audioReview.summary_ja,...audioReview.strengths_ja,...audioReview.review_points_ja,...audioReview.practice_chunks]) {
      if(!normalized(summary).includes(normalized(text))) fail('Current evaluation omits completed local audio findings or practice');
    }
    for(const text of ['音素の評価','モデル上の音素適合','確度','総合Lはこの評価の対象外']) {
      if(!normalized(summary).includes(normalized(text))) fail(`Current evaluation omits the bounded audio scope: ${text}`);
    }
  }
}
for (const label of ['今回の収穫', '内容面の持ち帰り', '次に使う表現', '5分復習', '次回の重点', '評価範囲']) {
  if (!normalized(inventory.page_texts[0]).includes(normalized(label))) fail(`Learning Brief role missing: ${label}`);
}

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
for (const requiredText of ["WHERE I AM NOW", "HOW MY SPEAKING IS CHANGING", "WHAT TO WORK ON NEXT", "RAW EVIDENCE COVERAGE", "SESSION-BY-SESSION FINGERPRINT", "ESTIMATED EXTERNAL-TEST RANGES"]) {
  if (!normalizedText.includes(normalized(requiredText))) fail(`Static Growth content is missing: ${requiredText}`);
}
const growthStart = inventory.outline_pages['Growth Evidence & Methods'];
const expressionStart = inventory.outline_pages['Expression Bank'];
if (growthStart < 0 || expressionStart <= growthStart) fail("Growth-to-Bank page boundary could not be identified");
else {
  const growthPages = expressionStart - growthStart;
  if (growthPages > 4) fail(`Growth section uses ${growthPages} pages; maximum target is 4 without shrinking body text`);
  const methods=normalized(inventory.page_texts.slice(growthStart,expressionStart).join('\n'));
  const audioReviews=progress.sessions.filter(session=>limitedPronunciationAssessment(session,progress.assessment_policy));
  if(audioReviews.length && !methods.includes(normalized('保存録音の音素評価'))) fail('Methods omits the saved-recording audio review history');
  if(audioReviews.length) {
    const validationSource=progress.assessment_policy.adopted_local_pronunciation_method.validation_source;
    const validation=JSON.parse(await fs.readFile(path.join(root,validationSource),'utf8'));
    const benchmark=validation.selection_evidence.human_benchmark;
    for(const text of [`公開${benchmark.recordings}録音`,'録音ごとの平均人手音素評価','探索的な小規模比較','GOPT開発・評価内','成人の日本語母語話者への独立検証はありません','外部音声APIへの送信や総合Lへの換算は行いません']) {
      if(!methods.includes(normalized(text))) fail(`Methods omits the local-method validation scope: ${text}`);
    }
    for(const key of ['asr_word_match_proxy','negative_greedy_phone_error','ctc_gop_sa_mean','gopt_mean_phone_prediction']) {
      if(!methods.includes(normalized(benchmark.utterance_level_pearson_r[key].toFixed(3)))) fail(`Methods omits the method-comparison result: ${key}`);
    }
  }
  for(const session of audioReviews) {
    const review=session.pronunciation_assessment;
    const duration=review.evidence_refs.reduce((sum,ref)=>sum+ref.duration_seconds,0);
    const expectedRow=[`S${session.session}`,review.capture_purpose==='practice'?'練習':'',`${duration.toFixed(1)}秒`,
      review.evidence_refs.length>1?`${review.evidence_refs.length}本`:'',...(review.selected_findings??[]).map(item=>item.word)].join(' ');
    if(!methods.includes(normalized(expectedRow))) {
      fail(`Methods omits the completed local audio review for Session ${session.session}`);
    }
  }
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
