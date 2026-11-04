// Simulation core: fixed-timestep tick loop. No DOM, no window, so it runs headless in Node tests.
//
// Per step(dt): advance clock -> spawn -> release delayed retries -> deliver arrivals -> process nodes
// -> expire timeouts. A request travels as a "transit" along a wire (hopMs), is queued at the node it
// reaches, processed there (latency/cost), then forwarded out of the chosen port. At a sink it flips to
// a response and travels back along its recorded path; reaching the source completes it.
//
// Fail reasons (req.failReason): no_route, no_answer, timeout, attempt_timeout, context_overflow,
//   provider_error, hallucination, low_quality, off_domain, rate_limited, over_budget, rejected,
//   no_embedding, bad_tool_call, tool_result_missing, connector_error, step_budget, loop_detected.
(function () {
  const dep = (name, file) => (typeof require === 'function' ? require(file) : SIM[name]);
  const Tuning = dep('tuning', './tuning');
  const createMetrics = dep('metrics', './metrics');
  const createRouter = dep('router', './router');

  const MAX_EVENTS = 500;
  const MAX_LOG = 200;
  // Failures a Fallback/Retry node may try to recover. Wiring errors and hard limits are not retryable.
  const RECOVERABLE = new Set(['provider_error', 'attempt_timeout', 'connector_error', 'bad_tool_call',
    'rate_limited', 'low_quality', 'hallucination', 'off_domain', 'rejected']);

  // Small seeded PRNG so a given seed always replays identically (tests, future replays).
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createSim({ defs, behaviors, tuning = Tuning, seed = 1 }) {
    const defMap = Object.fromEntries(defs.map((d) => [d.id, d]));
    const router = createRouter();
    const metrics = createMetrics(tuning);
    const nodes = new Map();   // id -> instance
    const active = new Set();  // requests still in flight
    let transits = [];         // time-ordered: every hop takes hopMs, so push order == arrival order
    let delayed = [];          // retries waiting out their backoff: {req, nodeId, port, at}
    let events = [];
    let chaos = {};            // defId -> provider error rate, set by the campaign level
    let rng, now, nextId, logs, logSeq, costCache;

    function reset() {
      rng = mulberry32(seed);
      now = 0; nextId = 0; logs = []; logSeq = 0; costCache = null;
      active.clear(); transits = []; delayed = []; events = [];
      metrics.reset();
      nodes.forEach((n) => { n.queue = []; n.inFlight = []; n.state = {}; n.spawnAcc = 0; n.stats = newStats(); });
    }
    const newStats = () => ({ processed: 0, failed: 0, cost: 0 });

    const ctx = {
      rng: () => rng(),
      get now() { return now; },
      connectedPorts: (node) => router.connectedPorts(node.id, defMap[node.defId]),
      isWired: (node, port) => !!router.edgeFrom(node.id, port),
      loadOf(node, port) {
        const edge = router.edgeFrom(node.id, port);
        const target = edge && nodes.get(edge.target);
        return target ? target.queue.length + target.inFlight.length : 0;
      },
      // Provider outage injected by the level. A real outage is independent per call, so this is a seeded
      // random draw (an evenly spaced accumulator would make retries look better than they are).
      chaosHit(node) {
        const p = chaos[node.defId] || 0;
        return p > 0 && rng() < p;
      },
      // Current spend rate ($/min over the last 60s), cached per tick for the budget gate.
      costPerMin() {
        if (costCache === null) costCache = metrics.costRate(now, tuning.windows.costMs);
        return costCache;
      },
    };

    // ---------- request outcomes ----------
    function emitFail(node, blocked) {
      if (node && events.length < MAX_EVENTS) events.push({ type: 'fail', nodeId: node.id, blocked });
    }
    // Human-readable event log (separate from `events`, which only drives particle fades).
    // kind: fail | block | falsepos | breach | retry. Consumers poll readLog(sinceSeq).
    function log(kind, node, req, reason) {
      logs.push({ seq: ++logSeq, t: now, kind, nodeId: node ? node.id : null, type: req.type, reason });
      if (logs.length > MAX_LOG) logs.shift();
    }
    function removeFromSystem(req) {
      nodes.forEach((n) => {
        n.queue = n.queue.filter((r) => r !== req);
        n.inFlight = n.inFlight.filter((f) => f.req !== req);
      });
      transits = transits.filter((t) => t.req !== req);
      delayed = delayed.filter((d) => d.req !== req);
    }
    // Give the nearest Fallback/Retry node upstream a chance to recover the request instead of failing it.
    function tryRecover(req, reason) {
      if (!RECOVERABLE.has(reason)) return false;
      for (let i = req.path.length - 1; i >= 0; i--) {
        const n = nodes.get(req.path[i]);
        const b = n && behaviors[n.defId];
        if (!b || !b.recover) continue;
        const plan = b.recover(req, n, reason, ctx);
        if (!plan) return false; // nearest recovery node is out of retries
        removeFromSystem(req);
        req.path.length = i + 1; req.pathEdges.length = i;
        req.phase = 'request';
        req.deadline = now + plan.delayMs + (plan.deadlineMs || 0);
        delayed.push({ req, nodeId: n.id, port: plan.port, at: now + plan.delayMs });
        log('retry', n, req, reason);
        return true;
      }
      return false;
    }
    function failReq(req, reason, node) {
      if (req.status !== 'in_flight') return;
      if (tryRecover(req, reason)) return;
      req.status = 'failed'; req.failReason = reason;
      active.delete(req);
      if (node) node.stats.failed++;
      metrics.onFail(req, reason, now);
      emitFail(node, false);
      log('fail', node, req, reason);
    }
    function finishBlocked(req, node) {
      req.status = 'blocked';
      active.delete(req);
      metrics.onBlocked(req, now);
      // Report where the block happened (the guardrail), not the sink the request was parked at.
      const at = (req.blockedAt && nodes.get(req.blockedAt)) || node;
      emitFail(at, true);
      log(req.type === 'malicious' ? 'block' : 'falsepos', at, req);
    }
    function complete(req) {
      req.status = 'done';
      active.delete(req);
      metrics.onDone(req, now - req.createdAt, now);
      if (req.type === 'malicious') log('breach', null, req);
    }

    // ---------- movement ----------
    function forward(req, from, port, noRoute) {
      const edge = router.edgeFrom(from.id, port);
      if (!edge) {
        // A blocked request with nowhere to go is a clean drop; anything else is a wiring/limit failure.
        if (req.tags.has('blocked')) finishBlocked(req, from); else failReq(req, noRoute || 'no_route', from);
        return;
      }
      transits.push({ req, edgeId: edge.id, to: edge.target, t0: now, t1: now + tuning.hopMs, dir: 1 });
    }
    function sendBack(req) {
      const i = req.hop - 1; // hop = index in path of where the response currently is
      transits.push({ req, edgeId: req.pathEdges[i], to: req.path[i], t0: now, t1: now + tuning.hopMs, dir: -1 });
    }
    function startResponse(req) {
      req.phase = 'response';
      req.deadline = 0; // the attempt succeeded; the response trip is not subject to attempt timeouts
      req.hop = req.path.length - 1;
      if (req.hop === 0) complete(req); else sendBack(req);
    }
    function arrive(tr) {
      const req = tr.req;
      if (req.status !== 'in_flight') return;
      if (tr.dir === 1) {
        const node = nodes.get(tr.to);
        if (!node) { failReq(req, 'no_route', null); return; }
        if (++req.visits > tuning.maxVisits) { failReq(req, 'loop_detected', node); return; }
        // Revisiting a node (an agent loop, a retry) folds the path back to it, so the response
        // returns by the simple route instead of replaying every lap.
        const idx = req.path.indexOf(node.id);
        if (idx >= 0) { req.path.length = idx + 1; req.pathEdges.length = idx; }
        else { req.path.push(node.id); req.pathEdges.push(tr.edgeId); }
        node.queue.push(req);
      } else {
        // A response passing back through an element lets it learn from the outcome (e.g. a cache stores it).
        const back = nodes.get(tr.to), bb = back && behaviors[back.defId];
        if (bb && bb.onResponse) bb.onResponse(req, back, ctx);
        req.hop--;
        if (req.hop === 0) complete(req); else sendBack(req);
      }
    }

    // ---------- spawning ----------
    function pickType(mix) {
      const entries = Object.entries(mix);
      let r = rng() * entries.reduce((s, e) => s + e[1], 0);
      for (const [type, w] of entries) { r -= w; if (r < 0) return type; }
      return entries[0][0];
    }
    // Explicit `mix` wins (scenarios); else the maliciousPct setting; else the default.
    function mixFor(cfg) {
      if (cfg.mix) return cfg.mix;
      if (typeof cfg.maliciousPct === 'number') return { qa: 100 - cfg.maliciousPct, malicious: cfg.maliciousPct };
      return tuning.defaultMix;
    }
    function spawn(src) {
      const type = pickType(mixFor(src.config));
      const spec = tuning.requestTypes[type];
      const jit = (v) => Math.max(1, Math.round(v * (1 + (rng() * 2 - 1) * tuning.jitter)));
      // Prompts repeat when the source has a finite keyPool (what a cache can exploit); else all unique.
      const pool = src.config.keyPool;
      const id = ++nextId;
      const tokensIn = jit(spec.tokensIn);
      const req = {
        id, key: type === 'qa' && pool > 0 ? Math.floor(rng() * pool) : 'u' + id, type,
        tokensIn, tokens0: tokensIn, tokensOut: jit(spec.tokensOut),
        complex: !!spec.complex, batch: !!spec.batch, timeoutMs: spec.timeoutMs || tuning.timeoutMs,
        steps: spec.steps ? spec.steps[0] + Math.floor(rng() * (spec.steps[1] - spec.steps[0] + 1)) : 0,
        stepsDone: 0, calls: 0, visits: 0, deadline: 0, tries: {},
        createdAt: now, path: [src.id], pathEdges: [], hop: 0, phase: 'request',
        status: 'in_flight', failReason: null, cost: 0, tags: new Set(),
      };
      active.add(req);
      metrics.onSpawn(req);
      forward(req, src, 'out');
    }
    function spawnFrom(src, dt) {
      if (!router.edgeFrom(src.id, 'out')) { src.spawnAcc = 0; return; } // unwired source stays idle
      const c = src.config, b = tuning.burst;
      const per = c.burstEveryMs || b.periodMs, len = c.burstLenMs || b.lengthMs;
      const boost = c.burst && (now % per) < len ? (c.burstFactor || b.factor) : 1;
      src.spawnAcc += (c.rate * boost * dt) / 1000;
      while (src.spawnAcc >= 1) { src.spawnAcc -= 1; spawn(src); }
    }

    // ---------- node processing ----------
    function finish(node, f) {
      const req = f.req, res = f.res;
      if (req.status !== 'in_flight') return;
      node.stats.processed++;
      if (res.cost) { req.cost += res.cost; node.stats.cost += res.cost; metrics.onCost(res.cost, now); }
      if (res.fail) { failReq(req, res.fail, node); return; }
      if (res.mutate) res.mutate(req);
      if (req.tags.has('blocked') && !req.blockedAt) req.blockedAt = node.id;
      if (res.terminal === 'respond') startResponse(req);
      else if (res.terminal === 'blocked') finishBlocked(req, node);
      else forward(req, node, res.outputPort, res.onNoRoute);
    }
    function tickNode(node) {
      const b = behaviors[node.defId];
      if (!b || b.isSource) return;
      const cap = b.concurrency(node.config);
      while (node.inFlight.length < cap && node.queue.length) {
        const req = node.queue.shift();
        if (req.status !== 'in_flight') continue;
        const res = b.process(req, node, ctx) || {};
        node.inFlight.push({ req, res, doneAt: now + (res.latencyMs || 0) });
      }
      if (!node.inFlight.length) return;
      const pending = [];
      for (const f of node.inFlight) { if (f.doneAt <= now) finish(node, f); else pending.push(f); }
      node.inFlight = pending;
    }

    function expireTimeouts() {
      let any = false;
      for (const req of active) {
        const last = () => nodes.get(req.path[req.path.length - 1]);
        if (now - req.createdAt > req.timeoutMs) { failReq(req, 'timeout', last()); any = true; }
        else if (req.deadline && now > req.deadline) { req.deadline = 0; failReq(req, 'attempt_timeout', last()); any = true; }
      }
      if (!any) return;
      const alive = (r) => r.status === 'in_flight';
      nodes.forEach((n) => { n.queue = n.queue.filter(alive); n.inFlight = n.inFlight.filter((f) => alive(f.req)); });
      transits = transits.filter((t) => alive(t.req));
      delayed = delayed.filter((d) => alive(d.req));
    }

    // ---------- public API ----------
    reset();
    return {
      nodes, defMap,
      get now() { return now; },
      get transits() { return transits; },
      reset,
      setChaos(map) { chaos = map || {}; },
      // Sync with the editor graph. Instances persist across calls so queues survive edits.
      setGraph(graphNodes, graphEdges) {
        const seen = new Set();
        graphNodes.forEach((n) => {
          if (!defMap[n.defId]) return;
          seen.add(n.id);
          let inst = nodes.get(n.id);
          if (!inst) {
            inst = { id: n.id, defId: n.defId, queue: [], inFlight: [], state: {}, spawnAcc: 0, stats: newStats() };
            nodes.set(n.id, inst);
          }
          inst.config = n.config; // shared reference: live config edits take effect next tick
        });
        nodes.forEach((inst, id) => {
          if (seen.has(id)) return;
          inst.queue.forEach((r) => failReq(r, 'no_route', inst));
          inst.inFlight.forEach((f) => failReq(f.req, 'no_route', inst));
          nodes.delete(id);
        });
        router.build(graphEdges.filter((e) => nodes.has(e.source) && nodes.has(e.target)));
      },
      step(dt) {
        now += dt;
        costCache = null;
        nodes.forEach((n) => { if (behaviors[n.defId] && behaviors[n.defId].isSource) spawnFrom(n, dt); });
        if (delayed.length) {
          const due = delayed.filter((d) => d.at <= now);
          if (due.length) {
            delayed = delayed.filter((d) => d.at > now);
            due.forEach((d) => {
              if (d.req.status !== 'in_flight') return;
              const n = nodes.get(d.nodeId);
              if (!n) failReq(d.req, 'no_route', null); else forward(d.req, n, d.port);
            });
          }
        }
        let i = 0;
        while (i < transits.length && transits[i].t1 <= now) i++;
        if (i) transits.splice(0, i).forEach(arrive);
        nodes.forEach(tickNode);
        expireTimeouts();
      },
      windowStats(windowMs) { return metrics.windowStats(now, windowMs); },
      snapshot() { return { ...metrics.snapshot(now), inFlight: active.size, now }; },
      drainEvents() { const e = events; events = []; return e; },
      get logSeq() { return logSeq; },
      readLog(sinceSeq) { return logs.filter((e) => e.seq > sinceSeq); },
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = createSim;
  else { globalThis.SIM = globalThis.SIM || {}; SIM.createSim = createSim; }
})();
