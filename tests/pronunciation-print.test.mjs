import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, recordsRoot } from '../scripts/lib/project.mjs';
import { limitedPronunciationAssessment } from '../scripts/lib/report-presentation.mjs';
import { compactPronunciationHistoryHtml, compactGrowthAudioHtml } from '../scripts/pdf/pronunciation-print.mjs';

const progress=JSON.parse(await fs.readFile(path.join(recordsRoot,'progress.json'),'utf8'));
const source=progress.assessment_policy?.adopted_local_pronunciation_method?.validation_source;
const validation=source?JSON.parse(await fs.readFile(path.join(projectRoot,source),'utf8')):null;
const assessed=progress.sessions.filter(session=>limitedPronunciationAssessment(session,progress.assessment_policy));

test('print history preserves every completed recording range and concrete example in short rows',()=>{
  const before=JSON.stringify(progress),html=compactPronunciationHistoryHtml(progress,validation);
  assert.equal((html.match(/data-print-audio-review-session=/g)??[]).length,assessed.length);
  for(const session of assessed) {
    const review=session.pronunciation_assessment;
    const row=html.match(new RegExp(`<tr data-print-audio-review-session="${session.session}">([\\s\\S]*?)</tr>`))?.[1];
    assert.ok(row);assert.ok(row.includes(review.evidence_refs.reduce((sum,ref)=>sum+ref.duration_seconds,0).toFixed(1)+'秒'));
    for(const finding of review.selected_findings??[]) assert.ok(row.includes(finding.word));
    assert.ok(!row.includes(review.summary_ja));
    if(review.capture_purpose==='practice') assert.ok(row.includes('練習'));
  }
  if(assessed.length) {
    assert.match(html,/モデル上の音素適合/);assert.match(html,/成人の日本語母語話者への独立検証はありません/);
    assert.match(html,/外部音声APIへの送信や総合Lへの換算は行いません/);
  }
  assert.equal(JSON.stringify(progress),before);
});

test('print history replaces duplicate current profiles while preserving history graphs and estimates',()=>{
  const html='<section class="growth-page growth-page--now"><div class="profile-grid"><div>DUPLICATE CURRENT PROFILE</div></div><p class="growth-caveat">Current scope</p><section class="local-pronunciation-assessment">CURRENT DETAILS</section><section class="local-pronunciation-history">SCREEN HISTORY</section><article class="before-now">DUPLICATE RECENT CHANGE</article><figure class="figure-frame growth-trend">ALL HISTORY GRAPH</figure></section><section class="growth-page growth-page--next"><h3>ESTIMATED EXTERNAL-TEST RANGES</h3><table>EXISTING ESTIMATES</table></section>';
  const printed=compactGrowthAudioHtml(html,progress,validation);
  assert.ok(!printed.includes('CURRENT DETAILS'));assert.ok(!printed.includes('SCREEN HISTORY'));
  assert.ok(printed.includes('ALL HISTORY GRAPH'));assert.ok(printed.includes('EXISTING ESTIMATES'));
  if(assessed.length) {
    assert.ok(!printed.includes('DUPLICATE CURRENT PROFILE'));assert.ok(!printed.includes('DUPLICATE RECENT CHANGE'));
    assert.ok(printed.indexOf('local-pronunciation-print-history')<printed.indexOf('ALL HISTORY GRAPH'));
    assert.throws(()=>compactGrowthAudioHtml('<p>No history graph</p>',progress,validation),/Growth history graph is missing/);
  }
});

test('compact print examples escape source text without exposing raw audio evidence',()=>{
  if(!assessed.length) return;
  const p=structuredClone(progress),session=p.sessions.find(item=>item.session===assessed[0].session);
  session.pronunciation_assessment.selected_findings=[{word:'<script>unsafe</script>'}];
  const html=compactPronunciationHistoryHtml(p,validation);
  assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.ok(!html.includes('<script>'));
  for(const s of assessed) for(const ref of s.pronunciation_assessment.evidence_refs) {
    assert.ok(!html.includes(ref.sha256));assert.ok(!html.includes(ref.id));
  }
});
