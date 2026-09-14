import { describe, expect, it } from "vitest";
import { startBunServer, stopBunServer } from "./bun-server.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const PORT = Number(process.env["TRIAGE_TEST_PORT"] ?? "3460");

describe("POST /tickets/triage through a real Bun server", () => {
  it("returns the deterministic TriageDecision", async () => {
    if (!DATABASE_URL) throw new Error("DATABASE_URL is required for integration tests");
    const server = await startBunServer(PORT, DATABASE_URL);
    try {
      const res = await fetch("http://localhost:" + PORT + "/tickets/triage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Feature request: export CSV",
          description: "Show a useful error when export is unavailable",
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        category: string;
        priority: string;
        risk: string;
        suggestedTeam: string;
        confidence: number;
        summary: string;
        rationale: string;
        requiresHumanReview: boolean;
        decisionSource: string;
        reviewReasons: string[];
      };
      expect(body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(body).toMatchObject({
        category: "FEATURE_REQUEST",
        priority: "LOW",
        risk: "LOW",
        suggestedTeam: "PRODUCT",
        confidence: 0.9,
        summary: "Feature request: export CSV",
        rationale:
          "FEATURE_REQUEST_HIGH_SIGNAL: feature_request | PRIORITY_LOW_DEFAULT | RISK_LOW_DEFAULT",
        requiresHumanReview: false,
        decisionSource: "DETERMINISTIC",
        reviewReasons: [],
      });

      const auditResponse = await fetch(`http://localhost:${PORT}/triage/${body.id}`);
      expect(auditResponse.status).toBe(200);
      const audit = (await auditResponse.json()) as {
        ticket: { title: string; description: string; createdAt: string };
        run: {
          status: string;
          startedAt: string;
          completedAt: string;
        };
        decision: { id: string; createdAt: string };
        feedback: unknown[];
      };
      expect(audit.ticket).toMatchObject({
        title: "Feature request: export CSV",
        description: "Show a useful error when export is unavailable",
      });
      expect(audit.run.status).toBe("SUCCEEDED");
      expect(audit.decision.id).toBe(body.id);
      expect(new Date(audit.run.startedAt).getTime()).toBeLessThanOrEqual(
        new Date(audit.run.completedAt).getTime(),
      );
      expect(new Date(audit.run.startedAt).getTime()).toBeLessThanOrEqual(
        new Date(audit.decision.createdAt).getTime(),
      );
      expect(audit.feedback).toEqual([]);

      const feedbackResponse = await fetch(
        `http://localhost:${PORT}/triage/${body.id}/feedback`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reviewedBy: "declared-reviewer",
            correction: { category: "BUG", priority: "HIGH", risk: "HIGH" },
            comment: "Manual correction",
          }),
        },
      );
      expect(feedbackResponse.status).toBe(201);
      expect(await feedbackResponse.json()).toMatchObject({
        decisionId: body.id,
        reviewedBy: "declared-reviewer",
        correctedCategory: "BUG",
        correctedPriority: "HIGH",
        correctedRisk: "HIGH",
        correctedSuggestedTeam: "DEVELOPMENT",
      });

      const auditedAgain = await fetch(`http://localhost:${PORT}/triage/${body.id}`);
      const auditWithFeedback = (await auditedAgain.json()) as {
        feedback: Array<{ createdAt: string; correctedSuggestedTeam: string }>;
      };
      expect(auditWithFeedback.feedback).toHaveLength(1);
      expect(auditWithFeedback.feedback[0]?.correctedSuggestedTeam).toBe("DEVELOPMENT");
      expect(new Date(auditWithFeedback.feedback[0]?.createdAt ?? 0).getTime()).toBeGreaterThanOrEqual(
        new Date(audit.decision.createdAt).getTime(),
      );
    } finally {
      await stopBunServer(server);
    }
  });
});
