# AI Engineering Simulator

A level-based game that teaches how real AI apps work, **no experience needed**. You wire a pipeline of elements, watch requests flow through it, and meet the goals to earn up to 3 stars per level. 26 levels in five tiers:

| Tier | Levels | You learn |
|---|---|---|
| 🌱 Beginner | 1-5 | What a model is, speed vs volume vs cost, queues, picking the right model, sharing load |
| 🧭 Novice | 6-10 | Guardrails, caching, rate limiting, routing, specialist models |
| 🛠️ Advanced | 11-16 | Retrieval (RAG), memory, tools, retries and spikes, batch work, budgets |
| 🎯 Expert | 17-21 | Judges and human review, fallbacks, agents, debugging a broken pipeline |
| 👑 Master | 22-26 | Production-grade challenges that combine everything |

Plain HTML/CSS/JS, no build step and no dependencies. **Open `index.html` in a browser.**

## Playing
- The front screen is a dashboard: your stars, a Continue button, and every level grouped by tier (levels unlock in order; "Unlock all levels" lets you browse). **Home** returns to it from any level.
- New to AI? Each tier opens with a short **primer**, each level lists its **new words**, early levels give a **step-by-step** guide, and the **Glossary** button explains every term in plain language. Hover a metric to see what it means.
- Drag elements from the palette onto the canvas (or focus one and press Enter), then drag from an output port to an input port to wire them. Traffic starts as soon as the Traffic Source is connected.
- Wiring the source straight to the Response Sink never works: a request only counts once a model has actually answered it.
- Goals are on the right. Hold all the first-tier goals for the hold time to pass; more stars for budget and excellence.
- Stuck? **Explain** gives a plain-text breakdown: what is happening in your pipeline, and what needs to happen to pass.
- **Reset progress** (bottom of the dashboard's button row) starts everything over after a confirmation.
- **Save / Share** copies a link to your pipeline, downloads it as JSON, or loads one back. Layouts also auto-save per level in your browser. **?** replays the tutorial.

## Code map
- `js/nodes.js` element definitions (plain data); `js/engine/behaviors.js` what each element does
- `js/engine/` headless simulation: `tuning.js` (every constant), `metrics.js`, `router.js`, `sim.js` (tick loop, retries, loops), `objectives.js` (goals, stars, scenario validator)
- `js/campaign/levels.js` the 26 scenarios; `js/campaign/learn.js` glossary + tiers + primers; `js/campaign.js` dashboard, goals, explanations, results, progress
- UI: `canvas.js`, `palette.js`, `inspector.js`, `dashboard.js`, `particles.js`, `runtime.js`, `share.js`, `tour.js`, `sfx.js`, `a11y.js`
- `js/store.js` graph state; `js/storage.js` the localStorage seam (a backend would plug in here)

## Tests
`node --test tests/` (Node 18+). Without Node, run the same files in the browser: see `CLAUDE.md` (Testing). `tests/solutions.js` holds a known solution and wrong answers for every level; `tests/levels.test.js` guards them.
