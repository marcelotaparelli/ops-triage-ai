import { describe, expect, it } from "vitest";
import type { TriageService } from "../../src/application/ports/triage-service.ts";
import { DeterministicTriageClassifier } from "../../src/application/classifiers/deterministic-triage-classifier.ts";
import { Category, Priority, Risk, SuggestedTeam } from "../../src/domain/triage.ts";
import { DecisionSource } from "../../src/domain/triage-decision.ts";
import { buildServerOptions, buildTriageTicket, toTriageMode } from "../../src/bootstrap.ts";
import { isApiKeyAuthorized, isUuid, jsonResponse, readJsonBody } from "../../src/http/http-protocol.ts";
import { ConcurrencyLimiter, withRequestTimeout } from "../../src/server/request-limits.ts";
import { handleRequest, startServer, stopServer } from "../../src/server.ts";
import { Metrics } from "../../src/observability.ts";

const DECISION_ID = "00000000-0000-4000-8000-000000000001";

function baseService(overrides: Partial<TriageService> = {}): TriageService {
  return {
    execute: async () => ({
      decisionId: DECISION_ID,
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
    addFeedback: async () => {
      throw new Error("unused");
    },
    ...overrides,
  };
}

function deps(overrides = {}) {
  return {
    checkDb: async () => true,
    triageService: baseService(),
    apiKey: "test-secret",
    metrics: new Metrics(),
    ...overrides,
  };
}

describe("HTTP equivalence after refactor", () => {
  it("keeps route/method/status/JSON contracts", async () => {
    // Unknown route
    const notFound = await handleRequest(new Request("http://x/nope"), deps());
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ status: "not_found" });

    // Wrong method on a business path still requires auth first
    const unauthenticatedGet = await handleRequest(new Request("http://x/tickets/triage"), deps());
    expect(unauthenticatedGet.status).toBe(401);
    expect(await unauthenticatedGet.json()).toEqual({ error: "unauthorized" });

    // Invalid UUID
    const badId = await handleRequest(
      new Request("http://x/triage/not-a-uuid", { headers: { "x-api-key": "test-secret" } }),
      deps(),
    );
    expect(badId.status).toBe(400);
    expect(await badId.json()).toEqual({ error: "invalid_triage_id" });

    // Missing audit
    const missing = await handleRequest(
      new Request(`http://x/triage/${DECISION_ID}`, { headers: { "x-api-key": "test-secret" } }),
      deps(),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "triage_not_found" });

    // Readiness stays public and healthy
    const ready = await handleRequest(new Request("http://x/ready"), deps());
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
  });

  it("propagates a valid X-Request-Id and regenerates an invalid one", async () => {
    const echoed = await handleRequest(
      new Request("http://x/health", { headers: { "x-request-id": "client-42" } }),
      deps(),
    );
    expect(echoed.headers.get("x-request-id")).toBe("client-42");

    const regenerated = await handleRequest(
      new Request("http://x/health", { headers: { "x-request-id": "has spaces!!" } }),
      deps(),
    );
    const regeneratedId = regenerated.headers.get("x-request-id") ?? "";
    expect(regeneratedId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(regeneratedId).not.toBe("has spaces!!");
  });

  it("always sets the JSON content type and security headers", async () => {
    const res = await handleRequest(
      new Request("http://x/tickets/triage", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "test-secret" },
        body: JSON.stringify({ title: "Help", description: "Need help" }),
      }),
      deps(),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("location")).toBe(`/triage/${DECISION_ID}`);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("enforces body limits, media type and timeouts", async () => {
    const oversized = await handleRequest(
      new Request("http://x/tickets/triage", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "test-secret" },
        body: JSON.stringify({ title: "too large", description: "too large" }),
      }),
      { ...deps(), bodyLimitBytes: 10 },
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "request_body_too_large" });

    const hanging = await handleRequest(
      new Request("http://x/tickets/triage", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "test-secret" },
        body: JSON.stringify({ title: "Help", description: "Need help" }),
      }),
      {
        ...deps(),
        triageService: baseService({
          execute: () => new Promise<never>(() => {}),
        }),
        requestTimeoutMs: 20,
      },
    );
    expect(hanging.status).toBe(504);
    expect(await hanging.json()).toEqual({ error: "request_timeout" });
  });

  it("returns 429 with retry-after when the concurrency budget is exhausted", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedService = baseService({
      execute: async () => {
        await gate;
        return {
          decisionId: DECISION_ID,
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
        };
      },
    });
    const gatedDeps = { ...deps(), triageService: gatedService, maxConcurrentTriages: 1 };
    const body = () =>
      new Request("http://x/tickets/triage", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "test-secret" },
        body: JSON.stringify({ title: "Help", description: "Need help" }),
      });

    const first = handleRequest(body(), gatedDeps);
    const second = await handleRequest(body(), gatedDeps);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("1");
    expect(await second.json()).toEqual({ error: "too_many_requests" });
    release();
    expect((await first).status).toBe(201);
  });

  it("stopServer drains, stops and closes persistence in order", async () => {
    const calls: string[] = [];
    await stopServer({
      beginShutdown: () => {
        calls.push("beginShutdown");
      },
      stop: () => {
        calls.push("stop");
      },
      waitForIdle: async () => {
        calls.push("waitForIdle");
      },
    });
    expect(calls).toEqual(["beginShutdown", "stop", "waitForIdle"]);
  });

  it("draining server returns 503 with retry-after on a live port", async () => {
    const server = startServer(0, "postgresql://localhost:5432/unused", baseService(), {
      metrics: new Metrics(),
    });
    try {
      const port = (server as unknown as { port: number }).port;
      server.beginShutdown();
      const res = await fetch(`http://localhost:${port}/health`, {
        headers: { "x-request-id": "drain-check" },
      });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("1");
      expect(res.headers.get("x-request-id")).toBe("drain-check");
      expect(await res.json()).toEqual({ error: "server_shutting_down" });
    } finally {
      server.stop();
    }
  });
});

describe("extracted transversal modules preserve semantics", () => {
  it("jsonResponse always carries content-type and request id", async () => {
    const res = jsonResponse(200, { ok: true }, "req-1", { "retry-after": "1" });
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-request-id")).toBe("req-1");
    expect(res.headers.get("retry-after")).toBe("1");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("readJsonBody enforces declared and actual limits", async () => {
    const declared = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "9999" },
      body: "{}",
    });
    expect(await readJsonBody(declared, 10)).toEqual({
      success: false,
      status: 413,
      error: "request_body_too_large",
    });

    const malformed = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(await readJsonBody(malformed, 1024)).toEqual({
      success: false,
      status: 400,
      error: "invalid_json",
    });
  });

  it("api-key check allows missing config and rejects mismatches", () => {
    const req = (key?: string) =>
      new Request("http://x/", { headers: key ? { "x-api-key": key } : {} });
    expect(isApiKeyAuthorized(req(), undefined)).toBe(true);
    expect(isApiKeyAuthorized(req("test-secret"), "test-secret")).toBe(true);
    expect(isApiKeyAuthorized(req(), "test-secret")).toBe(false);
    expect(isApiKeyAuthorized(req("wrong"), "test-secret")).toBe(false);
    expect(isUuid(DECISION_ID)).toBe(true);
    expect(isUuid("nope")).toBe(false);
  });

  it("concurrency limiter and timeout keep their contracts", async () => {
    const limiter = new ConcurrencyLimiter(1);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    limiter.release();
    expect(limiter.tryAcquire()).toBe(true);

    await expect(withRequestTimeout(Promise.resolve(1), 100)).resolves.toBe(1);
    await expect(withRequestTimeout(new Promise<never>(() => {}), 10)).rejects.toThrow(
      "request_timeout",
    );
  });

  it("bootstrap builds one explicit ticket per mode", () => {
    expect(toTriageMode("deterministic")).toBe("DETERMINISTIC");
    expect(toTriageMode("hybrid")).toBe("HYBRID");
    const ticket = buildTriageTicket(
      { TRIAGE_CLASSIFIER: "deterministic" } as never,
      new DeterministicTriageClassifier(),
    );
    expect(ticket).toBeDefined();

    const withKey = buildServerOptions(
      { TRIAGE_API_KEY: "k", HTTP_BODY_LIMIT_BYTES: 1, TRIAGE_MAX_CONCURRENCY: 1, REQUEST_TIMEOUT_MS: 1 } as never,
      new Metrics(),
      { log: () => {} },
    );
    expect(withKey.apiKey).toBe("k");
    const withoutKey = buildServerOptions(
      { TRIAGE_API_KEY: undefined, HTTP_BODY_LIMIT_BYTES: 1, TRIAGE_MAX_CONCURRENCY: 1, REQUEST_TIMEOUT_MS: 1 } as never,
      new Metrics(),
      { log: () => {} },
    );
    expect("apiKey" in withoutKey).toBe(false);
  });
});
