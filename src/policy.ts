/**
 * The deterministic policy layer — the safety boundary. No network I/O.
 *
 * The model classifies; this module decides. The cardinal error the spec warns
 * about (a "false-auto" — auto-executing something that needed a human) must be
 * unreachable through the model's discretion. In particular, the
 * highest-risk-intent rule is enforced HERE, not via the model's chosen primary
 * category: the tier is the riskiest across the primary category AND every
 * detected intent, so a refund buried in a how_to cannot resolve to AUTO.
 */

import type {
  Category,
  Classification,
  DecisionVerdict,
  RiskTier,
} from "./types.js";

export const CONFIDENCE_THRESHOLD = 0.7;

/** Category → tier (SPEC.md policy table). `unclear` → REVIEW (fail safe). */
export const CATEGORY_TIERS: Record<Category, RiskTier> = {
  how_to: "AUTO",
  access: "AUTO",
  billing_inquiry: "AUTO",
  bug: "AUTO",
  data_sync: "AUTO",
  spam: "AUTO",
  billing_dispute: "REVIEW",
  account_change: "REVIEW",
  security: "BLOCK",
  compliance: "BLOCK",
  unclear: "REVIEW",
};

const TIER_RANK: Record<RiskTier, number> = { AUTO: 1, REVIEW: 2, BLOCK: 3 };

/** The riskiest tier in a list; ranks BLOCK > REVIEW > AUTO. Empty → AUTO. */
export function riskiest(tiers: RiskTier[]): RiskTier {
  return tiers.reduce<RiskTier>(
    (acc, t) => (TIER_RANK[t] > TIER_RANK[acc] ? t : acc),
    "AUTO",
  );
}

export interface PolicyResult {
  risk_tier: RiskTier;
  decision: DecisionVerdict;
  /** Why the ticket escalated, in priority order. Empty when EXECUTE. */
  escalation_reasons: string[];
  /** True when no executable action may be proposed (BLOCK or low confidence). */
  suppress_action: boolean;
}

export function applyPolicy(c: Classification): PolicyResult {
  // Highest-risk-intent, in deterministic code: the tier is the riskiest across
  // the primary category and every detected intent. Instruction-as-data forces
  // BLOCK regardless of category.
  const candidateTiers: RiskTier[] = [c.category, ...c.detected_intents].map(
    (cat: Category) => CATEGORY_TIERS[cat],
  );
  const risk_tier: RiskTier = c.injection_detected
    ? "BLOCK"
    : riskiest(candidateTiers);

  // Confidence gate + decision derivation (unchanged): only an AUTO tier with
  // sufficient confidence may EXECUTE; everything else ESCALATES.
  const lowConfidence = c.confidence < CONFIDENCE_THRESHOLD;
  const reasons: string[] = [];
  if (c.injection_detected) {
    reasons.push("instruction-as-data: manipulation attempt routed to a human");
  }
  if (risk_tier !== "AUTO") {
    reasons.push(`${risk_tier} tier (riskiest of category + detected intents) requires a human`);
  }
  if (lowConfidence) {
    reasons.push(
      `confidence ${c.confidence.toFixed(2)} below threshold ${CONFIDENCE_THRESHOLD.toFixed(2)}`,
    );
  }

  const escalate = risk_tier !== "AUTO" || lowConfidence;
  const decision: DecisionVerdict = escalate ? "ESCALATE" : "EXECUTE";
  const suppress_action = risk_tier === "BLOCK" || lowConfidence;

  return { risk_tier, decision, escalation_reasons: reasons, suppress_action };
}
