// Sound feedback: tiny WebAudio synth, no assets. Created lazily on the first sound after a user gesture
// (browsers block audio before one). Noisy events are throttled; the mute choice is saved with progress.
window.SIM = window.SIM || {};

SIM.initSfx = function () {
  const btn = document.getElementById('btn-sound');
  let ctx = null;
  let muted = !!SIM.storage.loadProgress().muted;

  function audio() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, gain, delay, slideTo) {
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.08, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const SOUNDS = {
    place: () => tone(520, 0.08, 'triangle'),
    connect: () => { tone(660, 0.07, 'triangle'); tone(880, 0.09, 'triangle', 0.08, 0.07); },
    block: () => tone(300, 0.07, 'triangle', 0.05),
    fail: () => tone(220, 0.12, 'square', 0.035),
    retry: () => tone(400, 0.08, 'sine', 0.05, 0, 600),
    breach: () => tone(120, 0.4, 'sawtooth', 0.07, 0, 60),
    pass: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'sine', 0.1, i * 0.12)),
  };
  const MIN_GAP = { fail: 600, block: 400, retry: 500, breach: 1500 }; // ms between repeats
  const lastPlayed = {};

  SIM.sfx = {
    play(name) {
      if (muted || !SOUNDS[name]) return;
      const now = performance.now();
      if (MIN_GAP[name] && now - (lastPlayed[name] || -1e9) < MIN_GAP[name]) return;
      lastPlayed[name] = now;
      SOUNDS[name]();
    },
    isMuted: () => muted,
  };

  function paint() {
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-pressed', muted ? 'false' : 'true');
    btn.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
  }
  btn.addEventListener('click', () => {
    muted = !muted;
    const p = SIM.storage.loadProgress();
    p.muted = muted;
    SIM.storage.saveProgress(p);
    paint();
    if (!muted) SIM.sfx.play('place');
  });
  paint();
};
