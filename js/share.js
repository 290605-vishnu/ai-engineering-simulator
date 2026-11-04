// Save / load / share: a link that carries the level and your pipeline, a downloadable JSON file, and
// import from a file or pasted link. Layouts are also auto-saved per level in localStorage (storage.js).
window.SIM = window.SIM || {};

SIM.initShare = function () {
  const store = SIM.store;
  const $ = (id) => document.getElementById(id);
  const VERSION = 2; // v2: the campaign was re-numbered into 5 tiers

  const h = (tag, cls, content) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (Array.isArray(content)) content.forEach((c) => c && e.appendChild(c));
    else if (content !== undefined) e.textContent = content;
    return e;
  };
  const btn = (label, cls, fn) => { const b = h('button', cls, label); b.addEventListener('click', fn); return b; };

  // UTF-8 safe base64 so the whole payload lives in a URL fragment (never sent to a server).
  const encode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  const decode = (str) => JSON.parse(decodeURIComponent(escape(atob(str))));

  function payload() {
    const lv = SIM.campaign.level();
    return { v: VERSION, level: lv.id, graph: store.exportGraph() };
  }
  function shareUrl() {
    return location.origin === 'null' || location.protocol === 'file:'
      ? location.href.split('#')[0] + '#share=' + encode(payload())
      : location.origin + location.pathname + '#share=' + encode(payload());
  }

  // Validate before touching the game state; returns an error string or null.
  function validate(data) {
    if (!data || typeof data !== 'object') return 'That is not a pipeline file.';
    if (data.v !== VERSION) return 'This file is from a different version of the game.';
    if (!SIM.LEVELS.some((l) => l.id === data.level)) return 'It refers to a level that does not exist.';
    const g = data.graph;
    if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return 'The pipeline in it is malformed.';
    if (g.nodes.length > 80 || g.edges.length > 200) return 'The pipeline is too large.';
    return null;
  }

  // Open the level and load the pipeline into it. Locked elements are fine: it is someone's saved design.
  function load(data) {
    const err = validate(data);
    if (err) return err;
    SIM.campaign.startLevel(data.level, { intro: false });
    store.importGraph(data.graph);
    SIM.campaign.reapplyLevelConfig();
    SIM.sim.reset();
    SIM.dashboard.reset();
    SIM.campaign.onSimReset();
    SIM.fitView();
    SIM.announce('Pipeline loaded');
    SIM.toast('Pipeline loaded', 'ok');
    return null;
  }
  const parseLink = (text) => {
    const m = String(text).match(/#share=([A-Za-z0-9+/=_-]+)/);
    return decode(m ? m[1] : String(text).trim());
  };

  function download() {
    const lv = SIM.campaign.level();
    const blob = new Blob([JSON.stringify(payload(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-sim-level-${lv.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function copy(text, done) {
    const fallback = () => { const t = h('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } t.remove(); done(); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }

  function open() {
    const lv = SIM.campaign.level();
    if (!lv) return;
    const status = h('p', 'muted', '');
    const link = h('textarea', 'sharebox');
    link.readOnly = true; link.rows = 3; link.value = shareUrl(); link.setAttribute('aria-label', 'Share link');
    const paste = h('textarea', 'sharebox');
    paste.rows = 3; paste.placeholder = 'Paste a share link or the contents of a pipeline file'; paste.setAttribute('aria-label', 'Paste a share link');
    const file = h('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.setAttribute('aria-label', 'Load a pipeline file');

    const run = (fn) => { try { const err = fn(); if (err) status.textContent = err; else SIM.closeModal(true); } catch (e) { status.textContent = 'Could not read that: ' + e.message; } };
    file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;
      f.text().then((t) => run(() => load(JSON.parse(t))));
    });

    SIM.openModal(h('div', 'mbody', [
      h('h2', null, 'Save / Share'),
      h('p', 'muted', `Your layout for level ${lv.id} is saved in this browser automatically. Use these to move it or show it to someone.`),
      h('div', 'mkicker', 'Share link'),
      link,
      h('div', 'mactions left', [
        btn('Copy link', 'primary', () => copy(link.value, () => { status.textContent = 'Link copied.'; })),
        btn('Download JSON', '', download),
      ]),
      h('div', 'mkicker', 'Load a pipeline'),
      paste,
      h('div', 'mactions left', [btn('Load pasted', '', () => run(() => load(parseLink(paste.value)))), file]),
      status,
      h('div', 'mactions', [btn('Done', 'primary', () => SIM.closeModal(true))]),
    ]));
  }
  $('btn-share').addEventListener('click', open);
  const lvlObserver = () => { $('btn-share').hidden = !SIM.campaign.level(); };
  store.subscribe(lvlObserver);

  SIM.share = {
    // If the page was opened from a share link, load it and report true so the normal boot is skipped.
    bootFromHash() {
      const m = location.hash.match(/#share=([A-Za-z0-9+/=_-]+)/);
      if (!m) return false;
      let ok = false;
      try { ok = !load(decode(m[1])); } catch (e) { ok = false; }
      history.replaceState(null, '', location.pathname + location.search);
      return ok;
    },
    encode, decode, validate,
  };
};
