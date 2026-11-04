// Known solutions per level, as plain data so both `node --test` and a browser console can run them.
// A graph is { nodes: [[defId, id, configOverrides]], edges: [[source, port, target]] }.
// `stars` is what each solution should earn once it has settled. `fails` must NOT pass their level.
// Levels that ship a pre-built pipeline also have it tested "exactly as given" (see levels.test.js).
const src = ['trafficSource', 'src'], sink = ['responseSink', 'sink'];

// Tiny edge DSL: 'a>b' = a.out -> b ; 'a.port>b' = a.port -> b.
const W = (...specs) => specs.map((s) => { const [l, t] = s.split('>'); const [a, p] = l.split('.'); return [a, p || 'out', t]; });
const small = (cfg = {}, id = 'm') => ['llmSmall', id, cfg];
const large = (cfg = {}, id = 'l') => ['llmLarge', id, cfg];
const direct = { name: 'source wired straight to the sink', nodes: [src, sink], edges: W('src>sink') };
const empty = { name: 'nothing wired', nodes: [src, sink], edges: [] };
const one = (model) => ({ nodes: [src, model, sink], edges: W(`src>${model[1]}`, `${model[1]}>sink`) });

// Reusable pipelines
const guardrailLlm = (strictness, conc) => ({ nodes: [src, ['guardrail', 'g', { strictness }], small({ concurrency: conc }), sink],
  edges: W('src>g', 'g.pass>m', 'm>sink', 'g.blocked>sink') });
const ragChain = (topK, rerank, conc = 16) => ({
  nodes: [src, ['embeddingModel', 'e'], ['vectorDb', 'r', { topK }], ...(rerank ? [['reranker', 'k', { keep: 4 }]] : []), small({ concurrency: conc }), sink],
  edges: rerank ? W('src>e', 'e>r', 'r>k', 'k>m', 'm>sink') : W('src>e', 'e>r', 'r>m', 'm>sink') });
// guardrail -> retry -> router with the four paths (and optionally a load-balanced simple path)
const prod = (extra = {}) => ({
  nodes: [src, ['guardrail', 'g', { strictness: 0.9 }], ['fallbackRetry', 'f', { retries: 2, backoffMs: 300, timeoutMs: 6000 }], ['promptRouter', 'rt'],
    ...(extra.lb ? [['loadBalancer', 'lb'], small({ concurrency: 16 }, 's1'), small({ concurrency: 16 }, 's2')] : [small({ concurrency: 16 }, 's')]),
    large({ concurrency: extra.lbig || 16 }), ['embeddingModel', 'e'], ['vectorDb', 'v', { topK: 20 }], ['reranker', 'k', { keep: 4 }], small({ concurrency: 16 }, 'rs'),
    ['batchProcessor', 'b'], sink],
  edges: W('src>g', 'g.pass>f', 'g.blocked>sink', 'f>rt', 'rt.complex>l', 'rt.rag>e', 'rt.batch>b', 'e>v', 'v>k', 'k>rs',
    ...(extra.lb ? ['rt.simple>lb', 'lb.a>s1', 'lb.b>s2', 's1>sink', 's2>sink'] : ['rt.simple>s', 's>sink']), 'l>sink', 'rs>sink', 'b>sink') });
// level 21's repaired pipeline has no complex or batch path
const prodNoLargeNoBatch = () => {
  const p = prod();
  const drop = ['l', 'b'];
  p.nodes = p.nodes.filter((n) => !drop.includes(n[1]));
  p.edges = p.edges.filter((e) => !drop.includes(e[0]) && !drop.includes(e[2]));
  return p;
};

module.exports = {
  1: [{ name: 'small model', stars: 3, ...one(small()) }],
  2: [{ name: 'small model at concurrency 16', stars: 3, ...one(small({ concurrency: 16 })) }],
  3: [{ name: 'large model at concurrency 12', stars: 3, ...one(large({ concurrency: 12 }, 'm')) }],
  4: [{ name: 'small model at concurrency 16', stars: 3, ...one(small({ concurrency: 16 })) }],
  5: [{ name: 'balancer + 2 small @ concurrency 32', stars: 3,
    nodes: [src, ['loadBalancer', 'lb'], small({ concurrency: 32 }, 'a'), small({ concurrency: 32 }, 'b'), sink],
    edges: W('src>lb', 'lb.a>a', 'lb.b>b', 'a>sink', 'b>sink') }],
  6: [{ name: 'guardrail at 0.9', stars: 3, ...guardrailLlm(0.9, 12) },
    { name: 'guardrail at 0.85, default concurrency (no star 3)', stars: 2, ...guardrailLlm(0.85, 8) }],
  7: [{ name: 'cache of 40', stars: 3, nodes: [src, ['semanticCache', 'c', { capacity: 40 }], small(), sink], edges: W('src>c', 'c.miss>m', 'm>sink') }],
  8: [{ name: 'limiter(40) + one small', stars: 2, nodes: [src, ['rateLimiter', 'rl', { limit: 40, burst: 20 }], small({ concurrency: 32 }), sink], edges: W('src>rl', 'rl.pass>m', 'm>sink') },
    { name: 'limiter(110) + balancer + 3 small', stars: 3,
      nodes: [src, ['rateLimiter', 'rl', { limit: 110, burst: 30 }], ['loadBalancer', 'lb'], small({ concurrency: 32 }, 'a'), small({ concurrency: 32 }, 'b'), small({ concurrency: 32 }, 'c'), sink],
      edges: W('src>rl', 'rl.pass>lb', 'lb.a>a', 'lb.b>b', 'lb.c>c', 'a>sink', 'b>sink', 'c>sink') }],
  9: [{ name: 'router: simple -> small, complex -> large', stars: 3,
    nodes: [src, ['promptRouter', 'rt'], small({ concurrency: 16 }, 's'), large({ concurrency: 32 }), sink],
    edges: W('src>rt', 'rt.simple>s', 'rt.complex>l', 's>sink', 'l>sink') }],
  10: [{ name: 'fine-tuned analysis specialist', stars: 3, ...one(['fineTunedModel', 'm', { specialty: 'analysis', concurrency: 24 }]) }],
  11: [{ name: 'embedding -> retriever(20) -> reranker(4) -> small(16)', stars: 3, ...ragChain(20, true) }],
  12: [{ name: 'memory store + small @ 24', stars: 3, nodes: [src, ['memoryStore', 'mem'], small({ concurrency: 24 }), sink], edges: W('src>mem', 'mem>m', 'm>sink') }],
  13: [{ name: 'skill + executor + connector(3) + two models', stars: 2,
    nodes: [src, ['skill', 'sk'], small({ concurrency: 16 }, 'a'), ['toolExecutor', 'x'], ['connector', 'c', { retries: 3 }], small({ concurrency: 16 }, 'b'), sink],
    edges: W('src>sk', 'sk>a', 'a>x', 'x>c', 'c>b', 'b>sink') },
  { name: 'plugin bundle + two models', stars: 3,
    nodes: [src, small({ concurrency: 16 }, 'a'), ['plugin', 'p'], small({ concurrency: 16 }, 'b'), sink], edges: W('src>a', 'a>p', 'p>b', 'b>sink') }],
  14: [{ name: 'retry(3) + balancer + 3 small @ 32', stars: 3,
    nodes: [src, ['fallbackRetry', 'f', { retries: 3, backoffMs: 200, timeoutMs: 5000 }], ['loadBalancer', 'lb'],
      small({ concurrency: 32 }, 'a'), small({ concurrency: 32 }, 'b'), small({ concurrency: 32 }, 'c'), sink],
    edges: W('src>f', 'f>lb', 'lb.a>a', 'lb.b>b', 'lb.c>c', 'a>sink', 'b>sink', 'c>sink') }],
  15: [{ name: 'router: simple -> small, batch -> batch processor', stars: 3,
    nodes: [src, ['promptRouter', 'rt'], small({ concurrency: 16 }, 's'), ['batchProcessor', 'b'], sink],
    edges: W('src>rt', 'rt.simple>s', 'rt.batch>b', 's>sink', 'b>sink') }],
  16: [{ name: 'budget gate: ok -> large, over -> small', stars: 3,
    nodes: [src, ['budgetGate', 'bg', { budget: 0.25 }], large({ concurrency: 24 }), small({ concurrency: 16 }, 's'), sink],
    edges: W('src>bg', 'bg.ok>l', 'bg.over>s', 'l>sink', 's>sink') }],
  17: [{ name: 'small -> judge -> (reject) large', stars: 3,
    nodes: [src, small({ concurrency: 16 }, 's'), ['evalJudge', 'j'], large({ concurrency: 16 }), sink],
    edges: W('src>s', 's>j', 'j.pass>sink', 'j.reject>l', 'l>sink') }],
  18: [{ name: 'retrieval chain -> judge -> (reject) humans', stars: 3,
    nodes: [src, ['embeddingModel', 'e'], ['vectorDb', 'r', { topK: 20 }], ['reranker', 'k', { keep: 4 }], small({ concurrency: 16 }), ['evalJudge', 'j'], ['humanInLoop', 'h', { reviewers: 5 }], sink],
    edges: W('src>e', 'e>r', 'r>k', 'k>m', 'm>j', 'j.pass>sink', 'j.reject>h', 'h>sink') }],
  19: [{ name: 'retry(1) -> small, fallback -> large', stars: 3,
    nodes: [src, ['fallbackRetry', 'f', { retries: 1, backoffMs: 100, timeoutMs: 5000 }], small({ concurrency: 16 }, 's'), large({ concurrency: 16 }), sink],
    edges: W('src>f', 'f>s', 'f.fallback>l', 's>sink', 'l>sink') },
  { name: 'retry(2) -> small, fallback -> large (slower: no star 3)', stars: 2,
    nodes: [src, ['fallbackRetry', 'f', { retries: 2, backoffMs: 100, timeoutMs: 5000 }], small({ concurrency: 16 }, 's'), large({ concurrency: 16 }), sink],
    edges: W('src>f', 'f>s', 'f.fallback>l', 's>sink', 'l>sink') }],
  20: [{ name: 'orchestrator loop with a sub-agent', stars: 3,
    nodes: [src, ['memoryStore', 'mem'], ['agentOrchestrator', 'o'], ['subAgent', 'w', { concurrency: 16 }], sink],
    edges: W('src>mem', 'mem>o', 'o.step>w', 'w>o', 'o.done>sink') }],
  21: [{ name: 'the inherited pipeline, repaired', stars: 3, ...prodNoLargeNoBatch() }],
  22: [{ name: 'guardrail -> retry -> router with every path', stars: 3, ...prod() }],
  23: [{ name: 'the rescue pipeline, repaired', stars: 3, ...prod() }],
  24: [{ name: 'guardrail -> cache -> router: small / fine-tuned specialist', stars: 3,
    nodes: [src, ['guardrail', 'g', { strictness: 0.9 }], ['semanticCache', 'c', { capacity: 40 }], ['promptRouter', 'rt'], small({ concurrency: 16 }, 's'),
      ['fineTunedModel', 'ft', { specialty: 'analysis', concurrency: 16 }], sink],
    edges: W('src>g', 'g.pass>c', 'g.blocked>sink', 'c.miss>rt', 'rt.simple>s', 'rt.complex>ft', 's>sink', 'ft>sink') }],
  25: [{ name: 'production pipeline with a load-balanced simple path', stars: 3, ...prod({ lb: true, lbig: 32 }) }],
  26: [{ name: 'every path: simple, complex, rag, batch, tool, agent', stars: 3,
    nodes: [src, ['guardrail', 'g', { strictness: 0.9 }], ['fallbackRetry', 'f', { retries: 2, backoffMs: 300, timeoutMs: 6000 }], ['promptRouter', 'rt'],
      small({ concurrency: 16 }, 's'), large({ concurrency: 16 }), ['embeddingModel', 'e'], ['vectorDb', 'v', { topK: 20 }], ['reranker', 'k', { keep: 4 }], small({ concurrency: 16 }, 'rs'),
      ['batchProcessor', 'b'], small({ concurrency: 16 }, 't1'), ['plugin', 'p'], small({ concurrency: 16 }, 't2'),
      ['agentOrchestrator', 'o'], ['subAgent', 'w', { concurrency: 16 }], sink],
    edges: W('src>g', 'g.pass>f', 'g.blocked>sink', 'f>rt', 'rt.simple>s', 'rt.complex>l', 'rt.rag>e', 'rt.batch>b', 'rt.tool>t1', 'rt.agent>o',
      'e>v', 'v>k', 'k>rs', 't1>p', 'p>t2', 'o.step>w', 'w>o', 'o.done>sink', 's>sink', 'l>sink', 'rs>sink', 'b>sink', 't2>sink') }],

  // Graphs that must NOT pass their level. Every level also rejects "nothing wired" and the shortcut.
  fails: {
    1: [empty, direct, { name: 'large model at default concurrency', ...one(large({}, 'm')) }],
    2: [empty, direct, { name: 'small model at default concurrency', ...one(small()) }],
    3: [empty, direct, { name: 'small model (poor analyses)', ...one(small({ concurrency: 16 })) }, { name: 'large model at default concurrency', ...one(large({}, 'm')) }],
    4: [empty, direct, { name: 'large model (too expensive)', ...one(large({ concurrency: 32 }, 'm')) }],
    5: [empty, direct, { name: 'one small even at max concurrency', ...one(small({ concurrency: 32 })) },
      { name: 'balancer with two small at default concurrency', nodes: [src, ['loadBalancer', 'lb'], small({}, 'a'), small({}, 'b'), sink], edges: W('src>lb', 'lb.a>a', 'lb.b>b', 'a>sink', 'b>sink') }],
    6: [empty, direct, { name: 'no guardrail', ...one(small()) },
      { name: 'guardrail but no model (everything unanswered)', nodes: [src, ['guardrail', 'g', { strictness: 0.9 }], sink], edges: W('src>g', 'g.pass>sink', 'g.blocked>sink') },
      { name: 'paranoid guardrail at 1.0', ...guardrailLlm(1, 8) }],
    7: [empty, direct, { name: 'default cache capacity (8 of 40 prompts)', nodes: [src, ['semanticCache', 'c'], small(), sink], edges: W('src>c', 'c.miss>m', 'm>sink') },
      { name: 'cache whose misses skip the model', nodes: [src, ['semanticCache', 'c', { capacity: 40 }], sink], edges: W('src>c', 'c.miss>sink') }],
    8: [empty, direct, { name: 'no limiter, balancer and 3 small', nodes: [src, ['loadBalancer', 'lb'], small({ concurrency: 32 }, 'a'), small({ concurrency: 32 }, 'b'), small({ concurrency: 32 }, 'c'), sink],
      edges: W('src>lb', 'lb.a>a', 'lb.b>b', 'lb.c>c', 'a>sink', 'b>sink', 'c>sink') },
      { name: 'no limiter, one small', ...one(small({ concurrency: 32 })) }],
    9: [empty, direct, { name: 'everything on the small model', ...one(small({ concurrency: 32 })) }, { name: 'everything on the large model', ...one(large({ concurrency: 32 }, 'm')) }],
    10: [empty, direct, { name: 'large model (too expensive)', ...one(large({ concurrency: 32 }, 'm')) }, { name: 'small model (poor analyses)', ...one(small({ concurrency: 32 })) },
      { name: 'specialist with the wrong specialty', ...one(['fineTunedModel', 'm', { specialty: 'qa', concurrency: 24 }]) }],
    11: [empty, direct, { name: 'model with no retrieval', ...one(small({ concurrency: 16 })) }, { name: 'retrieval without reranking (noisy)', ...ragChain(20, false) },
      { name: 'retriever with no embedding step', nodes: [src, ['vectorDb', 'r', { topK: 20 }], ['reranker', 'k', { keep: 4 }], small({ concurrency: 16 }), sink], edges: W('src>r', 'r>k', 'k>m', 'm>sink') }],
    12: [empty, direct, { name: 'no memory store (prompts too costly)', ...one(small({ concurrency: 24 })) }],
    13: [empty, direct, { name: 'first model straight to the sink (never answered)', ...one(small({ concurrency: 16 })) },
      { name: 'two models, no tool in between', nodes: [src, small({ concurrency: 16 }, 'a'), small({ concurrency: 16 }, 'b'), sink], edges: W('src>a', 'a>b', 'b>sink') },
      { name: 'executor without a connector', nodes: [src, small({ concurrency: 16 }, 'a'), ['toolExecutor', 'x'], small({ concurrency: 16 }, 'b'), sink], edges: W('src>a', 'a>x', 'x>b', 'b>sink') },
      { name: 'unskilled calls, connector without retries', nodes: [src, small({ concurrency: 16 }, 'a'), ['toolExecutor', 'x'], ['connector', 'c', { retries: 0 }], small({ concurrency: 16 }, 'b'), sink],
        edges: W('src>a', 'a>x', 'x>c', 'c>b', 'b>sink') }],
    14: [empty, direct, { name: 'capacity but no retries', nodes: [src, ['loadBalancer', 'lb'], small({ concurrency: 32 }, 'a'), small({ concurrency: 32 }, 'b'), small({ concurrency: 32 }, 'c'), sink],
      edges: W('src>lb', 'lb.a>a', 'lb.b>b', 'lb.c>c', 'a>sink', 'b>sink', 'c>sink') },
      { name: 'retries but one model (spike overload)', nodes: [src, ['fallbackRetry', 'f', { retries: 3, backoffMs: 200, timeoutMs: 5000 }], small({ concurrency: 32 }), sink], edges: W('src>f', 'f>m', 'm>sink') }],
    15: [empty, direct, { name: 'everything on the large model', ...one(large({ concurrency: 32 }, 'm')) },
      { name: 'reports sent to the small model (poor quality)', nodes: [src, ['promptRouter', 'rt'], small({ concurrency: 16 }), sink], edges: W('src>rt', 'rt.simple>m', 'rt.batch>m', 'm>sink') }],
    16: [empty, direct, { name: 'everything on the large model (over budget)', ...one(large({ concurrency: 24 }, 'm')) }, { name: 'everything on the small model (poor quality)', ...one(small({ concurrency: 16 })) }],
    17: [empty, direct, { name: 'everything on the small model', ...one(small({ concurrency: 16 })) }, { name: 'everything on the large model', ...one(large({ concurrency: 32 }, 'm')) },
      { name: 'judge but the rejected go nowhere', nodes: [src, small({ concurrency: 16 }, 's'), ['evalJudge', 'j'], sink], edges: W('src>s', 's>j', 'j.pass>sink') }],
    18: [empty, direct, { name: 'retrieval chain with no judge or humans', ...ragChain(20, true) },
      { name: 'judge but no human (rejects go nowhere)', nodes: [src, ['embeddingModel', 'e'], ['vectorDb', 'r', { topK: 20 }], ['reranker', 'k', { keep: 4 }], small({ concurrency: 16 }), ['evalJudge', 'j'], sink],
        edges: W('src>e', 'e>r', 'r>k', 'k>m', 'm>j', 'j.pass>sink') }],
    19: [empty, direct, { name: 'retry(3) but no fallback', nodes: [src, ['fallbackRetry', 'f', { retries: 3, backoffMs: 100, timeoutMs: 5000 }], small({ concurrency: 16 }), sink], edges: W('src>f', 'f>m', 'm>sink') },
      { name: 'retry(5) but no fallback', nodes: [src, ['fallbackRetry', 'f', { retries: 5, backoffMs: 100, timeoutMs: 5000 }], small({ concurrency: 16 }), sink], edges: W('src>f', 'f>m', 'm>sink') },
      { name: 'no retry at all', ...one(small({ concurrency: 16 })) }],
    20: [empty, direct, { name: 'orchestrator loop with a plain LLM (needs up to 6 calls)', nodes: [src, ['agentOrchestrator', 'o'], small({ concurrency: 32 }), sink], edges: W('src>o', 'o.step>m', 'm>o', 'o.done>sink') },
      { name: 'orchestrator with no worker loop', nodes: [src, ['agentOrchestrator', 'o'], sink], edges: W('src>o', 'o.done>sink') }],
    21: [empty, direct, { name: 'guardrail fixed but nothing else', nodes: [src, ['guardrail', 'g', { strictness: 0.9 }], ['promptRouter', 'rt'], small({ concurrency: 2 }, 's'), small({ concurrency: 8 }, 'rs'), sink],
      edges: W('src>g', 'g.pass>rt', 'g.blocked>sink', 'rt.simple>s', 'rt.rag>rs', 's>sink', 'rs>sink') }],
    22: [empty, direct, { name: 'one small model for everything', ...one(small({ concurrency: 32 })) },
      { name: 'router paths but no guardrail', nodes: [src, ['promptRouter', 'rt'], small({ concurrency: 16 }, 's'), large({ concurrency: 16 }), sink], edges: W('src>rt', 'rt.simple>s', 'rt.complex>l', 's>sink', 'l>sink') }],
    23: [empty, direct, { name: 'guardrail fixed only', nodes: [src, ['guardrail', 'g', { strictness: 0.9 }], small({ concurrency: 16 }), sink], edges: W('src>g', 'g.pass>m', 'm>sink', 'g.blocked>sink') }],
    24: [empty, direct, { name: 'everything on the large model (the starter)', nodes: [src, ['guardrail', 'g', { strictness: 0.9 }], large({ concurrency: 32 }), sink],
      edges: W('src>g', 'g.pass>l', 'g.blocked>sink', 'l>sink') },
      { name: 'cache and router but hard questions on the large model', nodes: [src, ['guardrail', 'g', { strictness: 0.9 }], ['semanticCache', 'c', { capacity: 40 }], ['promptRouter', 'rt'], small({ concurrency: 16 }, 's'), large({ concurrency: 32 }), sink],
        edges: W('src>g', 'g.pass>c', 'g.blocked>sink', 'c.miss>rt', 'rt.simple>s', 'rt.complex>l', 's>sink', 'l>sink') }],
    25: [empty, direct, { name: 'production pipeline without load balancing the simple path (surge overload)', ...prod() }],
    26: [empty, direct, { name: 'production pipeline with no tool or agent paths', ...prod() }],
  },
};
