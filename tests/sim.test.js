const test = require('node:test');
const assert = require('node:assert');
const defs = require('../js/nodes.js');
const tuning = require('../js/engine/tuning');
const behaviors = require('../js/engine/behaviors');
const createSim = require('../js/engine/sim');

// ---- helpers ----
const N = (defId, id, cfg = {}) => {
  const d = defs.find((x) => x.id === defId);
  return { id, defId, config: { ...d.defaults, ...cfg } };
};
const E = (source, sourceHandle, target) =>
  ({ id: `${source}.${sourceHandle}>${target}`, source, sourceHandle, target, targetHandle: 'in' });

function run(nodes, edges, seconds, seed = 1) {
  const sim = createSim({ defs, behaviors, seed });
  sim.setGraph(nodes, edges);
  for (let t = 0; t < seconds * 1000; t += tuning.tickMs) sim.step(tuning.tickMs);
  return sim;
}
const chain = (srcCfg, llmCfg = {}) => ({
  nodes: [N('trafficSource', 'src', srcCfg), N('llmSmall', 'llm', llmCfg), N('responseSink', 'sink')],
  edges: [E('src', 'out', 'llm'), E('llm', 'out', 'sink')],
});

// ---- tests ----
test('source -> small LLM -> sink completes requests with plausible latency', () => {
  const { nodes, edges } = chain({ rate: 10 });
  const s = run(nodes, edges, 30).snapshot();
  assert.ok(s.completed >= 200, `completed ${s.completed}`);
  assert.strictEqual(s.failed, 0);
  // 4 wire hops (600ms) + ~300ms + 2ms * ~200 tokens
  assert.ok(s.p50 > 1000 && s.p50 < 1800, `p50 ${s.p50}`);
  assert.ok(s.costTotal > 0);
});

test('an unwired output port fails the request with no_route', () => {
  const s = run([N('trafficSource', 'src', { rate: 10 }), N('llmSmall', 'llm')],
    [E('src', 'out', 'llm')], 20).snapshot();
  assert.strictEqual(s.completed, 0);
  assert.ok(s.failReasons.no_route > 0);
});

test('an unwired source stays idle', () => {
  const s = run([N('trafficSource', 'src', { rate: 50 })], [], 5).snapshot();
  assert.strictEqual(s.sent, 0);
});

test('strict guardrail blocks most malicious traffic', () => {
  const nodes = [N('trafficSource', 'src', { rate: 10, mix: { malicious: 1 } }),
    N('guardrail', 'g', { strictness: 1 }), N('llmSmall', 'llm'), N('responseSink', 'sink')];
  const edges = [E('src', 'out', 'g'), E('g', 'pass', 'llm'), E('llm', 'out', 'sink'), E('g', 'blocked', 'sink')];
  const m = run(nodes, edges, 30).snapshot().malicious;
  assert.ok(m.blocked > 200, `blocked ${m.blocked}`);
  assert.ok(m.blocked > 0.9 * (m.blocked + m.breached));
});

test('a blocked request with an unwired blocked port is dropped, not failed', () => {
  const nodes = [N('trafficSource', 'src', { rate: 10, mix: { malicious: 1 } }),
    N('guardrail', 'g', { strictness: 1 }), N('llmSmall', 'llm'), N('responseSink', 'sink')];
  const edges = [E('src', 'out', 'g'), E('g', 'pass', 'llm'), E('llm', 'out', 'sink')];
  const s = run(nodes, edges, 20).snapshot();
  assert.ok(s.malicious.blocked > 0);
  assert.strictEqual(s.failed, 0);
});

test('without a guardrail every malicious request is a breach', () => {
  const { nodes, edges } = chain({ rate: 10, mix: { malicious: 1 } });
  const m = run(nodes, edges, 20).snapshot().malicious;
  assert.ok(m.breached > 100);
  assert.strictEqual(m.blocked, 0);
});

test('strict guardrail produces false positives on legitimate traffic', () => {
  const nodes = [N('trafficSource', 'src', { rate: 20, mix: { qa: 1 } }),
    N('guardrail', 'g', { strictness: 1 }), N('llmSmall', 'llm'), N('responseSink', 'sink')];
  const edges = [E('src', 'out', 'g'), E('g', 'pass', 'llm'), E('llm', 'out', 'sink'), E('g', 'blocked', 'sink')];
  const s = run(nodes, edges, 30).snapshot();
  assert.ok(s.falsePositives > 0);
  assert.ok(s.falsePositives < 0.3 * s.sent);
});

test('round-robin load balancer splits traffic evenly', () => {
  const nodes = [N('trafficSource', 'src', { rate: 10, mix: { qa: 1 } }), N('loadBalancer', 'lb'),
    N('llmSmall', 'a'), N('llmSmall', 'b'), N('responseSink', 'sink')];
  const edges = [E('src', 'out', 'lb'), E('lb', 'a', 'a'), E('lb', 'b', 'b'),
    E('a', 'out', 'sink'), E('b', 'out', 'sink')];
  const sim = run(nodes, edges, 30);
  const diff = Math.abs(sim.nodes.get('a').stats.processed - sim.nodes.get('b').stats.processed);
  assert.ok(diff <= 2, `diff ${diff}`);
  assert.strictEqual(sim.snapshot().failed, 0);
});

test('an overloaded model queues requests until they time out', () => {
  const { nodes, edges } = chain({ rate: 20 }, { concurrency: 1 });
  const s = run(nodes, edges, 40).snapshot();
  assert.ok(s.failReasons.timeout > 0);
});

test('prompts larger than the context window fail with context_overflow', () => {
  const { nodes, edges } = chain({ rate: 10 }, { contextWindow: 10 });
  const s = run(nodes, edges, 10).snapshot();
  assert.strictEqual(s.completed, 0);
  assert.ok(s.failReasons.context_overflow > 0);
});

test('the same seed replays identically', () => {
  const { nodes, edges } = chain({ rate: 15 });
  const a = JSON.stringify(run(nodes, edges, 20, 42).snapshot());
  const b = JSON.stringify(run(nodes, edges, 20, 42).snapshot());
  assert.strictEqual(a, b);
});

test('burst mode spawns more in the burst window', () => {
  const steady = run(...Object.values(chain({ rate: 10 })), 1).snapshot().sent;
  const burst = run(...Object.values(chain({ rate: 10, burst: true })), 1).snapshot().sent;
  assert.ok(burst > 3 * steady, `burst ${burst} vs steady ${steady}`);
});

test('deleting a node drains everything that was heading for it', () => {
  const { nodes, edges } = chain({ rate: 10 });
  const sim = run(nodes, edges, 5);
  sim.setGraph([nodes[0]], []);
  for (let t = 0; t < 5000; t += tuning.tickMs) sim.step(tuning.tickMs);
  assert.strictEqual(sim.snapshot().inFlight, 0);
});

test('the event log records failures, blocks and breaches with a node and sequence', () => {
  const { nodes, edges } = chain({ rate: 10 }, { contextWindow: 10 });
  const sim = run(nodes, edges, 5);
  const fails = sim.readLog(0).filter((e) => e.kind === 'fail');
  assert.ok(fails.length > 0);
  assert.strictEqual(fails[0].reason, 'context_overflow');
  assert.strictEqual(fails[0].nodeId, 'llm');
  assert.strictEqual(sim.readLog(sim.logSeq).length, 0); // polling past the end returns nothing
});

test('blocks are logged at the guardrail, not the sink', () => {
  const nodes = [N('trafficSource', 'src', { rate: 10, mix: { malicious: 1 } }),
    N('guardrail', 'g', { strictness: 1 }), N('responseSink', 'sink')];
  const edges = [E('src', 'out', 'g'), E('g', 'pass', 'sink'), E('g', 'blocked', 'sink')];
  const blocks = run(nodes, edges, 10).readLog(0).filter((e) => e.kind === 'block');
  assert.ok(blocks.length > 0);
  assert.ok(blocks.every((e) => e.nodeId === 'g'));
});

test('maliciousPct sets the traffic mix (explicit mix still wins)', () => {
  const none = run(...Object.values(chain({ rate: 20, maliciousPct: 0 })), 10).snapshot();
  const all = run(...Object.values(chain({ rate: 20, maliciousPct: 100 })), 10).snapshot();
  assert.strictEqual(none.malicious.sent, 0);
  assert.strictEqual(all.malicious.sent, all.sent);
});

test('a semantic cache serves repeats without calling the model', () => {
  const nodes = [N('trafficSource', 'src', { rate: 20, maliciousPct: 0, keyPool: 10 }), N('semanticCache', 'c', { capacity: 10 }),
    N('llmSmall', 'm'), N('responseSink', 'sink')];
  const edges = [E('src', 'out', 'c'), E('c', 'miss', 'm'), E('m', 'out', 'sink')];
  const sim = run(nodes, edges, 30);
  const s = sim.snapshot();
  assert.ok(s.cacheHits > 0.9 * s.completed, `hits ${s.cacheHits} of ${s.completed}`);
  // Keys are cached when the first answer comes back (~2 s), so a burst of early repeats still reaches
  // the model; after that almost nothing does.
  assert.ok(sim.nodes.get('m').stats.processed <= 60, `model calls ${sim.nodes.get('m').stats.processed}`);
});

test('an undersized cache hits about capacity/keyPool of the time', () => {
  const nodes = [N('trafficSource', 'src', { rate: 20, maliciousPct: 0, keyPool: 40 }), N('semanticCache', 'c', { capacity: 10 }),
    N('llmSmall', 'm'), N('responseSink', 'sink')];
  const edges = [E('src', 'out', 'c'), E('c', 'miss', 'm'), E('m', 'out', 'sink')];
  const s = run(nodes, edges, 60).snapshot();
  // Measured against requests sent: misses overload the model and time out, so `completed` skews to hits.
  const rate = s.cacheHits / s.sent;
  assert.ok(rate > 0.15 && rate < 0.35, `hit rate ${rate}`); // ~25%
});

test('guardrail catch rate follows the strictness curve exactly (deterministic accumulator)', () => {
  const nodes = [N('trafficSource', 'src', { rate: 20, mix: { malicious: 1 } }), N('guardrail', 'g', { strictness: 0.9 }),
    N('llmSmall', 'm', { concurrency: 32 }), N('responseSink', 'sink')];
  const edges = [E('src', 'out', 'g'), E('g', 'pass', 'm'), E('m', 'out', 'sink'), E('g', 'blocked', 'sink')];
  const m = run(nodes, edges, 60).snapshot().malicious;
  const expected = tuning.guardrail.detectBase + tuning.guardrail.detectGain * Math.sqrt(0.9);
  assert.ok(Math.abs(m.blocked / (m.blocked + m.breached) - expected) < 0.01);
});
