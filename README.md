# Triage Agent

Support ticket triage where the model classifies and deterministic code decides.
An agent reads each ticket, assigns a risk tier, acts on the safe ones by itself,
and hands a human only what it is not allowed to touch.

![The agent working an eight ticket queue, then the result: six handled on its own, one proposal waiting for approval, one message it refused to act on.](docs/triage-run.gif)

**[Open the live prototype](https://fracazo.github.io/triage-agent/)**

The run above takes about two seconds. What it shows: the queue draining, a tier
landing on each ticket, drafts streaming past faster than you can read them, then
the result split into the two piles that are the actual human workload.

## The idea: the model classifies, the code decides

The safety boundary lives in plain TypeScript, not in the model's discretion.

```
ticket ──▶ classify.ts ──▶ Classification ──▶ policy.ts ──▶ Decision
           (Gemini)        category               (pure)      EXECUTE / ESCALATE
                           confidence
                           detected_intents
                           injection_detected
                           proposed_action
```

- **The model only classifies and proposes** (`src/classify.ts`). It returns the
  primary `category`, a `confidence`, **every** intent it found
  (`detected_intents`), whether the ticket tried to manipulate it
  (`injection_detected`), a proposed action, and a rationale.
- **[`src/policy.ts`](src/policy.ts) owns the decision.** Pure, no network. It
  enforces the spec's three rules so a "false-auto" cannot hinge on the model's
  choice of primary category:
  - **Highest-risk-intent in code:**
    `risk_tier = injection ? BLOCK : riskiest([category, ...detected_intents])`,
    ranking `BLOCK > REVIEW > AUTO`. A refund buried in a `how_to` still escalates.
  - **Instruction-as-data:** `injection_detected` forces `BLOCK`.
  - **Confidence gate:** below `0.7` → `ESCALATE`, regardless of category.
  - Decision: only `AUTO` + sufficient confidence → `EXECUTE`; else `ESCALATE`.
    `BLOCK` / low-confidence suppress any proposed action to `none`.

`unclear` is added for the underspecified case (maps to `REVIEW`);
`detected_intents` is restricted to the 10 spec taxonomy categories.

See [SPEC.md](SPEC.md) for the full contract.

## The prototype

`ui/` is a single static page with no build step. It exists to make the safety
boundary something you can feel rather than read about.

Three outcomes, and the interface never blurs them:

| Outcome | What the agent did | What you can do |
|---|---|---|
| Handled | Replied, tagged or routed | Nothing. Collapsed to one line. |
| Needs your approval | Proposed one specific action | Approve or Reject |
| No action proposed | Nothing, by policy | Take the ticket |

Approve and Reject appear only where the agent actually proposed something. A
`BLOCK` ticket has nothing to approve, so it offers neither. Every decision can
be undone, and each ticket opens a detail view with the classification, the
decision in plain language, and the raw policy trace collapsed for audit.

**The prototype is a fixture replay.** The classifications are hand-written to
match the gold labels in [`evals/dataset.json`](evals/dataset.json), so no API
key is needed and no model runs. The tiers, decisions and eval metrics are
computed in the page by a port of `src/policy.ts`, which is why the eval panel
scores 100% and says so. Wiring it to live Gemini calls is the next step.

## Stack (verified against the docs)

- **Model:** `gemini-3.5-flash` (GA).
- **SDK:** [`@google/genai`](https://github.com/googleapis/js-genai) v2 (not the
  deprecated `@google/generative-ai`).
- **Structured output:** Gemini native `responseMimeType: "application/json"` +
  `responseSchema`, then **Zod**-validated (`src/types.ts`).

## Setup

```bash
npm install
cp .env.example .env     # then add your key (free from Google AI Studio)
```

`GEMINI_API_KEY` is loaded via Node 22's `process.loadEnvFile`. Override the model
with `GEMINI_MODEL` (e.g. `gemini-2.5-flash` if the free tier returns 503s on the
default `gemini-3.5-flash`).

## Run

```bash
npm run dev        # serves the prototype in ui/ at http://localhost:4173, no key needed
npm run triage     # tsx src/index.ts, runs one hardcoded ticket through the core loop
npm run typecheck  # tsc --noEmit
npm run build      # tsc -> dist/
```

`npm run triage` prints the SPEC.md decision contract, followed by a
classification trace (`detected_intents`, `injection_detected`,
`escalation_reasons`) so the reasoning behind a BLOCK or ESCALATE is visible.

## Layout

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | `Ticket`, the Zod `Classification` schema + the mirrored Gemini `responseSchema`, the `Decision` contract. |
| [`src/policy.ts`](src/policy.ts) | Deterministic safety core: highest-risk-intent, confidence gate, decision. Pure. |
| [`src/classify.ts`](src/classify.ts) | The Gemini call + system prompt, to a validated `Classification`. |
| [`src/triage.ts`](src/triage.ts) | The core loop: classify, apply policy, `Decision`. |
| [`src/index.ts`](src/index.ts) | Hardcoded ticket, runs the loop, prints decision + trace. |
| [`ui/index.html`](ui/index.html) | The prototype. Static, no build, fixture replay. |

## Not yet built (later steps)

Live Gemini calls behind the prototype, Xero enrichment (`context_used` is
empty), Slack approval routing, executing the AUTO actions, SQLite audit log,
and the eval harness over `evals/dataset.json`.
