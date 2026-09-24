/** Reproduce the Session 14 model comparison from a dated benchmark snapshot. */
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../lib/project.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const outputPath = path.join(projectRoot, "learning-records", "media", "sessions", "2026-09-24-model-benchmark-comparison.png");

// Artificial Analysis Intelligence Index v4.3.2 and weighted cost per Index task,
// checked 2026-09-24. Exact reasoning configurations are part of the labels.
// https://artificialanalysis.ai/leaderboards/models
// https://artificialanalysis.ai/models/releases/gpt-5-6-sol
// https://artificialanalysis.ai/models/releases/gpt-5-6-luna
const groups = [
  { heading: "OpenAI: GPT-6 and GPT-5.6", items: [
    { name: "GPT-6 Astra (max)", score: 53, cost: 3.26, color: "#1d4ed8" },
    { name: "GPT-6 Sol (max)", score: 48, cost: 1.06, color: "#1d4ed8" },
    { name: "GPT-6 Luna (max)", score: 37, cost: 0.07, color: "#1d4ed8" },
    { name: "GPT-5.6 Sol (max)", score: 47, cost: 1.99, color: "#64748b" },
    { name: "GPT-5.6 Terra (max)", score: 42, cost: 1.40, color: "#64748b" },
    { name: "GPT-5.6 Luna (max)", score: 37, cost: 0.18, color: "#64748b" },
  ] },
  { heading: "Other companies: selected configurations", items: [
    { name: "Claude Opus 5.5 (max*)", score: 58, cost: 5.98, color: "#7c3aed" },
    { name: "Gemini 3.8 Flash (high)", score: 41, cost: 1.24, color: "#047857" },
    { name: "Grok 4.7 (xhigh)", score: 46, cost: 3.74, color: "#b45309" },
    { name: "DeepSeek V4.1 Flash (max)", score: 39, cost: 0.27, color: "#0f766e" },
  ] },
];

const escapeXml = (value) => String(value).replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const label = (x, y, value, extra = "") =>
  '<text x="' + x + '" y="' + y + '" ' + extra + ">" + escapeXml(value) + "</text>";
const rows = [];
let y = 274;
for (const group of groups) {
  rows.push('<rect x="42" y="' + (y - 47) + '" width="1116" height="48" rx="10" fill="#eaf2fb"/>');
  rows.push(label(58, y - 15, group.heading, 'class="group"'));
  y += 55;
  for (const [index, model] of group.items.entries()) {
    const rowY = y + index * 65;
    if (index % 2 === 0) rows.push('<rect x="42" y="' + (rowY - 25) + '" width="1116" height="58" rx="8" fill="#f7f9fc"/>');
    const scoreWidth = 316 * model.score / 60;
    const costWidth = Math.max(5, 245 * model.cost / 6);
    rows.push(label(58, rowY + 12, model.name, 'class="name"'));
    rows.push('<rect x="410" y="' + (rowY - 11) + '" width="316" height="24" rx="8" fill="#e2e8f0"/>');
    rows.push('<rect x="410" y="' + (rowY - 11) + '" width="' + scoreWidth.toFixed(1) + '" height="24" rx="8" fill="' + model.color + '"/>');
    rows.push(label(750, rowY + 12, String(model.score), 'class="value" text-anchor="end"'));
    rows.push('<rect x="819" y="' + (rowY - 11) + '" width="245" height="24" rx="8" fill="#e2e8f0"/>');
    rows.push('<rect x="819" y="' + (rowY - 11) + '" width="' + costWidth.toFixed(1) + '" height="24" rx="8" fill="' + model.color + '"/>');
    rows.push(label(1141, rowY + 12, "$" + model.cost.toFixed(2), 'class="value" text-anchor="end"'));
  }
  y += group.items.length * 65 + 45;
}

const footerTop = y + 15;
const svg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="' + (footerTop + 140) + '" viewBox="0 0 1200 ' + (footerTop + 140) + '">',
  '<style>text{font-family:Arial,"Yu Gothic",Meiryo,sans-serif;fill:#1f2937}.title{font-size:42px;font-weight:700}.subtitle{font-size:25px;fill:#4b5563}.note{font-size:22px;fill:#4b5563}.head{font-size:26px;font-weight:700;fill:#163a5f}.group{font-size:26px;font-weight:700;fill:#163a5f}.name{font-size:26px;font-weight:600}.value{font-size:26px;font-weight:700}.foot{font-size:21px;fill:#4b5563}</style>',
  '<rect width="1200" height="' + (footerTop + 140) + '" fill="#ffffff"/>',
  label(42, 65, "AI models: benchmark score and cost", 'class="title"'),
  label(42, 104, "2026-09-24 snapshot | Artificial Analysis Intelligence Index v4.3.2", 'class="subtitle"'),
  label(42, 145, "Same benchmark; exact reasoning setting is shown for every model.", 'class="note"'),
  label(410, 185, "Index score", 'class="head"'),
  label(410, 213, "0-60; higher is better", 'class="note"'),
  label(819, 185, "Cost per task", 'class="head"'),
  label(819, 213, "USD; lower is better", 'class="note"'),
  rows.join("\n"),
  '<line x1="42" y1="' + footerTop + '" x2="1158" y2="' + footerTop + '" stroke="#cbd5e1" stroke-width="2"/>',
  label(42, footerTop + 35, "* Claude Opus 5.5 uses the benchmark provider fallback setting.", 'class="foot"'),
  label(42, footerTop + 73, "Cost per task is this benchmark's weighted estimate, not the API token price.", 'class="foot"'),
  label(42, footerTop + 111, "Source: artificialanalysis.ai/leaderboards/models (checked 2026-09-24).", 'class="foot"'),
  '</svg>',
].join("\n");

await mkdir(path.dirname(outputPath), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(outputPath);
console.log(outputPath);
