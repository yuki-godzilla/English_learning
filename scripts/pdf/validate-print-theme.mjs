import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = await fs.readFile(path.join(root, "site-src", "assets", "stylesheets", "journal-print.css"), "utf8");

function luminance(hex) {
  const values = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset + 1, offset + 3), 16) / 255);
  const [red, green, blue] = values.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const pairs = [
  ["本文", "#1F2937", "#FFFFFF", 7],
  ["見出し", "#163A5F", "#FFFFFF", 7],
  ["補助本文", "#4B5563", "#FFFFFF", 4.5],
  ["リンク", "#1D5FA7", "#FFFFFF", 4.5],
  ["Expression", "#1D4ED8", "#EFF6FF", 4.5],
  ["Vocabulary", "#047857", "#ECFDF5", 4.5],
  ["Speaking", "#6D28D9", "#F5F3FF", 4.5],
  ["支援領域", "#B45309", "#FFF7ED", 4.5],
  ["N/A", "#4B5563", "#F3F4F6", 4.5],
];
const requiredTokens = ["@media print", "size: A4", "#1f2937", "#163a5f", "#eff6ff", "#ecfdf5", "#f5f3ff", "details.recall-card"];
const missing = requiredTokens.filter((token) => !css.toLowerCase().includes(token.toLowerCase()));
const failures = pairs.map(([name, foreground, background, minimum]) => ({ name, ratio: contrast(foreground, background), minimum }))
  .filter((item) => item.ratio < item.minimum);

function fontSizeFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{[^}]*font-size:\\s*([0-9.]+)pt`, "i"));
  return match ? Number(match[1]) : null;
}

for (const [selector, minimum] of [
  [".session-card p", 10.5],
  [".session-card h2", 10.5],
  [".session-card .card-meta", 8.5],
  [".session-card .learning-tag", 8.5],
]) {
  const size = fontSizeFor(selector);
  if (size == null || size < minimum) failures.push({ name: `${selector} font size`, ratio: size ?? 0, minimum });
}
if (!/\.session-grid\s*\{[^}]*repeat\(2,/i.test(css)) failures.push({ name: "Session Index column count", ratio: 0, minimum: 2 });
if (/\.session-grid\s*\{[^}]*repeat\(3,/i.test(css)) failures.push({ name: "Session Index must not use three print columns", ratio: 3, minimum: Number.POSITIVE_INFINITY });

if (missing.length || failures.length) {
  if (missing.length) console.error(`Print theme missing required tokens: ${missing.join(", ")}`);
  for (const failure of failures) console.error(`${failure.name}: ${failure.ratio.toFixed(2)} is below the required ${failure.minimum}`);
  process.exit(1);
}
for (const [name, foreground, background] of pairs) console.log(`${name}: ${contrast(foreground, background).toFixed(2)}:1`);
console.log("Print theme contrast checks passed.");
