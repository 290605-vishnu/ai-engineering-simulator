// Canvas: pan/zoom world, DOM nodes, SVG edges, drag-to-wire.
window.SIM = window.SIM || {};

SIM.initCanvas = function () {
  const store = SIM.store;
  const canvas = document.getElementById('canvas');
  const world = document.getElementById('world');
  const nodesEl = document.getElementById('nodes');
  const edgesEl = document.getElementById('edges');
  const zoomLabel = document.getElementById('zoom-label');
  const NS = 'http://www.w3.org/2000/svg';

  const view = { x: 0, y: 0, k: 1 };
  SIM.view = view;              // read by the particle layer
  SIM.edgeGeo = new Map();      // edge id -> {a, b} in world coords, refreshed on every edge render
  let draft = null; // {source, handle, x, y} while wiring

  const applyView = () => {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    canvas.style.backgroundSize = `${24 * view.k}px ${24 * view.k}px`;
    canvas.style.backgroundPosition = `${view.x}px ${view.y}px`;
    zoomLabel.textContent = Math.round(view.k * 100) + '%';
  };
  const toWorld = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  };

  // ---------- values shown under each icon ----------
  const SHORT = { concurrency: 'conc', contextWindow: 'ctx', strictness: 'strict', capacity: 'cache', topK: 'top-K', keep: 'keep',
    limit: 'limit', burst: 'burst', retries: 'retries', backoffMs: 'backoff', timeoutMs: 'timeout', budget: 'budget',
    reviewers: 'people', specialty: 'for', intervalMs: 'window', maxSteps: 'steps', strategy: 'mode' };
  function fmtSpec(spec, v) {
    if (spec.pct) return Math.round(v * 100) + '%';
    if (spec.type === 'toggle') return v ? 'on' : 'off';
    if (spec.key === 'contextWindow') return v >= 1000 ? v / 1000 + 'k' : String(v);
    if (spec.key === 'budget') return '$' + v;
    if (spec.key === 'intervalMs' || spec.key === 'backoffMs' || spec.key === 'timeoutMs') return v >= 1000 ? v / 1000 + 's' : v + 'ms';
    return String(v) + (spec.unit ? spec.unit.trim() : '');
  }
  // The element's two most useful settings, e.g. "conc 16 · ctx 8k", so values read without opening the inspector.
  SIM.nodeValues = function (n) {
    const def = SIM.DEF_MAP[n.defId];
    if (n.defId === 'trafficSource') return `${n.config.rate}/s`;
    return (def.config || []).filter((s) => s.key !== 'burst').slice(0, 2).map((spec) => {
      const v = n.config[spec.key] !== undefined ? n.config[spec.key] : def.defaults[spec.key];
      return `${SHORT[spec.key] || spec.key} ${fmtSpec(spec, v)}`;
    }).join(' · ');
  };

  // ---------- rendering ----------
  function renderNodes(state) {
    const sel = state.selected;
    const existing = new Map([...nodesEl.children].map((el) => [el.dataset.id, el]));
    state.nodes.forEach((n) => {
      const def = SIM.DEF_MAP[n.defId];
      let el = existing.get(n.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'node';
        el.dataset.id = n.id;
        el.tabIndex = 0;                                  // keyboard: arrows move, Delete removes
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', `${def.label}. Arrow keys move it, Delete removes it.`);
        el.style.setProperty('--cat', SIM.CATEGORY_COLORS[def.category]);
        const ports = (list, dir) => `<div class="ports ${dir}">` + list.map((p) =>
          `<div class="port" data-dir="${dir}" data-port="${p.id}">${p.label ? `<span class="plabel">${p.label}</span>` : ''}</div>`
        ).join('') + '</div>';
        // No card: just the isometric icon, with the name, key settings and live status underneath.
        // The ports sit beside the icon, so the icon zone grows for elements with many ports (the router has six).
        const zone = Math.max(78, Math.max(def.inputs.length, def.outputs.length) * 24 + 10);
        el.style.setProperty('--zone', zone + 'px');
        el.innerHTML = `${ports(def.inputs, 'in')}<div class="art">${SIM.icon3d(def, 84)}</div><div class="label">${def.label}</div>` +
          `<div class="cfgline"></div><div class="qbadge"></div>${ports(def.outputs, 'out')}`;
        nodesEl.appendChild(el);
      }
      existing.delete(n.id);
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      el.querySelector('.cfgline').textContent = SIM.nodeValues(n); // settings changes re-render, so this stays current
      el.classList.toggle('sel', !!sel && sel.type === 'node' && sel.id === n.id);
    });
    existing.forEach((el) => el.remove());
  }

  function portPos(nodeId, dir, portId) {
    const el = nodesEl.querySelector(`[data-id="${nodeId}"] .port[data-dir="${dir}"][data-port="${portId}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect(), c = canvas.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - c.left - view.x) / view.k, y: (r.top + r.height / 2 - c.top - view.y) / view.k };
  }
  const ctrlDx = (a, b) => Math.max(40, Math.abs(b.x - a.x) / 2);
  const curve = (a, b) => {
    const dx = ctrlDx(a, b);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  };
  // Point on the same cubic the wire is drawn with, so particles ride the wires exactly.
  // `out` (optional) is reused by the particle loop so it allocates nothing per particle.
  SIM.bezierPoint = (a, b, t, out) => {
    const dx = ctrlDx(a, b), u = 1 - t;
    const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    const r = out || {};
    // Control points share their endpoint's y, so y only blends a.y and b.y.
    r.x = w0 * a.x + w1 * (a.x + dx) + w2 * (b.x - dx) + w3 * b.x;
    r.y = (w0 + w1) * a.y + (w2 + w3) * b.y;
    return r;
  };
  function path(d, cls) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    if (cls) p.setAttribute('class', cls);
    return p;
  }

  function renderEdges(state) {
    edgesEl.innerHTML = '';
    SIM.edgeGeo.clear();
    state.edges.forEach((e) => {
      const a = portPos(e.source, 'out', e.sourceHandle), b = portPos(e.target, 'in', e.targetHandle);
      if (!a || !b) return;
      SIM.edgeGeo.set(e.id, { a, b });
      const d = curve(a, b);
      const selected = state.selected && state.selected.type === 'edge' && state.selected.id === e.id;
      const vis = path(d, selected ? 'sel' : '');
      vis.style.pointerEvents = 'none';
      const hit = path(d, 'hit');
      hit.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); store.select({ type: 'edge', id: e.id }); });
      edgesEl.append(vis, hit);
    });
    if (draft) edgesEl.appendChild(path(curve(draft.from, { x: draft.x, y: draft.y }), 'draft'));
  }

  const render = (state) => { renderNodes(state); renderEdges(state); };
  store.subscribe(render);

  // ---------- interactions ----------
  canvas.addEventListener('pointerdown', (e) => {
    const portEl = e.target.closest('.port');
    const nodeEl = e.target.closest('.node');

    if (portEl && portEl.dataset.dir === 'out') {           // start wiring
      e.preventDefault();
      const nodeId = nodeEl.dataset.id, handle = portEl.dataset.port;
      draft = { source: nodeId, handle, from: portPos(nodeId, 'out', handle), ...toWorld(e.clientX, e.clientY) };
      canvas.setPointerCapture(e.pointerId);
      const move = (ev) => {
        Object.assign(draft, toWorld(ev.clientX, ev.clientY));
        document.querySelectorAll('.port.hot').forEach((p) => p.classList.remove('hot'));
        const t = document.elementFromPoint(ev.clientX, ev.clientY);
        const tp = t && t.closest && t.closest('.port[data-dir="in"]');
        if (tp) tp.classList.add('hot');
        renderEdges(store.state);
      };
      const up = (ev) => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        document.querySelectorAll('.port.hot').forEach((p) => p.classList.remove('hot'));
        const t = document.elementFromPoint(ev.clientX, ev.clientY);
        const tp = t && t.closest && t.closest('.port[data-dir="in"]');
        const tn = tp && tp.closest('.node');
        const src = draft;
        draft = null;
        if (tp && tn) {
          if (store.addEdge(src.source, src.handle, tn.dataset.id, tp.dataset.port)) {
            if (SIM.sfx) SIM.sfx.play('connect');
            if (SIM.announce) SIM.announce('Connected');
          }
        } else renderEdges(store.state);
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      return;
    }

    if (nodeEl && !portEl) {                                // drag node
      const id = nodeEl.dataset.id;
      const n = store.state.nodes.find((n) => n.id === id);
      store.select({ type: 'node', id });
      const start = toWorld(e.clientX, e.clientY), ox = n.x, oy = n.y;
      canvas.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const p = toWorld(ev.clientX, ev.clientY);
        store.moveNode(id, ox + p.x - start.x, oy + p.y - start.y);
      };
      const up = () => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        store.commit();
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      return;
    }

    // background: deselect + pan
    store.select(null);
    canvas.classList.add('panning');
    canvas.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, vx = view.x, vy = view.y;
    const move = (ev) => { view.x = vx + ev.clientX - sx; view.y = vy + ev.clientY - sy; applyView(); };
    const up = () => {
      canvas.classList.remove('panning');
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  });

  canvas.addEventListener('wheel', (e) => {                 // zoom around cursor
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.min(2, Math.max(0.25, view.k * Math.exp(-e.deltaY * 0.0015)));
    view.x = mx - ((mx - view.x) / view.k) * k;
    view.y = my - ((my - view.y) / view.k) * k;
    view.k = k;
    applyView();
    renderEdges(store.state);
  }, { passive: false });

  canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const defId = e.dataTransfer.getData(SIM.DRAG_MIME);
    if (!defId || (SIM.campaign && !SIM.campaign.isAvailable(defId))) return;
    const p = toWorld(e.clientX, e.clientY);
    store.addNode(defId, p.x - 60, p.y - 40);
    if (SIM.sfx) SIM.sfx.play('place');
    if (SIM.announce) SIM.announce(SIM.DEF_MAP[defId].label + ' added');
  });

  // Keyboard / touch alternative to dragging from the palette: drop near the middle of the visible canvas.
  let spawnCount = 0;
  SIM.addNodeAtCenter = function (defId) {
    if (SIM.campaign && !SIM.campaign.isAvailable(defId)) return;
    const r = canvas.getBoundingClientRect();
    const p = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    const off = (spawnCount++ % 6) * 28; // stagger so repeated adds don't stack exactly
    store.addNode(defId, p.x - 60 + off, p.y - 40 + off);
    if (SIM.sfx) SIM.sfx.play('place');
    if (SIM.announce) SIM.announce(SIM.DEF_MAP[defId].label + ' added. Use the inspector to connect it.');
  };

  // Keyboard: focusing a node selects it; arrows nudge it (Shift = bigger steps).
  nodesEl.addEventListener('focusin', (e) => {
    const nodeEl = e.target.closest('.node');
    if (nodeEl && !(store.state.selected && store.state.selected.id === nodeEl.dataset.id)) store.select({ type: 'node', id: nodeEl.dataset.id });
  });
  nodesEl.addEventListener('keydown', (e) => {
    const nodeEl = e.target.closest('.node');
    const step = e.shiftKey ? 40 : 10;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!nodeEl || !d) return;
    e.preventDefault();
    const n = store.state.nodes.find((x) => x.id === nodeEl.dataset.id);
    if (n) { store.moveNode(n.id, n.x + d[0], n.y + d[1]); store.commit(); }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && !/input|textarea|select/i.test(e.target.tagName)) {
      e.preventDefault();
      store.deleteSelected();
    }
  });

  SIM.fitView = function () {
    const ns = store.state.nodes;
    if (!ns.length) { view.x = 0; view.y = 0; view.k = 1; applyView(); renderEdges(store.state); return; }
    const els = ns.map((n) => nodesEl.querySelector(`[data-id="${n.id}"]`));
    const minX = Math.min(...ns.map((n) => n.x)), minY = Math.min(...ns.map((n) => n.y));
    const maxX = Math.max(...ns.map((n, i) => n.x + els[i].offsetWidth));
    const maxY = Math.max(...ns.map((n, i) => n.y + els[i].offsetHeight));
    const r = canvas.getBoundingClientRect(), pad = 60;
    view.k = Math.min(1.5, (r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY));
    view.x = (r.width - (maxX - minX) * view.k) / 2 - minX * view.k;
    view.y = (r.height - (maxY - minY) * view.k) / 2 - minY * view.k;
    applyView();
    renderEdges(store.state);
  };

  window.addEventListener('resize', () => renderEdges(store.state));
  applyView();
};
