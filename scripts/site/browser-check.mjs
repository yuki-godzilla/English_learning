/** Real computed-style/layout QA. Screenshots are local ignored review artifacts. */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { projectRoot as root } from '../lib/project.mjs';
import { findPdfBrowser } from '../pdf/runtime.mjs';
const require = createRequire(import.meta.url);
let chromium;
try { ({chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { ({chromium} = require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const out = path.join(root,'tmp/browser-qa'); await fs.mkdir(out,{recursive:true});
const siteRoot = path.join(root,'site');
const server = http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/English_learning\//,'/');
    let file = path.resolve(siteRoot,'.'+pathname);
    if (!file.startsWith(siteRoot+path.sep) && file !== siteRoot) throw Error('path');
    if ((await fs.stat(file)).isDirectory()) file=path.join(file,'index.html');
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch {res.statusCode=404;res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:findPdfBrowser(),headless:true});
const failures=[], results=[];
try {
  const page=await browser.newPage(); page.on('pageerror',error=>failures.push(error.message));
  for(const width of [390,1440]) for(const route of ['progress/','review/','']) {
    await page.setViewportSize({width,height:1000});
    await page.goto(`http://127.0.0.1:${server.address().port}/${route}`,{waitUntil:'networkidle'});
    await page.locator('img').evaluateAll(images => images.forEach(img => img.loading='eager'));
    await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0));
    await page.screenshot({path:path.join(out,`${route.replaceAll('/','') || 'home'}-${width}.png`),fullPage:true});
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth+2);
    if(overflow) failures.push(`${route} at ${width}px has horizontal overflow`);
    if(route==='review/') {
      const count=await page.locator('[data-due-queue] [data-recall-id]:visible').count();
      if(count>5 || count<1) failures.push(`Due queue renders ${count} cards`);
      const card=page.locator('[data-due-queue] [data-recall-id]:visible').first(); await card.locator('summary').click();
      await card.locator('[data-recall-rating="remembered"]').click();
      const history=await page.evaluate(()=>JSON.parse(localStorage.getItem('learning-recall-history-v2')));
      if(!Object.keys(history?.cards ?? {}).length) failures.push('Review click not saved');
    }
    await page.emulateMedia({media:'print'});
    const checks=await page.evaluate(()=>{
      const rgb=s=>s.match(/[\d.]+/g)?.slice(0,3).map(Number);
      const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      return [...document.querySelectorAll('.md-content p,.profile-row strong,.grammar-row small')].filter(el=>el.getBoundingClientRect().height && getComputedStyle(el).visibility!=='hidden').map(el=>{
        const style=getComputedStyle(el);let node=el,bg='rgb(255,255,255)';
        while(node){const color=getComputedStyle(node).backgroundColor;if(color!=='rgba(0, 0, 0, 0)' && color!=='transparent'){bg=color;break;}node=node.parentElement;}
        const a=lum(rgb(style.color)),b=lum(rgb(bg));return {font:parseFloat(style.fontSize)*.75,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),text:el.textContent.slice(0,35)};
      });
    });
    for(const c of checks) if(c.font<10.49 || c.ratio<4.5) failures.push(`${route} print text: ${JSON.stringify(c)}`);
    results.push({route,width,print_text_nodes:checks.length});
    await page.emulateMedia({media:'screen'});
  }
} finally {await browser.close(); await new Promise(resolve=>server.close(resolve));}
await fs.writeFile(path.join(out,'results.json'),JSON.stringify({results,failures},null,2));
if(failures.length) throw Error(failures.join('\n'));
console.log('Browser QA passed: mobile, desktop, review storage, computed print contrast and font size.');
