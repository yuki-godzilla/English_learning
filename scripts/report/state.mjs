/** Private delivery receipt. This command never sends mail or stages files. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { projectRoot as root } from '../lib/project.mjs';
const dir = path.join(root, 'tmp/report-runs');
const receiptPath = path.join(dir, 'current.json');
await fs.mkdir(dir, { recursive: true });
const pdf = path.join(root, 'output/pdf/yuki-chappy-english-journal.pdf');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).sort();
const inputs = {};
for (const file of files) {
  // Entire project frozen, including rules, generators and tests. Normalize text EOL.
  const bytes = await fs.readFile(path.join(root, file));
  inputs[file] = sha(/\.(?:png|jpg|jpeg|pdf|woff2?|ico)$/i.test(file) ? bytes : Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n')));
}
const fingerprint = sha(JSON.stringify(inputs)), pdfHash = sha(await fs.readFile(pdf));
const [action = 'status', argument] = process.argv.slice(2);
let receipt;
try { receipt = JSON.parse(await fs.readFile(receiptPath,'utf8')); } catch { receipt = null; }
const unchanged = () => {
  if (!receipt || receipt.source_hash !== fingerprint || receipt.pdf_sha256 !== pdfHash) throw new Error('Sources or PDF changed; rerun checks and freeze, then repeat visual review.');
};
if (action === 'freeze') {
  execFileSync(process.execPath, [path.join(root,'scripts/pdf/validate-journal-pdf.mjs')], { cwd:root, stdio:'inherit', windowsHide:true });
  if (receipt?.source_hash === fingerprint && receipt.pdf_sha256 === pdfHash) console.log('Same artifact: keeping existing review/delivery state.');
  else receipt = { version:1, created_at:new Date().toISOString(), source_hash:fingerprint, inputs, pdf_sha256:pdfHash, state:'awaiting_visual_review' };
} else if (action === 'reviewed') {
  unchanged();
  if (!argument) throw new Error('Supply the actual all-page visual-review note; do not mark review based on text extraction.');
  receipt.visual_review = { at:new Date().toISOString(), note:argument };
  receipt.state = receipt.message_id ? 'sent' : 'reviewed';
} else if (action === 'verify-send' || action === 'sent') {
  unchanged();
  if (!receipt.visual_review) throw new Error('All-page visual review is required before sending.');
  const git = args => execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  if (git(['status','--porcelain'])) throw new Error('Commit the frozen project before sending.');
  const remote = git(['ls-remote','origin','refs/heads/main']).split(/\s+/)[0];
  if (git(['rev-parse','HEAD']) !== remote) throw new Error('Verify origin/main push first.');
  receipt.commit = remote;
  if (action === 'verify-send' && receipt.message_id) throw new Error(`Already sent: ${receipt.message_id}. Do not duplicate delivery.`);
  if (action === 'sent') {
    if (!argument || receipt.message_id) throw new Error('A new confirmed provider message ID is required.');
    receipt.message_id = argument; receipt.sent_at = new Date().toISOString(); receipt.state = 'sent';
  }
} else if (action !== 'status') throw new Error('Use freeze, reviewed <note>, verify-send, sent <message-id>, or status.');
if (action !== 'status') {
  const temp = receiptPath + '.pending';
  await fs.writeFile(temp, JSON.stringify(receipt,null,2)+'\n'); await fs.rename(temp,receiptPath);
}
console.log(JSON.stringify({ state:receipt?.state ?? 'not_prepared', source_matches:receipt?.source_hash === fingerprint, pdf_matches:receipt?.pdf_sha256 === pdfHash, message_id:receipt?.message_id ?? null },null,2));
