// First-run tutorial: a short guided tour with a highlight and a card next to each part of the screen.
// Starts once after the first level begins (or on demand from the "?" button). Pauses the sim while open.
window.SIM = window.SIM || {};

SIM.initTour = function () {
  const coach = document.getElementById('coach');
  const STEPS = [
    { target: null, title: 'Welcome',
      text: 'Each level is a real situation. Read the story, build a pipeline that solves it, and meet the goals to earn stars. This quick tour shows the screen.' },
    { target: '#palette', title: 'Elements',
      text: 'Drag elements onto the canvas, or focus one and press Enter. Locked elements unlock as you progress through the levels.' },
    { target: '#canvas', title: 'The canvas',
      text: 'Wire elements together: drag from an output port (the circle on the right) to an input port. Red dots are requests travelling forward, blue dots are replies coming back. Scroll to zoom, drag the background to pan.' },
    { target: '#topbar .controls', title: 'Run controls',
      text: 'Pause, change the speed, or reset the simulation. Nothing counts until requests actually reach the Response Sink with an answer.' },
    { target: '#goals', title: 'Goals',
      text: 'To pass, every green tick in the first group must hold for the hold time. More stars for staying under budget and for excellence. "Stuck? Explain this level" gives plain-text help.' },
    { target: '#metrics', title: 'Live metrics',
      text: 'Throughput, latency, cost and failures update as it runs. Open Details for charts and an event log that says exactly why requests fail.' },
    { target: '#inspector', title: 'Inspector',
      text: 'Click any element to read what it teaches, tune its settings live and watch its queue. You can also connect elements from here without dragging.' },
  ];
  let i = 0, wasRunning = true, active = false, highlighted = null;

  const finish = () => {
    active = false;
    coach.hidden = true;
    if (highlighted) highlighted.classList.remove('tour-target');
    const p = SIM.storage.loadProgress();
    p.onboarded = true;
    SIM.storage.saveProgress(p);
    if (wasRunning) SIM.setRunning(true);
  };

  function show() {
    const s = STEPS[i];
    if (highlighted) highlighted.classList.remove('tour-target');
    const el = s.target && document.querySelector(s.target);
    highlighted = el || null;
    if (el) el.classList.add('tour-target');
    coach.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'coach-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Tutorial: ' + s.title);
    card.innerHTML = '<div class="mkicker"></div><h3></h3><p></p><div class="mactions"></div>';
    card.querySelector('.mkicker').textContent = `Step ${i + 1} of ${STEPS.length}`;
    card.querySelector('h3').textContent = s.title;
    card.querySelector('p').textContent = s.text;
    const actions = card.querySelector('.mactions');
    const add = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.addEventListener('click', fn); actions.appendChild(b); return b; };
    add('Skip tour', '', finish);
    if (i > 0) add('Back', '', () => { i--; show(); });
    const next = add(i === STEPS.length - 1 ? 'Finish' : 'Next', 'primary', () => { if (i === STEPS.length - 1) finish(); else { i++; show(); } });
    coach.appendChild(card);
    coach.hidden = false;
    next.focus();

    // Place the card beside the highlighted area, or centre it.
    const vw = window.innerWidth, vh = window.innerHeight, cw = card.offsetWidth, ch = card.offsetHeight;
    let x = (vw - cw) / 2, y = (vh - ch) / 2;
    if (el) {
      const r = el.getBoundingClientRect();
      x = r.right + 14 + cw < vw ? r.right + 14 : Math.max(10, r.left - cw - 14);
      y = Math.min(Math.max(10, r.top + 10), vh - ch - 10);
      if (r.width > vw * 0.6) { x = (vw - cw) / 2; y = r.top > vh / 2 ? Math.max(10, r.top - ch - 14) : Math.min(vh - ch - 10, r.bottom + 14); }
    }
    card.style.left = Math.max(10, x) + 'px';
    card.style.top = Math.max(10, y) + 'px';
    if (SIM.announce) SIM.announce(`Tutorial step ${i + 1} of ${STEPS.length}: ${s.title}`);
  }

  function start() {
    if (active) return;
    active = true; i = 0;
    wasRunning = SIM.isRunning();
    SIM.setRunning(false);
    show();
  }
  document.getElementById('btn-help').addEventListener('click', start);
  document.addEventListener('keydown', (e) => { if (active && e.key === 'Escape') finish(); });

  SIM.tour = {
    start,
    // First run only: begins once the player has started their first level.
    maybeStart() { if (!SIM.storage.loadProgress().onboarded) start(); },
  };
};
