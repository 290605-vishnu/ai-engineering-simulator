// Graph state + tiny pub/sub. The (future) engine reads this; it never touches the DOM.
window.SIM = window.SIM || {};

SIM.store = (function () {
  const state = { nodes: [], edges: [], selected: null }; // selected: {type:'node'|'edge', id}
  let slot = 'none';      // which saved graph is being edited: a campaign level ('level:<id>'); 'none' = nothing yet
  const listeners = new Set();
  let seq = 0;

  const emit = (persist = true) => {
    listeners.forEach((fn) => fn(state));
    if (persist && slot !== 'none') SIM.storage.save({ nodes: state.nodes, edges: state.edges, seq }, slot);
  };

  // Replace the graph from a saved object (dropping unknown elements and dangling edges).
  function loadSaved(saved) {
    state.nodes = saved && Array.isArray(saved.nodes) ? saved.nodes.filter((n) => SIM.DEF_MAP[n.defId]) : [];
    const ids = new Set(state.nodes.map((n) => n.id));
    state.edges = saved ? (saved.edges || []).filter((e) => ids.has(e.source) && ids.has(e.target)) : [];
    seq = (saved && saved.seq) || state.nodes.length;
    state.selected = null;
  }
  // Build a fresh graph from a scenario starter: nodes [defId, x, y, config?]; edges [fromIdx, port, toIdx].
  function buildStarter(starter, override) {
    state.nodes = []; state.edges = []; state.selected = null;
    starter.nodes.forEach(([defId, x, y, cfg]) => {
      state.nodes.push({ id: `${defId}-${++seq}`, defId, x, y, config: { ...SIM.DEF_MAP[defId].defaults, ...cfg, ...(override && override(defId)) } });
    });
    (starter.edges || []).forEach(([a, h, b]) => {
      state.edges.push({ id: `e-${++seq}`, source: state.nodes[a].id, sourceHandle: h, target: state.nodes[b].id, targetHandle: 'in' });
    });
  }

  return {
    state,
    // Campaign levels pin some config (e.g. the source's rate). null in sandbox.
    configOverride: null,
    // Switch to another saved graph. A missing slot starts from `starter` (or empty).
    switchSlot(name, starter) {
      if (slot !== 'none') SIM.storage.save({ nodes: state.nodes, edges: state.edges, seq }, slot);
      slot = name;
      const saved = SIM.storage.load(name);
      if (saved) loadSaved(saved); else if (starter) buildStarter(starter, this.configOverride); else loadSaved(null);
      emit(false);
    },
    // Discard the current slot's graph and rebuild it from the starter.
    restartSlot(starter) { buildStarter(starter, this.configOverride); emit(); },
    subscribe(fn) { listeners.add(fn); },
    // A plain copy of the editable graph (for export / share links).
    exportGraph() { return JSON.parse(JSON.stringify({ nodes: state.nodes, edges: state.edges })); },
    // Replace the current level's graph from an exported one (unknown elements are dropped).
    importGraph(g) { loadSaved(g); seq = Math.max(seq, 1000); emit(); },
    init() {
      loadSaved(SIM.storage.load(slot));
      emit(false);
    },
    addNode(defId, x, y) {
      const def = SIM.DEF_MAP[defId];
      if (!def) return;
      const node = { id: `${defId}-${++seq}`, defId, x, y, config: { ...def.defaults, ...(this.configOverride && this.configOverride(defId)) } };
      state.nodes.push(node);
      state.selected = { type: 'node', id: node.id };
      emit();
    },
    moveNode(id, x, y) {
      const n = state.nodes.find((n) => n.id === id);
      if (n) { n.x = x; n.y = y; emit(false); }
    },
    commit() { emit(); }, // persist after a drag ends
    addEdge(source, sourceHandle, target, targetHandle) {
      if (source === target) return false;
      const dup = state.edges.some((e) => e.source === source && e.sourceHandle === sourceHandle
        && e.target === target && e.targetHandle === targetHandle);
      if (dup) return false;
      state.edges.push({ id: `e-${++seq}`, source, sourceHandle, target, targetHandle });
      emit();
      return true;
    },
    setConfig(id, key, value) {
      const n = state.nodes.find((n) => n.id === id);
      if (n) { n.config[key] = value; emit(); }
    },
    // Set one config key on every node of a kind (the top-bar rate slider drives all sources).
    setConfigFor(defId, key, value) {
      state.nodes.forEach((n) => { if (n.defId === defId) n.config[key] = value; });
      emit();
    },
    select(sel) { state.selected = sel; emit(false); },
    deleteSelected() {
      const s = state.selected;
      if (!s) return;
      if (s.type === 'node') {
        state.nodes = state.nodes.filter((n) => n.id !== s.id);
        state.edges = state.edges.filter((e) => e.source !== s.id && e.target !== s.id);
      } else {
        state.edges = state.edges.filter((e) => e.id !== s.id);
      }
      state.selected = null;
      emit();
    },
    clear() { state.nodes = []; state.edges = []; state.selected = null; emit(); },
  };
})();
