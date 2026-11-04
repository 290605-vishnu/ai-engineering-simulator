// Dev tool, not a test: runs the real tests/*.test.js files inside the app's browser page by shimming
// `node:test`, `node:assert` and `require` over the SIM globals. For machines without Node.
//   (0, eval)(await (await fetch('tools/browser-tests.js')).text()); await SIM_TESTS(['elements.test.js'])
// `only` (optional RegExp) runs just the tests whose names match: the browser tool has a ~30 s call limit.
globalThis.SIM_TESTS = async function (files, only) {
  const stamp = '?' + Date.now();
  const text = (f) => fetch(new URL('tests/' + f + stamp, document.baseURI)).then((r) => r.text());
  const load = async (f) => { const m = { exports: {} }; new Function('module', 'require', await text(f))(m, req); return m.exports; };
  const cache = {};
  const results = [];
  const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
  assert.ok = assert;
  assert.strictEqual = (a, b, m) => { if (a !== b) throw new Error(m || `expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
  assert.deepStrictEqual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m || `expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
  assert.match = (s, re) => { if (!re.test(s)) throw new Error(`${s} does not match ${re}`); };
  const test = (name, fn) => { if (only && !only.test(name)) return; try { fn(); results.push([name, 'ok']); } catch (e) { results.push([name, 'FAIL: ' + e.message]); } };
  const mods = {
    'node:test': test, 'node:assert': assert,
    '../js/nodes.js': SIM.NODE_DEFS, '../js/engine/tuning': SIM.tuning, '../js/engine/behaviors': SIM.behaviors,
    '../js/engine/sim': SIM.createSim, '../js/engine/metrics': SIM.metrics, '../js/engine/objectives': SIM.objectives,
    '../js/engine/router': SIM.router, '../js/campaign/levels': SIM.LEVELS, '../js/campaign/learn': { GLOSSARY: SIM.GLOSSARY, TIERS: SIM.TIERS },
  };
  function req(name) {
    if (mods[name]) return mods[name];
    throw new Error('browser-tests: unknown module ' + name);
  }
  mods['./solutions'] = await load('solutions.js');
  const playSrc = await text('play.js');
  new Function(playSrc)();
  mods['./play'] = SIM_PLAY;
  for (const f of files) await load(f);
  return { passed: results.filter((r) => r[1] === 'ok').length, failed: results.filter((r) => r[1] !== 'ok'), total: results.length };
};
