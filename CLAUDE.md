# AI Engineering Simulator

A level-based "systems factory" game that teaches AI engineering concepts. Each level is a real situation with a question; the player wires a pipeline, requests flow through it, and queues, cost, guardrails, caches, retrieval, retries and agents show up in real time. Full design: `docs/PLAN.md` (the stack and mode sections are superseded by this file: **there is no sandbox mode**).

## Status
- M0-M6 are built. **26 levels in 5 tiers** (Beginner 1-5, Novice 6-10, Advanced 11-16, Expert 17-21, Master 22-26), 26 elements, campaign-only (no sandbox).
- Aimed at people new to AI: every element has a plain-language analogy (`plain` in `nodes.js`, shown in the palette and inspector), a glossary of 37 terms (`js/campaign/learn.js`, header Glossary button, metric tooltips), a primer the first time a tier is entered, "New words" and (levels 1-5) step-by-step guides on each level, and plain-language goal labels.
- Elements are drawn as **isometric illustrations** (`js/icons.js`: inline SVG built from one kit of rounded isometric boxes, cylinders and spheres in three tones with light-blue accents; one hand-composed icon per element, no image assets). On the canvas a node has no card: the icon with its name, its two key settings (`SIM.nodeValues`) and live queue/busy status underneath. Use `SIM.iconLabel(def, px)` anywhere an icon + name is shown. The home dashboard has a **Reset progress** button (confirmation dialog; wipes stars, layouts, primers and tutorial state, keeps the sound choice).
- Front screen is the home dashboard: stars, Continue, tiers with cards. Plain-text help: the Explain screen and the result screen ("what is happening / what needs to happen to pass").
- Storage keys are v2 (`aisim.progress.v2`, `aisim.slot2.*`): the old 10-level numbering was replaced. Share links are version 2.
- The `node --test tests/` suites have NOT been run on the dev machine (Node isn't installed). They are run in the browser instead: see Testing. Please run them under Node when available.
- Deferred: Load Balancer `weighted` strategy, `long_context` / `multimodal` request types, per-node charts, a live tuning/debug panel, a backend (the storage adapter is the seam).

## Stack rules
- Plain HTML, CSS and JavaScript. No bundler, no npm runtime dependencies, no frameworks.
- Classic `<script>` tags sharing the global `SIM` namespace (ES modules don't work from `file://`). Load order is set in `index.html`; add new files there.
- The app must work by double-clicking `index.html`.
- Dark theme only. Colors: requests red, responses blue, malicious that got through purple, failed grey fading, cache hit gold.

## Game model
- **The sink judges the reply.** `responseSink` fails any request no model answered (`no_answer`) and any wrong answer (`bad`: hallucination, low_quality, off_domain). Wiring the Traffic Source straight to the sink therefore never passes, and every level lists that shortcut as a must-fail case. Never relax this.
- The router has six outputs: simple, complex, rag, batch, tool, agent. Reports are `complex` + `batch`, so only the Batch Processor or the Large model answers them well.
- Elements communicate through request tags: `answered` (a model replied), `bad` + `badReason` (silent wrong answer, caught only by the sink or an Eval Judge), `blocked`, `cached`, `embedded`/`retrieved`, `skill`, `memory`, `toolRequested`/`toolCalled`/`toolResult`.
- Guardrail, hallucination, tool-failure and judge rates are error-diffusion accumulators (exact, no noise) so tuning gives crisp feedback. **Provider outages are independent seeded random draws**: an evenly spaced accumulator made retries look far better than reality (it let a retry-only design pass a level it should fail). Token jitter and the traffic mix also use the seeded PRNG.
- A level: `tier`, `situation`, `question`, `terms` (glossary keys), optional `steps`, `explain {happening, needed}`, `traffic` (forced onto the source), `locks` (forced config on other elements), `chaos` (provider error rate per model), `starter` (nodes may carry a config: pre-built, possibly broken pipelines for the "fix it" levels 21, 23, 24), `unlocks` (cumulative), `objectives`, `holdSec`, `learned`. Validated by `objectives.validateScenario` (also checks tier and glossary keys).
- Goal labels are plain language ("Nearly everyone (95%) is answered within 2 seconds"), with the jargon explained in the glossary. Keep new labels that way.
- A level passes when every star-1 objective holds for `holdSec` simulated seconds; stars by tier (2 = star-2 goals too, 3 = star-3 goals too). Objectives are `{metric, op, value, window(s), star?, label}` over trailing sim-time windows from `metrics.windowStats`. A window is "warming" (never met) until the sim has run that long; ratio metrics with under 10 samples are `null` (never met). `p95Latency` excludes `batch` request types.
- Plain-text help: the **Explain** screen (any time) and the result screen show "what is happening" and "what needs to happen to pass", with a live diagnosis built from the event log (`campaign.js` REASON_TEXT).
- Resilience: `fallbackRetry` snapshots the request, and `sim.tryRecover` re-sends it (after exponential backoff, then to its `fallback` port) when a downstream failure is in `RECOVERABLE`. Revisiting a node (agent loops, retries) folds the request's path back so responses return by the simple route; `maxVisits` stops infinite loops.
- The front screen is the home dashboard (`campaign.js` `showHome`, `#home`): progress, Continue, level cards grouped in five tiers. It always shows on load; the header **Home** button returns to it (the sim pauses while it is open). Levels unlock sequentially (previous level needs 1 star); the dashboard has an "Unlock all levels" button for browsing. Adding a level: add it to `levels.js` and to its tier's `levels` in `learn.js`, give it a known solution and wrong answers in `tests/solutions.js` (the shortcut is mandatory), and calibrate thresholds with `tools/browser-run.js` so they sit well clear of the measured values.

## Architecture
- `js/nodes.js`: element definitions as plain data (also loadable from Node). `config` is the schema the inspector renders (range / select / toggle); `defaults` hold defaults.
- `js/engine/behaviors.js`: `process()` per element, keyed by definition id (so `nodes.js` stays pure data). One new element = one entry in each file, with no sim change. Optional hooks: `recover` (retry), `onResponse` (cache learns from answers).
- `js/engine/`: `tuning` (every constant), `metrics`, `router`, `behaviors`, `sim`, `objectives`. Sim steps at a fixed 50 ms; requests travel wires for `hopMs` each way and the response retraces the recorded path. **The engine must never touch the DOM or `window`-only APIs** so it runs headless in Node. Each file exports under Node: `if (typeof module !== 'undefined') module.exports = ...`.
- `js/campaign/levels.js`: scenarios as plain data.
- `js/store.js`: graph state and pub/sub (no DOM). `js/storage.js`: StorageAdapter seam (`load(slot)`/`save(graph, slot)`, `loadProgress`/`saveProgress`); several modules share the progress record, so each saves only its own keys.
- UI only: `icons.js`, `canvas.js`, `palette.js`, `particles.js`, `runtime.js`, `inspector.js`, `dashboard.js`, `campaign.js`, `share.js`, `tour.js`, `sfx.js`, `a11y.js`. `runtime.js` owns the sim instance and rAF loop; `particles.js` reads `sim.transits` directly and draws one path per colour (preallocated buffers, sampled above 1k particles).
- The inspector builds controls once per selection and updates in place (no re-render mid-drag); the dashboard samples charts once per simulated second.
- Charts are hand-rolled canvas; validation is a hand-written function (no Zod).
- Costs/latencies: Small = 300 ms + 2 ms/token, $0.15/1M; Large = 900 ms + 6 ms/token, $3/1M (all in `tuning.js`).

## Testing
- `node --test tests/` (Node 18+, no install). Files: `sim`, `metrics`, `objectives`, `elements`, `levels` (plays every level with known solutions, wrong answers and pre-built pipelines "as given", 3 seeds each, plus structure checks: 5 tiers of at least 5 levels, glossary references, plain text on every element).
- Without Node: open the app, then in the browser console run `(0, eval)(await (await fetch('tools/browser-tests.js')).text()); await SIM_TESTS(['elements.test.js'])`. The browser tool caps a call at about 30 s, so run `levels.test.js` in chunks with the optional filter, e.g. `await SIM_TESTS(['levels.test.js'], /^level (1|2|3|4|5) ?[:r]/)`. `tools/browser-run.js` (`SIM_RUN([levelIds],[seeds])`) prints calibration numbers for solutions and wrong answers.
- **Tuning guard:** `tests/levels.test.js` + `tests/solutions.js`. Any change to `tuning.js`, behaviors or levels must keep them green. Add a known solution and a wrong answer (including the source-to-sink shortcut) for every new level.

## Working agreements
- Keep files small and readable; comment the "why".
- Don't add dependencies without asking.
- Milestones: the "stop for review after each milestone" rule was lifted when M4-M6 were requested together. Reinstate it for future milestones unless told otherwise.
- After a change: update Status above, summarize what changed, and list anything deferred.
