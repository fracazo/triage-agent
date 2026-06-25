# Triage Agent — Step 1: the core loop

Reads one support ticket, asks **Gemini** to classify it, applies the risk
policy in deterministic code, and prints the decision. No integrations yet (no
Xero, no Slack, no SQLite). See [SPEC.md](SPEC.md) for the full contract.

## Design: the model classifies, code decides

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
- **[`src/policy.ts`](src/policy.ts) owns the decision** — pure, no network. It
  enforces the spec's three rules so a "false-auto" can't hinge on the model's
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
npm run dev        # tsx src/index.ts — runs the hardcoded T001 ticket
npm run typecheck  # tsc --noEmit
npm run build      # tsc -> dist/
```

Output: the SPEC.md decision contract, followed by a classification trace
(`detected_intents`, `injection_detected`, `escalation_reasons`) so the reasoning
behind a BLOCK / ESCALATE is visible.

## Layout

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | `Ticket`, the Zod `Classification` schema + the mirrored Gemini `responseSchema`, the `Decision` contract. |
| [`src/policy.ts`](src/policy.ts) | Deterministic safety core: highest-risk-intent, confidence gate, decision. Pure. |
| [`src/classify.ts`](src/classify.ts) | The Gemini call + system prompt → validated `Classification`. |
| [`src/triage.ts`](src/triage.ts) | The core loop: classify → apply policy → `Decision`. |
| [`src/index.ts`](src/index.ts) | Hardcoded ticket, runs the loop, prints decision + trace. |

## Not yet built (later steps)

Xero enrichment (`context_used` is empty), Slack approval routing, executing the
AUTO actions, SQLite audit log, and the eval harness over `evals/dataset.json`.
