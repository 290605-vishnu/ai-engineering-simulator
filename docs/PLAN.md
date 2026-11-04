> **Update:** the game is campaign-only (no sandbox) and M0-M6 are built with 10 levels; see `CLAUDE.md` for the current design, element list and testing.

> **Stack override (supersedes sections 1-3, 8):** the project is plain HTML/CSS/JS, no build step, no npm dependencies. See `CLAUDE.md`. Everything else in this plan (engine model, elements, levels, milestones M1-M6) still applies. M0 is done.

# AI Engineering Simulator — Implementation Plan

A drag-and-drop "systems factory" game that teaches AI engineering concepts to engineers upskilling into the field. Requests flow continuously through a user-built pipeline; the player sees queues back up, costs climb, guardrails catch bad inputs, and caches save money — in real time.

## 1. Decisions locked in

| Topic | Decision |
|---|---|
| Deliverable | React web app, multi-file project (Vite + TypeScript) |
| Modes | Sandbox (free build) + Campaign (guided levels with goals/scoring) |
| Realism | Semi-real: latency, cost, tokens, failure modes — no real LLM calls |
| Connections | Player draws wires between nodes manually |
| Persistence | Pure frontend now (localStorage/IndexedDB); backend later via a storage adapter |
| Scenario authoring | Code-defined JSON/TS files; in-app editor is a stretch goal |
| Colors | Requests = red, Responses = blue; errors/bad outputs get distinct colors |

## 2. Tech stack

- **Vite + React 18 + TypeScript**
- **React Flow (@xyflow/react)** — node canvas, drag/drop, manual wiring, zoom/pan, minimap. Saves months vs. hand-rolling.
- **Zustand** — game state store (graph, sim state, metrics, progress). Simple, fast, no boilerplate.
- **Canvas 2D overlay** for animated request/response particles (DOM elements at 500+ particles will stutter; a single `<canvas>` layered over React Flow is cheap).
- **Tailwind CSS** + shadcn/ui for panels, HUD, modals.
- **Recharts** for the metrics dashboard.
- **Vitest** for the simulation engine (pure TS, fully unit-testable without the UI).
- **Zod** for validating scenario and node-definition files.

## 3. Architecture

```
┌─────────────────────────────────────────────────────┐
│ UI (React)                                          │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────┐  │
│  │ Palette  │ │ Canvas       │ │ Inspector / HUD │  │
│  │ (nodes)  │ │ (React Flow  │ │ (metrics, node  │  │
│  │          │ │  + particle  │ │  config, goals) │  │
│  │          │ │  canvas)     │ │                 │  │
│  └──────────┘ └──────────────┘ └─────────────────┘  │
├─────────────────────────────────────────────────────┤
│ Zustand store  (graph, simState, metrics, progress) │
├─────────────────────────────────────────────────────┤
│ Simulation Engine (pure TS, no React)               │
│  tick() → spawn → route → process → emit events     │
├─────────────────────────────────────────────────────┤
│ Content: node definitions, scenarios, request types │
└─────────────────────────────────────────────────────┘
```

Key principle: **the engine never imports React**. UI subscribes to the store; the engine mutates it on a fixed timestep (e.g. 20 ticks/s via `requestAnimationFrame` accumulator). This makes the simulator testable and lets you later run it headless (e.g. a backend scoring service).

## 4. Simulation engine

### 4.1 Core model

```ts
type Request = {
  id: string;
  type: RequestType;          // 'qa' | 'rag' | 'tool_call' | 'multimodal' | 'malicious' ...
  tokensIn: number;
  tokensOut?: number;
  createdAt: number;          // sim time (ms)
  path: NodeId[];             // nodes visited
  currentNode: NodeId;
  phase: 'request' | 'response';
  status: 'in_flight' | 'done' | 'failed';
  failReason?: 'timeout' | 'rate_limited' | 'blocked' | 'hallucination' | 'no_route';
  cost: number;
  tags: Set<string>;          // e.g. 'cached', 'injected', 'escalated'
};

type NodeInstance = {
  id: NodeId;
  defId: string;              // references NodeDefinition
  config: Record<string, number | string | boolean>;
  queue: Request[];
  inFlight: Request[];
  stats: { processed: number; failed: number; totalLatency: number; cost: number };
};

type Edge = { id: string; source: NodeId; target: NodeId; sourceHandle?: string };
```

### 4.2 Node definition contract

Every element is a `NodeDefinition` — a plain object plus a `process` function. New elements = new file, no engine change.

```ts
type NodeDefinition = {
  id: string;
  label: string;
  category: 'ingress' | 'traffic' | 'model' | 'retrieval' | 'safety' | 'tooling' | 'memory' | 'observability' | 'egress';
  icon: string;
  description: string;        // one-liner shown in palette
  concept: string;            // what it teaches, shown in inspector
  inputs: PortSpec[];         // e.g. [{ id: 'in' }]
  outputs: PortSpec[];        // e.g. [{ id: 'pass' }, { id: 'blocked' }]
  config: ConfigSchema;       // sliders/toggles exposed to the player
  defaults: Record<string, any>;
  concurrency: number | 'unlimited';
  process: (req: Request, node: NodeInstance, ctx: SimContext) => ProcessResult;
  // ProcessResult = { outputPort, latencyMs, cost, tokensDelta, mutate?: (req) => void, fail?: FailReason }
};
```

### 4.3 Tick loop

1. **Spawn** — the Traffic Source emits requests at the player-controlled rate (slider: 0–200 req/s) with a request-type mix defined by the scenario. Burst mode and spike scripting supported.
2. **Route** — for each node, dequeue up to `concurrency` requests; call `process()`; schedule completion at `now + latencyMs`.
3. **Complete** — on completion, follow the edge from the chosen output port. If no edge → request fails with `no_route` (teaches "unhandled path").
4. **Respond** — Model/egress nodes flip `phase` to `response`; the particle turns blue and travels back along `path` in reverse to the Traffic Source.
5. **Metrics** — aggregate per-tick: throughput, p50/p95 latency, cost/min, success rate, queue depths, token usage.
6. **Goal check** (campaign) — evaluate scenario objectives against rolling-window metrics.

Time scale is player-controllable (pause / 1× / 2× / 5×).

### 4.4 Request types (initial set)

| Type | Tokens in/out | Needs | Notes |
|---|---|---|---|
| `qa` | 50 / 150 | Model | Baseline |
| `rag` | 80 / 300 | Retriever → Model | Fails ("hallucination") if no retrieval before model |
| `tool_call` | 120 / 200 | Model → Tool Executor → Model | Two model passes |
| `multimodal` | 800 / 200 | Vision-capable model | Text-only models reject |
| `long_context` | 20k / 500 | Model with large context | Overflows small models |
| `malicious` | 60 / — | Guardrail | Passes through unprotected pipelines as "injected" (red→purple) |

## 5. Element catalog

### Phase 1 (MVP)
| Element | Category | Teaches | Key config |
|---|---|---|---|
| Traffic Source | ingress | Load patterns | rate, mix, burst |
| Load Balancer | traffic | Horizontal scaling | strategy: round-robin / least-busy / weighted |
| LLM — Small | model | Speed/cost vs. quality | concurrency, context window |
| LLM — Large | model | Same, opposite tradeoff | concurrency, context window |
| Guardrail / Content Filter | safety | Prompt injection, policy | strictness (false-positive rate rises) |
| Response Sink | egress | Terminates & scores | — |

### Phase 2
| Element | Category | Teaches |
|---|---|---|
| Rate Limiter | traffic | Backpressure, 429s |
| Prompt Router | traffic | Model routing by request type/complexity |
| Semantic Cache | memory | Cache hit rate, cost savings |
| Embedding Model | retrieval | Vectorization latency/cost |
| Vector DB / Retriever | retrieval | RAG, top-k, recall |
| Reranker | retrieval | Precision vs. latency |
| Tool Executor | tooling | Function calling, external latency |
| Connector (API/DB/SaaS) | tooling | Integration failure modes, auth |
| Skill | tooling | Reusable instruction bundles; boosts success on matching request types |
| Plugin | tooling | Bundles skills + connectors; shows composability |
| Observability Tap | observability | Tracing; unlocks per-node metrics in HUD |

### Phase 3
| Element | Teaches |
|---|---|
| Memory Store (short/long-term) | Session context, personalization |
| Eval / LLM-as-Judge | Quality gating, cost of evaluation |
| Fallback / Retry | Resilience, exponential backoff |
| Agent Orchestrator | Multi-step planning, loops, budget caps |
| Sub-agent | Delegation, parallelism |
| Human-in-the-Loop | Escalation, latency spikes |
| Fine-tuned Model | Specialization vs. generality |
| Batch Processor | Async workloads, cost arbitrage |
| Cost Budget Gate | FinOps |

## 6. Game modes

### 6.1 Sandbox
- Concept picker (e.g. "RAG", "Agents", "Guardrails") filters the palette to relevant elements and pre-configures the request mix.
- Unlimited budget, all elements unlocked, free rate control.
- Save/load/share layouts (JSON export; URL-encoded share later).

### 6.2 Campaign
Levels are ordered; each unlocks elements and a concept card.

| # | Level | Goal | Unlocks |
|---|---|---|---|
| 1 | Hello, Inference | Serve 10 req/s with one model | Traffic Source, LLM Small, Sink |
| 2 | Scale Out | 50 req/s, p95 < 2s | Load Balancer, LLM Large |
| 3 | Don't Get Owned | Block 95% malicious, <5% false positives | Guardrail |
| 4 | Stop Paying Twice | Cut cost/min by 40% on repetitive traffic | Semantic Cache |
| 5 | Ground Truth | Hallucination rate < 5% on `rag` traffic | Embedding, Vector DB, Reranker |
| 6 | Right Tool for the Job | Mixed traffic, cost cap, p95 target | Prompt Router, Rate Limiter |
| 7 | Hands and Feet | Handle `tool_call` traffic | Tool Executor, Connector, Skill, Plugin |
| 8 | Traffic Spike | Survive 10× burst without >1% errors | Fallback/Retry, Budget Gate |
| 9 | Agents Assemble | Multi-step tasks under step budget | Agent Orchestrator, Sub-agent |
| 10 | Production Ready | All constraints at once | Observability, Eval Judge, HITL |

Scoring: 3 stars per level — pass, pass under cost, pass under cost + latency. Scenario file declares objectives as declarative rules:

```ts
objectives: [
  { metric: 'throughput', op: '>=', value: 50, window: 30 },
  { metric: 'p95Latency', op: '<=', value: 2000, window: 30 },
  { metric: 'costPerMin', op: '<=', value: 1.5, window: 60, star: 2 },
]
```

## 7. UI layout

```
┌───────────────────────────────────────────────────────────────┐
│ Top bar: mode | scenario name | ▶ ⏸ speed | rate slider | $$$  │
├──────────┬──────────────────────────────────┬─────────────────┤
│ Palette  │                                  │ Inspector       │
│ (grouped │        Canvas (React Flow)       │ - node config   │
│  by      │    + particle overlay canvas     │ - node stats    │
│  category│                                  │ - concept card  │
│  search) │                                  ├─────────────────┤
│          │                                  │ Goals (campaign)│
├──────────┴──────────────────────────────────┴─────────────────┤
│ Metrics strip: throughput | p50/p95 | success % | cost/min    │
│ (expandable to full dashboard with charts & event log)        │
└───────────────────────────────────────────────────────────────┘
```

Visual language:
- **Red particles** = requests, **blue** = responses, **purple** = malicious/injected that got through, **grey fading** = failed/dropped, **gold** = cache hit.
- Node border glows amber→red as queue depth rises; pulses on processing.
- Edges thicken with traffic volume.
- Hover a particle to see its request card (type, tokens, path so far, cost).

## 8. Project structure

```
src/
  engine/
    sim.ts               # tick loop, scheduling
    router.ts            # edge traversal, port resolution
    metrics.ts           # rolling windows, percentiles
    objectives.ts        # campaign goal evaluation
    types.ts
    __tests__/
  content/
    nodes/               # one file per NodeDefinition
      trafficSource.ts, loadBalancer.ts, llmSmall.ts, ...
      index.ts           # registry
    requests/types.ts
    scenarios/
      sandbox/*.ts
      campaign/level01.ts ... level10.ts
      schema.ts          # zod schema
  store/
    gameStore.ts         # Zustand: graph + sim + progress
    persistence.ts       # StorageAdapter interface; LocalStorageAdapter now
  ui/
    canvas/              # React Flow wrapper, custom node components, ParticleLayer
    palette/
    inspector/
    hud/
    campaign/            # level select, results modal, concept cards
    shell/               # layout, top bar
  App.tsx
```

`StorageAdapter` interface (`load/save/listSaves/progress`) is the seam for the future backend — swap `LocalStorageAdapter` for `ApiAdapter` without touching UI.

## 9. Milestones

| Milestone | Scope | Est. |
|---|---|---|
| **M0 — Skeleton** | Vite/TS/React Flow/Zustand/Tailwind set up; drag from palette, wire nodes, delete, pan/zoom | 1 wk |
| **M1 — Engine core** | Tick loop, Request/Node model, Phase 1 elements, red/blue particles, rate slider, pause/speed. Unit tests for engine | 2 wks |
| **M2 — Metrics & inspector** | HUD strip, node stats, config sliders live-update, event log, request hover cards | 1 wk |
| **M3 — Campaign** | Scenario schema, objectives evaluator, levels 1–4, star scoring, progress saved locally, concept cards | 2 wks |
| **M4 — Phase 2 elements** | Cache, router, rate limiter, RAG stack, tools/connectors/skills/plugins; levels 5–7 | 2 wks |
| **M5 — Resilience & agents** | Phase 3 elements, levels 8–10, burst scripting, fallbacks | 2 wks |
| **M6 — Polish** | Onboarding tutorial, sound/visual feedback, save/load/share, accessibility, performance pass (1k+ particles) | 1–2 wks |
| **Stretch** | In-app scenario editor; backend adapter (auth, leaderboards); optional "live mode" hitting a real LLM for a sampled 1% of requests | — |

## 10. Risks & mitigations

- **Performance** with many particles → canvas overlay, object pooling, cap visible particles and sample when >1k.
- **Balancing** (numbers feel wrong) → keep all latency/cost constants in one `tuning.ts`; expose a debug panel to tweak live.
- **Scope creep in elements** → the NodeDefinition contract keeps each element a ~60-line file; ship Phase 1 before adding more.
- **Teaching vs. gaming** → every element has a `concept` card and every level ends with a "what you learned" summary tying metrics to the concept.

## 11. Open items to decide during M0
- Exact latency/cost constants per model tier (propose: Small = 300ms + 2ms/token, $0.15/1M; Large = 900ms + 6ms/token, $3/1M).
- Whether Skills/Plugins attach *to* a model node (as badges) or exist as standalone nodes in the flow. Recommendation: standalone nodes for visibility of routing, with a Plugin node that visually "contains" child skills/connectors.
- Dark/light theme default (recommend dark for particle contrast).
