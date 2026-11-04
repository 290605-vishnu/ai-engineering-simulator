// Metrics strip (always visible) plus an expandable panel with sparklines and the event log.
// Reads sim snapshots only; it never mutates the sim.
window.SIM = window.SIM || {};

SIM.initDashboard = function () {
  const strip = document.getElementById('strip');
  const dash = document.getElementById('dash');
  const sparksEl = document.getElementById('sparks');
  const logEl = document.getElementById('log');
  const toggle = document.getElementById('btn-dash');

  const MAX_POINTS = 120;      // one sample per simulated second
  const MAX_LOG_ROWS = 100;
  const MAX_NEW_ROWS = 30;     // a timeout storm should not flood the DOM
  let lastSample = 0, lastSeq = 0;

  const money = (v) => '$' + (v < 0.01 ? v.toFixed(5) : v.toFixed(3));
  const TILES = [
    { id: 'thr', label: 'Throughput', val: (s) => s.throughput.toFixed(1) + '/s' },
    { id: 'lat', label: 'Latency p50 / p95', val: (s) => `${Math.round(s.p50)} / ${Math.round(s.p95)} ms` },
    { id: 'ok', label: 'Success', val: (s) => Math.round(s.successRate * 100) + '%' },
    { id: 'cost', label: 'Cost / min', val: (s) => money(s.costPerMin) },
    { id: 'sent', label: 'Sent', val: (s) => s.sent },
    { id: 'fail', label: 'Failed', val: (s) => s.failed, warn: (s) => s.failed > 0 },
    { id: 'blk', label: 'Blocked', val: (s) => s.blocked },
    { id: 'brc', label: 'Breaches', val: (s) => `${s.malicious.breached} / ${s.malicious.sent}`, warn: (s) => s.malicious.breached > 0 },
    { id: 'fp', label: 'False positives', val: (s) => s.falsePositives },
    { id: 'cache', label: 'Cache hits', val: (s) => s.cacheHits },
  ];
  const tileEls = {};
  // Hovering a metric explains it in plain words (glossary definitions).
  const TIPS = { thr: 'throughput', lat: 'p95', ok: 'success', cost: 'cost', sent: 'request', fail: 'success', blk: 'guardrail', brc: 'injection', fp: 'falsepositive', cache: 'cache' };
  TILES.forEach((t) => {
    const d = document.createElement('div');
    d.className = 'tile';
    const g = SIM.GLOSSARY && SIM.GLOSSARY[TIPS[t.id]];
    if (g) d.title = g.term + ': ' + g.def;
    d.innerHTML = '<span class="tl"></span><b class="tv"></b>';
    d.firstChild.textContent = t.label;
    strip.appendChild(d);
    tileEls[t.id] = d.lastChild;
  });

  const SERIES = [
    { id: 'thr', label: 'Throughput /s', color: '#3b82f6', get: (s) => s.throughput, fmt: (v) => v.toFixed(1) },
    { id: 'p95', label: 'p95 latency ms', color: '#f59e0b', get: (s) => s.p95, fmt: (v) => Math.round(v) },
    { id: 'q', label: 'Queued requests', color: '#ef4444', get: (s, sim) => queued(sim), fmt: (v) => Math.round(v) },
  ];
  SERIES.forEach((sr) => {
    sr.data = [];
    const box = document.createElement('div');
    box.className = 'spark';
    box.innerHTML = '<div class="sl"><span></span><b></b></div><canvas width="240" height="52"></canvas>';
    box.querySelector('span').textContent = sr.label;
    sr.valEl = box.querySelector('b');
    sr.cv = box.querySelector('canvas');
    sparksEl.appendChild(box);
  });

  const queued = (sim) => { let q = 0; sim.nodes.forEach((n) => { q += n.queue.length; }); return q; };

  function drawSpark(sr) {
    const cv = sr.cv, ctx = cv.getContext('2d'), w = cv.width, h = cv.height, d = sr.data;
    ctx.clearRect(0, 0, w, h);
    if (d.length < 2) return;
    const max = Math.max(1, ...d);
    const x = (i) => (i / (MAX_POINTS - 1)) * w, y = (v) => h - 3 - (v / max) * (h - 8);
    const x0 = w - x(d.length - 1); // right-align so the newest sample sits at the edge
    ctx.beginPath();
    d.forEach((v, i) => (i ? ctx.lineTo(x(i) + x0, y(v)) : ctx.moveTo(x(i) + x0, y(v))));
    ctx.strokeStyle = sr.color; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(x0, h); ctx.closePath();
    ctx.globalAlpha = 0.15; ctx.fillStyle = sr.color; ctx.fill(); ctx.globalAlpha = 1;
  }

  const nodeLabel = (sim, id) => {
    const n = sim.nodes.get(id);
    return n ? SIM.DEF_MAP[n.defId].label : id || '?';
  };
  const LOG_TEXT = {
    fail: (sim, e) => `${e.reason} at ${nodeLabel(sim, e.nodeId)} (${e.type})`,
    block: (sim, e) => `blocked malicious request at ${nodeLabel(sim, e.nodeId)}`,
    falsepos: (sim, e) => `blocked a legitimate request at ${nodeLabel(sim, e.nodeId)}`,
    breach: () => 'malicious request got a response',
    retry: (sim, e) => `retrying after ${e.reason} (from ${nodeLabel(sim, e.nodeId)})`,
  };
  const LOG_ICON = { fail: '✖', block: '🛡', falsepos: '⚠', breach: '☠', retry: '🔁' };

  function appendLog(sim) {
    const fresh = sim.readLog(lastSeq);
    if (!fresh.length) return;
    lastSeq = fresh[fresh.length - 1].seq;
    fresh.slice(-MAX_NEW_ROWS).forEach((e) => {
      const row = document.createElement('div');
      row.className = 'ev ev-' + e.kind;
      row.textContent = `${(e.t / 1000).toFixed(1)}s  ${LOG_ICON[e.kind]} ${LOG_TEXT[e.kind](sim, e)}`;
      logEl.prepend(row);
    });
    while (logEl.children.length > MAX_LOG_ROWS) logEl.lastChild.remove();
  }

  toggle.addEventListener('click', () => {
    const open = dash.classList.toggle('open');
    toggle.textContent = open ? 'Details ▼' : 'Details ▲';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  SIM.dashboard = {
    reset() {
      lastSample = 0; lastSeq = 0;
      SERIES.forEach((sr) => { sr.data = []; drawSpark(sr); });
      logEl.innerHTML = '';
    },
    update(sim, s) {
      TILES.forEach((t) => {
        const v = tileEls[t.id];
        v.textContent = t.val(s);
        v.classList.toggle('warn', !!(t.warn && t.warn(s)));
      });
      // One sample per simulated second keeps charts honest at any playback speed.
      while (sim.now - lastSample >= 1000) {
        lastSample += 1000;
        SERIES.forEach((sr) => { sr.data.push(sr.get(s, sim)); if (sr.data.length > MAX_POINTS) sr.data.shift(); });
      }
      if (!dash.classList.contains('open')) { lastSeq = Math.max(lastSeq, sim.logSeq - MAX_NEW_ROWS); return; }
      SERIES.forEach((sr) => {
        const d = sr.data;
        sr.valEl.textContent = d.length ? sr.fmt(d[d.length - 1]) : '–';
        drawSpark(sr);
      });
      appendLog(sim);
    },
  };
};
