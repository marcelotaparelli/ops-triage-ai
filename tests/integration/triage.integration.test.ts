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

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
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
    } finally {
      await stopBunServer(server);
    }
  });
});
