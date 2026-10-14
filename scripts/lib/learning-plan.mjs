import { evaluatedMetrics, currentEvidenceNote, metricNameJa, confidenceNameJa, assessmentExample, supportNameJa } from './report-presentation.mjs';
/** Current planning and learner-facing views; never infer proficiency or mastery. */
import { tableRows, normalizeBankKey } from './markdown-table.mjs';

export const V4_FIRST_SESSION = 23;
export const SUPPORT_KINDS = ['conversation_prompt', 'structure_cue', 'lexical_cue', 'model_supplied', 'unknown'];
export const REUSE_KINDS = ['model_repetition', 'cued_use', 'independent_practice', 'delayed_independent_use', 'transfer_use'];
export const ASSESSMENT_STATUSES = ['observed', 'not_observed', 'insufficient_evidence', 'technical_incomplete'];

export function plainText(value) {
  return String(value ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]*>/g, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
}
export function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** Validate metadata only; source-backed human review is still required. */
export function validateLearningPlan(progress, ledger, turnsBySession = new Map()) {
  const errors = [];
  const plan = progress.learning_plan;
  if (!plan || plan.version !== '1.0') return ['missing current learning plan v1.0'];
  const ids = new Set(ledger.items.filter(item => !item.retired_reason).map(item => item.id));
  const sessions = new Map(progress.sessions.map(s => [s.session, s]));
  if (!validDate(plan.updated_on)) errors.push('learning plan: invalid update date');
  if (!Number.isInteger(plan.effective_from_session) || plan.effective_from_session < V4_FIRST_SESSION) errors.push('learning plan: unexpected policy boundary');
  if (!Array.isArray(plan.goals) || plan.goals.length < 1 || plan.goals.length > 2 || plan.goals.some(g => !g.id || !g.title || !g.success_look_for || !g.assistant_action)) errors.push('learning plan: one or two concrete goals required');
  if (new Set((plan.goals ?? []).map(g => g.id)).size !== (plan.goals ?? []).length) errors.push('learning plan: duplicate goal ID');
  if (!Array.isArray(plan.active_items) || plan.active_items.length < 5 || plan.active_items.length > 8) errors.push('learning plan: select 5–8 existing Bank IDs');
  const activeIds = new Set();
  for (const item of plan.active_items ?? []) {
    if (!ids.has(item.id) || activeIds.has(item.id)) errors.push(`learning plan: invalid/duplicate active ID ${item.id}`);
    activeIds.add(item.id);
    if (!item.recall_prompt?.trim() || !item.transfer_context?.trim()) errors.push(`learning plan: missing recall/context ${item.id}`);
  }
  if (!Array.isArray(plan.basis_sessions) || plan.basis_sessions.some(s => !sessions.has(s))) errors.push('learning plan: invalid basis sessions');
  if (plan.assessment_cadence?.mandatory !== false) errors.push('learning plan: probes must remain optional');
  if (!Array.isArray(plan.reuse_observations)) errors.push('learning plan: explicit reuse observations array required');
  for (const o of plan.reuse_observations ?? []) {
    const current = sessions.get(o.session), introduced = sessions.get(o.introduced_session);
    if (!ids.has(o.bank_item_id) || !current || !introduced || introduced.session > current.session) errors.push('reuse: invalid Bank/session references');
    if (!REUSE_KINDS.includes(o.kind) || !o.evidence_note?.trim()) errors.push('reuse: kind and actual evidence note required');
    if (!Array.isArray(o.turn_indices) || !o.turn_indices.length || o.turn_indices.some(t => !turnsBySession.get(o.session)?.has(t))) errors.push('reuse: real learner turn references required');
    if (!Array.isArray(o.support_kinds) || o.support_kinds.some(k => !SUPPORT_KINDS.includes(k))) errors.push('reuse: explicit support kinds required');
    if (['independent_practice', 'delayed_independent_use', 'transfer_use'].includes(o.kind) && o.support_kinds?.some(k => k !== 'conversation_prompt')) errors.push('reuse: independent use cannot have supplied language or unknown support');
    if (['delayed_independent_use', 'transfer_use'].includes(o.kind) && (!validDate(current?.date) || !validDate(introduced?.date) || current.date <= introduced.date)) errors.push('reuse: delayed use must occur on a later calendar day');
    if (o.kind === 'transfer_use' && !o.changed_context?.trim()) errors.push('reuse: transfer requires a changed context');
    if (o.mastered === true) errors.push('reuse: one observation cannot declare mastery');
  }
  return errors;
}

export function resolveActiveItems(journal, plan, ledger) {
  if (!plan) return [];
  const rowsByBank = Object.fromEntries(['expressions', 'vocabulary', 'speaking'].map(bank => [bank,
    new Map(tableRows(journal.sections[bank] ?? '').map(row => [normalizeBankKey(row[0]), row]))]));
  return plan.active_items.map(item => {
    const identity = ledger.items.find(i => i.id === item.id && !i.retired_reason);
    const row = identity && rowsByBank[identity.bank]?.get(identity.key);
    if (!row) throw new Error(`Active Bank item cannot be resolved: ${item.id}`);
    return { ...item, bank: identity.bank, expression: plainText(row[0]), detail: plainText(row[1]),
      source: plainText(row[2]), sourceAnchor: row[2].match(/#(session-[^)]+)/)?.[1] ?? null };
  });
}

export function buildLearningBrief(journal, progress, ledger) {
  const latest = [...journal.sessions].sort((a, b) => b.date.localeCompare(a.date) || b.session - a.session)[0];
  if (!latest) throw new Error('A learning brief requires a recorded session');
  const assessment = progress.sessions.find(s => s.session === latest.session);
  if (!assessment) throw new Error(`Missing assessment for Session ${latest.session}`);
  const plan = progress.learning_plan;
  const unfinished = Object.entries(assessment.metric_evidence ?? {})
    .filter(([, evidence]) => evidence.assessment_status === 'technical_incomplete').map(([metric]) => metric);
  const recordedAudio = assessment.pronunciation_evidence?.holistic_audio_review === true;
  return {
    session: latest.session, date: latest.date, title: latest.title,
    success: assessment.assessment_summary?.observed_success?.meaning_ja ?? '今回の成功は、保存済みの根拠からまだ特定されていません。',
    takeaway: journal.sections.review.match(/\*\*内容面の持ち帰り:\*\*\s*([^\r\n]+)/)?.[1] ?? latest.remember,
    change: assessment.recent_change_review?.compact_summary ?? assessment.recent_change_review?.summary ?? '最近の変化を公平に比べる根拠は未確認です。',
    items: resolveActiveItems(journal, plan, ledger),
    goal: plan?.goals?.[0]?.title ?? assessment.assessment_summary?.next_targets?.[0] ?? '次の会話で重点を一つ選びます。',
    assistantAction: plan?.goals?.[0]?.assistant_action ?? '本人の意図に応答し、話し終える余地を残す。',
    planDate: plan?.updated_on ?? null,
    planningNote: plan && latest.session < plan.effective_from_session
      ? `現在の計画（${plan.updated_on}設定 / Session ${plan.effective_from_session}から）。過去の成果・習得を追加したものではありません。`
      : '復習の提案と、今回の実際の成果は別に記録します。過去の成果・習得を追加したものではありません。',
    scope: unfinished.length ? `評価未完了: ${unfinished.join(' / ')}。完了済みとは扱いません。`
      : recordedAudio ? `保存済みSession ${latest.session}の評価を表示。音声の確認範囲は詳細資料に記載。`
      : `保存済みSession ${latest.session}の記録に基づく。今回の直接音声による総合発音評価はありません。`,
    unfinished,
  };
}

export function pdfChapterOrder(sessions) {
  const recent = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || b.session - a.session).slice(0, 3);
  if (!recent.length) throw new Error('No sessions available for PDF');
  const sessionChapter = s => ({label: `session-${s.id}`, title: `Session ${s.session} — ${s.title}`, session: s.session});
  return [
    {label: 'cover', title: 'Learning Brief'}, sessionChapter(recent[0]),
    {label: 'growth-summary', title: 'English Growth & Evaluation'},
    {label: 'session-index', title: 'Session Index'}, ...recent.slice(1).map(sessionChapter),
    {label: 'growth', title: 'Growth Evidence & Methods'},
    {label: 'expressions', title: 'Expression Bank'}, {label: 'vocabulary', title: 'Vocabulary Bank'},
    {label: 'speaking', title: 'Pronunciation & Speaking Bank'},
  ];
}

const printCss = `
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
body { margin:0; color:#1f2937; background:white; font-family:"Yu Gothic UI","Meiryo","Noto Sans CJK JP",sans-serif; font-size:10.5pt; line-height:1.55; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
h1 { color:#163a5f; font-size:23pt; line-height:1.25; margin:2mm 0 3mm; }
h2 { color:#163a5f; font-size:13pt; margin:4mm 0 1.5mm; break-after:avoid; }
p { margin:1.6mm 0; }
.kicker { font-weight:700; color:#1d5fa7; font-size:10.5pt; }
.panel { padding:3mm 4mm; margin:2mm 0; border-left:3px solid #0f766e; background:#f7f9fc; break-inside:avoid; }
.english { font-size:12pt; color:#163a5f; font-weight:700; }
.note { color:#4b5563; font-size:10.5pt; }
.warning { padding:3mm; border:1px solid #b45309; }
.journal-contents { padding:2mm 3mm; margin:2mm 0 3mm; border:1px solid #cbd5e1; background:#f7f9fc; break-inside:avoid; }
.journal-contents > div { display:grid; grid-template-columns:1fr 1fr; gap:1mm 4mm; margin-top:1mm; }
.journal-contents a { color:#1d5fa7; text-decoration:underline; }
.assessment-table { table-layout:fixed; }
.assessment-table th:nth-child(1) { width:22%; }
.assessment-table th:nth-child(2) { width:17%; }
.assessment-table th:nth-child(3) { width:49%; }
.assessment-table th:nth-child(4) { width:12%; }
.evidence-reference { color:#4b5563; font-size:8.5pt; }
table { border-collapse:collapse; width:100%; font-size:10.5pt; }
th { background:#163a5f; color:white; text-align:left; }
th,td { padding:2mm; border:1px solid #cbd5e1; vertical-align:top; }
tr { break-inside:avoid; } thead { display:table-header-group; }
`;
function documentHtml(title, body) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${printCss}</style></head><body>${body}</body></html>`;
}
export function learningBriefHtml(brief, contents = []) {
  const items = brief.items.slice(0, 1);
  return documentHtml('Learning Brief', `
<div class="kicker">YUKI × ASTRA · LEARNING BRIEF</div>
<h1>次の会話へ持ち帰る一枚</h1>
<p class="note">Session ${brief.session} · ${escapeHtml(brief.date)} · ${escapeHtml(brief.title)}</p>
${contents.length ? `<nav class="journal-contents" aria-label="目次"><strong>目次 · クリックして移動</strong><div>${contents.map(item => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a>`).join('')}</div></nav>` : ''}
<h2>今回の収穫</h2><p>${escapeHtml(brief.success)}</p>
<h2>内容面の持ち帰り</h2><p>${escapeHtml(brief.takeaway)}</p>
<h2>次に使う表現</h2>
${items.map(item => `<div class="panel"><p class="english" lang="en">${escapeHtml(item.expression)}</p><p>${escapeHtml(item.transfer_context)}</p></div>`).join('')}
<p class="note">Bankの学習用表現。完成文の独立使用・習得の実績とは区別します。</p>
<h2>5分復習 · 例文を隠して一つだけ</h2>
${items.map((item, i) => `<p>${i + 1}. ${escapeHtml(item.recall_prompt)}</p>`).join('')}
<p class="note">自分の場面で一文にできたら、ここで終えて大丈夫です。別の候補はStudy Bankへ。</p>
<h2>次回の重点</h2><p><strong>${escapeHtml(brief.goal)}</strong></p><p>Astra: ${escapeHtml(brief.assistantAction)}</p>
<p class="note">${escapeHtml(brief.planningNote)}</p>
<p class="note">評価範囲: 保存済みSession ${brief.session}の発話と文脈から確認できた結果を掲載。</p>
`);
}

export function growthSummaryHtml(progress, brief) {
  const latest = progress.sessions.find(s => s.session === brief.session);
  const previous = [...progress.sessions].filter(s => s.session < latest.session).sort((a,b) => b.session-a.session)[0];
  const label = (s, metric) => Number.isInteger(s?.ratings?.[metric]) ? `L${s.ratings[metric]} / ${{emerging:'形成中',established:'安定',strong:'強い'}[s.within_level_stage?.[metric]] ?? '段階未記録'}` : 'N/A';
  const decisions = { observed_gain:'この行動で前進',stable:'同程度を再確認',mixed:'混在',observed_loss:'この行動で後退',unconfirmed:'変化は未確認' };
  const allChanges = latest.recent_change_review?.observations ?? [];
  const currentMetrics=evaluatedMetrics(latest,progress.qualitative_metrics,progress.assessment_policy);
  // Select by the declared learning priorities, never by positive/negative result.
  const priorities = ['Task achievement', 'Lexical resource', 'Grammar control', 'Fluency & coherence', 'Interaction & repair', 'Pronunciation'];
  const changes = allChanges.filter(o=>currentMetrics.includes(o.metric)).sort((a,b) => priorities.indexOf(a.metric)-priorities.indexOf(b.metric)).slice(0,2);
  const rubric = Object.values(latest.metric_evidence ?? {}).map(e=>e.provenance?.rubric_version).find(Boolean) ?? '旧記録';
  return documentHtml('English Growth & Evaluation', `
<div class="kicker">${currentMetrics.length ? 'CURRENT ABILITY · SUCCESS · RECENT CHANGE' : 'SESSION REFLECTION'}</div><h1>${currentMetrics.length ? '現在地と、次の一歩' : '今回の振り返りと、次の一歩'}</h1>
<p>保存済み Session ${latest.session} · ${escapeHtml(latest.date)} · ${escapeHtml(rubric)}</p>
${currentMetrics.length ? `<table class="assessment-table"><thead><tr><th>観点</th><th>今回</th><th>確認した行動・根拠</th><th>確度</th></tr></thead><tbody>
${evaluatedMetrics(latest, progress.qualitative_metrics, progress.assessment_policy).map(metric=>{const example=assessmentExample(latest,metric,progress.assessment_policy);return `<tr><td><strong>${escapeHtml(metricNameJa[metric] ?? metric)}</strong></td><td>${label(latest,metric)}</td><td>${escapeHtml(example.text)}<br><span class="evidence-reference">実発話 turn ${example.turns.join('・')} · ${escapeHtml(supportNameJa(latest,metric))}</span></td><td>${escapeHtml(example.confidence)}</td></tr>`;}).join('')}
</tbody></table>` : ''}
<p class="note">今回評価した観点だけを表示。Lは個人学習用。旧基準の観察値を新基準で再採点していません。</p>
<p class="note">${escapeHtml(currentEvidenceNote(latest,progress.qualitative_metrics,progress.assessment_policy))}</p>
${changes.length ? '<h2>以前 → 今回 → 判断</h2>' : ''}
${changes.map(o=>`<div class="panel"><p><strong>${escapeHtml(o.behavior)}</strong> · ${escapeHtml(decisions[o.decision] ?? '未確認')}（確度 ${confidenceNameJa(o.confidence)}）</p><p>以前${o.earlier ? ` S${o.earlier.session} · ${progress.sessions.find(s=>s.session===o.earlier.session)?.date ?? ''}: ${escapeHtml(o.earlier.observation)}` : ': 比較できる例なし'}</p><p>今回 S${o.current.session} · ${escapeHtml(latest.date)}: ${escapeHtml(o.current.observation)}</p></div>`).join('')}
<p class="note">比較は記録にある本人の行動に限定。題材・支援・基準が異なり、点数差を改善率にはしません。提示文の使用と後日の自力再利用は別に扱います。</p>
<p class="note">重点の説明・再利用に沿って最大2件を表示。全比較の条件と確度は詳細記録へ。</p>
<h2>次に確認すること</h2><p>${escapeHtml(brief.goal)}</p><p class="note">詳しい条件・確度・推移・資格目安は「Growth Evidence & Methods」へ。</p>
`);
}
