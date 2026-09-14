import { describe, expect, it } from "vitest";
import { DeterministicTriageClassifier } from "../../src/application/classifiers/deterministic-triage-classifier.ts";
import { TriageTicket } from "../../src/application/triage-ticket.ts";
import type { TriageService } from "../../src/application/ports/triage-service.ts";
import { handleRequest } from "../../src/server.ts";

const triageTicket = new TriageTicket({
  mode: "deterministic",
  classifier: new DeterministicTriageClassifier(),
});
const triageService: TriageService = {
  execute: async (input) => ({ decisionId: crypto.randomUUID(), decision: await triageTicket.execute(input) }),
  getDecisionAudit: async () => null,
  addFeedback: async () => {
    throw new Error("not used in health tests");
  },
};
const dependencies = (checkDb: () => Promise<boolean>) => ({ checkDb, triageService });

describe("GET /health", () => {
  it("returns 200 healthy when DB is up", async () => {
    const res = await handleRequest(
      new Request("http://x/health"),
      dependencies(async () => true),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "healthy", db: "up" });
  });

  it("returns 503 unhealthy when DB is down", async () => {
    const res = await handleRequest(
      new Request("http://x/health"),
      dependencies(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "unhealthy", db: "down" });
  });

  it("never leaks internals on DB failure", async () => {
    const secretErr = new Error("connect postgresql://ops:secret@localhost/db ECONNREFUSED stack...");
    const res = await handleRequest(
      new Request("http://x/health"),
      dependencies(async () => {
        throw secretErr;
      }),
    );
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("DATABASE_URL");
    expect(text).not.toContain("stack");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await handleRequest(
      new Request("http://x/unknown"),
      dependencies(async () => true),
    );
    expect(res.status).toBe(404);
  });
});
