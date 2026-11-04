// Plays a campaign level headlessly with a given graph, mirroring the in-app campaign loop:
// evaluate once per simulated second; pass once star-1 goals hold for `holdSec`.
// Works under Node (`require`) and in a browser console (reads the SIM globals), so levels can be
// calibrated in the browser and guarded by `node --test`.
(function () {
  const node = typeof require === 'function';
  const dep = (name, file) => (node ? require(file) : SIM[name]);
  const defs = node ? require('../js/nodes.js') : SIM.NODE_DEFS;
  const tuning = dep('tuning', '../js/engine/tuning');
  const behaviors = dep('behaviors', '../js/engine/behaviors');
  const createSim = dep('createSim', '../js/engine/sim');
  const O = dep('objectives', '../js/engine/objectives');

  // graph = { nodes: [[defId, id, configOverrides]], edges: [[source, port, target]] }
  function build(level, graph) {
    const nodes = graph.nodes.map(([defId, id, cfg = {}]) => ({
      id, defId,
      config: {
        ...defs.find((d) => d.id === defId).defaults,
        ...(defId === 'trafficSource' ? level.traffic : {}),
        ...((level.locks && level.locks[defId]) || {}),
        ...cfg,
        // locks win over the graph's own settings, exactly like the app
        ...((level.locks && level.locks[defId]) || {}),
      },
    }));
    const edges = graph.edges.map(([source, sourceHandle, target]) =>
      ({ id: `${source}.${sourceHandle}>${target}`, source, sourceHandle, target, targetHandle: 'in' }));
    return { nodes, edges };
  }

  function play(level, graph, seed = 1, maxSeconds = 240) {
    const sim = createSim({ defs, behaviors, seed });
    sim.setChaos(level.chaos);
    const g = build(level, graph);
    sim.setGraph(g.nodes, g.edges);
    let hold = 0, last = null;
    for (let t = 0; t < maxSeconds * 1000; t += tuning.tickMs) {
      sim.step(tuning.tickMs);
      if (t % 1000 !== 0) continue;
      last = O.evaluate(level.objectives, (w) => sim.windowStats(w), sim.now);
      if (!O.passed(level.objectives, last)) { hold = 0; continue; }
      if (++hold >= level.holdSec) {
        return { passed: true, stars: O.stars(level.objectives, last), at: sim.now / 1000, values: last.map((r) => r.value), sim };
      }
    }
    return { passed: false, stars: 0, at: null, values: last ? last.map((r) => r.value) : [], met: last ? last.map((r) => r.met) : [], sim };
  }

  // The pipeline a level hands you (starter nodes + edges) as a graph, for testing it "exactly as given".
  function starterGraph(level) {
    return {
      nodes: level.starter.nodes.map(([defId, , , cfg], i) => [defId, 'n' + i, cfg || {}]),
      edges: (level.starter.edges || []).map(([a, p, b]) => ['n' + a, p, 'n' + b]),
    };
  }

  const api = { play, build, starterGraph };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.SIM_PLAY = api;
})();
