/** Isolated browser checks; screenshots and synthetic recall state stay outside Git. */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { projectRoot as root } from '../lib/project.mjs';
import { findPdfBrowser } from '../pdf/runtime.mjs';
import { loadJournal } from '../lib/journal-parser.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = path.join(root, 'tmp/browser-qa');
await fs.mkdir(out, { recursive: true });
const siteRoot = path.join(root, 'site');
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/English_learning\//, '/');
    let file = path.resolve(siteRoot, '.' + pathname);
    if (!file.startsWith(siteRoot + path.sep) && file !== siteRoot) throw Error('path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const failures = [], results = [];
const latestSession=(await loadJournal()).sessions.sort((a,b)=>b.date.localeCompare(a.date)||b.session-a.session)[0];
let browser;

// Alpha colors must be composited before judging actual screen contrast.
async function textChecks(page, selectors) {
  return page.evaluate(selectors => {
    const rgba = value => { const n = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0]; return [...n.slice(0, 3), n.length > 3 ? n[3] : 1]; };
    const blend = (front, back) => front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3]));
    const lum = c => c.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const background = el => {
      const ancestors = []; for (let n = el; n; n = n.parentElement) ancestors.unshift(n);
      return ancestors.reduce((color, n) => blend(rgba(getComputedStyle(n).backgroundColor), color), [255, 255, 255]);
    };
    return [...document.querySelectorAll(selectors)].filter(el => el.getBoundingClientRect().height && getComputedStyle(el).visibility !== 'hidden').map(el => {
      const style = getComputedStyle(el), bg = background(el), fg = blend(rgba(style.color), bg);
      const a = lum(fg), b = lum(bg);
      return { font: parseFloat(style.fontSize) * .75, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), text: el.textContent.trim().slice(0, 35) };
    });
  }, selectors);
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.UI_CHECK_MANAGED_BROWSER === '1' ? {} : { executablePath: findPdfBrowser() }) });
  for (const width of [390, 1440]) for (const theme of ['default', 'slate']) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, colorScheme: theme === 'slate' ? 'dark' : 'light', timezoneId: 'Asia/Tokyo' });
    try {
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(error.message));
      for (const route of ['progress/', 'review/', '', `sessions/${latestSession.id}/`]) {
        await page.goto(base + '/' + route, { waitUntil: 'networkidle' });
        await page.evaluate(theme => document.body.setAttribute('data-md-color-scheme', theme), theme);
        await page.locator('img').evaluateAll(images => images.forEach(img => img.loading = 'eager'));
        await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0));
        const name = (route.replaceAll('/', '') || 'home') + '-' + width + '-' + theme;
        await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) failures.push(name + ': horizontal overflow');
        const screen = await textChecks(page, '.before-now p,.growth-insight p,.profile-evidence,.profile-evidence span,.report-contents a');
        let firstPracticeTop = null;
        for (const c of screen) if (c.ratio < 4.5) failures.push(name + ' screen contrast: ' + JSON.stringify(c));
        if (route === 'review/' || route === '') {
          const primary = page.locator('[data-practice-primary] [data-recall-id]:visible');
          if (await primary.count() !== 1) failures.push(name + ': expected one initial current practice');
          else {
            firstPracticeTop = (await primary.first().boundingBox())?.y ?? null;
            if (firstPracticeTop > 650) failures.push(name + ': first practice is below the initial phone viewport');
          }
        }
        if (route === 'review/') {
          const counts = await page.evaluate(() => ({ complete: document.querySelectorAll('[data-active-items] [data-active-bank-item]').length, candidates: document.querySelectorAll('[data-practice-primary] [data-recall-id]').length }));
          if (counts.complete < 5 || counts.complete > 8 || counts.complete !== counts.candidates) failures.push(name + ': active plan catalogue incomplete');
        }
        if (route === 'progress/' && width === 390) {
          await page.locator('.level-history > summary').click();
          await page.locator('.level-history-metric > summary').first().click();
          if (!await page.locator('.level-history-table').first().isVisible()) failures.push(name + ': readable mobile history unavailable');
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) failures.push(name + ': expanded mobile history overflows');
          await page.screenshot({ path: path.join(out, name + '-history.png'), fullPage: true });
        }
        await page.emulateMedia({ media: 'print' });
        const print = await textChecks(page, '.md-content p,.profile-row strong,.grammar-row small');
        for (const c of print) if (c.font < 10.49 || c.ratio < 4.5) failures.push(name + ' print text: ' + JSON.stringify(c));
        if (route === 'progress/' && await page.locator('.fingerprint-grid .fingerprint-card:visible').count() !== 4) failures.push(name + ': supplemental print sparklines missing');
        results.push({ route, width, theme, first_practice_top: firstPracticeTop, screen_min_contrast: screen.length ? Math.min(...screen.map(c => c.ratio)) : null, screen_text_nodes: screen.length, print_text_nodes: print.length });
        await page.emulateMedia({ media: 'screen' });
        if (route === `sessions/${latestSession.id}/`) {
          const contents=page.locator('.report-contents');
          if (await contents.locator('a').count()!==5) failures.push(name+': report contents incomplete');
          for (const [text,target] of [['Vocabulary Bank','/review/vocabulary/'],['評価・成長','/progress/']]) {
            await contents.getByRole('link',{name:text,exact:true}).click();
            await page.waitForURL('**'+target);
            if (await page.locator('.md-content h1').count()!==1) failures.push(name+': contents target has no report heading');
            await page.goto(base+'/'+route,{waitUntil:'networkidle'});
          }
        }
      }
    } finally { await context.close(); }
  }

  // Independent pages share one origin and acquire the same Web Lock, including overlapping clicks.
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo' });
  try {
    const a = await context.newPage(), b = await context.newPage();
    await a.goto(base + '/', { waitUntil: 'networkidle' });
    const latestHref = await a.locator('.session-card h2 a[href*="sessions/"]').first().getAttribute('href');
    await b.goto(new URL(latestHref, base + '/').href, { waitUntil: 'networkidle' });
    const ca = a.locator('[data-practice-primary] [data-recall-id]:visible').first();
    const firstId = await ca.getAttribute('data-recall-id');
    const cb = b.locator('[data-recall-id]:not([data-recall-id="' + firstId + '"])').first();
    const ids = [firstId, await cb.getAttribute('data-recall-id')];
    if (ids[0] === ids[1]) throw Error('Two-tab fixture needs distinct real cards');
    await Promise.all([ca.locator('summary').click(), cb.locator('summary').click()]);
    await Promise.all([ca.locator('[data-recall-rating="remembered"]').click(), cb.locator('[data-recall-rating="remembered"]').click()]);
    await a.waitForFunction(ids => { const s = JSON.parse(localStorage.getItem('learning-recall-history-v2')); return ids.every(id => s?.cards[id]?.history.length > 0); }, ids);
    await b.reload();
    const saved = await b.evaluate(() => JSON.parse(localStorage.getItem('learning-recall-history-v2')));
    if (!ids.every(id => saved.cards[id]?.history.length)) failures.push('Two tabs: one card history was lost after reload');
    results.push({ check: 'overlapping-two-tab-history', survived: ids.length });
  } finally { await context.close(); }

  const recoveryContext = await browser.newContext();
  try {
    await recoveryContext.addInitScript(() => { localStorage.setItem('learning-recall-history-v2', 'broken-json-fixture'); });
    const page = await recoveryContext.newPage();
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    const warning = page.locator('[data-recall-message]').first(), recovery = page.locator('[data-recall-recovery]');
    if (!await warning.isVisible() || !await warning.textContent() || !await recovery.isVisible()) failures.push('Home: storage failure warning/backup is hidden');
    const card = page.locator('[data-practice-primary] [data-recall-id]:visible').first();
    const id = await card.getAttribute('data-recall-id');
    await card.locator('summary').click();
    await card.locator('[data-recall-rating="remembered"]').click();
    await page.waitForFunction(() => document.querySelector('[data-recall-message]')?.textContent.includes('この画面'));
    const downloadPending = page.waitForEvent('download');
    await recovery.locator('[data-recall-export]').click();
    const exported = JSON.parse(await fs.readFile(await (await downloadPending).path(), 'utf8'));
    if (!exported.cards[id]?.history.length) failures.push('Home: unsaved practice missing from recovery export');
    if (await page.evaluate(() => localStorage.getItem('learning-recall-history-v2')) !== 'broken-json-fixture') failures.push('Recovery overwrote corrupt original storage');
    await page.screenshot({ path: path.join(out, 'home-storage-recovery.png'), fullPage: true });
    results.push({ check: 'visible-storage-recovery-export', original_preserved: true });
  } finally { await recoveryContext.close(); }
} catch (error) {
  failures.push(error.stack || error.message);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ results, failures }, null, 2));
if (failures.length) throw Error(failures.join('\n'));
console.log('Browser QA passed: phone/desktop, light/dark, current practice, readable history, print and overlapping tabs.');
