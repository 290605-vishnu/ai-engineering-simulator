// Aggregates outcomes into the numbers the HUD and campaign objectives read.
// Windows are in simulated ms, so metrics stay correct at any playback speed.
(function () {
  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  }

  const MIN_SAMPLES = 10; // ratio metrics below this many samples are "unknown" (null), never "met"

  function createMetrics(tuning) {
    const W = tuning.windows;
    let c, recorded;

    function reset() {
      recorded = 0;
      c = {
        sent: 0, completed: 0, failed: 0, blocked: 0, cost: 0, falsePositives: 0, cacheHits: 0,
        failReasons: {}, malicious: { sent: 0, blocked: 0, breached: 0 },
        latencies: [], doneTimes: [],
        costEvents: [], // [time, amount]
        events: [],     // time-ordered outcomes for windowStats: {t, k: 'd'|'f'|'b', mal, lat?, cached?}
      };
    }
    reset();

    // Drop doneTimes older than the cutoff (time-ordered).
    const trimDone = (cutoff) => {
      let i = 0;
      while (i < c.doneTimes.length && c.doneTimes[i] < cutoff) i++;
      if (i) c.doneTimes.splice(0, i);
    };
    // Trim the long-lived lists in batches so recording stays O(1) amortised.
    function trimLong(now) {
      if ((++recorded & 255) !== 0) return;
      const cutoff = now - W.maxMs;
      const cut = (arr, get) => { let i = 0; while (i < arr.length && get(arr[i]) < cutoff) i++; if (i) arr.splice(0, i); };
      cut(c.events, (e) => e.t);
      cut(c.costEvents, (e) => e[0]);
    }
    const ratio = (num, den) => (den >= MIN_SAMPLES ? (100 * num) / den : null);

    return {
      reset,
      onSpawn(req) { c.sent++; if (req.type === 'malicious') c.malicious.sent++; },
      onCost(amount, now) { c.cost += amount; c.costEvents.push([now, amount]); trimLong(now); },
      onDone(req, latency, now) {
        const cached = req.tags.has('cached');
        c.completed++;
        if (cached) c.cacheHits++;
        if (req.type === 'malicious') c.malicious.breached++; // a malicious request got a real answer
        c.latencies.push(latency);
        if (c.latencies.length > W.latencySamples) c.latencies.shift();
        c.doneTimes.push(now);
        c.events.push({ t: now, k: 'd', mal: req.type === 'malicious', type: req.type, batch: req.batch, lat: latency, cached });
        trimLong(now);
      },
      onFail(req, reason, now) {
        c.failed++; c.failReasons[reason] = (c.failReasons[reason] || 0) + 1;
        c.events.push({ t: now, k: 'f', mal: req.type === 'malicious', type: req.type, reason });
      },
      onBlocked(req, now) {
        c.blocked++;
        if (req.type === 'malicious') c.malicious.blocked++; else c.falsePositives++;
        c.events.push({ t: now, k: 'b', mal: req.type === 'malicious' });
      },

      // Stats over the trailing windowMs of sim time; this is what campaign objectives evaluate.
      windowStats(now, windowMs) {
        const cutoff = now - windowMs;
        const span = Math.min(now, windowMs) / 1000;
        let done = 0, fail = 0, legitFail = 0, malBlocked = 0, malDone = 0, fpBlocked = 0, legitDone = 0, cached = 0;
        let ragResolved = 0, ragHallucinated = 0;
        const lats = [];
        for (let i = c.events.length - 1; i >= 0; i--) {
          const e = c.events[i];
          if (e.t < cutoff) break;
          if (e.k === 'd') {
            done++;
            if (!e.batch) lats.push(e.lat); // latency goals are about interactive traffic; batch jobs are slow by design
            if (e.type === 'rag') ragResolved++;
            if (e.mal) malDone++; else { legitDone++; if (e.cached) cached++; }
          } else if (e.k === 'f') {
            fail++; if (!e.mal) legitFail++;
            if (e.type === 'rag') { ragResolved++; if (e.reason === 'hallucination') ragHallucinated++; }
          }
          else if (e.mal) malBlocked++; else fpBlocked++;
        }
        lats.sort((a, b) => a - b);
        let cost = 0;
        for (let i = c.costEvents.length - 1; i >= 0 && c.costEvents[i][0] >= cutoff; i--) cost += c.costEvents[i][1];
        return {
          throughput: span > 0 ? done / span : 0,
          p50Latency: lats.length ? percentile(lats, 0.5) : null,
          p95Latency: lats.length ? percentile(lats, 0.95) : null,
          costPerMin: span > 0 ? cost / (span / 60) : 0,
          successPct: ratio(done, done + fail),
          maliciousBlockedPct: ratio(malBlocked, malBlocked + malDone),
          // Denominator = every legitimate request that finished any way, so timeouts can't inflate the rate.
          falsePositivePct: ratio(fpBlocked, fpBlocked + legitDone + legitFail),
          cacheHitPct: ratio(cached, legitDone + legitFail), // timeouts are misses too, not absent
          hallucinationPct: ratio(ragHallucinated, ragResolved),
        };
      },

      // $/min over the trailing window; cheap enough for the budget gate to call once per tick.
      costRate(now, windowMs) {
        const span = Math.min(now, windowMs) / 60000;
        let cost = 0;
        for (let i = c.costEvents.length - 1; i >= 0 && c.costEvents[i][0] >= now - windowMs; i--) cost += c.costEvents[i][1];
        return span > 0 ? cost / span : 0;
      },

      snapshot(now) {
        trimDone(now - W.throughputMs);
        const sorted = c.latencies.slice().sort((a, b) => a - b);
        const tSpan = Math.min(now, W.throughputMs) / 1000;
        const cSpan = Math.min(now, W.costMs) / 60000;
        let costWindow = 0;
        for (let i = c.costEvents.length - 1; i >= 0 && c.costEvents[i][0] >= now - W.costMs; i--) costWindow += c.costEvents[i][1];
        const finished = c.completed + c.failed;
        return {
          sent: c.sent, completed: c.completed, failed: c.failed, blocked: c.blocked,
          falsePositives: c.falsePositives, cacheHits: c.cacheHits,
          malicious: { ...c.malicious },
          failReasons: { ...c.failReasons },
          throughput: tSpan > 0 ? c.doneTimes.length / tSpan : 0,
          p50: percentile(sorted, 0.5),
          p95: percentile(sorted, 0.95),
          successRate: finished ? c.completed / finished : 1,
          costTotal: c.cost,
          costPerMin: cSpan > 0 ? costWindow / cSpan : 0,
        };
      },
    };
  }

  createMetrics.percentile = percentile;
  if (typeof module !== 'undefined' && module.exports) module.exports = createMetrics;
  else { globalThis.SIM = globalThis.SIM || {}; SIM.metrics = createMetrics; }
})();
