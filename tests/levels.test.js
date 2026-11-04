// Every level must be solvable by its known solution(s) with the stated stars, and unsolvable by the
// listed wrong answers (which always include wiring the source straight to the sink). This is the guard
// against a tuning change silently breaking the campaign.
const test = require('node:test');
const assert = require('node:assert');
const LEVELS = require('../js/campaign/levels');
const SOLUTIONS = require('./solutions');
const { play, starterGraph } = require('./play');
const { GLOSSARY, TIERS } = require('../js/campaign/learn');
const defs = require('../js/nodes.js');
const O = require('../js/engine/objectives');

const SEEDS = [1, 2, 3];

LEVELS.forEach((level) => {
  (SOLUTIONS[level.id] || []).forEach((sol) => {
    test(`level ${level.id}: "${sol.name}" earns ${sol.stars} star(s)`, () => {
      SEEDS.forEach((seed) => {
        const r = play(level, sol, seed);
        assert.ok(r.passed, `seed ${seed} did not pass`);
        assert.strictEqual(r.stars, sol.stars, `seed ${seed}`);
      });
    });
  });
  ((SOLUTIONS.fails || {})[level.id] || []).forEach((bad) => {
    test(`level ${level.id}: "${bad.name}" does not pass`, () => {
      SEEDS.forEach((seed) => assert.strictEqual(play(level, bad, seed).passed, false, `seed ${seed}`));
    });
  });
  if (level.starter.nodes.length > 2) {
    test(`level ${level.id}: the pre-built pipeline does not pass as given`, () => {
      SEEDS.forEach((seed) => assert.strictEqual(play(level, starterGraph(level), seed).passed, false, `seed ${seed}`));
    });
  }
  test(`level ${level.id} rejects the source-to-sink shortcut`, () => {
    const names = ((SOLUTIONS.fails || {})[level.id] || []).map((g) => g.name);
    assert.ok(names.includes('source wired straight to the sink'), 'solutions.js must list the shortcut for this level');
  });
});

test('every level has a situation, a question and a two-part explanation', () => {
  LEVELS.forEach((l) => {
    assert.ok(l.situation.length > 60 && l.question.endsWith('?'), `level ${l.id} story`);
    assert.ok(l.explain.happening.length > 60 && l.explain.needed.length > 60, `level ${l.id} explanation`);
  });
});

test('there are five tiers in order, each with at least 5 levels, covering every level exactly once', () => {
  assert.deepStrictEqual(TIERS.map((t) => t.id), ['beginner', 'novice', 'advanced', 'expert', 'master']);
  const seen = [];
  TIERS.forEach((t) => {
    assert.ok(t.levels.length >= 5, `${t.name} has ${t.levels.length} levels`);
    t.levels.forEach((id) => { seen.push(id); assert.strictEqual(LEVELS.find((l) => l.id === id).tier, t.id, `level ${id} tier`); });
  });
  assert.deepStrictEqual(seen, LEVELS.map((l) => l.id)); // contiguous, in order, none missing or repeated
});

test('every glossary term a level or tier primer uses exists, and every definition is plain text', () => {
  const keys = Object.keys(GLOSSARY);
  LEVELS.forEach((l) => (l.terms || []).forEach((k) => assert.ok(keys.includes(k), `level ${l.id} uses unknown term ${k}`)));
  TIERS.forEach((t) => t.primer.terms.forEach((k) => assert.ok(keys.includes(k), `${t.name} primer uses unknown term ${k}`)));
  keys.forEach((k) => assert.ok(GLOSSARY[k].def.length > 30 && GLOSSARY[k].term, `glossary ${k}`));
});

test('scenario validator accepts every level (with glossary and tier checks)', () => {
  LEVELS.forEach((l) => assert.deepStrictEqual(O.validateScenario(l, defs.map((d) => d.id), Object.keys(GLOSSARY)), []));
});

test('every element has a plain-language analogy and every element is introduced by some level', () => {
  const introduced = new Set(LEVELS.flatMap((l) => l.unlocks));
  defs.forEach((d) => {
    assert.ok(d.plain && d.plain.length > 15, `${d.id} plain text`);
    assert.ok(introduced.has(d.id), `${d.id} is never unlocked by a level`);
  });
});

test('beginner levels give step-by-step guidance for the first three levels', () => {
  [1, 2, 3].forEach((id) => assert.ok(LEVELS.find((l) => l.id === id).steps.length >= 3, `level ${id} steps`));
});
