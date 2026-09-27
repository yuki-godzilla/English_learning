import test from 'node:test';
import assert from 'node:assert/strict';
import '../site-src/assets/javascripts/recall-state.js';
const r=globalThis.LearningRecall,id='expressions-0123456789abcdef';
test('review records time and due; self-reported confidence is not mastery',()=>{
  const s=r.record(r.empty(),id,'mastered',new Date('2026-09-27T00:00:00Z'));
  assert.equal(s.cards[id].due,'2026-09-29T00:00:00.000Z'); assert.equal(s.cards[id].history.length,1);
});
test('same-day clicks do not accumulate evidence',()=>{
  let s=r.record(r.empty(),id,'remembered',new Date('2026-09-27T00:00:00Z'));
  s=r.record(s,id,'again',new Date('2026-09-27T01:00:00Z')); assert.equal(s.cards[id].history.length,1);
});
test('same-day success does not increase interval; again resets spacing',()=>{
  let s=r.record(r.empty(),id,'remembered',new Date('2026-09-27T00:00:00Z'));
  s=r.record(s,id,'mastered',new Date('2026-09-27T01:00:00Z')); assert.equal(s.cards[id].due,'2026-09-29T01:00:00.000Z');
  s=r.record(s,id,'again',new Date('2026-09-28T00:00:00Z'));
  s=r.record(s,id,'remembered',new Date('2026-09-29T00:00:00Z')); assert.equal(s.cards[id].due,'2026-10-01T00:00:00.000Z');
});
test('merge is idempotent; overdue queue has maximum size',()=>{
  const s=r.record(r.empty(),id,'remembered',new Date('2026-09-20T00:00:00Z'));
  assert.equal(r.merge(s,s).cards[id].history.length,1); assert.deepEqual(r.dueIds(s,[id],new Date('2026-09-27')), [id]);
});
test('corrupt import rejected without touching source state',()=>{
  const s=r.empty(); assert.throws(()=>r.merge(s,{version:1,cards:{}})); assert.deepEqual(s,r.empty());
});
