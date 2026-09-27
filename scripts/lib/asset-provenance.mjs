import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { projectRoot } from './project.mjs';
export const assetInputs = ['learning-records/progress.json', 'scripts/charts/generate.mjs', 'scripts/lib/evidence.mjs', 'scripts/charts/skill-timeline.mjs'];
export async function assetProvenance() {
  const inputs = {};
  for (const file of assetInputs) inputs[file] = crypto.createHash('sha256').update((await fs.readFile(path.join(projectRoot, file), 'utf8')).replaceAll('\r\n', '\n')).digest('hex');
  return { schema_version: 1, inputs };
}
