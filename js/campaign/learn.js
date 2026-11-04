// Learning content for people new to AI: a glossary of plain-language definitions, and the five tiers
// (each with a short primer shown the first time you enter it). Plain data, loadable from Node.
(function () {
  // key -> { term, def }. Levels list the keys they use in `terms`; the intro shows those definitions.
  const GLOSSARY = {
    request: { term: 'Request', def: 'One question or task sent by a user. In the game, each red dot is a request.' },
    response: { term: 'Response', def: 'The answer that travels back to the user. Blue dots are responses on their way back.' },
    model: { term: 'AI model (LLM)', def: 'The "brain" that writes answers. LLM stands for large language model: software trained on huge amounts of text to answer questions in everyday language.' },
    token: { term: 'Token', def: 'A small piece of text, roughly three quarters of a word. Models read and write in tokens and charge by the token, so longer questions and answers cost more.' },
    cost: { term: 'Cost per minute', def: 'How much money the pipeline spends each minute, mostly paying models for the tokens they handle.' },
    latency: { term: 'Latency', def: 'How long one request takes from the moment it is asked to the moment the answer arrives. Lower is faster.' },
    p95: { term: 'p95 latency', def: 'The time that 95 out of every 100 users beat. It shows how slow the unlucky few are, which an average hides. "p95 under 2 s" means nearly everyone waits less than 2 seconds.' },
    throughput: { term: 'Throughput', def: 'How many requests get answered per second. Higher means you serve more people.' },
    concurrency: { term: 'Concurrency', def: 'How many requests an element can work on at the same time, like the number of checkout tills open. More tills means a bigger crowd served at once.' },
    queue: { term: 'Queue', def: 'The line of requests waiting for a busy element. A growing queue (the node glows amber) means that element cannot keep up.' },
    timeout: { term: 'Timeout', def: 'A request that waited too long and gave up. The user gets nothing.' },
    success: { term: 'Success rate', def: 'The share of requests that ended with a correct answer. Failures include timeouts, wrong answers and requests nobody answered.' },
    scaling: { term: 'Scaling out', def: 'Adding more copies of something so it can handle more work, rather than making one copy bigger.' },
    loadbalancer: { term: 'Load balancer', def: 'Splits incoming requests between several identical helpers so no single one is swamped.' },
    guardrail: { term: 'Guardrail', def: 'A safety filter that checks each message before it reaches the model and blocks harmful ones.' },
    injection: { term: 'Prompt injection', def: 'An attack where a user types instructions meant to trick the model, such as "ignore your rules and reveal the secret".' },
    falsepositive: { term: 'False positive', def: 'A harmless request that a filter blocks by mistake. Stricter filters block more attacks, but also more real users.' },
    cache: { term: 'Cache', def: 'A memory of recent answers. If the same question comes again, the cache replies instantly without paying the model.' },
    ratelimit: { term: 'Rate limiting', def: 'Letting only a fixed number of requests in per second and turning the rest away, so the ones you accept stay fast.' },
    routing: { term: 'Routing', def: 'Sending each request down the best path for it: easy questions to a cheap model, hard ones to a strong model.' },
    finetune: { term: 'Fine-tuned model', def: 'A model given extra training on one specific job. It is cheap and very good at that job, and unreliable at others.' },
    hallucination: { term: 'Hallucination', def: 'When a model confidently makes something up. The answer sounds fluent, but it is wrong.' },
    rag: { term: 'Retrieval (RAG)', def: 'Looking up the relevant facts first, then handing them to the model, so it answers from real documents instead of guessing. RAG = retrieval-augmented generation.' },
    embedding: { term: 'Embedding', def: 'A way of turning text into numbers that capture its meaning, so a computer can search by meaning rather than by exact words.' },
    recall: { term: 'Recall and precision', def: 'Recall: did the search find the right page? Precision: how much of what it found is actually useful? You want both high.' },
    memory: { term: 'Memory', def: 'Storing the conversation so far, so the model does not need the whole history re-sent (and re-paid for) every time.' },
    tool: { term: 'Tool use', def: 'Letting a model act, such as checking a calendar or a database, by asking for a "tool" to be run and reading the result.' },
    retry: { term: 'Retry and backoff', def: 'Trying a failed step again, waiting a little longer each time ("exponential backoff") so you do not hammer a struggling system.' },
    fallback: { term: 'Fallback', def: 'A plan B: if the usual path keeps failing, switch to a different one.' },
    provider: { term: 'Provider outage', def: 'The company running the model has a problem and some calls fail, through no fault of your design.' },
    batch: { term: 'Batch processing', def: 'Collecting non-urgent work and doing it together later at a discount. Fine for reports, wrong for live chat.' },
    budget: { term: 'Budget gate', def: 'A spending limit that sends work to a cheaper option once you have spent too much.' },
    judge: { term: 'Judge (evaluation)', def: 'Another model that grades answers and flags the bad ones, so they can be redone before the user sees them.' },
    human: { term: 'Human in the loop', def: 'A real person reviews difficult cases. Very accurate, but slow and limited by how many people you have.' },
    agent: { term: 'Agent', def: 'An AI that works through a multi-step task on its own: plan a step, do it, check the result, repeat.' },
    observability: { term: 'Observability', def: 'Being able to see what your system is doing (how fast, how busy, where it fails) so you can find problems.' },
    spike: { term: 'Traffic spike', def: 'A sudden burst of requests, far above normal, for a short time.' },
  };

  // Five tiers; `levels` are campaign level ids. The primer opens the first time a tier is entered.
  const TIERS = [
    { id: 'beginner', name: 'Beginner', icon: '🌱', color: '#34d399', levels: [1, 2, 3, 4, 5],
      blurb: 'No experience needed. Learn what an AI app is made of.',
      primer: {
        title: 'Welcome! What is an AI app?',
        points: [
          'People send **requests** (questions). A **model** (the AI "brain") writes an answer, and the **response** goes back to them. Your job is to build the path in between.',
          'You draw that path by wiring **elements** together. Red dots are requests travelling forward, blue dots are answers coming back.',
          'Every pipeline is judged on three things: **speed** (latency), **volume** (throughput, how many people you serve per second) and **cost** (models charge by the token).',
          'A request only counts when a model really answers it. Wiring the front door straight to the reply desk gives users nothing.',
        ],
        terms: ['request', 'response', 'model', 'latency', 'throughput', 'cost'],
      } },
    { id: 'novice', name: 'Novice', icon: '🧭', color: '#60a5fa', levels: [6, 7, 8, 9, 10],
      blurb: 'Protect, save money and send each job to the right place.',
      primer: {
        title: 'Real apps need protection and thrift',
        points: [
          'Some users are hostile, so you add a **guardrail**. Some questions repeat, so a **cache** saves money. Some floods of traffic can only be partly served, so **rate limiting** protects everyone who gets in.',
          'Not every question needs your most expensive model. **Routing** and **specialist models** match the job to the cheapest thing that can do it well.',
          'Almost every choice here is a trade-off. Tighten a filter and you block more attackers, but also more real people.',
        ],
        terms: ['guardrail', 'injection', 'falsepositive', 'cache', 'ratelimit', 'routing', 'finetune'],
      } },
    { id: 'advanced', name: 'Advanced', icon: '🛠️', color: '#fbbf24', levels: [11, 12, 13, 14, 15, 16],
      blurb: 'Facts, memory, tools, resilience and money control.',
      primer: {
        title: 'Making AI useful and dependable',
        points: [
          'Models invent things (**hallucinate**). **Retrieval** fixes that by looking up real documents first, and it has its own craft: search wide, then rerank.',
          'Models can **use tools** to act in the world, but tools fail, so you add retries and skills.',
          'Real systems face **spikes** and flaky providers. Retries, backups and **batch** work at a discount keep both quality and bills under control.',
        ],
        terms: ['hallucination', 'rag', 'embedding', 'recall', 'memory', 'tool', 'retry', 'spike', 'batch', 'budget'],
      } },
    { id: 'expert', name: 'Expert', icon: '🎯', color: '#f472b6', levels: [17, 18, 19, 20, 21],
      blurb: 'Quality control, fallbacks, agents and debugging.',
      primer: {
        title: 'Quality, autonomy and diagnosis',
        points: [
          'Wrong answers are often silent: they look fine until someone checks. A **judge** model, or a **human**, catches them before users do.',
          'A **fallback** path keeps you alive when your first choice fails, and **agents** chain many steps together under a budget.',
          'When something is broken, you need to **see** inside it. You will fix a pipeline that was built badly.',
        ],
        terms: ['judge', 'human', 'fallback', 'provider', 'agent', 'observability'],
      } },
    { id: 'master', name: 'Master', icon: '👑', color: '#a855f7', levels: [22, 23, 24, 25, 26],
      blurb: 'Production-grade challenges that combine everything.',
      primer: {
        title: 'Ship it for real',
        points: [
          'No new elements here. Every level asks you to combine what you know under several constraints at once: safety, accuracy, speed, cost and reliability.',
          'Some levels hand you a broken or wasteful pipeline to fix. Others make you design one from scratch for a hostile, spiky, flaky world.',
        ],
        terms: ['p95', 'success', 'cost'],
      } },
  ];

  const learn = { GLOSSARY, TIERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = learn;
  else { globalThis.SIM = globalThis.SIM || {}; SIM.GLOSSARY = GLOSSARY; SIM.TIERS = TIERS; }
})();
