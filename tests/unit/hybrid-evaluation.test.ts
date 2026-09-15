import { describe, expect, it } from "vitest";
import type { TriageClassifier } from "../../src/application/ports/triage-classifier.ts";
import { Category, Priority, Risk, SuggestedTeam, type ClassifierResult } from "../../src/domain/triage.ts";
import { calculateHumanReviewMetrics, evaluateHybrid } from "../../src/evaluation/hybrid-evaluation.ts";
import { parseHumanReviewDataset } from "../../src/evaluation/human-review-dataset.ts";
import { validateAuditTrail } from "../../src/evaluation/audit-validation.ts";
import type { TriageAuditRecord } from "../../src/application/ports/triage-persistence.ts";
import { DecisionSource } from "../../src/domain/triage-decision.ts";

function result(category: Category, priority = Priority.LOW, risk = Risk.LOW): ClassifierResult {
  return { category, priority, risk, suggestedTeam: SuggestedTeam.HUMAN_REVIEW, confidence: 0.9, summary: "synthetic", rationale: "synthetic" };
}
function classifier(value: ClassifierResult): TriageClassifier { return { classify: async () => value }; }

describe("independent Phase 7 evaluation", () => {
  it("reports hybrid quality, disagreement, review, fallback and latency metrics", async () => {
    const examples = [{ id: "one", input: { title: "One", description: "One" }, expected: { category: Category.BUG, priority: Priority.LOW, risk: Risk.LOW }, tags: ["test"] }];
    const evaluated = await evaluateHybrid(classifier(result(Category.BUG)), classifier(result(Category.SUPPORT)), examples);
    expect(evaluated.metrics).toMatchObject({ examples: 1, exactTupleAccuracy: 0, disagreementRate: 1, reviewRate: 1, fallbackRate: 0 });
    expect(evaluated.metrics.reviewReasons.CLASSIFIER_DISAGREEMENT).toBe(1);
  });

  it("calculates review precision and recall only from explicit independent labels", () => {
    const examples = parseHumanReviewDataset(JSON.stringify({ id: "x", input: { title: "x", description: "x" }, expected: { category: "BUG", priority: "LOW", risk: "LOW" }, shouldRequireHumanReview: true, reviewJustification: "uncertain impact", tags: ["ambiguous"] }));
    expect(calculateHumanReviewMetrics(examples, [{ id: "x", decision: { ...result(Category.BUG), requiresHumanReview: true, decisionSource: DecisionSource.HYBRID, reviewReasons: [] } }])).toMatchObject({ precision: 1, recall: 1 });
    expect(() => calculateHumanReviewMetrics(examples, [])).toThrow(/must match exactly/);
  });

  it("checks that audit snapshots preserve decisions and append-only feedback", () => {
    const base = { id: "d", triageRunId: "r", category: Category.BUG, priority: Priority.LOW, risk: Risk.LOW, suggestedTeam: SuggestedTeam.DEVELOPMENT, confidence: 0.9 as const, summary: "s", rationale: "r", decisionSource: DecisionSource.DETERMINISTIC, requiresHumanReview: false, reviewReasons: [], createdAt: new Date() };
    const audit = { ticket: { id: "t", title: "t", description: "d", createdAt: new Date() }, run: { id: "r", ticketId: "t", mode: "DETERMINISTIC" as const, status: "SUCCEEDED" as const, failureCode: null, startedAt: new Date(), completedAt: new Date() }, decision: base, feedback: [] } satisfies TriageAuditRecord;
    expect(validateAuditTrail(audit, audit)).toEqual({ valid: true, errors: [] });
    expect(validateAuditTrail(audit, { ...audit, decision: { ...base, category: Category.ACCESS } })).toMatchObject({ valid: false });
  });
});
