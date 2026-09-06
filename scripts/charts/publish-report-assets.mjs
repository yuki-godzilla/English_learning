/** Publish the two required report charts and synchronize their manifest metadata. */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { projectRoot as root, recordsRoot } from "../lib/project.mjs";

const execFileAsync = promisify(execFile);
const generatorPath = path.join(root, "scripts", "charts", "generate.mjs");
const manifestPath = path.join(recordsRoot, "media-manifest.json");
const progressPath = path.join(recordsRoot, "progress.json");

const { stdout, stderr } = await execFileAsync(process.execPath, [generatorPath, "--publish-assets"], {
  cwd: root,
  windowsHide: true,
});
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

const progress = JSON.parse(await fs.readFile(progressPath, "utf8"));
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const latestSession = progress.sessions?.at(-1);
if (!latestSession?.session) throw new Error("progress.json has no latest Session for report assets.");
if (!Array.isArray(manifest.files)) throw new Error("media-manifest.json has no files array.");

const pronunciationSessions = progress.sessions
  .filter((session) => Number.isInteger(session.ratings?.Pronunciation))
  .map((session) => session.session)
  .join("・");

const requiredAssets = [
  {
    path: "learning-records/media/progress/english-growth-evidence-dashboard.png",
    role: "English growth dashboard",
    alt: `Session 1からSession ${latestSession.session}までの英語力成長グラフ`,
    caption: `progress.jsonから生成したSession 1〜${latestSession.session}の英語力推移。L1〜L5と同一レベル内の形成中・安定・強いを表示し、Pronunciationは直接音声を確認したSession ${pronunciationSessions || "なし"}だけを測定値として扱う。`,
  },
  {
    path: "learning-records/media/progress/english-test-score-estimate-trends.png",
    role: "Estimated test score trends",
    alt: `Session 1からSession ${latestSession.session}までの資格スコア予測の推移グラフ`,
    caption: "progress.jsonから生成した学習用の資格スコア目安。正本の会話根拠が十分な節目だけを履歴点として描画し、記録が薄い回を補間しない。各技能の最新根拠Session、確度、未測定範囲を区別し、公式試験結果とは扱わない。",
  },
];

for (const asset of requiredAssets) {
  const entry = manifest.files.find((candidate) => candidate.path === asset.path);
  if (!entry) throw new Error(`Required report asset is not registered: ${asset.path}`);
  const absolutePath = path.join(root, asset.path);
  const bytes = await fs.readFile(absolutePath);
  entry.status = "generated";
  entry.role = asset.role;
  entry.alt = asset.alt;
  entry.caption = asset.caption;
  entry.creator = "Generated from learning-records/progress.json";
  entry.license = "Project generated";
  entry.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
}

await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Published and registered ${requiredAssets.length} report assets for Session ${latestSession.session}.`);
