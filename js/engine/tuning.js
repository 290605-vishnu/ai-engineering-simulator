// Every latency / cost / probability constant lives here so balancing is one-file work.
// Engine files must stay DOM-free: they run in the browser and under `node --test`.
(function () {
  const Tuning = {
    tickMs: 50,          // fixed simulation timestep (20 ticks/s)
    hopMs: 150,          // time a request spends travelling along one wire (each direction)
    timeoutMs: 10000,    // default: a request alive longer than this fails with 'timeout'
    maxVisits: 40,       // a request entering this many nodes is stuck in a loop
    jitter: 0.25,        // +/- token-count variation so latencies are not identical

    // Model tiers, keyed by node definition id.
    models: {
      llmSmall: { baseMs: 300, perTokenMs: 2, pricePerMTok: 0.15 },
      llmLarge: { baseMs: 900, perTokenMs: 6, pricePerMTok: 3 },
      fineTuned: { baseMs: 350, perTokenMs: 3, pricePerMTok: 0.4 },
      subAgent: { baseMs: 400, perTokenMs: 2, pricePerMTok: 0.4 },
    },
    modelFailMs: 50,     // how long a model takes to reject a request (e.g. context overflow)

    // Answer quality. All rates are exact (accumulators), never coin flips.
    quality: {
      complexOnSmall: 0.7,      // share of complex questions a small model answers badly (low_quality)
      noContextHallucination: 0.9, // rag question answered without retrieval
      offDomain: 0.5,           // fine-tuned model asked outside its specialty
    },

    guardrail: {
      latencyMs: 40,
      // detect = base + gain * sqrt(strictness): quickly useful, then diminishing returns.
      // false positives = fpMax * strictness^3: negligible when lax, climbing steeply near 1.
      // Together they leave a narrow sweet spot (strictness 0.85-0.90) for the "Don't Get Owned" level.
      detectBase: 0.5,
      detectGain: 0.5,
      fpMax: 0.06,
    },
    loadBalancerMs: 5,
    cache: { latencyMs: 15, lookupCost: 0.000001 }, // embedding lookup is cheap but not free

    // Retrieval stack (RAG). quality = recall * precision; hallucination = noContext * (1 - quality).
    rag: {
      embedMs: 60, embedPricePerMTok: 0.02,
      retrieveBaseMs: 80, retrievePerKMs: 4, retrieveCost: 0.00002,
      recallDecay: 0.85,        // recall(K) = 1 - decay^K
      noisePerK: 0.015,         // precision = max(floor, 1 - noisePerK * K) until reranked
      precisionFloor: 0.4,
      tokensPerChunk: 40,       // each retrieved chunk adds this many prompt tokens
      rerankBaseMs: 120, rerankPerChunkMs: 10, rerankCost: 0.00003,
      rerankMinKeep: 4,         // keeping fewer chunks than this starts costing recall
    },

    router: { latencyMs: 30, cost: 0.000005 },
    limiter: { latencyMs: 2 },

    // Tools. A skill makes malformed tool calls rare; a connector fails per attempt, retries multiply odds.
    tools: {
      executorMs: 120, badCall: 0.35, badCallSkill: 0.05,
      connectorMs: 250, connectorFail: 0.25,
      skillMs: 10, skillTokens: 30,
      pluginMs: 200, pluginBadCall: 0.05, pluginConnectorFail: 0.0156, // two built-in retries (0.25^3)
    },

    // Phase 3
    memory: { latencyMs: 20, cost: 0.000002, tokenFactor: 0.6 }, // remembered context shrinks the prompt
    eval: { latencyMs: 250, cost: 0.00003, detect: 0.9, falseReject: 0.03 },
    human: { latencyMs: 4000, cost: 0.0005 },
    batch: { extraMs: 500, discount: 0.5, pricePerMTok: 3 },
    agent: { orchestratorMs: 20, orchestratorCost: 0.000005 },
    budget: { latencyMs: 2 },
    retry: { latencyMs: 1 },

    // Tokens are per-request means before jitter.
    //   complex: small models answer it badly        steps: [min,max] model calls an agent task needs
    //   batch: not interactive (excluded from latency goals)      timeoutMs: per-type timeout override
    requestTypes: {
      qa: { tokensIn: 50, tokensOut: 150 },
      malicious: { tokensIn: 60, tokensOut: 120 },
      rag: { tokensIn: 80, tokensOut: 300 },
      analysis: { tokensIn: 150, tokensOut: 400, complex: true },
      tool_call: { tokensIn: 120, tokensOut: 200 },
      chat: { tokensIn: 1200, tokensOut: 150 }, // long conversation history: expensive prompts
      agent_task: { tokensIn: 100, tokensOut: 150, steps: [4, 6] },
      report: { tokensIn: 300, tokensOut: 600, complex: true, batch: true, timeoutMs: 90000 },
    },
    defaultMix: { qa: 0.85, malicious: 0.15 },

    burst: { factor: 5, periodMs: 5000, lengthMs: 1000 }, // defaults; a level can override per source

    windows: { throughputMs: 10000, costMs: 60000, latencySamples: 1000, maxMs: 120000 },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Tuning;
  else { globalThis.SIM = globalThis.SIM || {}; SIM.tuning = Tuning; }
})();
