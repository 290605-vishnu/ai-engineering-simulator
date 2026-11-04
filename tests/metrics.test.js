const test = require('node:test');
const assert = require('node:assert');
const createMetrics = require('../js/engine/metrics');
const tuning = require('../js/engine/tuning');

test('percentile picks nearest-rank values', () => {
  const s = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.strictEqual(createMetrics.percentile(s, 0.5), 50);
  assert.strictEqual(createMetrics.percentile(s, 0.95), 100);
  assert.strictEqual(createMetrics.percentile([], 0.5), 0);
});

test('throughput and cost/min only count the rolling window', () => {
  const m = createMetrics(tuning);
  const req = { type: 'qa', tags: new Set() };
  m.onCost(1, 0);                       // falls out of the 60s window by t=70s
  for (let t = 60000; t < 70000; t += 1000) { m.onDone(req, 100, t); m.onCost(0.5, t); }
  const s = m.snapshot(70000);
  assert.strictEqual(s.throughput, 1);  // 10 completions in the last 10s
  assert.ok(Math.abs(s.costPerMin - 5) < 1e-9); // 10 * 0.5 inside the window, the t=0 cost is gone
  assert.strictEqual(s.costTotal, 6);   // lifetime total keeps everything
});

test('malicious and false-positive accounting', () => {
  const m = createMetrics(tuning);
  m.onSpawn({ type: 'malicious' });
  m.onBlocked({ type: 'malicious' });
  m.onBlocked({ type: 'qa' });
  m.onDone({ type: 'malicious', tags: new Set() }, 100, 1);
  const s = m.snapshot(1000);
  assert.deepStrictEqual(s.malicious, { sent: 1, blocked: 1, breached: 1 });
  assert.strictEqual(s.falsePositives, 1);
  assert.strictEqual(s.blocked, 2);
});
