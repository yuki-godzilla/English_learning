/** Generate a graph-first, bilingual English growth dashboard for Docs and email. */

import { createRequire } from "node:module";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot as root, recordsRoot } from "../lib/project.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const data = JSON.parse(await readFile(path.join(recordsRoot, "progress.json"), "utf8"));
const outputPath = path.join(root, "output", "english-growth-evidence-dashboard.png");
const testEstimateOutputPath = path.join(root, "output", "english-test-score-estimate-trends.png");
const trackedAssetRoot = path.join(recordsRoot, "media", "progress");
const trackedGrowthPath = path.join(trackedAssetRoot, "english-growth-evidence-dashboard.png");
const trackedEstimatePath = path.join(trackedAssetRoot, "english-test-score-estimate-trends.png");
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

if (!Array.isArray(sessions) || sessions.length < 2) {
  throw new Error("learning-records/progress.json must contain at least two sessions.");
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
  }
}
for (let index = 1; index < sessions.length; index += 1) {
  if (sessions[index].session <= sessions[index - 1].session || sessions[index].date < sessions[index - 1].date) {
    throw new Error("Sessions must be ordered from oldest to newest with increasing session numbers.");
  }
}

// Keep every completed session visible.  The visual hierarchy is carried by
// marker treatment, not by dropping history from the evidence line.
const plottedSessions = sessions;
const currentSession = sessions.at(-1);
const previousSession = sessions.at(-2);
const currentMeasuredMetrics = metrics.filter((metric) => isRating(currentSession.ratings[metric]));
const plottedMetrics = metrics.filter((metric) =>
  sessions.some((session) => isRating(session.ratings[metric])),
);
const firstComparableMetrics = currentMeasuredMetrics.filter((metric) => isRating(sessions[0].ratings[metric]));
const previousComparableMetrics = currentMeasuredMetrics.filter((metric) => isRating(previousSession.ratings[metric]));
const countChange = (comparableMetrics, referenceSession, direction) => comparableMetrics.filter((metric) => {
  const delta = currentSession.ratings[metric] - referenceSession.ratings[metric];
  return direction === "up" ? delta > 0 : direction === "down" ? delta < 0 : delta === 0;
}).length;
const improvedFromFirst = countChange(firstComparableMetrics, sessions[0], "up");
const declinedFromFirst = countChange(firstComparableMetrics, sessions[0], "down");
const improvedFromPrevious = countChange(previousComparableMetrics, previousSession, "up");
const steadyFromPrevious = countChange(previousComparableMetrics, previousSession, "steady");
const declinedFromPrevious = countChange(previousComparableMetrics, previousSession, "down");

if (currentMeasuredMetrics.length === 0) {
  throw new Error("The latest session has no measured qualitative metrics to plot.");
}

const metricJa = {
  "Task achievement": "課題達成",
  "Fluency & coherence": "流暢さ・一貫性",
  "Lexical resource": "語彙運用",
  "Grammar control": "文法運用",
  "Interaction & repair": "対話・言い直し",
  "Pronunciation": "発音"
};
const currentGuide = {
  "Task achievement": ["理由・例まで自力で完結", "Independent completion"],
  "Fluency & coherence": ["詰まっても話を継続", "Keep going despite pauses"],
  "Lexical resource": ["確認・言い換えで伝達", "Clarify or paraphrase"],
  "Grammar control": ["誤りがあっても明確", "Meaning stays clear"],
  "Interaction & repair": ["自発的に確認・修復", "Clarify and self-repair"],
  "Pronunciation": ["音声根拠で明瞭さを確認", "Use direct audio evidence"]
};

const plotLeft = 330;
const plotRight = 970;
const scaleStep = (plotRight - plotLeft) / 4;
const xForLevel = (level) => plotLeft + (level - 1) * scaleStep;
const rowHeight = 91;
const legendColumns = 3;
const legendRows = Math.ceil(plottedSessions.length / legendColumns);
const legendStartY = 292;
const legendRowGap = 34;
const chartTop = 382 + legendRows * legendRowGap;
const footerStartY = chartTop + plottedMetrics.length * rowHeight - 12;
const height = Math.max(980, footerStartY + 85);
const marker = (sessionIndex, totalSessions, x, y) => {
  const isStart = sessionIndex === 0;
  const isCurrent = sessionIndex === totalSessions - 1;
  const isPrevious = sessionIndex === totalSessions - 2;
  if (isStart) return `<circle cx="${x}" cy="${y}" r="10" fill="#ffffff" stroke="#64748b" stroke-width="5"/>`;
  if (isCurrent) return `<path d="M ${x} ${y - 12} L ${x + 12} ${y} L ${x} ${y + 12} L ${x - 12} ${y} Z" fill="#16a34a"/>`;
  if (isPrevious) return `<rect x="${x - 9}" y="${y - 9}" width="18" height="18" rx="3" fill="#2563eb"/>`;
  return `<circle cx="${x}" cy="${y}" r="6" fill="#94a3b8" stroke="#ffffff" stroke-width="2"/>`;
};

const levelLabels = [
  [1, "強い支援", "Strong support"],
  [2, "支援あり", "Supported"],
  [3, "ほぼ自立", "Mostly independent"],
  [4, "自立", "Independent"],
  [5, "柔軟", "Flexible"]
];
const axis = levelLabels.map(([level, ja, en]) => {
  const x = xForLevel(level);
  return `
    <line x1="${x}" y1="${chartTop - 23}" x2="${x}" y2="${chartTop + rowHeight * plottedMetrics.length - 20}" stroke="#cbd5e1" stroke-width="2"/>
    ${text(x, chartTop - 86, `L${level}`, 'class="axis-level" text-anchor="middle"')}
    ${text(x, chartTop - 60, ja, 'class="axis-ja" text-anchor="middle"')}
    ${text(x, chartTop - 37, en, 'class="axis-en" text-anchor="middle"')}
  `;
}).join("");

const graphRows = plottedMetrics.map((metric, metricIndex) => {
  const centerY = chartTop + metricIndex * rowHeight + 26;
  const ratings = plottedSessions.map((session) => session.ratings[metric]);
  const rowFill = metricIndex % 2 ? "#ffffff" : "#f8fafc";
  const zone = `
      <rect x="${plotLeft - 30}" y="${centerY - 34}" width="${xForLevel(2.5) - plotLeft + 30}" height="68" fill="#fff3e4"/>
      <rect x="${xForLevel(2.5)}" y="${centerY - 34}" width="${xForLevel(3.5) - xForLevel(2.5)}" height="68" fill="#e8f1ff"/>
      <rect x="${xForLevel(3.5)}" y="${centerY - 34}" width="${plotRight - xForLevel(3.5) + 30}" height="68" fill="#e6f8ee"/>`;
  const common = `
    <rect x="${left}" y="${centerY - 40}" width="${right - left}" height="80" fill="${rowFill}"/>
    ${zone}
    ${text(left + 18, centerY - 2, metricJa[metric], 'class="metric-ja"')}
    ${text(left + 18, centerY + 24, metric, 'class="metric-en"')}
    <line x1="${plotLeft}" y1="${centerY}" x2="${plotRight}" y2="${centerY}" stroke="#b8c4d4" stroke-width="3"/>`;
  const spread = Math.min(22, Math.max(0, (ratings.length - 1) * 5));
  const offsetForIndex = (index) => ratings.length === 1
    ? 0
    : -spread + (index * (spread * 2 / (ratings.length - 1)));
  const points = ratings
    .map((rating, index) => isRating(rating)
      ? {x:xForLevel(rating), y:centerY + offsetForIndex(index), index, rating}
      : null)
    .filter(Boolean);
  const lineSegments = points.slice(1).map((point, index) => {
    const previousPoint = points[index];
    if (point.index !== previousPoint.index + 1) return "";
    return `<line x1="${previousPoint.x}" y1="${previousPoint.y}" x2="${point.x}" y2="${point.y}" stroke="#475569" stroke-width="4" stroke-linecap="round"/>`;
  }).join("");
  const current = currentSession.ratings[metric];
  const first = sessions[0].ratings[metric];
  const previous = previousSession.ratings[metric];
  const lastMeasured = [...plottedSessions]
    .reverse()
    .find((session) => isRating(session.ratings[metric]));
  const delta = isRating(current) && isRating(first) ? current - first : null;
  const recentDelta = isRating(current) && isRating(previous) ? current - previous : null;
  const recentLabel = !isRating(current)
    ? "今回 N/A"
    : recentDelta == null
      ? "前回比 N/A"
    : recentDelta > 0
      ? `↑ 前回比 +${recentDelta}`
      : recentDelta < 0
        ? `↓ 前回比 ${recentDelta}`
        : "→ 前回比 ±0";
  const recentClass = recentDelta == null || recentDelta === 0
    ? "change-steady"
    : recentDelta > 0
      ? "change-up"
      : "change-down";
  const firstLabel = delta == null ? "比較なし" : `初回比 ${delta > 0 ? "+" : ""}${delta}`;
  const guide = !isRating(current) && metric === "Pronunciation"
    ? "直接音声がある回だけ更新"
    : currentGuide[metric]?.[0] ?? "根拠に基づく現在評価";
  const currentLabel = isRating(current)
    ? `現在 L${current}`
    : lastMeasured
      ? `最終 S${lastMeasured.session} L${lastMeasured.ratings[metric]}`
      : "未測定";
  return `${common}
    ${lineSegments}
    ${points.map((point) => marker(point.index, plottedSessions.length, point.x, point.y)).join("")}
    ${text(1010, centerY - 6, currentLabel, 'class="current"')}
    ${text(1160, centerY - 6, recentLabel, `class="${recentClass}"`)}
    ${text(1010, centerY + 23, `${firstLabel}｜${guide}`, 'class="guide-ja"')}`;
}).join("");

const legend = plottedSessions.map((session, index) => {
  // Keep the complete history in a three-column grid and move the chart down
  // as rows are added, so Session 7+ cannot overlap earlier legend entries.
  const column = index % legendColumns;
  const row = Math.floor(index / legendColumns);
  const x = 570 + column * 235;
  const y = legendStartY + row * legendRowGap;
  const label = index === 0 ? "開始" : index === plottedSessions.length - 1 ? "今回" : index === plottedSessions.length - 2 ? "前回" : `履歴S${session.session}`;
  return `${marker(index, plottedSessions.length, x, y - 6)}${text(x + 16, y, `${label} 第${session.session}回 ${session.date.slice(5).replace("-", "/")}`, 'class="legend"')}`;
}).join("");

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text { font-family: "Yu Gothic", Meiryo, Arial, Helvetica, sans-serif; fill: #0f172a; }
    .title { font-size: 46px; font-weight: 700; }
    .subtitle { font-size: 23px; fill: #475569; }
    .note { font-size: 19px; fill: #64748b; }
    .summary-kicker { font-size: 18px; fill: #475569; font-weight: 700; }
    .summary { font-size: 25px; font-weight: 700; }
    .section { font-size: 31px; font-weight: 700; }
    .legend { font-size: 15px; fill: #334155; }
    .axis-level { font-size: 23px; font-weight: 700; }
    .axis-ja { font-size: 19px; font-weight: 700; fill: #334155; }
    .axis-en { font-size: 15px; fill: #64748b; }
    .metric-ja { font-size: 27px; font-weight: 700; }
    .metric-en { font-size: 17px; fill: #64748b; }
    .current { font-size: 21px; font-weight: 700; }
    .change-up { font-size: 17px; font-weight: 700; fill: #15803d; }
    .change-steady { font-size: 17px; font-weight: 700; fill: #475569; }
    .change-down { font-size: 17px; font-weight: 700; fill: #b45309; }
    .guide-ja { font-size: 17px; font-weight: 700; fill: #334155; }
    .foot { font-size: 18px; fill: #475569; }
  </style>
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  ${text(left, 58, "英語力の成長推移", 'class="title"')}
  ${text(left, 91, "English Growth Progress", 'class="subtitle"')}
  ${text(left, 120, "観察記録による学習用評価。英語資格・試験の公式スコアではありません。", 'class="note"')}

  <rect x="${left}" y="145" width="${right - left}" height="62" rx="12" fill="#eaf6ff"/>
  ${text(left + 20, 172, "観察ベースライン / OBSERVED BASELINE", 'class="summary-kicker"')}
  ${text(left + 20, 197, `第1回→第${currentSession.session}回: ${firstComparableMetrics.length}項目中 ${improvedFromFirst}向上・${declinedFromFirst}低下　｜　直近: ${improvedFromPrevious}向上・${steadyFromPrevious}維持・${declinedFromPrevious}低下`, 'class="summary"')}

  ${text(left, 264, "技能別の推移 / Skill progression", 'class="section"')}
  ${legend}
  ${axis}
  ${text(1010, chartTop - 38, "現在地 / Current", 'class="summary-kicker"')}
  ${graphRows}
  ${text(left, footerStartY, "L1 強い支援　｜　L2 支援あり　｜　L3 ほぼ自立　｜　L4 自立　｜　L5 柔軟", 'class="foot"')}
  ${text(left, footerStartY + 32, (() => {
    const latestPronunciation = [...sessions].reverse().find((session) => isRating(session.ratings.Pronunciation));
    return isRating(currentSession.ratings.Pronunciation)
      ? `発音: L${currentSession.ratings.Pronunciation}（直接音声の根拠あり）　※資格・試験の公式スコアではありません。`
      : latestPronunciation
        ? `発音: 今回N/A／最終 S${latestPronunciation.session} L${latestPronunciation.ratings.Pronunciation}（直接音声）　※公式スコアではありません。`
        : "発音: N/A（信頼できる音声を未計測）　※資格・試験の公式スコアではありません。";
  })(), 'class="foot"')}
</svg>`;

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

const estimateWidth = 1400;
const estimatePanelWidth = 632;
const estimatePanelHeight = 286;
const estimateLeft = 52;
const estimateColumnGap = 32;
const estimateTop = 204;
const estimateHeight = estimateTop + Math.ceil(estimateMetricOrder.length / 2) * estimatePanelHeight + 76;
const estimateText = (x, y, value, attributes = "") => `<text x="${x}" y="${y}" ${attributes}>${escapeXml(value)}</text>`;
const ordinalEdgeLabel = (definition, edge) => {
  const labels = definition.ordinal_labels;
  if (!Array.isArray(labels) || labels.length === 0) return String(edge === "min" ? definition.scale_min : definition.scale_max);
  return edge === "min" ? labels[0] : labels.at(-1);
};
const shortDate = (date) => String(date).slice(5).replace("-", "/");

const estimatePanels = estimateMetricOrder.map((metricId, metricIndex) => {
  const definition = estimateDefinitions[metricId];
  const { session: latestMetricSession, estimate: latest } = latestEstimateByMetric.get(metricId);
  const column = metricIndex % 2;
  const row = Math.floor(metricIndex / 2);
  const panelX = estimateLeft + column * (estimatePanelWidth + estimateColumnGap);
  const panelY = estimateTop + row * estimatePanelHeight;
  const plotLeftLocal = panelX + 78;
  const plotRightLocal = panelX + estimatePanelWidth - 32;
  const plotTopLocal = panelY + 124;
  const plotBottomLocal = panelY + 218;
  const scoreY = (value) => {
    const ratio = (value - definition.scale_min) / (definition.scale_max - definition.scale_min);
    return plotBottomLocal - Math.max(0, Math.min(1, ratio)) * (plotBottomLocal - plotTopLocal);
  };
  const predictionPoints = estimateSessions
    .map((session) => ({ session, estimate: session.estimates?.[metricId] }))
    .filter(({ estimate }) => estimate && Number.isFinite(estimate.mid));
  const actualPoints = (estimateData.historical_results ?? [])
    .filter((result) => result.test_id === metricId && Number.isFinite(result.score))
    .map((result) => ({ actual: result }));
  const timeline = [...actualPoints, ...predictionPoints];
  const xForPoint = (index) => timeline.length === 1
    ? (plotLeftLocal + plotRightLocal) / 2
    : plotLeftLocal + index * (plotRightLocal - plotLeftLocal) / (timeline.length - 1);
  const predictionStart = actualPoints.length;
  const predictionLine = predictionPoints.slice(1).map((point, index) => {
    const previous = predictionPoints[index];
    const x1 = xForPoint(predictionStart + index);
    const x2 = xForPoint(predictionStart + index + 1);
    return `<line x1="${x1}" y1="${scoreY(previous.estimate.mid)}" x2="${x2}" y2="${scoreY(point.estimate.mid)}" stroke="#2563eb" stroke-width="4" stroke-linecap="round"/>`;
  }).join("");
  const actualMarks = actualPoints.map(({ actual }, index) => {
    const x = xForPoint(index);
    const y = scoreY(actual.score);
    return `
      <rect x="${x - 8}" y="${y - 8}" width="16" height="16" rx="3" fill="#ffffff" stroke="#475569" stroke-width="4"/>
      ${estimateText(x, plotBottomLocal + 24, actual.date_label_ja, 'class="estimate-axis" text-anchor="middle"')}
      ${estimateText(x, plotBottomLocal + 44, `実績 ${actual.score}`, 'class="estimate-actual" text-anchor="middle"')}`;
  }).join("");
  const predictionMarks = predictionPoints.map(({ session, estimate }, index) => {
    const x = xForPoint(predictionStart + index);
    const lowY = scoreY(estimate.low);
    const midY = scoreY(estimate.mid);
    const highY = scoreY(estimate.high);
    return `
      <line x1="${x}" y1="${highY}" x2="${x}" y2="${lowY}" stroke="#16a34a" stroke-width="8" stroke-linecap="round" opacity="0.55"/>
      <line x1="${x - 10}" y1="${highY}" x2="${x + 10}" y2="${highY}" stroke="#15803d" stroke-width="3"/>
      <line x1="${x - 10}" y1="${lowY}" x2="${x + 10}" y2="${lowY}" stroke="#15803d" stroke-width="3"/>
      <path d="M ${x} ${midY - 11} L ${x + 11} ${midY} L ${x} ${midY + 11} L ${x - 11} ${midY} Z" fill="#16a34a"/>
      ${estimateText(x, plotBottomLocal + 24, `S${session.session} ${shortDate(session.date)}`, 'class="estimate-axis" text-anchor="middle"')}`;
  }).join("");
  const minLabel = ordinalEdgeLabel(definition, "min");
  const maxLabel = ordinalEdgeLabel(definition, "max");
  return `
    <rect x="${panelX}" y="${panelY}" width="${estimatePanelWidth}" height="${estimatePanelHeight - 16}" rx="16" fill="${row % 2 === 0 ? "#f8fbff" : "#fbfcfe"}" stroke="#d7e1ec" stroke-width="2"/>
    ${estimateText(panelX + 22, panelY + 38, definition.label_ja, 'class="estimate-panel-title"')}
    ${estimateText(panelX + 22, panelY + 64, definition.label_en, 'class="estimate-panel-subtitle"')}
    ${estimateText(panelX + estimatePanelWidth - 22, panelY + 94, `${latest.display}（S${latestMetricSession.session}）`, 'class="estimate-current" text-anchor="end"')}
    ${estimateText(panelX + estimatePanelWidth - 22, panelY + 66, `確度 ${confidenceJa[latest.confidence] ?? latest.confidence}`, 'class="estimate-confidence" text-anchor="end"')}
    <line x1="${plotLeftLocal}" y1="${plotBottomLocal}" x2="${plotRightLocal}" y2="${plotBottomLocal}" stroke="#94a3b8" stroke-width="2"/>
    <line x1="${plotLeftLocal}" y1="${plotTopLocal}" x2="${plotLeftLocal}" y2="${plotBottomLocal}" stroke="#94a3b8" stroke-width="2"/>
    ${estimateText(plotLeftLocal - 12, plotTopLocal + 7, maxLabel, 'class="estimate-scale" text-anchor="end"')}
    ${estimateText(plotLeftLocal - 12, plotBottomLocal + 7, minLabel, 'class="estimate-scale" text-anchor="end"')}
    ${predictionLine}${actualMarks}${predictionMarks}
  `;
}).join("");

const estimateSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${estimateWidth}" height="${estimateHeight}" viewBox="0 0 ${estimateWidth} ${estimateHeight}">
  <style>
    text { font-family: "Yu Gothic", Meiryo, Arial, Helvetica, sans-serif; fill: #0f172a; }
    .estimate-title { font-size: 44px; font-weight: 700; }
    .estimate-subtitle { font-size: 23px; fill: #475569; }
    .estimate-note { font-size: 18px; fill: #64748b; }
    .estimate-panel-title { font-size: 25px; font-weight: 700; }
    .estimate-panel-subtitle { font-size: 16px; fill: #64748b; }
    .estimate-current { font-size: 22px; font-weight: 700; fill: #15803d; }
    .estimate-confidence { font-size: 16px; font-weight: 700; fill: #475569; }
    .estimate-axis { font-size: 15px; fill: #475569; }
    .estimate-actual { font-size: 15px; font-weight: 700; fill: #334155; }
    .estimate-scale { font-size: 14px; fill: #64748b; }
    .estimate-foot { font-size: 17px; fill: #475569; }
  </style>
  <rect width="${estimateWidth}" height="${estimateHeight}" fill="#ffffff"/>
  ${estimateText(estimateLeft, 56, "資格スコア予測の推移（学習用）", 'class="estimate-title"')}
  ${estimateText(estimateLeft, 90, "Estimated Test-Score Trends — learning reference only", 'class="estimate-subtitle"')}
  ${estimateText(estimateLeft, 124, `予測履歴は第${estimateSessions[0].session}回から開始。根拠のある試験種別だけを更新し、各パネルに最新Sessionを表示します。`, 'class="estimate-note"')}
  ${estimateText(estimateLeft, 153, "試験ごとに固有の尺度を使用。TOEFL iBTは2026年1月導入の1–6尺度、CEFR / ACTFLは順序レベルです。", 'class="estimate-note"')}
  ${estimatePanels}
  ${estimateText(estimateLeft, estimateHeight - 34, "◆ 予測レンジの中央表示値　｜　縦線 予測レンジ　｜　□ 自己申告の実績　※公式試験結果・合格保証ではありません。", 'class="estimate-foot"')}
</svg>`;

await sharp(Buffer.from(estimateSvg)).png().toFile(testEstimateOutputPath);
if (publishTrackedAssets) {
  await copyFile(testEstimateOutputPath, trackedEstimatePath);
}
console.log(testEstimateOutputPath);
