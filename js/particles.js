// Particle overlay: one <canvas> above the world layer. It reads sim.transits directly each frame
// (no per-particle objects), so cost is one arc per visible request.
// Colors: request red, response blue, injected purple, failed grey (fading).
window.SIM = window.SIM || {};

SIM.initParticles = function (sim) {
  const host = document.getElementById('canvas');
  const cv = document.getElementById('particles');
  const ctx = cv.getContext('2d');
  const MAX_VISIBLE = 1000;   // above this we draw every Nth particle
  const FADE_MS = 700;
  const fades = [];           // {x, y, born, blocked}
  const card = document.getElementById('reqcard');
  const HIT_PX = 9;           // hover radius in screen pixels
  const mouse = { in: false, x: 0, y: 0 }; // x/y relative to the canvas element
  let dpr = 1, cardReq = null, cardTick = 0;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    cv.width = host.clientWidth * dpr;
    cv.height = host.clientHeight * dpr;
  }
  // ResizeObserver also catches the dashboard panel opening and shrinking the canvas.
  new ResizeObserver(resize).observe(host);
  resize();

  host.addEventListener('mousemove', (e) => {
    const r = host.getBoundingClientRect();
    mouse.in = true; mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  });
  host.addEventListener('mouseleave', () => { mouse.in = false; });

  const label = (id) => {
    const n = sim.nodes.get(id);
    return n ? SIM.DEF_MAP[n.defId].label : id;
  };
  function cardText(req) {
    return [
      `#${req.id} · ${req.type} · ${req.phase}`,
      `tokens in ${req.tokensIn} / out ${req.tokensOut}`,
      `path: ${req.path.map(label).join(' → ')}`,
      `cost $${req.cost.toFixed(6)} · age ${Math.round(sim.now - req.createdAt)}ms`,
      req.tags.size ? `tags: ${[...req.tags].join(', ')}` : '',
    ].filter(Boolean).join('\n');
  }
  function showCard(req) {
    // Rewriting text every frame is wasteful; refresh when the request changes or ~6x/s.
    if (req !== cardReq || ++cardTick % 10 === 0) { card.textContent = cardText(req); cardReq = req; }
    card.hidden = false;
    const flip = mouse.x + 14 + card.offsetWidth > host.clientWidth;
    card.style.left = (flip ? mouse.x - 14 - card.offsetWidth : mouse.x + 14) + 'px';
    card.style.top = Math.min(mouse.y + 14, host.clientHeight - card.offsetHeight - 4) + 'px';
  }

  // Turn sim 'fail' events into fading dots at the node that dropped the request (and flash the node).
  function collectFades() {
    const evs = sim.drainEvents();
    const limit = Math.min(evs.length, 50); // a timeout storm should not flood the layer
    for (let i = 0; i < limit; i++) {
      const n = SIM.store.state.nodes.find((x) => x.id === evs[i].nodeId);
      const el = n && document.querySelector(`#nodes [data-id="${n.id}"]`);
      if (!el) continue;
      const art = el.querySelector('.art');
      if (!SIM.reducedMotion) {
        fades.push({ x: n.x + el.offsetWidth / 2, y: n.y + (art ? art.offsetTop + art.offsetHeight / 2 : el.offsetHeight / 2), born: performance.now(), blocked: evs[i].blocked });
        if (!el.classList.contains('flash')) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 450); }
      }
    }
  }

  // Performance: particles are bucketed by colour into preallocated arrays, then each colour is filled with
  // ONE path, so thousands of particles cost a handful of canvas calls instead of one per dot.
  // Colours: request red, response blue, injected purple, cached gold.
  const COLORS = ['#ef4444', '#3b82f6', '#a855f7', '#fbbf24'];
  const buckets = COLORS.map(() => ({ xs: new Float32Array(MAX_VISIBLE + 16), ys: new Float32Array(MAX_VISIBLE + 16), n: 0 }));
  const pt = { x: 0, y: 0 };
  const R = 4.5, TAU = 6.2832;

  function dot(x, y, r, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  // visualNow = sim.now plus the unspent accumulator, so motion is smooth between 20Hz ticks.
  SIM.drawParticles = function (visualNow) {
    collectFades();
    const v = SIM.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);

    const list = sim.transits;
    const stride = Math.max(1, Math.ceil(list.length / MAX_VISIBLE));
    // Hover hit-test piggybacks on the draw loop: nearest drawn particle within HIT_PX of the cursor.
    const mx = (mouse.x - v.x) / v.k, my = (mouse.y - v.y) / v.k;
    let hit = null, hitX = 0, hitY = 0, best = (HIT_PX / v.k) * (HIT_PX / v.k);
    buckets.forEach((b) => { b.n = 0; });
    for (let i = 0; i < list.length; i += stride) {
      const tr = list[i], g = SIM.edgeGeo.get(tr.edgeId);
      if (!g) continue;
      let t = (visualNow - tr.t0) / (tr.t1 - tr.t0);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      SIM.bezierPoint(g.a, g.b, tr.dir === 1 ? t : 1 - t, pt);
      const tags = tr.req.tags;
      const b = buckets[tags.has('injected') ? 2 : tags.has('cached') ? 3 : tr.dir === 1 ? 0 : 1];
      if (b.n < b.xs.length) { b.xs[b.n] = pt.x; b.ys[b.n] = pt.y; b.n++; }
      if (mouse.in) {
        const d2 = (pt.x - mx) * (pt.x - mx) + (pt.y - my) * (pt.y - my);
        if (d2 <= best) { best = d2; hit = tr.req; hitX = pt.x; hitY = pt.y; }
      }
    }
    ctx.globalAlpha = 1;
    for (let c = 0; c < buckets.length; c++) {
      const b = buckets[c];
      if (!b.n) continue;
      ctx.fillStyle = COLORS[c];
      ctx.beginPath();
      for (let k = 0; k < b.n; k++) { ctx.moveTo(b.xs[k] + R, b.ys[k]); ctx.arc(b.xs[k], b.ys[k], R, 0, TAU); }
      ctx.fill();
    }
    if (hit) {
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2 / v.k;
      ctx.beginPath(); ctx.arc(hitX, hitY, 8, 0, TAU); ctx.stroke();
      showCard(hit);
    } else { card.hidden = true; cardReq = null; }

    const t = performance.now();
    for (let i = fades.length - 1; i >= 0; i--) {
      const f = fades[i], age = (t - f.born) / FADE_MS;
      if (age >= 1) { fades.splice(i, 1); continue; }
      dot(f.x, f.y - age * 14, 5, f.blocked ? '#9ca3af' : '#6b7280', 1 - age);
    }
    ctx.globalAlpha = 1;
  };
};
