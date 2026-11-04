// Dev tool, not a test: paste/eval in the app's browser console to calibrate levels.
//   const run = await (await fetch('tools/browser-run.js')).text(); (0, eval)(run);
//   await SIM_RUN([5, 6], [1, 2, 3])   -> compact report of every solution and wrong answer
// Needs the app page loaded (uses the SIM globals) and serves tests/play.js + tests/solutions.js.
globalThis.SIM_RUN = async function (levelIds, seeds = [1]) {
  const stamp = '?' + Date.now();
  const text = (f) => fetch(new URL('tests/' + f + stamp, document.baseURI)).then((r) => r.text());
  const m = { exports: {} };
  new Function('module', await text('solutions.js'))(m);
  const SOL = m.exports;
  new Function(await text('play.js'))();
  const { play } = SIM_PLAY;
  const f = (a) => a.map((v) => (v === null ? '-' : +v.toFixed(3))).join(' ');
  const out = {};
  for (const lv of SIM.LEVELS.filter((l) => !levelIds || levelIds.includes(l.id))) {
    for (const g of SOL[lv.id] || []) {
      out[`L${lv.id} OK   ${g.name} (want ${g.stars})`] = seeds.map((s) => { const r = play(lv, g, s); return `${r.stars}@${r.at} [${f(r.values)}]`; }).join(' | ');
    }
    const asGiven = lv.starter.nodes.length > 2 ? [{ name: 'the pipeline exactly as given', ...SIM_PLAY.starterGraph(lv) }] : [];
    for (const g of [...((SOL.fails || {})[lv.id] || []), ...asGiven]) {
      out[`L${lv.id} FAIL ${g.name}`] = seeds.map((s) => { const r = play(lv, g, s); return (r.passed ? 'PASSED?! ' : 'no ') + `[${f(r.values)}]`; }).join(' | ');
    }
  }
  return out;
};
