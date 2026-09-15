import { describe, expect, it } from "vitest";
import type { TriageService } from "../../src/application/ports/triage-service.ts";
import { handleRequest } from "../../src/server.ts";
import { Metrics } from "../../src/observability.ts";
import { Category, Priority, Risk, SuggestedTeam } from "../../src/domain/triage.ts";
import { DecisionSource } from "../../src/domain/triage-decision.ts";

const id = "00000000-0000-4000-8000-000000000001";
const service: TriageService = {
  execute: async () => ({
    decisionId: id,
    decision: {
      category: Category.SUPPORT,
      priority: Priority.LOW,
      risk: Risk.LOW,
      suggestedTeam: SuggestedTeam.SUPPORT,
      confidence: 0.9,
      summary: "safe",
      rationale: "safe",
      decisionSource: DecisionSource.DETERMINISTIC,
      requiresHumanReview: false,
      reviewReasons: [],
    },
  }),
  getDecisionAudit: async () => null,
  addFeedback: async () => { throw new Error("unused"); },
};

function deps() { return { checkDb: async () => true, triageService: service, apiKey: "test-secret", metrics: new Metrics() }; }
function triage(headers: Record<string, string> = {}, body = { title: "Help", description: "Need help" }) {
  return new Request("http://x/tickets/triage", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("Phase 6 HTTP boundaries", () => {
  it("protects business routes while leaving probes public", async () => {
    expect((await handleRequest(triage(), deps())).status).toBe(401);
    expect((await handleRequest(triage({ "x-api-key": "wrong" }), deps())).status).toBe(401);
    expect((await handleRequest(triage({ "x-api-key": "test-secret", "x-request-id": "client-42" }), deps())).status).toBe(201);
    const health = await handleRequest(new Request("http://x/health"), deps());
    expect(health.status).toBe(200);
    expect(health.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects an oversized body before invoking the service", async () => {
    const limited = { ...deps(), bodyLimitBytes: 10 };
    const response = await handleRequest(triage({ "x-api-key": "test-secret" }, { title: "too large", description: "too large" }), limited);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request_body_too_large" });
  });

  it("exposes protected metrics without sensitive request content", async () => {
    const dependencies = deps();
    await handleRequest(triage({ "x-api-key": "test-secret" }), dependencies);
    const response = await handleRequest(new Request("http://x/metrics", { headers: { "x-api-key": "test-secret" } }), dependencies);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("requests_total");
    expect(await handleRequest(new Request("http://x/metrics"), dependencies)).toHaveProperty("status", 401);
  });
});
