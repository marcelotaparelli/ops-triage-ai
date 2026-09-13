import { describe, expect, it } from "vitest";
import { HybridPolicy, type LlmFailureReason } from "../../src/application/policies/hybrid-policy.ts";
import {
  DecisionSource,
  HumanReviewReason,
} from "../../src/domain/triage-decision.ts";
import {
  Category,
  Priority,
  Risk,
  SuggestedTeam,
  type ClassifierResult,
} from "../../src/domain/triage.ts";

const policy = new HybridPolicy();

function result(overrides: Partial<ClassifierResult> = {}): ClassifierResult {
  return {
    category: Category.SUPPORT,
    priority: Priority.LOW,
    risk: Risk.LOW,
    suggestedTeam: SuggestedTeam.SUPPORT,
    confidence: 0.7,
    summary: "Need usage guidance",
    rationale: "Support request",
    ...overrides,
  };
}

describe("HybridPolicy", () => {
  it("auto-accepts low-severity agreement with confidence at least 0.7", () => {
    const llm = result({ confidence: 0.9 });
    expect(
      policy.decide({
        deterministic: result(),
        llm: { status: "available", result: llm },
      }),
    ).toEqual({
      ...llm,
      requiresHumanReview: false,
      decisionSource: DecisionSource.HYBRID,
      reviewReasons: [],
    });
  });

  it.each([
    ["category", { category: Category.BUG }],
    ["priority", { priority: Priority.MEDIUM }],
    ["risk", { risk: Risk.MEDIUM }],
  ])("requires review for %s disagreement", (_dimension, overrides) => {
    const llm = result(overrides);
    const decision = policy.decide({
      deterministic: result(),
      llm: { status: "available", result: llm },
    });
    expect(decision.reviewReasons).toContain(HumanReviewReason.CLASSIFIER_DISAGREEMENT);
    expect(decision).toMatchObject(llm);
  });

  it.each(["deterministic", "llm"])("requires review for %s confidence 0.5", (source) => {
    const deterministic = result({ confidence: source === "deterministic" ? 0.5 : 0.7 });
    const llm = result({ confidence: source === "llm" ? 0.5 : 0.7 });
    expect(
      policy.decide({ deterministic, llm: { status: "available", result: llm } })
        .reviewReasons,
    ).toContain(HumanReviewReason.LOW_CONFIDENCE);
  });

  it.each([
    ["HIGH priority", { priority: Priority.HIGH }],
    ["CRITICAL priority", { priority: Priority.CRITICAL }],
    ["HIGH risk", { risk: Risk.HIGH }],
  ])("requires review for %s in either result", (_signal, overrides) => {
    const severeDeterministic = policy.decide({
      deterministic: result(overrides),
      llm: { status: "available", result: result() },
    });
    const severeLlm = policy.decide({
      deterministic: result(),
      llm: { status: "available", result: result(overrides) },
    });
    expect(severeDeterministic.reviewReasons).toContain(HumanReviewReason.HIGH_SEVERITY);
    expect(severeLlm.reviewReasons).toContain(HumanReviewReason.HIGH_SEVERITY);
  });

  it("returns unique review reasons in stable order", () => {
    const decision = policy.decide({
      deterministic: result({ confidence: 0.5, priority: Priority.HIGH }),
      llm: { status: "available", result: result({ category: Category.BUG }) },
    });
    expect(decision.reviewReasons).toEqual([
      HumanReviewReason.CLASSIFIER_DISAGREEMENT,
      HumanReviewReason.LOW_CONFIDENCE,
      HumanReviewReason.HIGH_SEVERITY,
    ]);
  });

  it.each<LlmFailureReason>(["TIMEOUT", "UNAVAILABLE", "INVALID_RESPONSE"])(
    "uses the deterministic fallback for %s",
    (reason) => {
      const deterministic = result();
      expect(
        policy.decide({ deterministic, llm: { status: "failed", reason } }),
      ).toEqual({
        ...deterministic,
        requiresHumanReview: true,
        decisionSource: DecisionSource.DETERMINISTIC_FALLBACK,
        reviewReasons: [HumanReviewReason.LLM_UNAVAILABLE],
      });
    },
  );

  it.each([
    DecisionSource.DETERMINISTIC,
    DecisionSource.LLM,
  ] as const)("creates a decision for the %s single mode", (source) => {
    expect(policy.decideSingle(result(), source)).toMatchObject({
      requiresHumanReview: false,
      decisionSource: source,
      reviewReasons: [],
    });
  });
});
