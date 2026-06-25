/**
 * Shared types and schemas.
 *
 * Schema approach (Option 1): the Gemini `responseSchema` and the Zod schema are
 * both hand-written here and MUST be kept in sync. Gemini constrains generation
 * to `classificationResponseSchema`; Zod re-validates the parsed JSON so a
 * malformed or off-schema response is rejected before it reaches policy code.
 */

import { Type } from "@google/genai";
import { z } from "zod";

// --- Taxonomy (SPEC.md) ----------------------------------------------------

/** The 10 spec categories. `detected_intents` is constrained to these. */
export const TAXONOMY = [
  "how_to",
  "access",
  "billing_inquiry",
  "billing_dispute",
  "bug",
  "data_sync",
  "account_change",
  "security",
  "compliance",
  "spam",
] as const;

/** The primary `category` may also be `unclear` (too little info → confidence gate). */
export const CATEGORIES = [...TAXONOMY, "unclear"] as const;

export type TaxonomyCategory = (typeof TAXONOMY)[number];
export type Category = (typeof CATEGORIES)[number];

export type RiskTier = "AUTO" | "REVIEW" | "BLOCK";
export type DecisionVerdict = "EXECUTE" | "ESCALATE";

// --- Input: a ticket (SPEC.md "Input: a ticket") ---------------------------

export interface Ticket {
  ticket_id: string;
  subject: string;
  body: string;
  customer_id: string;
  channel: "email" | "chat" | "form";
}

// --- Model output: Classification (Zod = validation source of truth) -------

export const ActionTypeEnum = z.enum([
  "send_reply",
  "apply_tags",
  "route_queue",
  "none",
]);
export type ActionType = z.infer<typeof ActionTypeEnum>;

export const ActionParamsSchema = z
  .object({
    reply: z.string().optional(),
    tags: z.array(z.string()).optional(),
    queue: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
export type ActionParams = z.infer<typeof ActionParamsSchema>;

export const ProposedActionSchema = z
  .object({
    type: ActionTypeEnum,
    params: ActionParamsSchema.default({}),
  })
  .strict();

export const ClassificationSchema = z
  .object({
    category: z.enum(CATEGORIES),
    confidence: z.number().min(0).max(1),
    detected_intents: z.array(z.enum(TAXONOMY)),
    injection_detected: z.boolean(),
    proposed_action: ProposedActionSchema,
    rationale: z.string(),
  })
  .strict();
export type Classification = z.infer<typeof ClassificationSchema>;

// --- Gemini native response schema (kept in sync with ClassificationSchema) -

/**
 * The schema Gemini constrains generation to. Mirrors ClassificationSchema.
 * `detected_intents` items are restricted to the taxonomy; `category` adds
 * `unclear`. `propertyOrdering` keeps the JSON deterministic.
 */
export const classificationResponseSchema = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING, enum: [...CATEGORIES] },
    confidence: { type: Type.NUMBER },
    detected_intents: {
      type: Type.ARRAY,
      items: { type: Type.STRING, enum: [...TAXONOMY] },
    },
    injection_detected: { type: Type.BOOLEAN },
    proposed_action: {
      type: Type.OBJECT,
      properties: {
        type: {
          type: Type.STRING,
          enum: ["send_reply", "apply_tags", "route_queue", "none"],
        },
        params: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            queue: { type: Type.STRING },
            note: { type: Type.STRING },
          },
        },
      },
      required: ["type"],
      propertyOrdering: ["type", "params"],
    },
    rationale: { type: Type.STRING },
  },
  required: [
    "category",
    "confidence",
    "detected_intents",
    "injection_detected",
    "proposed_action",
    "rationale",
  ],
  propertyOrdering: [
    "category",
    "confidence",
    "detected_intents",
    "injection_detected",
    "proposed_action",
    "rationale",
  ],
};

// --- Final decision: the SPEC.md "Agent output contract" -------------------

export interface ProposedActionOut {
  type: ActionType;
  params: Record<string, unknown>;
}

export interface Decision {
  ticket_id: string;
  category: string;
  confidence: number;
  risk_tier: RiskTier;
  decision: DecisionVerdict;
  proposed_action: ProposedActionOut;
  rationale: string;
  context_used: string[];
}
