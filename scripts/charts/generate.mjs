/** Generate a graph-first, bilingual English growth dashboard for Docs and email. */

import { createRequire } from "node:module";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot as root, recordsRoot } from "../lib/project.mjs";
import { skillTimeline } from './skill-timeline.mjs';

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const data = JSON.parse(await readFile(path.join(recordsRoot, "progress.json"), "utf8"));
const outputPath = path.join(root, "output", "english-growth-evidence-dashboard.png");
const testEstimateOutputPath = path.join(root, "output", "english-test-score-estimate-trends.png");
const modelComparisonOutputPath = path.join(root, "output", "gpt-model-cost-capability-comparison.png");
const trackedAssetRoot = path.join(recordsRoot, "media", "progress");
const trackedGrowthPath = path.join(trackedAssetRoot, "english-growth-evidence-dashboard.png");
const trackedEstimatePath = path.join(trackedAssetRoot, "english-test-score-estimate-trends.png");
const trackedModelComparisonPath = path.join(recordsRoot, "media", "sessions", "2026-09-06-gpt-model-cost-capability-comparison.png");
const publishTrackedAssets = process.argv.includes("--publish-assets");

const width = 1400;
const left = 52;
const right = 1348;
const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const text = (x, y, value, attributes = "") => `<text x="${x}" y="${y}" ${attributes}>${escapeXml(value)}</text>`;

const sessions = data.sessions;
const metrics = data.qualitative_metrics;
const isRating = (value) => Number.isInteger(value) && value >= 1 && value <= 5;
const withinLevelStageOffsets = {
  emerging: -0.2,
  established: 0,
  strong: 0.2,
};
const isWithinLevelStage = (value) => Object.hasOwn(withinLevelStageOffsets, value);

if (!Array.isArray(sessions) || sessions.length < 1) {
  throw new Error("learning-records/progress.json must contain at least one session.");
}
if (!Array.isArray(metrics) || metrics.length === 0) {
  throw new Error("learning-records/progress.json must define qualitative_metrics.");
}
for (const [sessionIndex, session] of sessions.entries()) {
  if (!session || !Number.isInteger(session.session) || typeof session.date !== "string" || !session.ratings) {
    throw new Error(`Session at index ${sessionIndex} is missing required fields.`);
  }
  for (const metric of metrics) {
    const rating = session.ratings[metric];
    if (rating != null && !isRating(rating)) {
      throw new Error(`Session ${session.session} has an invalid ${metric} rating: ${rating}`);
    }
    const stage = session.within_level_stage?.[metric];
    if (isRating(rating) && !isWithinLevelStage(stage)) {
      throw new Error(`Session ${session.session} must define a within-level stage for ${metric}.`);
    }
    if (!isRating(rating) && stage != null) {
      throw new Error(`Session ${session.session} cannot define a within-level stage for unmeasured ${metric}.`);
    }
  }
}
for (let index = 1; index < sessions.length; index += 1) {
  if (sessions[index].session <= sessions[index - 1].session || sessions[index].date < sessions[index - 1].date) {
    throw new Error("Sessions must be ordered from oldest to newest with increasing session numbers.");
  }
}


const svg = skillTimeline(data);

await mkdir(path.dirname(outputPath), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(outputPath);
if (publishTrackedAssets) {
  await mkdir(trackedAssetRoot, { recursive: true });
  await copyFile(outputPath, trackedGrowthPath);
}
console.log(outputPath);

const estimateData = data.test_score_estimates;
if (!estimateData || !Array.isArray(estimateData.estimate_sessions) || estimateData.estimate_sessions.length === 0) {
  throw new Error("learning-records/progress.json must define test_score_estimates.estimate_sessions.");
}

const estimateDefinitions = estimateData.definitions ?? {};
const estimateSessions = estimateData.estimate_sessions;
const estimateMetricOrder = [
  "toeic_lr",
  "toeic_speaking",
  "toeic_writing",
  "ielts_speaking",
  "toefl_speaking",
  "cambridge_speaking",
  "cefr_oral",
  "actfl_speaking"
];
const confidenceJa = {
  high: "高",
  medium: "中",
  "medium-low": "中〜低",
  low: "低"
};
for (const [sessionIndex, session] of estimateSessions.entries()) {
  if (!Number.isInteger(session.session) || typeof session.date !== "string" || !session.estimates) {
    throw new Error(`Test-score estimate session at index ${sessionIndex} is missing required fields.`);
  }
  if (sessionIndex > 0) {
    const previous = estimateSessions[sessionIndex - 1];
    if (session.session <= previous.session || session.date < previous.date) {
      throw new Error("Test-score estimate sessions must be ordered from oldest to newest.");
    }
  }
}
const currentEstimateSession = estimateSessions.at(-1);
if (estimateData.as_of_session !== currentEstimateSession.session || estimateData.as_of_date !== currentEstimateSession.date) {
  throw new Error("test_score_estimates as_of_session/as_of_date must match the latest estimate session.");
}
const latestEstimateByMetric = new Map();
for (const metricId of estimateMetricOrder) {
  const definition = estimateDefinitions[metricId];
  if (!definition || !Number.isFinite(definition.scale_min) || !Number.isFinite(definition.scale_max) || definition.scale_max <= definition.scale_min) {
    throw new Error(`Invalid test score definition: ${metricId}`);
  }
  const latestEstimateSession = [...estimateSessions]
    .reverse()
    .find((session) => session.estimates?.[metricId]);
  const latestEstimate = latestEstimateSession?.estimates?.[metricId];
  if (!latestEstimate || !Number.isFinite(latestEstimate.low) || !Number.isFinite(latestEstimate.mid) || !Number.isFinite(latestEstimate.high)) {
    throw new Error(`Latest test score estimate is missing: ${metricId}`);
  }
  if (latestEstimate.low > latestEstimate.mid || latestEstimate.mid > latestEstimate.high) {
    throw new Error(`Test score estimate range is not ordered: ${metricId}`);
  }
  if (!currentEstimateSession.estimates?.[metricId] && !currentEstimateSession.not_updated?.[metricId]) {
    throw new Error(`Latest test-score session needs an estimate or not_updated reason: ${metricId}`);
  }
  latestEstimateByMetric.set(metricId, { session: latestEstimateSession, estimate: latestEstimate });
}

const estimateText = text;

// A cross-sectional forest plot is deliberately used instead of connected
// estimates: these are broad, intermittently reviewed ranges, not repeated
// administrations of the external tests.
const forestWidth = 1400;
const forestHeight = 820;
const forestRows = estimateMetricOrder.map((metricId, index) => {
  const definition = estimateDefinitions[metricId];
  const { session, estimate } = latestEstimateByMetric.get(metricId);
  const y = 175 + index * 76;
  const plotLeft = 490;
  const plotRight = 1075;
  const position = (value) => plotLeft + (value - definition.scale_min) / (definition.scale_max - definition.scale_min) * (plotRight - plotLeft);
  const lo = position(estimate.low);
  const mid = position(estimate.mid);
  const hi = position(estimate.high);
  const displayParts = estimate.display.replaceAll('Intermediate', 'Int.').replaceAll('Advanced', 'Adv.').split(/[（(]/);
  const mainDisplay = displayParts[0].trim();
  const secondDisplay = displayParts.slice(1).join(' ').replace(/[）)]/g, '').trim();
  return `<g>
    <rect x="42" y="${y - 32}" width="1316" height="68" rx="10" fill="${index % 2 ? "#ffffff" : "#f7f9fc"}"/>
    ${estimateText(60, y - 6, definition.label_ja, 'class="forest-label"')}
    ${estimateText(60, y + 22, `${definition.label_en} · last evidence S${session.session}`, 'class="forest-meta"')}
    <line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="#cbd5e1" stroke-width="3"/>
    <line x1="${lo}" y1="${y}" x2="${hi}" y2="${y}" stroke="#1d5fa7" stroke-width="12" stroke-linecap="round"/>
    <line x1="${lo}" y1="${y - 12}" x2="${lo}" y2="${y + 12}" stroke="#163a5f" stroke-width="3"/>
    <line x1="${hi}" y1="${y - 12}" x2="${hi}" y2="${y + 12}" stroke="#163a5f" stroke-width="3"/>
    <circle cx="${mid}" cy="${y}" r="9" fill="#ffffff" stroke="#163a5f" stroke-width="4"/>
    ${estimateText(1110, y - 9, mainDisplay, 'class="forest-value"')}
    ${secondDisplay ? estimateText(1110, y + 14, secondDisplay, 'class="forest-meta"') : ""}
    ${secondDisplay ? "" : estimateText(1110, y + 31, `確度 ${confidenceJa[estimate.confidence] ?? estimate.confidence}`, 'class="forest-meta"')}
  </g>`;
}).join("");
const historicalActual = (estimateData.historical_results ?? [])
  .map((result) => `${estimateDefinitions[result.test_id]?.label_ja ?? result.test_id} ${result.score}（${result.date_label_ja}・本人申告）`)
  .join(" / ");
const forestSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${forestWidth}" height="${forestHeight}" viewBox="0 0 ${forestWidth} ${forestHeight}">
  <style>text{font-family:"Yu Gothic",Meiryo,Arial,sans-serif;fill:#1f2937}.forest-title{font-size:42px;font-weight:700}.forest-sub{font-size:21px;fill:#475569}.forest-label{font-size:28px;font-weight:700}.forest-meta{font-size:20px;fill:#475569}.forest-value{font-size:24px;font-weight:700;fill:#163a5f}.forest-foot{font-size:17px;fill:#475569}</style>
  <rect width="${forestWidth}" height="${forestHeight}" fill="#ffffff"/>
  ${estimateText(48, 60, "資格スコア目安：最新の推定レンジ", 'class="forest-title"')}
  ${estimateText(48, 94, "Estimated external-test ranges · not official results", 'class="forest-sub"')}
  ${estimateText(48, 124, "各行は別の試験尺度。横位置を試験間で比較せず、数値と最終根拠Sessionを確認してください。", 'class="forest-sub"')}
  ${forestRows}
  ${estimateText(48, 790, `実績は推定と別物：${historicalActual || "記録なし"}。連続的な試験測定を示す線は使いません。`, 'class="forest-foot"')}
</svg>`;
await sharp(Buffer.from(forestSvg)).png().toFile(testEstimateOutputPath);
if (publishTrackedAssets) {
  await copyFile(testEstimateOutputPath, trackedEstimatePath);
}
console.log(testEstimateOutputPath);

// Snapshot of the official OpenAI model comparison used in Session 12.
// The horizontal placement expresses the vendor's stated model role, not an
// independently measured or cross-vendor intelligence score.
const modelComparison = [
  { name: "GPT-5.6 Luna", roleJa: "高頻度・コスト重視", roleEn: "Cost-sensitive / high volume", input: 0.2, output: 1.2, color: "#64748b" },
  { name: "GPT-5.6 Terra", roleJa: "知能とコストのバランス", roleEn: "Balance of intelligence and cost", input: 2, output: 12, color: "#0f766e" },
  { name: "GPT-5.6 Sol", roleJa: "複雑な業務向け", roleEn: "Complex professional work", input: 4, output: 20, color: "#1d4ed8" },
  { name: "GPT-6 Astra", roleJa: "最も難しいエンドツーエンド作業", roleEn: "Hardest end-to-end work", input: 10, output: 50, color: "#7c3aed" },
];
const modelChartWidth = 1400;
const modelChartHeight = 1000;
const modelPlotLeft = 180;
const modelPlotRight = 1310;
const modelPlotTop = 280;
const modelPlotBottom = 710;
const modelY = (value) => modelPlotBottom - value / 55 * (modelPlotBottom - modelPlotTop);
const modelX = (index) => modelPlotLeft + 95 + index * ((modelPlotRight - modelPlotLeft - 190) / (modelComparison.length - 1));
const modelComparisonText = (x, y, value, attributes = "") => `<text x="${x}" y="${y}" ${attributes}>${escapeXml(value)}</text>`;
const modelTicks = [0, 10, 20, 30, 40, 50].map((value) => `
  <line x1="${modelPlotLeft}" y1="${modelY(value)}" x2="${modelPlotRight}" y2="${modelY(value)}" stroke="#dbe4ee" stroke-width="2"/>
  ${modelComparisonText(modelPlotLeft - 18, modelY(value) + 6, `$${value}`, 'class="model-axis" text-anchor="end"')}`,
).join("");
const modelPoints = modelComparison.map((model, index) => {
  const x = modelX(index);
  const y = modelY(model.output);
  const radius = 16 + Math.sqrt(model.input) * 11;
  return `
    <line x1="${x}" y1="${modelPlotBottom}" x2="${x}" y2="${y}" stroke="${model.color}" stroke-width="4" opacity="0.38"/>
    <circle cx="${x}" cy="${y}" r="${radius}" fill="${model.color}" opacity="0.95"/>
    ${modelComparisonText(x, y + 6, `$${model.output}`, 'class="model-point-value" text-anchor="middle"')}
    ${modelComparisonText(x, modelPlotBottom + 48, model.name, 'class="model-name" text-anchor="middle"')}
    ${modelComparisonText(x, modelPlotBottom + 76, model.roleJa, 'class="model-role-ja" text-anchor="middle"')}
    ${modelComparisonText(x, modelPlotBottom + 101, model.roleEn, 'class="model-role-en" text-anchor="middle"')}
    ${modelComparisonText(x, modelPlotBottom + 143, `入力 $${model.input} / 出力 $${model.output}`, 'class="model-price" text-anchor="middle"')}`;
}).join("");
const modelComparisonSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${modelChartWidth}" height="${modelChartHeight}" viewBox="0 0 ${modelChartWidth} ${modelChartHeight}">
  <style>
    text { font-family: "Yu Gothic", Meiryo, Arial, Helvetica, sans-serif; fill: #172033; }
    .model-title { font-size: 45px; font-weight: 700; }
    .model-subtitle { font-size: 24px; fill: #475569; }
    .model-note { font-size: 18px; fill: #526274; }
    .model-axis { font-size: 17px; fill: #475569; }
    .model-axis-title { font-size: 20px; font-weight: 700; fill: #334155; }
    .model-point-value { font-size: 22px; font-weight: 700; fill: #ffffff; }
    .model-name { font-size: 24px; font-weight: 700; }
    .model-role-ja { font-size: 19px; font-weight: 700; fill: #334155; }
    .model-role-en { font-size: 16px; fill: #526274; }
    .model-price { font-size: 19px; font-weight: 700; fill: #1d4ed8; }
    .model-legend { font-size: 18px; fill: #475569; }
    .model-foot { font-size: 18px; fill: #475569; }
  </style>
  <rect width="${modelChartWidth}" height="${modelChartHeight}" fill="#ffffff"/>
  ${modelComparisonText(52, 62, "GPT-5.6 → GPT-6 Astra：価格と公式モデル位置", 'class="model-title"')}
  ${modelComparisonText(52, 98, "API Cost and Official Model Positioning", 'class="model-subtitle"')}
  ${modelComparisonText(52, 132, "2026年9月6日時点の標準API価格（USD / 100万トークン）。横方向の位置はOpenAIの公式役割であり、独立ベンチマークの知能スコアではありません。", 'class="model-note"')}
  <rect x="52" y="164" width="1296" height="68" rx="12" fill="#edf6ff"/>
  ${modelComparisonText(76, 193, "読み方", 'class="model-axis-title"')}
  ${modelComparisonText(148, 193, "縦軸 = 出力価格　｜　円の大きさ = 入力価格　｜　左から右 = 公式の用途・能力位置", 'class="model-legend"')}
  ${modelComparisonText(modelPlotLeft, modelPlotTop - 28, "出力価格 / USD per 1M output tokens", 'class="model-axis-title"')}
  ${modelTicks}
  <line x1="${modelPlotLeft}" y1="${modelPlotTop}" x2="${modelPlotLeft}" y2="${modelPlotBottom}" stroke="#94a3b8" stroke-width="2"/>
  <line x1="${modelPlotLeft}" y1="${modelPlotBottom}" x2="${modelPlotRight}" y2="${modelPlotBottom}" stroke="#94a3b8" stroke-width="2"/>
  ${modelPoints}
  ${modelComparisonText(52, 910, "共通仕様", 'class="model-axis-title"')}
  ${modelComparisonText(150, 910, "4モデルとも 1.05M context window / 128K max output。差は主に想定ワークロード、能力位置、価格にある。", 'class="model-foot"')}
  ${modelComparisonText(52, 950, "出典: OpenAI API Models。実際の選択は、必要な品質・速度・ツール利用・予算を小さな実タスクで確認して決める。", 'class="model-foot"')}
</svg>`;

await sharp(Buffer.from(modelComparisonSvg)).png().toFile(modelComparisonOutputPath);
if (publishTrackedAssets) {
  await mkdir(path.dirname(trackedModelComparisonPath), { recursive: true });
  await copyFile(modelComparisonOutputPath, trackedModelComparisonPath);
}
console.log(modelComparisonOutputPath);
