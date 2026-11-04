// Per-element behavior, keyed by node definition id (nodes.js stays pure data for the palette).
// A new element = one new entry here + one in nodes.js; the sim loop does not change.
//
// Behavior contract:
//   concurrency(config) -> max requests processed at once (Infinity = unlimited)
//   process(req, node, ctx) -> { outputPort, latencyMs, cost, fail, terminal, mutate, onNoRoute }
//     fail       FailReason string; the request ends as a failure (a Fallback/Retry may recover it)
//     terminal   'respond' (flip to response and travel back) | 'blocked' (end quietly)
//     mutate     (req) => void, applied when processing completes (tags etc.)
//     onNoRoute  FailReason used if outputPort is not wired (default 'no_route')
//   recover(req, node, reason, ctx) -> { port, delayMs, deadlineMs } | null   (Fallback/Retry only)
//   onResponse(req, node, ctx)  called when an answered request travels back through this node
//   isSource: true marks elements that spawn requests instead of receiving them.
//
// Request facts the elements share (tags): answered (a model produced a reply), bad (the reply is wrong,
// req.badReason says why; it stays silent until the sink or an Eval Judge looks), blocked, cached,
// embedded/retrieved (RAG), skill, memory, toolRequested/toolCalled/toolResult (tools), injected.
(function () {
  const dep = (name, file) => (typeof require === 'function' ? require(file) : SIM[name]);
  const T = dep('tuning', './tuning');

  const unlimited = () => Infinity;
  const passThrough = (ms = 1) => ({ outputPort: 'out', latencyMs: ms });

  // Error-diffusion accumulator: returns true exactly p of the time (deterministic, no noise).
  function acc(node, key, p) {
    const v = (node.state[key] || 0) + p;
    node.state[key] = v >= 1 ? v - 1 : v;
    return v >= 1;
  }
  // Prompt size is always recomputed from the original, so retries and repeated stages never compound.
  function retokenize(r) {
    r.tokensIn = Math.round(r.tokens0 * (r.tags.has('memory') ? T.memory.tokenFactor : 1))
      + (r.ctxTokens || 0) + (r.tags.has('skill') ? T.tools.skillTokens : 0);
  }
  const RAG_FIELDS = ['ctxTokens', 'stepsDone', 'calls', 'retrieved', 'recall', 'precision', 'chunks'];
  function snapshotReq(r, node) {
    const s = { tags: [...r.tags] };
    RAG_FIELDS.forEach((k) => { s[k] = r[k]; });
    (r.snaps = r.snaps || {})[node.id] = s;
  }
  function restoreReq(r, node) {
    const s = r.snaps && r.snaps[node.id];
    if (!s) return;
    r.tags = new Set(s.tags);
    RAG_FIELDS.forEach((k) => { r[k] = s[k]; });
    r.badReason = null;
    retokenize(r);
  }

  // ---- models ----
  // o: handlesComplex (answers `complex` questions well), stepsPerCall (agent steps done per call),
  //    specialty (fine-tuned: strong on config.specialty, off-domain elsewhere), discount, waitMs, unlimited
  function llm(model, o = {}) {
    return {
      concurrency: (cfg) => (o.unlimited ? Infinity : cfg.concurrency),
      process(req, node, ctx) {
        const cfg = node.config;
        if (cfg.contextWindow && req.tokensIn > cfg.contextWindow) {
          return { fail: 'context_overflow', latencyMs: T.modelFailMs };
        }
        const tokens = req.tokensIn + req.tokensOut;
        const latencyMs = model.baseMs + model.perTokenMs * tokens + (o.waitMs ? o.waitMs(node, ctx) : 0);
        const cost = (tokens / 1e6) * model.pricePerMTok * (o.discount || 1);
        if (ctx.chaosHit(node)) return { fail: 'provider_error', latencyMs: model.baseMs, cost: cost * 0.3 };

        let stepsAdd = 0, bad = null;
        if (req.type === 'tool_call' && !req.tags.has('toolResult')) {
          // First pass asks for a tool (not yet an answer); a second pass without a tool result can only guess.
          if (req.tags.has('toolRequested')) return { fail: 'tool_result_missing', latencyMs, cost };
          return { outputPort: 'out', latencyMs, cost, mutate(r) { r.tags.add('toolRequested'); } };
        }
        if (req.type === 'agent_task') stepsAdd = o.stepsPerCall || 1;
        if (req.type === 'rag') {
          const q = req.retrieved ? req.recall * req.precision : 0;
          if (acc(node, 'accHall', T.quality.noContextHallucination * (1 - q))) bad = 'hallucination';
        }
        const inDomain = o.specialty && req.type === cfg.specialty;
        if (req.complex && !o.handlesComplex && !inDomain && acc(node, 'accComplex', T.quality.complexOnSmall)) bad = bad || 'low_quality';
        if (o.specialty && !inDomain && acc(node, 'accOff', T.quality.offDomain)) bad = bad || 'off_domain';

        return {
          outputPort: 'out', latencyMs, cost,
          mutate(r) {
            // A malicious prompt that reached a model is now "injected" (purple particle).
            if (r.type === 'malicious') r.tags.add('injected');
            if (stepsAdd) { r.stepsDone += stepsAdd; if (r.stepsDone >= r.steps) r.tags.add('answered'); }
            else r.tags.add('answered');
            if (bad) { r.tags.add('bad'); r.badReason = bad; }
          },
        };
      },
    };
  }

  const behaviors = {
    trafficSource: { isSource: true, concurrency: unlimited },

    // ---------------- Phase 1 ----------------
    loadBalancer: {
      concurrency: unlimited,
      process(req, node, ctx) {
        const ports = ctx.connectedPorts(node);
        if (!ports.length) return { fail: 'no_route', latencyMs: 0 };
        const start = node.state.rr || 0;
        node.state.rr = start + 1;
        let port = ports[start % ports.length];
        if (node.config.strategy === 'least-busy') {
          // Scan from the round-robin cursor so ties still rotate.
          let best = Infinity;
          for (let i = 0; i < ports.length; i++) {
            const p = ports[(start + i) % ports.length];
            const load = ctx.loadOf(node, p);
            if (load < best) { best = load; port = p; }
          }
        }
        return { outputPort: port, latencyMs: T.loadBalancerMs };
      },
    },

    llmSmall: llm(T.models.llmSmall),
    llmLarge: llm(T.models.llmLarge, { handlesComplex: true }),

    guardrail: {
      concurrency: unlimited,
      process(req, node) {
        const g = T.guardrail, s = node.config.strictness;
        // Exact catch rate via an accumulator instead of a coin flip, so tuning strictness gives crisp feedback.
        const malicious = req.type === 'malicious';
        const p = malicious ? g.detectBase + g.detectGain * Math.sqrt(s) : g.fpMax * s * s * s;
        const caught = acc(node, malicious ? 'accMal' : 'accLegit', p);
        return {
          outputPort: caught ? 'blocked' : 'pass',
          latencyMs: g.latencyMs,
          mutate(r) { if (caught) r.tags.add('blocked'); },
        };
      },
    },

    // ---------------- Phase 2 ----------------
    // LRU cache keyed by request.key. A hit answers immediately (no model, no cost); a miss goes on to
    // the model. A key is only stored when a real answer comes back through the cache (onResponse), so
    // a miss path that never reaches a model teaches the cache nothing.
    semanticCache: {
      concurrency: unlimited,
      process(req, node) {
        const lru = node.state.lru || (node.state.lru = new Map());
        const c = T.cache;
        if (lru.has(req.key)) {
          lru.delete(req.key); lru.set(req.key, true); // refresh recency
          return {
            terminal: 'respond', latencyMs: c.latencyMs, cost: c.lookupCost,
            mutate(r) { r.tags.add('cached'); r.tags.add('answered'); },
          };
        }
        return { outputPort: 'miss', latencyMs: c.latencyMs, cost: c.lookupCost };
      },
      onResponse(req, node) {
        if (req.tags.has('cached') || req.tags.has('bad') || !req.tags.has('answered')) return;
        const lru = node.state.lru || (node.state.lru = new Map());
        lru.delete(req.key); lru.set(req.key, true);
        while (lru.size > node.config.capacity) lru.delete(lru.keys().next().value);
      },
    },

    // RAG stack: Embedding -> Retriever -> (Reranker) -> model.
    embeddingModel: {
      concurrency: (cfg) => cfg.concurrency,
      process(req) {
        return {
          outputPort: 'out', latencyMs: T.rag.embedMs, cost: (req.tokensIn / 1e6) * T.rag.embedPricePerMTok,
          mutate(r) { r.tags.add('embedded'); },
        };
      },
    },
    vectorDb: {
      concurrency: (cfg) => cfg.concurrency,
      process(req, node) {
        const R = T.rag, K = node.config.topK;
        if (!req.tags.has('embedded')) return { fail: 'no_embedding', latencyMs: 20 };
        const recall = 1 - Math.pow(R.recallDecay, K);
        const precision = Math.max(R.precisionFloor, 1 - R.noisePerK * K); // more chunks, more noise
        return {
          outputPort: 'out', latencyMs: R.retrieveBaseMs + R.retrievePerKMs * K, cost: R.retrieveCost,
          mutate(r) {
            r.retrieved = true; r.recall = recall; r.precision = precision;
            r.chunks = K; r.ctxTokens = K * R.tokensPerChunk; r.tags.add('retrieved');
            retokenize(r);
          },
        };
      },
    },
    reranker: {
      concurrency: (cfg) => cfg.concurrency,
      process(req, node) {
        const R = T.rag;
        if (!req.retrieved) return passThrough(5); // nothing to rerank
        const keep = Math.min(req.chunks, node.config.keep);
        return {
          outputPort: 'out', latencyMs: R.rerankBaseMs + R.rerankPerChunkMs * req.chunks, cost: R.rerankCost,
          mutate(r) {
            r.precision = 1;                                        // noise removed
            r.recall *= Math.min(1, keep / R.rerankMinKeep);        // but keeping too few drops answers
            r.chunks = keep; r.ctxTokens = keep * R.tokensPerChunk; // and the prompt shrinks
            retokenize(r);
          },
        };
      },
    },

    rateLimiter: {
      concurrency: unlimited,
      process(req, node, ctx) {
        const st = node.state, cfg = node.config, now = ctx.now;
        if (st.last === undefined) { st.tokens = cfg.burst; st.last = now; }
        st.tokens = Math.min(cfg.burst, st.tokens + ((now - st.last) / 1000) * cfg.limit);
        st.last = now;
        if (st.tokens >= 1) { st.tokens -= 1; return { outputPort: 'pass', latencyMs: T.limiter.latencyMs }; }
        return { outputPort: 'limited', latencyMs: T.limiter.latencyMs, onNoRoute: 'rate_limited' };
      },
    },

    promptRouter: {
      concurrency: unlimited,
      process(req) {
        const port = req.batch ? 'batch' : req.type === 'rag' ? 'rag' : req.type === 'tool_call' ? 'tool'
          : req.type === 'agent_task' ? 'agent' : req.complex ? 'complex' : 'simple';
        return { outputPort: port, latencyMs: T.router.latencyMs, cost: T.router.cost };
      },
    },

    // Tools: LLM (asks) -> Tool Executor (parses the call) -> Connector (calls the system) -> LLM (answers).
    toolExecutor: {
      concurrency: (cfg) => cfg.concurrency,
      process(req, node) {
        const t = T.tools;
        if (!req.tags.has('toolRequested') || req.tags.has('toolCalled')) return passThrough(5);
        if (acc(node, 'accBad', req.tags.has('skill') ? t.badCallSkill : t.badCall)) return { fail: 'bad_tool_call', latencyMs: t.executorMs };
        return { outputPort: 'out', latencyMs: t.executorMs, mutate(r) { r.tags.add('toolCalled'); } };
      },
    },
    connector: {
      concurrency: (cfg) => cfg.concurrency,
      process(req, node) {
        const t = T.tools, retries = node.config.retries;
        if (!req.tags.has('toolCalled') || req.tags.has('toolResult')) return passThrough(5);
        if (acc(node, 'accFail', Math.pow(t.connectorFail, retries + 1))) {
          return { fail: 'connector_error', latencyMs: t.connectorMs * (1 + retries) };
        }
        return { outputPort: 'out', latencyMs: t.connectorMs * (1 + retries * t.connectorFail), mutate(r) { r.tags.add('toolResult'); } };
      },
    },
    skill: {
      concurrency: unlimited,
      process() {
        return {
          outputPort: 'out', latencyMs: T.tools.skillMs, cost: (T.tools.skillTokens / 1e6) * T.models.llmSmall.pricePerMTok,
          mutate(r) { r.tags.add('skill'); retokenize(r); }, // costs a few prompt tokens
        };
      },
    },
    plugin: { // executor + connector + skill bundled and pre-tested
      concurrency: (cfg) => cfg.concurrency,
      process(req, node) {
        const t = T.tools;
        if (!req.tags.has('toolRequested') || req.tags.has('toolCalled')) return passThrough(5);
        if (acc(node, 'accBad', t.pluginBadCall)) return { fail: 'bad_tool_call', latencyMs: t.pluginMs };
        if (acc(node, 'accFail', t.pluginConnectorFail)) return { fail: 'connector_error', latencyMs: t.pluginMs };
        return { outputPort: 'out', latencyMs: t.pluginMs, mutate(r) { r.tags.add('toolCalled'); r.tags.add('toolResult'); } };
      },
    },

    observabilityTap: {
      concurrency: unlimited,
      process(req, node, ctx) {
        // Tracing: remember when each request passed and how old it already was (read by the HUD badge).
        const seen = node.state.seen || (node.state.seen = []);
        seen.push([ctx.now, ctx.now - req.createdAt]);
        while (seen.length && seen[0][0] < ctx.now - 10000) seen.shift();
        return passThrough(1);
      },
    },

    // ---------------- Phase 3 ----------------
    memoryStore: {
      concurrency: unlimited,
      process() {
        return {
          outputPort: 'out', latencyMs: T.memory.latencyMs, cost: T.memory.cost,
          mutate(r) { r.tags.add('memory'); retokenize(r); }, // remembered context: shorter prompts
        };
      },
    },

    // Wraps everything downstream: remembers the request's state so a failure later in the pipeline
    // can send it again (after exponential backoff), then to the `fallback` port when retries run out.
    fallbackRetry: {
      concurrency: unlimited,
      process(req, node, ctx) {
        return {
          outputPort: 'out', latencyMs: T.retry.latencyMs,
          mutate(r) { snapshotReq(r, node); r.deadline = ctx.now + node.config.timeoutMs; },
        };
      },
      recover(req, node, reason, ctx) {
        const cfg = node.config, n = req.tries[node.id] || 0;
        if (n < cfg.retries) {
          req.tries[node.id] = n + 1; restoreReq(req, node);
          return { port: 'out', delayMs: cfg.backoffMs * Math.pow(2, n), deadlineMs: cfg.timeoutMs };
        }
        if (!req.usedFallback && ctx.isWired(node, 'fallback')) {
          req.usedFallback = true; restoreReq(req, node);
          return { port: 'fallback', delayMs: 0, deadlineMs: cfg.timeoutMs };
        }
        return null;
      },
    },

    budgetGate: {
      concurrency: unlimited,
      process(req, node, ctx) {
        const over = ctx.costPerMin() > node.config.budget;
        return { outputPort: over ? 'over' : 'ok', latencyMs: T.budget.latencyMs, onNoRoute: 'over_budget' };
      },
    },

    // LLM-as-judge: catches most wrong answers (and wrongly flags a few good ones) and sends them to `reject`.
    evalJudge: {
      concurrency: unlimited,
      process(req, node) {
        const e = T.eval;
        const reject = req.tags.has('bad') ? acc(node, 'accDet', e.detect) : acc(node, 'accFr', e.falseReject);
        return {
          outputPort: reject ? 'reject' : 'pass', latencyMs: e.latencyMs, cost: e.cost,
          onNoRoute: req.badReason || 'rejected',
          mutate(r) { if (reject) { r.tags.delete('bad'); r.tags.delete('answered'); } },
        };
      },
    },

    humanInLoop: {
      concurrency: (cfg) => cfg.reviewers,
      process() {
        return {
          outputPort: 'out', latencyMs: T.human.latencyMs, cost: T.human.cost,
          mutate(r) { r.tags.delete('bad'); r.tags.add('answered'); r.tags.add('human'); },
        };
      },
    },

    fineTunedModel: llm(T.models.fineTuned, { specialty: true }),
    subAgent: llm(T.models.subAgent, { stepsPerCall: 2, handlesComplex: true }),

    // Non-urgent work at a discount: waits for the next batch window, then runs as a large-quality model.
    batchProcessor: llm(
      { baseMs: T.batch.extraMs, perTokenMs: 0, pricePerMTok: T.batch.pricePerMTok },
      { handlesComplex: true, unlimited: true, discount: T.batch.discount,
        waitMs: (node, ctx) => { const iv = node.config.intervalMs; return Math.ceil((ctx.now + 1) / iv) * iv - ctx.now; } }
    ),

    // Plans an agent task as repeated `step` calls (wire the step path back into this node) until the
    // model work is done, within a step budget.
    agentOrchestrator: {
      concurrency: unlimited,
      process(req, node) {
        const a = T.agent;
        if (req.type !== 'agent_task') return { outputPort: 'done', latencyMs: a.orchestratorMs };
        if (req.stepsDone >= req.steps) return { outputPort: 'done', latencyMs: a.orchestratorMs };
        if (req.calls >= node.config.maxSteps) return { fail: 'step_budget', latencyMs: a.orchestratorMs };
        return {
          outputPort: 'step', latencyMs: a.orchestratorMs, cost: a.orchestratorCost,
          mutate(r) { r.calls += 1; },
        };
      },
    },

    // ---------------- exit ----------------
    // The sink is where the user's reply is judged: blocked requests end quietly, wrong answers and
    // never-answered requests count as failures. Wiring straight from source to sink therefore fails.
    responseSink: {
      concurrency: unlimited,
      process(req) {
        if (req.tags.has('blocked')) return { latencyMs: 0, terminal: 'blocked' };
        if (req.tags.has('bad')) return { latencyMs: 0, fail: req.badReason || 'low_quality' };
        if (!req.tags.has('answered')) return { latencyMs: 0, fail: 'no_answer' };
        return { latencyMs: 0, terminal: 'respond' };
      },
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = behaviors;
  else { globalThis.SIM = globalThis.SIM || {}; SIM.behaviors = behaviors; }
})();
