import test from 'node:test';
import assert from 'node:assert/strict';
import '../site-src/assets/javascripts/recall-state.js';
const r=globalThis.LearningRecall,id='expressions-0123456789abcdef';
test('review records time and due; self-reported confidence is not mastery',()=>{
  const s=r.record(r.empty(),id,'mastered',new Date('2026-09-27T00:00:00Z'));
  assert.equal(s.cards[id].due,'2026-09-29T00:00:00.000Z'); assert.equal(s.cards[id].history.length,1);
});
test('same-day rating changes preserve events without adding practice days',()=>{
  let s=r.record(r.empty(),id,'remembered',new Date('2026-09-27T00:00:00Z'));
  s=r.record(s,id,'again',new Date('2026-09-27T01:00:00Z'));
  assert.equal(s.cards[id].history.length,2); assert.equal(r.reviewDays(s.cards[id]),1);
  assert.equal(s.cards[id].due,'2026-09-28T01:00:00.000Z');
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
test('08:30 and 09:30 JST remain the same practice day across UTC midnight',()=>{
  let s=r.record(r.empty(),id,'remembered',new Date('2026-10-11T23:30:00Z'));
  s=r.record(s,id,'remembered',new Date('2026-10-12T00:30:00Z'));
  assert.equal(r.reviewDays(s.cards[id]),1);
  assert.equal(s.cards[id].due,'2026-10-14T00:30:00.000Z');
  assert.deepEqual(s.cards[id].history.map(h=>h.at),['2026-10-11T23:30:00.000Z','2026-10-12T00:30:00.000Z']);
});
test('23:30 and 00:30 JST are two practice days within one UTC date',()=>{
  let s=r.record(r.empty(),id,'remembered',new Date('2026-10-12T14:30:00Z'));
  s=r.record(s,id,'remembered',new Date('2026-10-12T15:30:00Z'));
  assert.equal(r.reviewDays(s.cards[id]),2);
  assert.equal(s.cards[id].due,'2026-10-16T15:30:00.000Z');
});
test('v2 backup merge preserves timestamps and derives a convergent JST schedule',()=>{
  const a={version:2,cards:{[id]:{history:[{at:'2026-10-12T08:30:00+09:00',rating:'remembered'}],due:'2030-01-01T00:00:00Z'}}};
  const b={version:2,cards:{[id]:{history:[{at:'2026-10-12T00:30:00Z',rating:'remembered'}],due:'2020-01-01T00:00:00Z'}}};
  const merged=r.merge(a,b);
  assert.deepEqual(merged,r.merge(b,a));
  assert.deepEqual(merged,r.merge(merged,a));
  assert.equal(merged.version,2); assert.equal(merged.cards[id].history.length,2);
  assert.equal(r.reviewDays(merged.cards[id]),1); assert.equal(merged.cards[id].due,'2026-10-14T00:30:00.000Z');
  assert.equal(merged.cards[id].history[0].at,a.cards[id].history[0].at);
});
test('equal-time conflicting ratings and split backups converge regardless of arrival order',()=>{
  const at='2026-10-12T00:30:00Z';
  const backup=rating=>({version:2,cards:{[id]:{history:[{at,rating}],due:at}}});
  const a=backup('mastered'),b=backup('again'),c=backup('remembered');
  const merged=r.merge(r.merge(a,b),c);
  assert.deepEqual(merged,r.merge(a,r.merge(c,b)));
  assert.deepEqual(merged,r.merge(c,r.merge(b,a)));
  assert.equal(merged.cards[id].history.length,3); assert.equal(r.reviewDays(merged.cards[id]),1);
  assert.equal(merged.cards[id].due,'2026-10-13T00:30:00.000Z');
  assert.equal(merged.cards[id].history.at(-1).rating,'again');
});
test('undated legacy labels remain recoverable without inventing events',()=>{
  const old={version:2,cards:{[id]:{history:[],due:'2030-01-01T00:00:00Z',legacy_rating:'remembered'}}};
  const migrated=r.merge(r.empty(),old);
  assert.deepEqual(migrated.cards[id].history,[]); assert.equal(r.reviewDays(migrated.cards[id]),0);
  assert.equal(migrated.cards[id].legacy_rating,'remembered');
  assert.deepEqual(r.dueIds(migrated,[id],new Date('2026-10-12')),[id]);
  assert.deepEqual(old.cards[id].history,[]);
});
