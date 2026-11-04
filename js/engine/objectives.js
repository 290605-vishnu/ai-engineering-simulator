// Campaign goal logic: evaluate declarative objectives against windowed metrics, award stars, and
// validate scenario objects. Pure functions: no DOM, so it runs headless in Node tests.
(function () {
  const Tuning = typeof require === 'function' ? require('./tuning') : SIM.tuning;
  // Metric names a scenario may reference (all come from metrics.windowStats).
  const METRICS = {
    throughput: { label: 'Throughput', unit: '/s', dp: 1 },
    p50Latency: { label: 'p50 latency', unit: ' ms', dp: 0 },
    p95Latency: { label: 'p95 latency', unit: ' ms', dp: 0 },
    costPerMin: { label: 'Cost / min', prefix: '$', unit: '', dp: 4 },
    successPct: { label: 'Success rate', unit: '%', dp: 1 },
    maliciousBlockedPct: { label: 'Malicious blocked', unit: '%', dp: 1 },
    falsePositivePct: { label: 'False positives', unit: '%', dp: 1 },
    cacheHitPct: { label: 'Cache hit rate', unit: '%', dp: 1 },
    hallucinationPct: { label: 'Hallucinations', unit: '%', dp: 1 },
  };
  const OPS = {
    '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b,
  };

  const fmtValue = (metric, v) => {
    const m = METRICS[metric];
    if (v === null || v === undefined) return '–';
    return (m.prefix || '') + v.toFixed(m.dp) + m.unit;
  };

  // getStats(windowMs) -> windowStats object. Stats are fetched once per distinct window.
  // `warming` = the sim hasn't run a full window yet, so the number can't be trusted.
  function evaluate(objectives, getStats, now) {
    const cache = new Map();
    return objectives.map((o) => {
      const w = o.window * 1000;
      if (!cache.has(w)) cache.set(w, getStats(w));
      const value = cache.get(w)[o.metric];
      const warming = now < w;
      const met = !warming && value !== null && value !== undefined && OPS[o.op](value, o.value);
      return { value, met, warming };
    });
  }

  // Stars: 1 = star-1 objectives met, 2 = plus star-2 ("under cost"), 3 = plus star-3 ("excellence").
  const tierMet = (objectives, results, tier) =>
    objectives.every((o, i) => (o.star || 1) !== tier || results[i].met);
  function stars(objectives, results) {
    if (!tierMet(objectives, results, 1)) return 0;
    if (!tierMet(objectives, results, 2)) return 1;
    return tierMet(objectives, results, 3) ? 3 : 2;
  }
  const passed = (objectives, results) => tierMet(objectives, results, 1);

  // Small hand-written validator (instead of a schema library). Returns a list of problems.
  const TIER_IDS = ['beginner', 'novice', 'advanced', 'expert', 'master'];
  function validateScenario(s, defIds, termKeys) {
    const err = [];
    const need = (cond, msg) => { if (!cond) err.push(`${s && s.id !== undefined ? 'level ' + s.id : 'scenario'}: ${msg}`); };
    if (!s || typeof s !== 'object') return ['scenario: not an object'];
    need(Number.isInteger(s.id) && s.id > 0, 'id must be a positive integer');
    ['title', 'situation', 'question', 'learned'].forEach((k) => need(typeof s[k] === 'string' && s[k], `${k} must be a non-empty string`));
    need(s.explain && s.explain.happening && s.explain.needed, 'explain.happening and explain.needed are required');
    need(Array.isArray(s.unlocks) && (s.unlocks.length > 0 || s.id > 1), 'unlocks must be an array (non-empty for level 1)');
    need(TIER_IDS.includes(s.tier), 'tier must be one of ' + TIER_IDS.join(', '));
    (s.terms || []).forEach((k) => need(!termKeys || termKeys.includes(k), `unknown glossary term "${k}"`));
    need(s.steps === undefined || (Array.isArray(s.steps) && s.steps.every((t) => typeof t === 'string')), 'steps must be an array of strings');
    (s.unlocks || []).forEach((d) => need(defIds.includes(d), `unknown element "${d}" in unlocks`));
    need(s.traffic && typeof s.traffic === 'object', 'traffic must be an object');
    Object.keys(s.locks || {}).forEach((d) => need(defIds.includes(d), `unknown element "${d}" in locks`));
    Object.keys(s.chaos || {}).forEach((d) => need(defIds.includes(d), `unknown element "${d}" in chaos`));
    Object.keys((s.traffic && s.traffic.mix) || {}).forEach((t) => need(Tuning.requestTypes[t], `unknown request type "${t}" in traffic.mix`));
    need(s.starter && Array.isArray(s.starter.nodes), 'starter.nodes must be an array');
    ((s.starter && s.starter.nodes) || []).forEach((n) => need(defIds.includes(n[0]), `unknown starter element "${n[0]}"`));
    ((s.starter && s.starter.edges) || []).forEach((e) =>
      need(s.starter.nodes[e[0]] && s.starter.nodes[e[2]], 'starter edge references a missing node'));

    const objs = s.objectives;
    need(Array.isArray(objs) && objs.length > 0, 'objectives must be a non-empty array');
    let maxStar1Window = 0;
    (objs || []).forEach((o, i) => {
      const at = `objective ${i}`;
      need(METRICS[o.metric], `${at}: unknown metric "${o.metric}"`);
      need(OPS[o.op], `${at}: unknown op "${o.op}"`);
      need(typeof o.value === 'number', `${at}: value must be a number`);
      need(typeof o.window === 'number' && o.window > 0, `${at}: window (seconds) must be > 0`);
      need(o.star === undefined || [1, 2, 3].includes(o.star), `${at}: star must be 1, 2 or 3`);
      need(typeof o.label === 'string' && o.label, `${at}: label required`);
      if ((o.star || 1) === 1) maxStar1Window = Math.max(maxStar1Window, o.window);
    });
    need((objs || []).some((o) => (o.star || 1) === 1), 'at least one star-1 objective is required');
    // A level passes after the longest star-1 window plus the hold time; star objectives with a longer
    // window would still be "warming" at that moment and could never award their star.
    (objs || []).forEach((o, i) => need((o.star || 1) === 1 || o.window <= maxStar1Window + (s.holdSec || 0),
      `objective ${i}: window is longer than the level takes to pass, so its star is unreachable`));
    return err;
  }

  const Objectives = { METRICS, OPS, fmtValue, evaluate, stars, passed, validateScenario };
  if (typeof module !== 'undefined' && module.exports) module.exports = Objectives;
  else { globalThis.SIM = globalThis.SIM || {}; SIM.objectives = Objectives; }
})();
