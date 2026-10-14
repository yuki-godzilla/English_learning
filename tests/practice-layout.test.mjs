import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, recordsRoot } from '../scripts/lib/project.mjs';
import { limitedPronunciationAssessment, limitedPronunciationHtml } from '../scripts/lib/report-presentation.mjs';
import { loadJournal } from '../scripts/lib/journal-parser.mjs';

// Generate the real learner-facing Markdown once. This writes derived views only.
const { practiceQueueMarkup, activeCatalogueMarkup, levelHistoryMarkup } = await import('../scripts/site/build.mjs');
const progress = JSON.parse(await fs.readFile(path.join(recordsRoot, 'progress.json'), 'utf8'));
const generated = file => fs.readFile(path.join(projectRoot, '.generated-site-docs', file), 'utf8');
const home = await generated('index.md');
const review = await generated('review/index.md');
const growth = await generated('progress/index.md');
const journal = await loadJournal();
const fixtureItems = count => Array.from({ length: count }, (_, i) => ({
  id: `expressions-${(i + 1).toString(16).padStart(16, '0')}`,
  bank: 'expressions', expression: `Example ${i + 1}`, detail: 'Synthetic reference, not a learning event.',
  recall_prompt: `自分の場面を説明する ${i + 1}`, transfer_context: 'A different ordinary situation',
  source: 'Session 1', sourceAnchor: 'session-2026-08-08-01',
}));
const recallTags = html => [...html.matchAll(/<details\b[^>]*\bdata-recall-id="([^"]+)"[^>]*>/g)];

test('home and review begin with one active practice pool before explanations and storage', () => {
  for (const page of [home, review]) {
    assert.equal((page.match(/data-practice-primary/g) ?? []).length, 1);
    assert.match(page, /data-recall-limit="1"/);
    const cards = recallTags(page);
    assert.deepEqual(cards.map(card => card[1]), progress.learning_plan.active_items.map(item => item.id));
    assert.equal(cards.filter(card => !/\bhidden\b/.test(card[0])).length, 1);
    assert.ok(page.indexOf('data-practice-primary') < page.indexOf('active-learning-plan'));
  }
  assert.ok(home.indexOf('data-practice-primary') < home.indexOf('## Continue Learning'));
  assert.ok(review.indexOf('data-practice-primary') < review.indexOf('recall-tools'));
  assert.match(review, /ここで終えて大丈夫/);
  assert.match(review, /過去の成果・習得を追加したものではありません/);
});

test('storage warning is beside primary practice and recovery starts hidden on both pages', () => {
  for (const page of [home, review]) {
    assert.equal((page.match(/data-recall-message/g) ?? []).length, 1);
    const status = page.match(/<p\b[^>]*data-recall-message[^>]*>/)?.[0];
    assert.match(status, /aria-live="polite"/);
    assert.ok(!/\bhidden\b/.test(status));
    assert.ok(page.indexOf('data-recall-message') < page.indexOf('active-learning-plan'));
    assert.match(page, /<div class="practice-recovery" data-recall-recovery hidden><button[^>]*data-recall-export/);
  }
});
test('current growth pairs grades with concrete evidence and distinguishes coverage from ability change',()=>{
  assert.equal((growth.match(/class="profile-evidence"/g) ?? []).length,3);
  assert.match(growth,/実発話 turn 174・177・181 · 確度 中/);
  assert.match(growth,/2026-10-14 · 回収済み発話/);
  assert.match(growth,/過去の6観点との数の違いや欠測は能力低下を示しません/);
  assert.match(growth,/残りの平均を総合点として計算し直していません/);
  const deltas=[...growth.matchAll(/class="comparison-change">([^<]*)</g)].map(m=>m[1]);
  assert.ok(deltas.length>0);assert.ok(deltas.every(text=>!/%|↓|↑/.test(text)));
  assert.match(growth,/推定履歴の最終更新は 2026-09-27（S17）/);
});

test('completed audio reviews reach their Daily Notes and the current overview without repeating canonical prose', async()=>{
  const reviews=progress.sessions.filter(session=>limitedPronunciationAssessment(session,progress.assessment_policy));
  const current=progress.sessions.find(session=>session.session===Math.max(...journal.sessions.map(item=>item.session)));
  assert.equal((growth.match(/data-audio-review-session=/g) ?? []).length,reviews.length);
  for(const session of reviews) {
    const definition=journal.sessions.find(item=>item.session===session.session);
    const page=await generated(`sessions/${definition.id}.md`);
    const canonical=definition.raw.includes('<!-- local-pronunciation-review: local-gopt-consensus-v1 -->');
    if(canonical) {
      assert.ok(!page.includes('class="local-pronunciation-assessment"'));
      assert.ok(page.includes(session.pronunciation_assessment.summary_ja));
    } else assert.ok(page.includes(limitedPronunciationHtml(session,progress.assessment_policy)));
    assert.ok(growth.includes(`data-audio-review-session="${session.session}"`));
  }
  if(limitedPronunciationAssessment(current,progress.assessment_policy)) {
    assert.ok(growth.includes(limitedPronunciationHtml(current,progress.assessment_policy)));
    assert.match(growth,/モデル上の音素適合/);
    assert.match(growth,/総合Lには換算しません/);
    assert.match(growth,/今回の総合発音Lは未判定。音素の限定評価は別欄に掲載/);
    assert.ok(!growth.includes('今回の発音: N/A'));
    assert.ok(growth.indexOf('class="local-pronunciation-assessment"')<growth.indexOf('HOW MY SPEAKING IS CHANGING'));
  } else assert.ok(!growth.includes('class="local-pronunciation-assessment"'));
  if(reviews.length) {
    const validation=JSON.parse(await fs.readFile(path.join(projectRoot,progress.assessment_policy.adopted_local_pronunciation_method.validation_source),'utf8'));
    const benchmark=validation.selection_evidence.human_benchmark;
    assert.match(growth,new RegExp(`公開${benchmark.recordings}録音`));
    for(const key of ['asr_word_match_proxy','negative_greedy_phone_error','ctc_gop_sa_mean','gopt_mean_phone_prediction']) {
      assert.ok(growth.includes(benchmark.utterance_level_pearson_r[key].toFixed(3)));
    }
    for(const phrase of ['録音ごとの平均人手音素評価','探索的な小規模比較','GOPT開発・評価内','成人の日本語母語話者への独立検証はありません','外部音声APIへの送信や総合Lへの換算は行いません']) {
      assert.ok(growth.includes(phrase));
    }
  }
});

test('every allowed active-set size is selectable without duplicate first-page options', () => {
  for (const count of [5, 6, 7, 8]) {
    const items = fixtureItems(count), queue = practiceQueueMarkup(items), catalogue = activeCatalogueMarkup(items);
    assert.equal(recallTags(queue).length, count);
    assert.equal(recallTags(queue).filter(card => !/\bhidden\b/.test(card[0])).length, 1);
    assert.deepEqual([...catalogue.matchAll(/data-active-bank-item="([^"]+)"/g)].map(match => match[1]), items.map(item => item.id));
    assert.ok(!catalogue.includes('data-recall-rating'));
    assert.ok(!catalogue.includes('data-recall-id'));
    assert.match(catalogue, new RegExp(`今使う${count}件`));
  }
});

test('retrieval prompts do not expose the model answer; the reference view escapes source text', () => {
  const items = fixtureItems(5);
  items[0].expression = '<script>model()</script>';
  const queue = practiceQueueMarkup(items);
  assert.equal(queue.match(/<summary>(.*?)<\/summary>/s)[1], items[0].recall_prompt);
  assert.ok(!queue.includes('<script>model()'));
  assert.match(queue, /&lt;script&gt;model\(\)&lt;\/script&gt;/);
  assert.match(activeCatalogueMarkup(items), /\.\.\/sessions\/2026-08-08-01\//);
  assert.ok(!/## [1-4]\. /.test(review));
});

test('text history preserves every recorded session, level, stage and N/A separately', () => {
  const metrics = ['Task achievement', 'Pronunciation'];
  const sessions = [
    { session: 1, date: '2026-08-08', ratings: { 'Task achievement': 3, Pronunciation: null }, within_level_stage: { 'Task achievement': 'emerging' } },
    { session: 2, date: '2026-08-15', ratings: { 'Task achievement': 3, Pronunciation: 3 }, within_level_stage: { 'Task achievement': 'established', Pronunciation: 'strong' } },
    { session: 3, date: '2026-08-16', ratings: { 'Task achievement': null, Pronunciation: null } },
  ];
  const before = JSON.stringify(sessions), html = levelHistoryMarkup(sessions, metrics);
  assert.equal((html.match(/data-history-session=/g) ?? []).length, sessions.length * metrics.length);
  assert.match(html, /形成中/); assert.match(html, /安定/); assert.match(html, /強い/);
  assert.match(html, /N\/A<\/td><td>未測定/);
  assert.equal(JSON.stringify(sessions), before);
  assert.ok(html.indexOf('data-history-session="3"') < html.indexOf('data-history-session="1"'));
  assert.equal((growth.match(/data-history-session=/g) ?? []).length, progress.sessions.length * progress.qualitative_metrics.length);
  assert.match(growth, /growth-history-screen/);
  assert.match(growth, /推移グラフを拡大して見る/);
});
