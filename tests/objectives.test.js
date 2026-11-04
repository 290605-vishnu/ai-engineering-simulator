const test = require('node:test');
const assert = require('node:assert');
const O = require('../js/engine/objectives');
const createMetrics = require('../js/engine/metrics');
const tuning = require('../js/engine/tuning');
const defs = require('../js/nodes.js');
const LEVELS = require('../js/campaign/levels');

const objs = [
  { metric: 'throughput', op: '>=', value: 10, window: 10, label: 'a' },
  { metric: 'costPerMin', op: '<=', value: 1, window: 10, star: 2, label: 'b' },
  { metric: 'p95Latency', op: '<=', value: 500, window: 10, star: 3, label: 'c' },
];
const statsOf = (s) => () => ({ throughput: 12, costPerMin: 0.5, p95Latency: 400, ...s });

test('stars are awarded in tiers', () => {
  const run = (s) => { const r = O.evaluate(objs, statsOf(s), 20000); return O.stars(objs, r); };
  assert.strictEqual(run({}), 3);
  assert.strictEqual(run({ p95Latency: 900 }), 2);
  assert.strictEqual(run({ costPerMin: 2, p95Latency: 100 }), 1); // star 3 needs star 2 first
  assert.strictEqual(run({ throughput: 3 }), 0);
});

test('an objective is never met while the window is still warming up or the value is unknown', () => {
  const warm = O.evaluate(objs, statsOf({}), 5000);   // only 5s of a 10s window
  assert.ok(warm.every((r) => r.warming && !r.met));
  const unknown = O.evaluate(objs, statsOf({ throughput: null }), 20000);
  assert.strictEqual(unknown[0].met, false);
});

test('every shipped level passes the validator', () => {
  const ids = defs.map((d) => d.id);
  LEVELS.forEach((l) => assert.deepStrictEqual(O.validateScenario(l, ids), []));
});

test('the validator catches bad scenarios', () => {
  const ids = defs.map((d) => d.id);
  const bad = JSON.parse(JSON.stringify(LEVELS[0]));
  bad.objectives[0].metric = 'vibes';
  bad.unlocks.push('flux');
  bad.objectives.push({ metric: 'costPerMin', op: '<=', value: 1, window: 500, star: 2, label: 'too long' });
  const errors = O.validateScenario(bad, ids).join('\n');
  assert.match(errors, /unknown metric "vibes"/);
  assert.match(errors, /unknown element "flux"/);
  assert.match(errors, /star is unreachable/);
});

test('windowStats only looks at the trailing window', () => {
  const m = createMetrics(tuning);
  const req = { type: 'qa', tags: new Set() };
  for (let t = 0; t < 60000; t += 100) m.onDone(req, t < 30000 ? 5000 : 100, t); // slow first half, fast second
  const w = m.windowStats(60000, 20000);
  assert.strictEqual(w.p95Latency, 100);
  assert.ok(Math.abs(w.throughput - 10) < 0.2);
});

test('ratio metrics are unknown (null) with too few samples, and timeouts count in the false-positive denominator', () => {
  const m = createMetrics(tuning);
  m.onBlocked({ type: 'qa', tags: new Set() }, 1000);
  assert.strictEqual(m.windowStats(2000, 5000).falsePositivePct, null);
  for (let i = 0; i < 9; i++) m.onFail({ type: 'qa', tags: new Set() }, 'timeout', 1000 + i);
  const w = m.windowStats(2000, 5000);
  assert.ok(Math.abs(w.falsePositivePct - 10) < 1e-9); // 1 blocked / (1 blocked + 9 failed), not 100%
});
