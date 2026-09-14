import { describe, expect, it } from "vitest";
import type { TriageService } from "../../src/application/ports/triage-service.ts";
import type { FeedbackRecord, TriageAuditRecord } from "../../src/application/ports/triage-persistence.ts";
import { handleRequest } from "../../src/server.ts";
import { Category, Priority, Risk, SuggestedTeam } from "../../src/domain/triage.ts";
import { DecisionSource } from "../../src/domain/triage-decision.ts";

const decisionId = "00000000-0000-4000-8000-000000000001";
const audit: TriageAuditRecord = {
  ticket: {
    id: "00000000-0000-4000-8000-000000000002",
    title: "Need help",
    description: "How do I export?",
    createdAt: new Date("2026-09-14T10:00:00.000Z"),
  },
  run: {
    id: "00000000-0000-4000-8000-000000000003",
    ticketId: "00000000-0000-4000-8000-000000000002",
    mode: "DETERMINISTIC",
    status: "SUCCEEDED",
    failureCode: null,
    startedAt: new Date("2026-09-14T10:00:01.000Z"),
    completedAt: new Date("2026-09-14T10:00:02.000Z"),
  },
  decision: {
    id: decisionId,
    triageRunId: "00000000-0000-4000-8000-000000000003",
    category: Category.SUPPORT,
    priority: Priority.LOW,
    risk: Risk.LOW,
    suggestedTeam: SuggestedTeam.SUPPORT,
    confidence: 0.9,
    summary: "Need help",
    rationale: "Support request",
    decisionSource: DecisionSource.DETERMINISTIC,
    requiresHumanReview: false,
    reviewReasons: [],
    createdAt: new Date("2026-09-14T10:00:02.000Z"),
  },
  feedback: [],
};

function service(overrides: Partial<TriageService> = {}): TriageService {
  return {
    execute: async () => ({ decisionId, decision: audit.decision }),
    getDecisionAudit: async () => audit,
    addFeedback: async (_id, input) => {
      const feedback: FeedbackRecord = {
        id: "00000000-0000-4000-8000-000000000004",
        decisionId,
        reviewedBy: input.reviewedBy,
        correctedCategory: input.correctedCategory,
        correctedPriority: input.correctedPriority,
        correctedRisk: input.correctedRisk,
        correctedSuggestedTeam: SuggestedTeam.DEVELOPMENT,
        comment: input.comment ?? null,
        createdAt: new Date("2026-09-14T10:00:03.000Z"),
      };
      return feedback;
    },
    ...overrides,
  };
}

describe("triage audit HTTP endpoints", () => {
  it("returns a persisted audit record by decision id", async () => {
    const res = await handleRequest(
      new Request(`http://x/triage/${decisionId}`),
      { checkDb: async () => true, triageService: service() },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ticket: { id: audit.ticket.id },
      run: { id: audit.run.id, status: "SUCCEEDED" },
      decision: { id: decisionId, decisionSource: "DETERMINISTIC" },
      feedback: [],
    });
  });

  it("validates feedback and returns the append-only record", async () => {
    const res = await handleRequest(
      new Request(`http://x/triage/${decisionId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewedBy: "declared-reviewer",
          correction: { category: "BUG", priority: "HIGH", risk: "HIGH" },
          comment: "Manual correction",
        }),
      }),
      { checkDb: async () => true, triageService: service() },
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      decisionId,
      reviewedBy: "declared-reviewer",
      correctedCategory: "BUG",
      correctedPriority: "HIGH",
      correctedRisk: "HIGH",
      correctedSuggestedTeam: "DEVELOPMENT",
    });
  });

  it("rejects invalid feedback and unknown decisions", async () => {
    const invalid = await handleRequest(
      new Request(`http://x/triage/${decisionId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewedBy: "reviewer",
          correction: {
            category: "BUG",
            priority: "HIGH",
            risk: "HIGH",
            suggestedTeam: "INFRASTRUCTURE",
          },
        }),
      }),
      { checkDb: async () => true, triageService: service() },
    );
    expect(invalid.status).toBe(422);

    const missing = await handleRequest(
      new Request(`http://x/triage/00000000-0000-4000-8000-000000000099`),
      {
        checkDb: async () => true,
        triageService: service({ getDecisionAudit: async () => null }),
      },
    );
    expect(missing.status).toBe(404);
  });
});
