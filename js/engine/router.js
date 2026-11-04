// Edge lookup: "which wire leaves this node's output port?". An unwired port means no route.
(function () {
  function createRouter() {
    const byPort = new Map(); // `${nodeId}|${port}` -> edges, in creation order

    return {
      build(edges) {
        byPort.clear();
        edges.forEach((e) => {
          const key = e.source + '|' + e.sourceHandle;
          if (!byPort.has(key)) byPort.set(key, []);
          byPort.get(key).push(e);
        });
      },
      // If a port has several wires, the first one wins (deterministic).
      edgeFrom(nodeId, port) {
        const list = byPort.get(nodeId + '|' + port);
        return list ? list[0] : null;
      },
      connectedPorts(nodeId, def) {
        return def.outputs.map((o) => o.id).filter((id) => byPort.has(nodeId + '|' + id));
      },
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = createRouter;
  else { globalThis.SIM = globalThis.SIM || {}; SIM.router = createRouter; }
})();
