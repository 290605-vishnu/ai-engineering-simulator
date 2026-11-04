// Behavior of the M4/M5 elements and of the sink's "a real answer is required" rule.
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
const SRC = (cfg) => N('trafficSource', 'src', cfg);
const SINK = () => N('responseSink', 'sink');

function run(nodes, edges, seconds, { seed = 1, chaos } = {}) {
  const sim = createSim({ defs, behaviors, seed });
  sim.setChaos(chaos);
  sim.setGraph(nodes, edges);
  for (let t = 0; t < seconds * 1000; t += tuning.tickMs) sim.step(tuning.tickMs);
  return sim;
}
const stats = (sim, sec = 30) => sim.windowStats(sec * 1000);

// ---- the sink ----
test('wiring the source straight to the sink answers nothing', () => {
  const s = run([SRC({ rate: 10 }), SINK()], [E('src', 'out', 'sink')], 20).snapshot();
  assert.ok(s.sent > 100);
  assert.strictEqual(s.completed, 0);
  assert.ok(s.failReasons.no_answer > 100);
});

// ---- RAG ----
const ragGraph = (topK, withRerank, withEmbed = true) => {
  const nodes = [SRC({ rate: 10, mix: { rag: 1 } })], edges = [];
  let prev = ['src', 'out'];
  const add = (node, port = 'out') => { nodes.push(node); edges.push(E(prev[0], prev[1], node.id)); prev = [node.id, port]; };
  if (withEmbed) add(N('embeddingModel', 'e'));
  add(N('vectorDb', 'v', { topK }));
  if (withRerank) add(N('reranker', 'k', { keep: 4 }));
  add(N('llmSmall', 'm', { concurrency: 32 }));
  nodes.push(SINK()); edges.push(E('m', 'out', 'sink'));
  return [nodes, edges];
};
test('RAG: a model with no retrieval hallucinates most answers', () => {
  const nodes = [SRC({ rate: 10, mix: { rag: 1 } }), N('llmSmall', 'm', { concurrency: 32 }), SINK()];
  const h = stats(run(nodes, [E('src', 'out', 'm'), E('m', 'out', 'sink')], 60)).hallucinationPct;
  assert.ok(h > 80, `hallucination ${h}`);
});
test('RAG: wide retrieval plus reranking brings hallucinations under 5%', () => {
  const h = stats(run(...ragGraph(20, true), 60)).hallucinationPct;
  assert.ok(h < 5, `hallucination ${h}`);
});
test('RAG: wide retrieval without reranking is noisy and still hallucinates', () => {
  const h = stats(run(...ragGraph(20, false), 60)).hallucinationPct;
  assert.ok(h > 15, `hallucination ${h}`);
});
test('RAG: a retriever without an embedding step fails with no_embedding', () => {
  const s = run(...ragGraph(20, true, false), 20).snapshot();
  assert.ok(s.failReasons.no_embedding > 0);
  assert.strictEqual(s.completed, 0);
});

// ---- routing and rate limiting ----
test('complex questions on a small model are answered badly; a router sends them to the large model', () => {
  const traffic = { rate: 6, mix: { analysis: 1 } }; // the large model's capacity is only ~7.6/s on analyses
  const small = run([SRC(traffic), N('llmSmall', 'm', { concurrency: 32 }), SINK()], [E('src', 'out', 'm'), E('m', 'out', 'sink')], 40).snapshot();
  assert.ok(small.failReasons.low_quality > 0);
  const routed = run([SRC(traffic), N('promptRouter', 'rt'), N('llmSmall', 's'), N('llmLarge', 'l', { concurrency: 32 }), SINK()],
    [E('src', 'out', 'rt'), E('rt', 'simple', 's'), E('rt', 'complex', 'l'), E('s', 'out', 'sink'), E('l', 'out', 'sink')], 40).snapshot();
  assert.ok(!routed.failReasons.low_quality);
  assert.ok(routed.completed > 150);
});
test('rate limiter sheds excess with rate_limited, or diverts it when "limited" is wired', () => {
  const base = [SRC({ rate: 20, mix: { qa: 1 } }), N('rateLimiter', 'rl', { limit: 5, burst: 5 }), N('llmSmall', 'm', { concurrency: 32 }), SINK()];
  const shed = run(base, [E('src', 'out', 'rl'), E('rl', 'pass', 'm'), E('m', 'out', 'sink')], 30).snapshot();
  assert.ok(shed.failReasons.rate_limited > 0.6 * shed.sent, `${JSON.stringify(shed.failReasons)}`);
  const diverted = run([...base, N('llmSmall', 'm2', { concurrency: 32 })],
    [E('src', 'out', 'rl'), E('rl', 'pass', 'm'), E('rl', 'limited', 'm2'), E('m', 'out', 'sink'), E('m2', 'out', 'sink')], 30).snapshot();
  assert.ok(!diverted.failReasons.rate_limited);
});

// ---- tools ----
const toolTraffic = { rate: 10, mix: { tool_call: 1 } };
test('tool calls: LLM -> Plugin -> LLM works; skipping the tool does not', () => {
  const good = run([SRC(toolTraffic), N('llmSmall', 'a', { concurrency: 32 }), N('plugin', 'p'), N('llmSmall', 'b', { concurrency: 32 }), SINK()],
    [E('src', 'out', 'a'), E('a', 'out', 'p'), E('p', 'out', 'b'), E('b', 'out', 'sink')], 40);
  assert.ok(stats(good).successPct > 88);
  const noTool = run([SRC(toolTraffic), N('llmSmall', 'a', { concurrency: 32 }), N('llmSmall', 'b', { concurrency: 32 }), SINK()],
    [E('src', 'out', 'a'), E('a', 'out', 'b'), E('b', 'out', 'sink')], 20).snapshot();
  assert.ok(noTool.failReasons.tool_result_missing > 0);
  const oneModel = run([SRC(toolTraffic), N('llmSmall', 'a', { concurrency: 32 }), SINK()], [E('src', 'out', 'a'), E('a', 'out', 'sink')], 20).snapshot();
  assert.ok(oneModel.failReasons.no_answer > 0);
});
test('a skill makes tool calls reliable; connector retries absorb a flaky API', () => {
  const chain = (skill, retries) => {
    const nodes = [SRC(toolTraffic)], edges = []; let prev = 'src';
    const add = (n) => { nodes.push(n); edges.push(E(prev, 'out', n.id)); prev = n.id; };
    if (skill) add(N('skill', 'sk'));
    add(N('llmSmall', 'a', { concurrency: 32 })); add(N('toolExecutor', 'x')); add(N('connector', 'c', { retries }));
    add(N('llmSmall', 'b', { concurrency: 32 })); nodes.push(SINK()); edges.push(E('b', 'out', 'sink'));
    return stats(run(nodes, edges, 60)).successPct;
  };
  assert.ok(chain(true, 3) > 92);
  assert.ok(chain(false, 0) < 60);
});

// ---- resilience ----
test('provider errors are retried by Fallback / Retry', () => {
  const graph = (retries) => [[SRC({ rate: 10, mix: { qa: 1 } }), N('fallbackRetry', 'f', { retries, backoffMs: 200 }), N('llmSmall', 'm', { concurrency: 16 }), SINK()],
    [E('src', 'out', 'f'), E('f', 'out', 'm'), E('m', 'out', 'sink')]];
  const chaos = { llmSmall: 0.2 };
  assert.ok(stats(run(...graph(0), 60, { chaos })).successPct < 85);
  assert.ok(stats(run(...graph(3), 60, { chaos })).successPct > 99);
});
test('after retries run out, the fallback path takes over', () => {
  const nodes = [SRC({ rate: 10, mix: { qa: 1 } }), N('fallbackRetry', 'f', { retries: 0 }), N('llmSmall', 'm'), N('llmLarge', 'big', { concurrency: 16 }), SINK()];
  const edges = [E('src', 'out', 'f'), E('f', 'out', 'm'), E('f', 'fallback', 'big'), E('m', 'out', 'sink'), E('big', 'out', 'sink')];
  const sim = run(nodes, edges, 40, { chaos: { llmSmall: 0.5 } });
  assert.ok(stats(sim).successPct > 98);
  assert.ok(sim.nodes.get('big').stats.processed > 0);
});
test('a request that loops forever is stopped by the loop guard', () => {
  const s = run([SRC({ rate: 5, mix: { qa: 1 } }), N('llmSmall', 'm'), SINK()], [E('src', 'out', 'm'), E('m', 'out', 'm')], 20).snapshot();
  assert.ok(s.failReasons.loop_detected > 0 || s.failReasons.no_route > 0 || s.failReasons.timeout > 0);
  assert.strictEqual(s.completed, 0);
});
test('the budget gate diverts to its "over" path once spend exceeds the budget', () => {
  const nodes = [SRC({ rate: 20, mix: { qa: 1 } }), N('budgetGate', 'g', { budget: 0.005 }), N('llmLarge', 'big', { concurrency: 32 }), N('llmSmall', 'cheap', { concurrency: 32 }), SINK()];
  const edges = [E('src', 'out', 'g'), E('g', 'ok', 'big'), E('g', 'over', 'cheap'), E('big', 'out', 'sink'), E('cheap', 'out', 'sink')];
  const sim = run(nodes, edges, 40);
  assert.ok(sim.nodes.get('cheap').stats.processed > 0);
  assert.ok(sim.nodes.get('big').stats.processed > 0); // before the budget was exceeded
});

// ---- quality ----
test('an eval judge plus a human reviewer catch most wrong answers', () => {
  const traffic = { rate: 8, mix: { rag: 1 } };
  const bare = stats(run([SRC(traffic), N('llmSmall', 'm', { concurrency: 32 }), SINK()], [E('src', 'out', 'm'), E('m', 'out', 'sink')], 60)).hallucinationPct;
  const nodes = [SRC(traffic), N('llmSmall', 'm', { concurrency: 32 }), N('evalJudge', 'j'), N('humanInLoop', 'h', { reviewers: 10 }), SINK()];
  const edges = [E('src', 'out', 'm'), E('m', 'out', 'j'), E('j', 'pass', 'sink'), E('j', 'reject', 'h'), E('h', 'out', 'sink')];
  const judged = stats(run(nodes, edges, 80)).hallucinationPct;
  assert.ok(judged < bare / 4, `bare ${bare} judged ${judged}`);
});
test('a fine-tuned model is good on its specialty and unreliable elsewhere', () => {
  const g = (specialty) => [[SRC({ rate: 10, mix: { analysis: 1 } }), N('fineTunedModel', 'm', { specialty, concurrency: 32 }), SINK()], [E('src', 'out', 'm'), E('m', 'out', 'sink')]];
  assert.ok(stats(run(...g('analysis'), 40)).successPct > 99);
  assert.ok(stats(run(...g('qa'), 40)).successPct < 80);
});

// ---- cost ----
test('batch processor answers reports at half the large-model price, after the batch window', () => {
  const traffic = { rate: 4, mix: { report: 1 } };
  const batch = run([SRC(traffic), N('batchProcessor', 'b'), SINK()], [E('src', 'out', 'b'), E('b', 'out', 'sink')], 60);
  const large = run([SRC(traffic), N('llmLarge', 'l', { concurrency: 32 }), SINK()], [E('src', 'out', 'l'), E('l', 'out', 'sink')], 60);
  assert.ok(stats(batch).successPct > 99);
  assert.ok(batch.snapshot().costTotal < 0.6 * large.snapshot().costTotal);
  assert.ok(batch.snapshot().p50 > 2000); // waits for the next window
});
test('a memory store shortens prompts and lowers cost', () => {
  const g = (mem) => { const nodes = [SRC({ rate: 10, mix: { qa: 1 } })], edges = []; let prev = 'src';
    if (mem) { nodes.push(N('memoryStore', 'mem')); edges.push(E('src', 'out', 'mem')); prev = 'mem'; }
    nodes.push(N('llmSmall', 'm', { concurrency: 16 }), SINK()); edges.push(E(prev, 'out', 'm'), E('m', 'out', 'sink')); return [nodes, edges]; };
  const without = run(...g(false), 30).snapshot().costTotal, withMem = run(...g(true), 30).snapshot().costTotal;
  assert.ok(withMem < without);
});
test('the observability tap passes traffic through and records what it sees', () => {
  const sim = run([SRC({ rate: 10, mix: { qa: 1 } }), N('observabilityTap', 't'), N('llmSmall', 'm', { concurrency: 16 }), SINK()],
    [E('src', 'out', 't'), E('t', 'out', 'm'), E('m', 'out', 'sink')], 20);
  assert.ok(sim.snapshot().completed > 100);
  assert.ok(sim.nodes.get('t').state.seen.length > 20);
});

// ---- agents ----
const agentGraph = (worker, maxSteps) => [[SRC({ rate: 4, mix: { agent_task: 1 } }), N('agentOrchestrator', 'o', { maxSteps }), worker, SINK()],
  [E('src', 'out', 'o'), E('o', 'step', 'w'), E('w', 'out', 'o'), E('o', 'done', 'sink')]];
test('an agent loop finishes tasks within the step budget only if each call does enough', () => {
  const sub = stats(run(...agentGraph(N('subAgent', 'w', { concurrency: 32 }), 4), 60)).successPct;
  assert.ok(sub > 95, `sub-agent ${sub}`);
  const plain = run(...agentGraph(N('llmSmall', 'w', { concurrency: 32 }), 4), 60).snapshot();
  assert.ok(plain.failReasons.step_budget > 0);
  assert.ok(stats(run(...agentGraph(N('llmSmall', 'w', { concurrency: 32 }), 4), 60)).successPct < 60);
});
