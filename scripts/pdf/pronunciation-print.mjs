import { limitedPronunciationAssessment, currentEvidenceNote } from '../lib/report-presentation.mjs';

const escapeHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const comparisonMethods=[['asr_word_match_proxy','ASR一致'],['negative_greedy_phone_error','greedy音素'],['ctc_gop_sa_mean','CTC GOP-SA'],['gopt_mean_phone_prediction','GOPT']];

/** Compact print history; the Site and current-evaluation chapter retain full findings. */
export function compactPronunciationHistoryHtml(progress, validation) {
  const rows=(progress.sessions??[]).map(session=>({session,assessment:limitedPronunciationAssessment(session,progress.assessment_policy)}))
    .filter(item=>item.assessment).sort((a,b)=>b.session.session-a.session.session);
  if(!rows.length) return '';
  const benchmark=validation?.selection_evidence?.human_benchmark;
  const correlations=benchmark?.utterance_level_pearson_r;
  const comparison=Number.isInteger(benchmark?.recordings)&&comparisonMethods.every(([key])=>Number.isFinite(correlations?.[key]))
    ? `方式選定: SpeechOcean762の公開${benchmark.recordings}録音で、録音ごとの平均人手音素評価との相関rは${comparisonMethods.map(([key,label])=>`${label} ${correlations[key].toFixed(3)}`).join('、')}。探索的な小規模比較で、GOPT開発・評価内の資料です。成人の日本語母語話者への独立検証はありません。` : '';
  const dates=[...new Set(rows.map(item=>item.assessment.reviewed_on))].map(escapeHtml).join('・');
  return `<section class="local-pronunciation-print-history"><h3>保存録音の音素評価</h3>
<table class="local-pronunciation-print-table"><colgroup><col style="width:23%"><col style="width:27%"><col style="width:50%"></colgroup><thead><tr><th>Session</th><th>全録音の処理範囲</th><th>音素適合が安定した例</th></tr></thead><tbody>${rows.map(({session,assessment})=>{
    const duration=assessment.evidence_refs.reduce((sum,ref)=>sum+ref.duration_seconds,0);
    const examples=(assessment.selected_findings??[]).map(item=>item.word).filter(value=>typeof value==='string'&&value.trim());
    const detail=examples.length?examples.map(escapeHtml).join(' / '):'具体例は各回の詳細を参照';
    return `<tr data-print-audio-review-session="${session.session}"><th scope="row">S${session.session}${assessment.capture_purpose==='practice'?'（練習）':''}</th><td>${duration.toFixed(1)}秒${assessment.evidence_refs.length>1?`（${assessment.evidence_refs.length}本）`:''}</td><td>${detail}</td></tr>`;
  }).join('')}</tbody></table>
<p class="growth-caveat local-pronunciation-print-note">${dates}再評価。GOPT主方式・CTC GOP-SA補助によるモデル上の音素適合。${escapeHtml(comparison)} 録音はPC内で処理し、外部音声APIへの送信や総合Lへの換算は行いません。課題が異なる回の点差を能力変化にはしません。</p></section>`;
}

/** Share the first Methods page with history; current profiles remain in the prior chapter. */
export function compactGrowthAudioHtml(html, progress, validation) {
  const compact=compactPronunciationHistoryHtml(progress,validation);
  let output=html.replace(/<section class="local-pronunciation-assessment">[\s\S]*?<\/section>/g,'')
    .replace(/<section class="local-pronunciation-history">[\s\S]*?<\/section>/g,'');
  if(compact) {
    output=output.replace(/<div class="profile-grid">[\s\S]*?<\/div>(?=\s*<p class="growth-caveat")/g,'')
      .replace(/<article class="before-now">[\s\S]*?<\/article>/g,'');
    const latest=[...progress.sessions].sort((a,b)=>b.session-a.session)[0];
    const currentNote=escapeHtml(currentEvidenceNote(latest,progress.qualitative_metrics,progress.assessment_policy));
    if(currentNote) output=output.replace(`<p class="growth-caveat">${currentNote}</p>`,'');
    const graph=/<figure class="figure-frame growth-trend">/;
    if(!graph.test(output)) throw new Error('Growth history graph is missing; cannot place the compact audio history.');
    output=output.replace(graph,`${compact}<figure class="figure-frame growth-trend">`);
  }
  return output;
}
