// Campaign: level select, situation/question intro, goals panel, plain-text explanations, result screen,
// and progress. The game is level-based only (no sandbox). Objective maths lives in engine/objectives.js;
// scenarios in campaign/levels.js. This file is UI + state.
window.SIM = window.SIM || {};

SIM.initCampaign = function () {
  const store = SIM.store, O = SIM.objectives, LEVELS = SIM.LEVELS;
  const $ = (id) => document.getElementById(id);
  const state = { level: null, hold: 0, lastNow: 0, done: false, lastResults: null };
  let progress = Object.assign({ levels: {} }, SIM.storage.loadProgress());
  let goalEls = [], holdEls = null;

  // Tiny DOM helper: h('div', 'cls', 'text' | [children])
  const h = (tag, cls, content) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (Array.isArray(content)) content.forEach((c) => c && e.appendChild(c));
    else if (content !== undefined) e.textContent = content;
    return e;
  };
  // **bold** markers in learning text -> <b>
  const rich = (text) => {
    const span = h('span');
    text.split('**').forEach((part, i) => span.appendChild(i % 2 ? h('b', null, part) : document.createTextNode(part)));
    return span;
  };
  const termList = (keys) => h('dl', 'terms', keys.flatMap((k) => {
    const g = SIM.GLOSSARY[k];
    return g ? [h('dt', null, g.term), h('dd', null, g.def)] : [];
  }));
  // A pill with the element's 3D icon and name.
  const chipFor = (def) => { const c = h('span', 'chip'); c.innerHTML = SIM.iconLabel(def, 28); return c; };
  const tierOf = (lv) => SIM.TIERS.find((t) => t.id === lv.tier);
  const primerSeen = (tier) => !!(SIM.storage.loadProgress().primers || {})[tier.id];
  const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
  const levelById = (id) => LEVELS.find((l) => l.id === id);
  const starsOf = (id) => (progress.levels[id] && progress.levels[id].stars) || 0;
  const levelUnlocked = (id) => progress.unlockAll || id === LEVELS[0].id || starsOf(id - 1) > 0; // beat the previous level
  const unlockLevel = (defId) => (LEVELS.find((l) => l.unlocks.includes(defId)) || {}).id;
  // Several modules share the progress record (sfx saves `muted`, the tour `onboarded`), so each saves only its own keys.
  const save = () => {
    const p = SIM.storage.loadProgress();
    p.levels = progress.levels; p.last = progress.last; p.unlockAll = progress.unlockAll;
    SIM.storage.saveProgress(p);
  };

  // What the level pins on an element (traffic on the source, `locks` on others).
  const overrideFor = (defId) => {
    const lv = state.level;
    if (!lv) return null;
    return defId === 'trafficSource' ? lv.traffic : (lv.locks && lv.locks[defId]) || null;
  };

  // ---------- public surface used by palette / canvas / inspector / runtime / share ----------
  SIM.campaign = {
    reapplyLevelConfig: () => applyLevelConfig(),
    // Elements are cumulative: everything unlocked by levels up to and including the current one.
    isAvailable: (defId) => !!state.level && LEVELS.some((l) => l.id <= state.level.id && l.unlocks.includes(defId)),
    unlockLevel,
    isLocked: (defId, key) => !!(overrideFor(defId) && key in overrideFor(defId)),
    level: () => state.level,
    progress: () => progress,
    saveProgress: save,
    update,
    onSimReset() { state.hold = 0; state.lastNow = 0; state.done = false; },
    startLevel: (id, opts) => startLevel(id, opts),
    // A plain-text description of the traffic the level sends (the source has no editable controls).
    trafficProfile(config) {
      const lv = state.level, rows = [];
      rows.push(['Rate', `${config.rate} requests/s`]);
      const mix = config.mix || (typeof config.maliciousPct === 'number'
        ? { qa: 100 - config.maliciousPct, malicious: config.maliciousPct } : { qa: 85, malicious: 15 });
      const total = Object.values(mix).reduce((a, b) => a + b, 0);
      rows.push(['Mix', Object.entries(mix).filter(([, w]) => w > 0).map(([t, w]) => `${t} ${Math.round((100 * w) / total)}%`).join(' · ')]);
      if (config.keyPool > 0) rows.push(['Repeats', `only ${config.keyPool} distinct prompts`]);
      if (config.burst) {
        rows.push(['Bursts', `x${config.burstFactor || SIM.tuning.burst.factor} for ${(config.burstLenMs || SIM.tuning.burst.lengthMs) / 1000} s every ${(config.burstEveryMs || SIM.tuning.burst.periodMs) / 1000} s`]);
      }
      Object.entries((lv && lv.chaos) || {}).forEach(([d, p]) =>
        rows.push(['Provider errors', `${SIM.DEF_MAP[d].label} fails ${Math.round(p * 100)}% of calls`]));
      return rows;
    },
  };

  // ---------- modal ----------
  const modal = $('modal'), card = $('modal-card');
  let resumeAfter = false;
  function openModal(content) {
    if (modal.hidden) resumeAfter = SIM.isRunning();
    SIM.setRunning(false);
    card.innerHTML = '';
    card.appendChild(content);
    modal.hidden = false;
    if (SIM.focusModal) SIM.focusModal();
  }
  function closeModal(resume) {
    modal.hidden = true;
    if (resume && resumeAfter) SIM.setRunning(true);
  }
  SIM.closeModal = closeModal;
  SIM.openModal = openModal;
  const btn = (label, cls, fn) => { const b = h('button', cls, label); b.addEventListener('click', fn); return b; };

  // ---------- starting a level ----------
  function applyLevelConfig() {
    const lv = state.level;
    store.configOverride = overrideFor;
    Object.entries(lv.traffic).forEach(([k, v]) => store.setConfigFor('trafficSource', k, v));
    Object.entries(lv.locks || {}).forEach(([d, cfg]) => Object.entries(cfg).forEach(([k, v]) => store.setConfigFor(d, k, v)));
  }

  function startLevel(id, opts = {}) {
    const lv = levelById(id);
    state.level = lv;
    if (!home.hidden) { home.hidden = true; document.body.classList.remove('home-open'); }
    store.configOverride = overrideFor;
    store.switchSlot('level:' + id, lv.starter);
    if (opts.restart) store.restartSlot(lv.starter);
    applyLevelConfig();
    progress.last = id;
    save();

    SIM.sim.reset();
    SIM.sim.setChaos(lv.chaos);
    SIM.dashboard.reset();
    SIM.campaign.onSimReset();
    document.body.classList.add('in-level');
    $('mode-title').textContent = `· Level ${lv.id}: ${lv.title}`;
    ['btn-levels', 'btn-restart', 'btn-explain'].forEach((b) => { $(b).hidden = false; });
    SIM.refreshPalette();
    SIM.fitView();
    SIM.setRunning(true);
    buildGoals();
    if (opts.intro !== false) {
      const tier = tierOf(lv);
      if (tier && lv.id === tier.levels[0] && !primerSeen(tier)) showPrimer(tier, () => showIntro(lv));
      else showIntro(lv);
    }
    if (SIM.announce) SIM.announce(`Level ${lv.id}: ${lv.title}`);
  }

  // ---------- goals panel ----------
  const TIERS = [[1, '★ Pass the level'], [2, '★★ Under budget'], [3, '★★★ Excellence']];
  function buildGoals() {
    const lv = state.level, root = $('goals');
    root.hidden = false;
    root.innerHTML = '';
    goalEls = [];
    root.appendChild(h('div', 'goals-head', [h('b', null, `Level ${lv.id}`), h('span', 'best', 'Best ' + starStr(starsOf(lv.id)))]));
    root.appendChild(h('div', 'goals-title', lv.title));
    const sit = h('details', 'sit', [h('summary', null, 'Situation'), h('p', null, lv.situation)]);
    root.appendChild(sit);
    root.appendChild(h('div', 'goal-question', lv.question));
    TIERS.forEach(([tier, title]) => {
      const objs = lv.objectives.map((o, i) => [o, i]).filter(([o]) => (o.star || 1) === tier);
      if (!objs.length) return;
      root.appendChild(h('div', 'tier', title));
      objs.forEach(([o, i]) => {
        const icon = h('span', 'gi', '⏳'), val = h('span', 'gv', '–');
        root.appendChild(h('div', 'goal', [icon, h('span', 'gl', o.label), val]));
        goalEls[i] = { icon, val };
      });
    });
    const fill = h('i'), label = h('span', null, '');
    root.appendChild(h('div', 'hold', [h('div', 'bar', [fill]), label]));
    holdEls = { fill, label };
    if (lv.steps) root.appendChild(h('details', 'sit', [h('summary', null, 'Step by step'), h('ol', 'steps', lv.steps.map((t) => h('li', null, [rich(t)])))]));
    if (lv.terms && lv.terms.length) root.appendChild(h('details', 'sit', [h('summary', null, 'New words'), termList(lv.terms)]));
    root.appendChild(btn('Stuck? Explain this level', 'explain-btn', showExplain));
    root.appendChild(h('div', 'goal-hint muted', 'Hint: ' + lv.hint));
    paintHold();
  }
  function paintHold() {
    if (!holdEls || !state.level) return;
    holdEls.fill.style.width = Math.min(100, (state.hold / state.level.holdSec) * 100) + '%';
    holdEls.label.textContent = `Hold all pass goals ${Math.floor(state.hold)} / ${state.level.holdSec} s`;
  }
  function paint(results) {
    const lv = state.level;
    results.forEach((r, i) => {
      const g = goalEls[i];
      if (!g) return;
      g.icon.textContent = r.met ? '✓' : r.warming ? '⏳' : '✗';
      g.icon.className = 'gi ' + (r.met ? 'ok' : r.warming ? 'wait' : 'bad');
      g.val.textContent = O.fmtValue(lv.objectives[i].metric, r.value);
    });
    paintHold();
  }

  // Called at HUD rate by the runtime. Hold time is counted in simulated seconds, so it is
  // fair at any playback speed and pauses when the sim does.
  function update(sim) {
    if (!state.level || state.done) return;
    const lv = state.level, now = sim.now;
    if (now < state.lastNow) state.hold = 0; // sim was reset
    const dt = now - state.lastNow;
    state.lastNow = now;
    const results = O.evaluate(lv.objectives, (w) => sim.windowStats(w), now);
    state.lastResults = results;
    state.hold = O.passed(lv.objectives, results) ? state.hold + dt / 1000 : 0;
    paint(results);
    if (state.hold >= lv.holdSec) complete(results);
  }

  function complete(results) {
    const lv = state.level, stars = O.stars(lv.objectives, results);
    state.done = true;
    if (stars > starsOf(lv.id)) progress.levels[lv.id] = { stars };
    save();
    $('goals').querySelector('.best').textContent = 'Best ' + starStr(starsOf(lv.id));
    if (SIM.sfx) SIM.sfx.play('pass');
    if (SIM.announce) SIM.announce(`Level complete with ${stars} stars`);
    showResult(lv, results, stars);
  }

  // ---------- plain-text diagnosis of the current pipeline ----------
  const REASON_TEXT = {
    no_answer: 'Requests are reaching the Response Sink without any model having answered them, so users get an empty reply. Route them through a model first.',
    no_route: 'Some requests arrive at an output that is not connected to anything. Check every output port that carries traffic.',
    timeout: 'Requests are waiting too long in queues (look for the amber glow): something is overloaded. Add capacity or raise concurrency.',
    attempt_timeout: 'Attempts are timing out inside the retry window, usually because a node downstream is overloaded.',
    context_overflow: 'Prompts are longer than a model\'s context window. Pick a model with a larger window.',
    provider_error: 'The model provider is returning errors. Add a Fallback / Retry so failed calls are sent again.',
    hallucination: 'The model is inventing answers because it has no clean, relevant context. Retrieve, then rerank, before the model.',
    low_quality: 'A Small model is answering hard questions badly. Send complex requests to a stronger model.',
    off_domain: 'A fine-tuned model is being asked about something outside its specialty.',
    rate_limited: 'The Rate Limiter is rejecting requests. Raise its limit or send the "limited" output somewhere useful.',
    over_budget: 'The Cost Budget Gate is over budget and its "over" output goes nowhere.',
    rejected: 'The judge rejected answers and the "reject" output goes nowhere.',
    no_embedding: 'The Retriever received questions that were never embedded. Put an Embedding Model before it.',
    bad_tool_call: 'The model produced malformed tool calls. A Skill (or a Plugin) makes them reliable.',
    tool_result_missing: 'A model is answering a tool request without a tool result. Wire a Tool Executor and a Connector between the two model passes.',
    connector_error: 'The external system is failing. Give the Connector retries, or use a Plugin.',
    step_budget: 'Agent tasks are running past the step budget. Do more per step: a Sub-agent completes two steps per call.',
    loop_detected: 'A request is going round in circles. Check for a loop that never reaches the sink.',
  };
  function diagnose(sim) {
    const lines = [], now = sim.now, snap = sim.snapshot();
    if (!snap.sent) return ['No requests are flowing yet: connect the Traffic Source output to the first element of your pipeline.'];
    const counts = {};
    sim.readLog(0).filter((e) => e.t >= now - 20000).forEach((e) => { counts[e.kind === 'fail' ? e.reason : e.kind] = (counts[e.kind === 'fail' ? e.reason : e.kind] || 0) + 1; });
    Object.entries(counts).filter(([k]) => REASON_TEXT[k]).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .forEach(([k, n]) => lines.push(`${REASON_TEXT[k]} (${n} in the last 20 s)`));
    if (counts.breach) lines.push(`Attacks are getting real answers (${counts.breach} in the last 20 s). A Guardrail would stop them.`);
    if (counts.falsepos) lines.push(`Real users are being blocked by the Guardrail (${counts.falsepos} in the last 20 s). Lower its strictness a little.`);
    if (!lines.length) lines.push(`Requests are flowing without failures (${snap.completed} answered so far). Any unmet goal below is about speed, cost or volume rather than errors.`);
    return lines;
  }
  const unmetLines = (lv, results) => lv.objectives
    .map((o, i) => [o, results && results[i]]).filter(([, r]) => !r || !r.met)
    .map(([o, r]) => `${o.label}${r && r.value !== null && r.value !== undefined ? ` (now ${O.fmtValue(o.metric, r.value)})` : ''}`);

  const list = (items) => h('ul', 'plainlist', items.map((t) => h('li', null, t)));

  // ---------- modals ----------
  function showIntro(lv) {
    const unlocked = lv.unlocks.map((id) => SIM.DEF_MAP[id]);
    openModal(h('div', 'mbody', [
      h('div', 'mkicker', `Level ${lv.id}`),
      h('h2', null, lv.title),
      h('div', 'mkicker', 'Situation'),
      h('p', null, lv.situation),
      h('div', 'question', [h('b', null, 'The question'), h('div', null, lv.question)]),
      lv.steps ? h('div', 'mkicker', 'Step by step') : null,
      lv.steps ? h('ol', 'steps', lv.steps.map((t) => h('li', null, [rich(t)]))) : null,
      unlocked.length ? h('div', 'mkicker', 'New elements') : null,
      unlocked.length ? h('div', 'chips', unlocked.map((d) => chipFor(d))) : null,
      lv.terms && lv.terms.length ? h('div', 'mkicker', 'New words') : null,
      lv.terms && lv.terms.length ? termList(lv.terms) : null,
      h('div', 'mkicker', 'To pass'),
      h('ul', 'mgoals', lv.objectives.filter((o) => (o.star || 1) === 1).map((o) => h('li', null, o.label))),
      h('div', 'mactions', [btn('Start', 'primary', () => { closeModal(false); SIM.setRunning(true); SIM.tour.maybeStart(); })]),
    ]));
  }

  // Available any time: the same two-part explanation the result screen ends with, with live detail.
  function showExplain() {
    const lv = state.level;
    if (!lv) return;
    const unmet = unmetLines(lv, state.lastResults);
    openModal(h('div', 'mbody', [
      h('div', 'mkicker', `Level ${lv.id} · ${lv.title}`),
      h('h2', null, 'Explain this level'),
      h('div', 'partition', [
        h('div', 'part', [h('h3', null, 'What is happening'), h('p', null, lv.explain.happening),
          h('div', 'mkicker', 'Right now in your pipeline'), list(diagnose(SIM.sim))]),
        h('div', 'part', [h('h3', null, 'What needs to happen to pass'), h('p', null, lv.explain.needed),
          unmet.length ? h('div', 'mkicker', 'Still to fix') : null, unmet.length ? list(unmet) : null]),
      ]),
      h('div', 'mactions', [btn('Back to the level', 'primary', () => closeModal(true))]),
    ]));
  }

  function showResult(lv, results, stars) {
    const next = levelById(lv.id + 1);
    const missed = lv.objectives.filter((o, i) => (o.star || 1) === stars + 1 && !results[i].met).map((o) => o.label);
    const rows = lv.objectives.map((o, i) => h('div', 'goal', [
      h('span', 'gi ' + (results[i].met ? 'ok' : 'bad'), results[i].met ? '✓' : '✗'),
      h('span', 'gl', o.label),
      h('span', 'gv', O.fmtValue(o.metric, results[i].value)),
    ]));
    const actions = [];
    if (next) actions.push(btn('Next level', 'primary', () => { closeModal(false); startLevel(next.id); }));
    actions.push(btn('Keep playing', next ? '' : 'primary', () => closeModal(true)));
    actions.push(btn('Replay', '', () => { closeModal(false); startLevel(lv.id, { restart: true }); }));
    actions.push(btn('Home', '', () => { closeModal(false); showHome(); }));
    openModal(h('div', 'mbody', [
      h('div', 'mkicker', `Level ${lv.id} complete`),
      h('h2', 'stars-title', [document.createTextNode(lv.title + '  '), h('span', 'stars', starStr(stars))]),
      h('div', 'results', rows),
      stars < 3 ? h('p', 'muted', `Next star: ${missed.join('; ')}.`) : h('p', 'muted', 'Perfect score!'),
      tierOf(lv) && tierOf(lv).levels[tierOf(lv).levels.length - 1] === lv.id
        ? h('p', 'tierdone', `${tierOf(lv).icon} You finished the ${tierOf(lv).name} tier!`) : null,
      h('div', 'partition', [
        h('div', 'part', [h('h3', null, 'What was happening'), h('p', null, lv.explain.happening)]),
        h('div', 'part', [h('h3', null, 'What needed to happen to pass'), h('p', null, lv.explain.needed)]),
      ]),
      h('div', 'concept learned', [h('b', null, 'What you learned'), h('div', null, lv.learned)]),
      h('div', 'mactions', actions),
    ]));
  }

  // ---------- primer + glossary ----------
  function showPrimer(tier, then) {
    const p = SIM.storage.loadProgress();
    p.primers = Object.assign({}, p.primers, { [tier.id]: true });
    SIM.storage.saveProgress(p);
    openModal(h('div', 'mbody', [
      h('div', 'mkicker', `${tier.icon} ${tier.name} tier`),
      h('h2', null, tier.primer.title),
      h('ul', 'primer', tier.primer.points.map((t) => h('li', null, [rich(t)]))),
      h('div', 'mkicker', 'Words you will meet'),
      termList(tier.primer.terms),
      h('div', 'mactions', [btn('Got it', 'primary', () => { closeModal(false); if (then) then(); else SIM.setRunning(true); })]),
    ]));
  }
  function showGlossary() {
    const input = h('input');
    input.placeholder = 'Search words...';
    input.setAttribute('aria-label', 'Search the glossary');
    const list = h('dl', 'terms big');
    const render = () => {
      const q = input.value.trim().toLowerCase();
      list.innerHTML = '';
      Object.values(SIM.GLOSSARY).filter((g) => !q || (g.term + ' ' + g.def).toLowerCase().includes(q))
        .sort((x, y) => x.term.localeCompare(y.term))
        .forEach((g) => { list.appendChild(h('dt', null, g.term)); list.appendChild(h('dd', null, g.def)); });
    };
    input.addEventListener('input', render);
    render();
    openModal(h('div', 'mbody', [
      h('h2', null, 'Glossary'),
      h('p', 'muted', 'Plain-language meanings of every term used in the game.'),
      input, list,
      h('div', 'mactions', [btn('Close', 'primary', () => closeModal(true))]),
    ]));
    input.focus();
  }
  SIM.showGlossary = showGlossary;

  // Start over: wipes stars, saved pipelines, primers and tutorial progress (the sound choice is kept).
  function showReset() {
    openModal(h('div', 'mbody', [
      h('h2', null, 'Reset all progress?'),
      h('p', null, 'This erases every star you have earned, your saved pipeline for every level, and your tutorial and primer progress. Your sound setting is kept. It cannot be undone.'),
      h('div', 'mactions', [
        btn('Cancel', 'primary', () => closeModal(false)),
        btn('Yes, reset everything', 'danger', resetAll),
      ]),
    ]));
  }
  function resetAll() {
    try {
      const muted = !!SIM.storage.loadProgress().muted;
      Object.keys(localStorage).filter((k) => k.startsWith('aisim.')).forEach((k) => localStorage.removeItem(k));
      if (muted) SIM.storage.saveProgress({ levels: {}, muted: true });
    } catch (e) { /* storage unavailable: nothing was saved anyway */ }
    location.reload(); // simplest way to get every module back to a clean first-run state
  }

  // ---------- home dashboard (the front screen: pick a level) ----------
  const home = $('home');
  let homeResume = false;
  const firstSentence = (t) => (t.match(/^.*?[.!?](\s|$)/) || [t])[0].trim();

  function hideHome(resume) {
    home.hidden = true;
    document.body.classList.remove('home-open');
    if (resume && homeResume) SIM.setRunning(true);
  }
  function showHome() {
    if (home.hidden) homeResume = !!state.level && SIM.isRunning();
    SIM.setRunning(false);
    closeModal(false);
    const total = LEVELS.length;
    const totalStars = LEVELS.reduce((n, l) => n + starsOf(l.id), 0);
    const done = LEVELS.filter((l) => starsOf(l.id) > 0).length;
    const nextId = (LEVELS.find((l) => levelUnlocked(l.id) && starsOf(l.id) === 0) || {}).id;
    const resumeId = progress.last && levelById(progress.last) && levelUnlocked(progress.last) ? progress.last : nextId || 1;

    const open = (id) => { hideHome(false); startLevel(id); };
    const cardFor = (lv) => {
      const unlocked = levelUnlocked(lv.id), stars = starsOf(lv.id);
      const status = !unlocked ? '🔒 Locked' : stars === 3 ? '★ Mastered' : stars > 0 ? 'Completed' : lv.id === nextId ? 'Up next' : 'Available';
      const c = h('button', 'hcard' + (unlocked ? '' : ' locked') + (stars === 3 ? ' gold' : '') + (lv.id === nextId ? ' next' : ''), [
        h('div', 'hc-top', [h('span', 'hc-num', `Level ${lv.id}`), h('span', 'hc-status', status)]),
        h('div', 'hc-title', lv.title),
        h('div', 'hc-blurb', lv.question),
        h('div', 'hc-chips', lv.unlocks.slice(0, 4).map((id) => chipFor(SIM.DEF_MAP[id]))),
        h('div', 'hc-stars', starStr(stars)),
      ]);
      c.disabled = !unlocked;
      c.setAttribute('aria-label', `Level ${lv.id}: ${lv.title}. ${status}. ${stars} of 3 stars.`);
      c.addEventListener('click', () => open(lv.id));
      return c;
    };

    const sections = SIM.TIERS.map((tier) => {
      const lvls = tier.levels.map(levelById);
      const got = lvls.reduce((n, l) => n + starsOf(l.id), 0);
      const unlockedTier = levelUnlocked(tier.levels[0]);
      const sec = h('section', 'hgroup' + (unlockedTier ? '' : ' tier-locked'), [
        h('div', 'tier-head', [
          h('div', 'tier-title', [h('span', 'tier-icon', tier.icon), h('div', null, [h('h2', null, tier.name), h('span', 'muted', tier.blurb)])]),
          h('div', 'tier-meta', [
            h('span', 'tier-stars', `${got} / ${lvls.length * 3} ★`),
            btn('Primer', 'small', () => showPrimer(tier, () => showHome())),
          ]),
        ]),
        h('div', 'hgrid', lvls.map(cardFor)),
      ]);
      sec.style.setProperty('--tier', tier.color);
      return sec;
    });
    const resumeLv = levelById(resumeId);
    const actions = [btn(done ? `Continue: Level ${resumeId} · ${resumeLv.title}` : 'Start Level 1', 'primary big', () => open(resumeId))];
    if (state.level) actions.push(btn('Back to my level', '', () => hideHome(true)));
    actions.push(btn('Glossary', '', showGlossary));
    actions.push(btn('Tutorial', '', () => { hideHome(false); if (state.level) { SIM.setRunning(true); SIM.tour.start(); } else { open(1); } }));
    if (!progress.unlockAll) actions.push(btn('Unlock all levels', '', () => { progress.unlockAll = true; save(); showHome(); }));
    actions.push(h('span', 'spacer'));
    actions.push(btn('Reset progress', 'danger', showReset));

    home.innerHTML = '';
    [
      h('div', 'home-hero', [
        h('div', null, [h('h1', null, 'AI Engineering Simulator'),
          h('p', 'muted', 'Learn how real AI apps work by building them. No experience needed: start at Beginner and work up to Master.')]),
        h('div', 'home-stats', [
          h('div', 'hs', [h('b', null, `${totalStars} / ${total * 3}`), h('span', null, 'stars')]),
          h('div', 'hs', [h('b', null, `${done} / ${total}`), h('span', null, 'levels done')]),
        ]),
      ]),
      h('div', 'home-bar', [h('div', 'bar', [h('i')]), h('span', 'muted', `${Math.round((100 * totalStars) / (total * 3))}% complete`)]),
      h('div', 'home-actions', actions),
      ...sections,
    ].forEach((n) => home.appendChild(n));
    home.querySelector('.home-bar i').style.width = (100 * totalStars) / (total * 3) + '%';
    home.hidden = false;
    document.body.classList.add('home-open');
    home.scrollTop = 0;
    (home.querySelector('.big') || home.querySelector('button')).focus();
  }
  SIM.campaign.showHome = showHome;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !home.hidden && state.level && modal.hidden) hideHome(true); });

  // ---------- header controls ----------
  $('btn-levels').addEventListener('click', showHome);
  $('btn-glossary').addEventListener('click', showGlossary);
  $('btn-explain').addEventListener('click', showExplain);
  $('btn-restart').addEventListener('click', () => {
    if (confirm('Restart this level? Your current layout will be replaced.')) startLevel(state.level.id, { restart: true });
  });

  // First screen: the dashboard. (Continue picks up where the player left off.)
  SIM.campaign.boot = function () { showHome(); };
};
