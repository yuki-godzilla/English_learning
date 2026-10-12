import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const recallSource = fs.readFileSync(new URL('../site-src/assets/javascripts/recall-state.js', import.meta.url), 'utf8');
const pageSource = fs.readFileSync(new URL('../site-src/assets/javascripts/learning.js', import.meta.url), 'utf8');
const storageKey = 'learning-recall-history-v2';
const expression = 'expressions-0123456789abcdef', vocabulary = 'vocabulary-0123456789abcdef';
class Target {
  listeners = new Map();
  addEventListener(type, handler) { const set = this.listeners.get(type) ?? new Set(); set.add(handler); this.listeners.set(type, set); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  async emit(type, event = {}) { await Promise.all([...(this.listeners.get(type) ?? [])].map(handler => handler(event))); }
}
function sharedBrowser(withLocks = true, { failWrites = false } = {}) {
  const values = new Map(), tabs = [], operations = [];
  let tail = Promise.resolve(), active = 0, maximumActive = 0;
  const locks = {
    request(name, callback) {
      assert.equal(name, storageKey);
      const run = tail.then(async () => {
        active++; maximumActive = Math.max(maximumActive, active);
        await Promise.resolve(); // Both stale tabs request their transaction before the first reads.
        try { return await callback(); } finally { active--; }
      });
      tail = run.catch(() => {});
      return run;
    },
  };
  async function open(id, at = '2026-10-12T00:00:00Z', { queue = false } = {}) {
    let time = at;
    const buttons = ['again', 'remembered', 'mastered'].map(rating => Object.assign(new Target(), {
      dataset: { recallRating: rating }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
    }));
    const status = { textContent: '' }, message = { textContent: '', hidden: false }, queueMessage = { hidden: true, textContent: '' }, recovery = { hidden: true };
    const card = { dataset: { recallId: id }, hidden: false, querySelectorAll: () => buttons, querySelector: () => status };
    const dueQueue = { dataset: { recallLimit: '1', recallEmpty: 'No due practice; stopping is fine.' }, querySelectorAll: () => [card], querySelector: () => queueMessage };
    const exporters = [new Target(), new Target()], importer = new Target(), document = new Target(), window = new Target(), downloads = [];
    Object.assign(window, { location: { href: 'https://example.test/review/' } });
    Object.assign(document, {
      visibilityState: 'visible',
      querySelector(selector) { return ({ '[data-recall-message]': message, '[data-recall-export]': exporters[0], '[data-recall-import]': importer })[selector] ?? null; },
      querySelectorAll(selector) { return ({ '[data-recall-id]': [card], '[data-due-queue]': queue ? [dueQueue] : [], '[data-recall-message]': [message], '[data-recall-recovery]': [recovery], '[data-recall-export]': exporters })[selector] ?? []; },
      createElement() { return { click() {} }; },
    });
    const storage = {
      getItem(key) { if (key === storageKey) operations.push('read'); return values.get(key) ?? null; },
      setItem(key, value) {
        if (failWrites) throw new Error('Storage quota exceeded');
        if (key === storageKey) operations.push('write');
        values.set(key, value);
        for (const other of tabs) if (other.window !== window) queueMicrotask(() => void other.window.emit('storage', { key, newValue: value, storageArea: other.storage }));
      },
    };
    class DownloadURL extends URL {}
    DownloadURL.createObjectURL = blob => { downloads.push(blob); return 'blob:test'; };
    DownloadURL.revokeObjectURL = () => {};
    const context = vm.createContext({ URL: DownloadURL, Blob, Intl, structuredClone,
      Date: class extends Date { constructor(...args) { super(...(args.length ? args : [time])); } },
      navigator: withLocks ? { locks } : {}, localStorage: storage, document, window,
    });
    vm.runInContext(recallSource, context); vm.runInContext(pageSource, context);
    const tab = { window, storage, card, status, message, queueMessage, recovery,
      setTime(at) { time = at; },
      rate(rating) { return buttons.find(b => b.dataset.recallRating === rating).emit('click'); },
      async export(index = 0) { await exporters[index].emit('click'); return JSON.parse(await downloads.at(-1).text()); },
      import(backup) { const text = JSON.stringify(backup); return importer.emit('change', { target: { files: [{ size: text.length, text: async () => text }] } }); },
    };
    tabs.push(tab); await document.emit('DOMContentLoaded'); return tab;
  }
  return { open, values, operations, get maximumActive() { return maximumActive; }, stored: () => JSON.parse(values.get(storageKey)) };
}
test('overlapping stale tabs serialize read/write and both cards survive reload', async () => {
  const browser = sharedBrowser(), a = await browser.open(expression), b = await browser.open(vocabulary);
  browser.operations.length = 0;
  await Promise.all([a.rate('remembered'), b.rate('remembered')]);
  assert.deepEqual(browser.operations, ['read', 'write', 'read', 'write']);
  assert.equal(browser.maximumActive, 1);
  assert.deepEqual(Object.keys(browser.stored().cards).sort(), [expression, vocabulary]);
  const reloadA = await browser.open(expression), reloadB = await browser.open(vocabulary);
  assert.match(reloadA.status.textContent, /1日/); assert.match(reloadB.status.textContent, /1日/);
  assert.equal((await a.export()).cards[vocabulary].history.length, 1);
});
test('cross-tab same-item rating changes retain events but only one JST practice day', async () => {
  const browser = sharedBrowser(), a = await browser.open(expression, '2026-10-12T00:00:00Z'), b = await browser.open(expression, '2026-10-12T00:01:00Z');
  await a.rate('remembered'); await b.rate('again');
  const card = browser.stored().cards[expression];
  assert.equal(card.history.length, 2); assert.equal(card.due, '2026-10-13T00:01:00.000Z');
  assert.match(a.status.textContent, /1日/); assert.match(b.status.textContent, /1日/);
  const exported = await a.export();
  await b.import(exported); await a.import(exported);
  assert.deepEqual(browser.stored(), exported);
});
test('a tab left open across JST midnight records two real days without reopening', async () => {
  const browser = sharedBrowser(), tab = await browser.open(expression, '2026-10-12T14:30:00Z');
  await tab.rate('remembered'); tab.setTime('2026-10-12T15:30:00Z'); await tab.rate('remembered');
  assert.match(tab.status.textContent, /2日/);
  assert.equal(browser.stored().cards[expression].due, '2026-10-16T15:30:00.000Z');
});
test('v2 import derives JST spacing, keeps timestamps, and reimport/export is idempotent', async () => {
  const browser = sharedBrowser(), tab = await browser.open(expression);
  const history = [{ at: '2026-10-12T08:30:00+09:00', rating: 'remembered' }, { at: '2026-10-12T00:30:00Z', rating: 'mastered' }];
  const backup = { version: 2, cards: { [expression]: { history, due: '2030-01-01T00:00:00Z' } } };
  await tab.import(backup); const exported = await tab.export(); await tab.import(backup);
  assert.deepEqual(browser.stored(), exported); assert.deepEqual(exported.cards[expression].history, history);
  assert.equal(exported.cards[expression].due, '2026-10-14T00:30:00.000Z'); assert.match(tab.status.textContent, /1日/);
});
test('read-before-write fallback preserves sequential stale-tab edits without claiming concurrent locking', async () => {
  const browser = sharedBrowser(false), a = await browser.open(expression), b = await browser.open(vocabulary);
  await a.rate('remembered'); await b.rate('remembered');
  assert.deepEqual(Object.keys(browser.stored().cards).sort(), [expression, vocabulary]);
});
test('one-item queue shows a non-recording empty message after its last due item', async () => {
  const browser = sharedBrowser(), tab = await browser.open(expression, '2026-10-12T00:00:00Z', { queue: true });
  assert.equal(tab.card.hidden, false); assert.equal(tab.queueMessage.hidden, true);
  await tab.rate('remembered');
  assert.equal(tab.card.hidden, true); assert.equal(tab.queueMessage.hidden, false);
  assert.equal(tab.queueMessage.textContent, 'No due practice; stopping is fine.');
  assert.equal(browser.stored().cards[expression].history.length, 1);
});
test('an unreadable stored backup is not overwritten by practice or import', async () => {
  const browser = sharedBrowser(); browser.values.set(storageKey, '{broken');
  const tab = await browser.open(expression);
  assert.equal(tab.message.hidden, false); assert.match(tab.message.textContent, /上書きせず/);
  assert.equal(tab.recovery.hidden, false);
  await tab.rate('remembered'); assert.match(tab.message.textContent, /この画面だけ/);
  const exported = await tab.export(); await tab.import(exported);
  assert.equal(browser.values.get(storageKey), '{broken');
  assert.equal(exported.cards[expression].history.length, 1);
  assert.match(tab.message.textContent, /ブラウザ保存はできない/);
  assert.deepEqual(await tab.export(1), exported); // The later history-controls button is bound too.
});
test('failed persistence exposes recovery and exports the real in-memory snapshot', async () => {
  const browser = sharedBrowser(true, { failWrites: true }), tab = await browser.open(expression);
  assert.equal(tab.recovery.hidden, true); await tab.rate('remembered');
  assert.equal(browser.values.has(storageKey), false); assert.equal(tab.recovery.hidden, false);
  assert.equal(tab.message.hidden, false); assert.match(tab.message.textContent, /この画面だけ/);
  const exported = await tab.export();
  assert.equal(exported.version, 2); assert.equal(exported.cards[expression].history.length, 1);
  assert.equal(exported.cards[expression].history[0].at, '2026-10-12T00:00:00.000Z');
  assert.deepEqual(await tab.export(1), exported);
});
