// Inspector: concept card, live config controls and runtime stats for the selected node.
// Controls are built once per selection and then updated in place, so dragging a slider is never
// interrupted by a re-render (the sim shares the config object, so edits apply on the next tick).
window.SIM = window.SIM || {};

SIM.initInspector = function () {
  const store = SIM.store;
  const body = document.getElementById('insp-body');
  let shownKey = null;
  // Rebuild when the selection changes or the graph's shape does (so the Wires lists stay current),
  // but never while a slider is being dragged (config edits don't change the shape).
  const sigOf = (s) => (s.selected ? s.selected.type + ':' + s.selected.id : 'none') + '|' + s.nodes.length + '|' + s.edges.length;
  let controls = [];  // {spec, input, valEl, node}
  let statEls = {};

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (Array.isArray(text)) text.forEach((c) => e.appendChild(c));
    else if (text !== undefined) e.textContent = text;
    return e;
  };
  const cfgValue = (node, spec) => {
    const v = node.config[spec.key];
    return v !== undefined ? v : SIM.DEF_MAP[node.defId].defaults[spec.key];
  };
  const fmt = (spec, v) => (spec.pct ? Math.round(v * 100) + '%' : v + (spec.unit || ''));

  function buildControl(node, spec) {
    const row = el('label', 'ctl');
    const head = el('div', 'ctl-head');
    head.appendChild(el('span', null, spec.label));
    const valEl = el('span', 'ctl-val');
    head.appendChild(valEl);
    row.appendChild(head);

    let input;
    if (spec.type === 'range') {
      input = el('input');
      input.type = 'range';
      input.min = spec.min; input.max = spec.max; input.step = spec.step;
    } else if (spec.type === 'select') {
      input = el('select');
      spec.options.forEach((o) => { const opt = el('option', null, String(o)); opt.value = String(o); input.appendChild(opt); });
    } else {
      input = el('input');
      input.type = 'checkbox';
    }
    row.appendChild(input);
    // Campaign levels pin some traffic settings; show them but don't allow edits.
    if (SIM.campaign && SIM.campaign.isLocked(node.defId, spec.key)) {
      input.disabled = true; row.classList.add('locked'); head.appendChild(el('span', 'lock', '🔒 set by level'));
    }

    const read = () => (spec.type === 'toggle' ? input.checked
      : spec.type === 'select' ? (typeof spec.options[0] === 'number' ? Number(input.value) : input.value)
      : Number(input.value));
    input.addEventListener('input', () => {
      const v = read();
      valEl.textContent = spec.type === 'toggle' ? (v ? 'on' : 'off') : fmt(spec, v);
      store.setConfig(node.id, spec.key, v);
    });
    controls.push({ spec, input, valEl, node });
    return row;
  }

  function build(state) {
    body.innerHTML = '';
    controls = []; statEls = {};
    const sel = state.selected;
    shownKey = sigOf(state);

    if (!sel) {
      body.appendChild(el('p', 'muted', 'Select an element to see what it teaches, tune it live and watch its stats.'));
      return;
    }
    if (sel.type === 'edge') {
      const e = state.edges.find((x) => x.id === sel.id);
      if (!e) return;
      const label = (id) => { const n = state.nodes.find((x) => x.id === id); return n ? SIM.DEF_MAP[n.defId].label : id; };
      body.appendChild(el('h3', null, 'Wire'));
      body.appendChild(el('p', 'muted', `${label(e.source)} (${e.sourceHandle}) → ${label(e.target)}`));
      body.appendChild(el('p', 'muted', 'Press Delete to remove it.'));
      return;
    }

    const node = state.nodes.find((n) => n.id === sel.id);
    if (!node) return;
    const def = SIM.DEF_MAP[node.defId];
    const title = el('h3');
    title.innerHTML = SIM.iconLabel(def, 64); // 3D icon + name (our own definitions, not user input)
    body.appendChild(title);
    body.appendChild(el('div', 'cat', def.category));
    body.appendChild(el('p', 'plainwords', def.plain));
    body.appendChild(el('p', 'muted', def.description));
    const concept = el('div', 'concept');
    concept.appendChild(el('b', null, 'What it teaches'));
    concept.appendChild(el('div', null, def.concept));
    body.appendChild(concept);

    if (node.defId === 'trafficSource') {
      // The level decides the traffic, so the source shows a read-only profile instead of controls.
      body.appendChild(el('h4', null, 'Traffic profile (set by the level)'));
      SIM.campaign.trafficProfile(node.config).forEach(([k, v]) => {
        const row = el('div', 'stat');
        row.appendChild(el('span', 'muted', k));
        row.appendChild(el('b', null, v));
        body.appendChild(row);
      });
    } else if (def.config && def.config.length) {
      body.appendChild(el('h4', null, 'Config'));
      def.config.forEach((spec) => body.appendChild(buildControl(node, spec)));
    }
    if (node.defId !== 'trafficSource') {
      body.appendChild(el('h4', null, 'Live stats'));
      [['queue', 'Queued'], ['busy', 'Processing'], ['processed', 'Processed'], ['failed', 'Failed'], ['cost', 'Cost']].forEach(([k, label]) => {
        const row = el('div', 'stat');
        row.appendChild(el('span', 'muted', label));
        statEls[k] = el('b', null, '0');
        row.appendChild(statEls[k]);
        body.appendChild(row);
      });
    }
    buildWires(node, def, state);
    SIM.refreshInspector(SIM.sim);
  }

  // Connect / disconnect without dragging: a keyboard- and touch-friendly alternative to wiring on the canvas.
  function buildWires(node, def, state) {
    const label = (n) => `${SIM.DEF_MAP[n.defId].label} #${n.id.split('-').pop()}`;
    body.appendChild(el('h4', null, 'Wires'));
    const mine = state.edges.filter((e) => e.source === node.id);
    if (!mine.length) body.appendChild(el('p', 'muted', def.outputs.length ? 'Nothing connected to its outputs yet.' : 'This element has no outputs.'));
    mine.forEach((e) => {
      const t = state.nodes.find((n) => n.id === e.target);
      const row = el('div', 'wire');
      row.appendChild(el('span', null, `${e.sourceHandle} → ${t ? label(t) : '?'}`));
      const rm = el('button', null, 'Remove');
      rm.setAttribute('aria-label', `Remove wire from ${e.sourceHandle} to ${t ? label(t) : 'unknown'}`);
      rm.addEventListener('click', () => { store.select({ type: 'edge', id: e.id }); store.deleteSelected(); store.select({ type: 'node', id: node.id }); });
      row.appendChild(rm);
      body.appendChild(row);
    });
    const targets = state.nodes.filter((n) => n.id !== node.id && SIM.DEF_MAP[n.defId].inputs.length);
    if (!def.outputs.length || !targets.length) return;
    const port = el('select'), tgt = el('select');
    port.setAttribute('aria-label', 'Output port'); tgt.setAttribute('aria-label', 'Connect to');
    def.outputs.forEach((o) => { const op = el('option', null, o.label || o.id); op.value = o.id; port.appendChild(op); });
    targets.forEach((n) => { const op = el('option', null, label(n)); op.value = n.id; tgt.appendChild(op); });
    const go = el('button', null, 'Connect');
    go.addEventListener('click', () => {
      if (store.addEdge(node.id, port.value, tgt.value, 'in')) {
        if (SIM.sfx) SIM.sfx.play('connect');
        if (SIM.announce) SIM.announce(`Connected ${port.value} to ${tgt.options[tgt.selectedIndex].text}`);
      }
    });
    body.appendChild(el('div', 'wire-add', [port, tgt, go]));
  }

  store.subscribe((s) => { if (sigOf(s) !== shownKey) build(s); });

  // Called at HUD rate by the runtime: pushes stats and external config changes (e.g. the top-bar rate slider).
  SIM.refreshInspector = function (sim) {
    controls.forEach(({ spec, input, valEl, node }) => {
      const v = cfgValue(node, spec);
      if (document.activeElement !== input) {
        if (spec.type === 'toggle') input.checked = !!v; else input.value = String(v);
      }
      valEl.textContent = spec.type === 'toggle' ? (v ? 'on' : 'off') : fmt(spec, v);
    });
    const sel = store.state.selected;
    const inst = sel && sel.type === 'node' && sim && sim.nodes.get(sel.id);
    if (!inst || !statEls.queue) return;
    statEls.queue.textContent = inst.queue.length;
    statEls.busy.textContent = inst.inFlight.length;
    statEls.processed.textContent = inst.stats.processed;
    statEls.failed.textContent = inst.stats.failed;
    statEls.cost.textContent = '$' + inst.stats.cost.toFixed(5);
  };
};
