import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot as root } from '../lib/project.mjs';
await fs.mkdir(path.join(root,'tmp'),{recursive:true});
const lockPath = path.join(root,'tmp/report-prepare.lock');
const lock = await fs.open(lockPath,'wx').catch(() => { throw new Error('Another report run is active. Inspect the lock before recovery.'); });
try {
  await lock.writeFile(JSON.stringify({pid:process.pid,started:new Date().toISOString()}));
  const npm = command => execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d','/s','/c', `npm run ${command}`] : ['run',command], {cwd:root,stdio:'inherit',windowsHide:true});
  npm('journal:pdf'); npm('check');
  execFileSync(process.execPath,[path.join(root,'scripts/report/state.mjs'),'freeze'],{cwd:root,stdio:'inherit',windowsHide:true});
  console.log('Awaiting all-page visual review. Then commit/push, verify-send, send exact PDF, and record provider message ID.');
} finally { await lock.close(); await fs.rm(lockPath,{force:true}); }
