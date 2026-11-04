// Runtime controller: owns the sim instance, the rAF loop, playback controls and the periodic HUD update.
// The sim is stepped at a fixed tickMs; playback speed only changes how much sim time each frame feeds it.
window.SIM = window.SIM || {};

SIM.initRuntime = function () {
  const store = SIM.store;
  const sim = SIM.createSim({
    defs: SIM.NODE_DEFS, behaviors: SIM.behaviors, seed: (Math.random() * 1e9) | 0,
  });
  SIM.sim = sim;
  SIM.initParticles(sim);

  const MAX_STEPS_PER_FRAME = 10; // if the tab lags, drop time rather than spiral
  let running = true, speed = 1, acc = 0, lastFrame = performance.now(), lastHud = 0;

  const $ = (id) => document.getElementById(id);
  const playBtn = $('btn-play');

  // Engine follows the editor graph; instances persist so edits don't wipe queues.
  store.subscribe((s) => sim.setGraph(s.nodes, s.edges));

  SIM.setRunning = function (on) {
    running = on;
    playBtn.textContent = running ? '⏸ Pause' : '▶ Play';
  };
  SIM.isRunning = () => running;
  playBtn.addEventListener('click', () => SIM.setRunning(!running));
  document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    speed = Number(b.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
    });
  }));
  $('btn-reset').addEventListener('click', () => { sim.reset(); SIM.dashboard.reset(); SIM.campaign.onSimReset(); updateHud(); });

  // Per-node badge text. The tap shows what tracing gives you: throughput and request age at that point.
  function badgeText(n) {
    if (n.defId === 'trafficSource') return '';
    if (n.defId === 'observabilityTap') {
      const seen = n.state.seen || [];
      const ages = seen.map((s) => s[1]).sort((a, b) => a - b);
      const span = Math.max(1, Math.min(10, sim.now / 1000));
      return `${(seen.length / span).toFixed(1)}/s · age p50 ${ages.length ? Math.round(ages[ages.length >> 1]) : 0} ms`;
    }
    return `q ${n.queue.length} · busy ${n.inFlight.length}`;
  }

  // Sound + toasts from what just happened in the sim (the log is polled, never pushed, so this stays cheap).
  let sfxSeq = 0, lastToast = 0;
  function feedback() {
    if (sim.logSeq < sfxSeq) sfxSeq = 0; // sim was reset
    const fresh = sim.readLog(sfxSeq);
    if (!fresh.length) return;
    sfxSeq = fresh[fresh.length - 1].seq;
    if (!running) return;
    const kinds = new Set(fresh.map((e) => e.kind));
    const sfx = SIM.sfx;
    if (kinds.has('breach')) {
      sfx.play('breach');
      if (performance.now() - lastToast > 4000) { lastToast = performance.now(); SIM.toast('☠ An attack got a real answer', 'bad'); SIM.announce('Breach: an attack got a real answer'); }
    } else if (kinds.has('fail')) sfx.play('fail');
    else if (kinds.has('retry')) sfx.play('retry');
    else if (kinds.has('block')) sfx.play('block');
  }

  function updateHud() {
    const s = sim.snapshot();
    feedback();
    SIM.dashboard.update(sim, s);
    SIM.campaign.update(sim);
    SIM.refreshInspector(sim);
    // Node badge + heat glow: amber -> red as the queue deepens.
    sim.nodes.forEach((n) => {
      const el = document.querySelector(`#nodes [data-id="${n.id}"]`);
      if (!el) return;
      const q = n.queue.length;
      const heat = Math.min(1, q / 20);
      el.querySelector('.qbadge').textContent = badgeText(n);
      el.style.setProperty('--glow', q ? `${4 + heat * 14}px` : '0px');
      el.style.setProperty('--heat', `hsl(${40 - 40 * heat}, 90%, 55%)`);
    });
  }

  function frame(t) {
    const dt = Math.min(100, t - lastFrame);
    lastFrame = t;
    if (running) {
      acc += dt * speed;
      let steps = 0;
      while (acc >= SIM.tuning.tickMs && steps < MAX_STEPS_PER_FRAME) {
        sim.step(SIM.tuning.tickMs);
        acc -= SIM.tuning.tickMs;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0;
    }
    SIM.drawParticles(sim.now + (running ? acc : 0));
    if (t - lastHud > 250) { lastHud = t; updateHud(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
};
