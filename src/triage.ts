/**
 * The core loop: one ticket -> classify (Gemini) -> apply policy (pure) -> Decision.
 *
 * Returns both the spec-contract `Decision` and the raw `Classification`, so the
 * caller can surface the "why" (detected_intents, injection_detected) behind a
 * BLOCK or escalation. `context_used` is empty — Xero enrichment is a later step.
 */

import type { GoogleGenAI } from "@google/genai";

import { classify } from "./classify.js";
import { applyPolicy } from "./policy.js";
import type { Classification, Decision } from "./types.js";
import type { Ticket } from "./types.js";

export interface TriageResult {
  decision: Decision;
  classification: Classification;
  escalation_reasons: string[];
}

export async function triage(
  ticket: Ticket,
  ai?: GoogleGenAI,
): Promise<TriageResult> {
  const classification = await classify(ticket, ai);
  const policy = applyPolicy(classification);

  const proposed_action = policy.suppress_action
    ? { type: "none" as const, params: {} }
    : {
        type: classification.proposed_action.type,
        params: { ...classification.proposed_action.params },
      };

  const decision: Decision = {
    ticket_id: ticket.ticket_id,
    category: classification.category,
    confidence: classification.confidence,
    risk_tier: policy.risk_tier,
    decision: policy.decision,
    proposed_action,
    rationale: classification.rationale,
    context_used: [], // no Xero enrichment yet
  };

  return {
    decision,
    classification,
    escalation_reasons: policy.escalation_reasons,
  };
}
