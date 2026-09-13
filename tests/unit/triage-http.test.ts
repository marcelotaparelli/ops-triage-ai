import { describe, expect, it } from "vitest";
import { DeterministicTriageClassifier } from "../../src/application/classifiers/deterministic-triage-classifier.ts";
import {
  ClassifierInvalidResponseError,
  ClassifierTimeoutError,
  ClassifierUnavailableError,
} from "../../src/application/errors/classifier-errors.ts";
import type { TriageClassifier } from "../../src/application/ports/triage-classifier.ts";
import { TriageTicket } from "../../src/application/triage-ticket.ts";
import { handleRequest, type ServerDependencies } from "../../src/server.ts";

function dependencies(classifier: TriageClassifier = new DeterministicTriageClassifier()) {
  return {
    checkDb: async () => true,
    triageTicket: new TriageTicket({ mode: "deterministic", classifier }),
  } satisfies ServerDependencies;
}

function request(body: string, contentType = "application/json") {
  return new Request("http://x/tickets/triage", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("POST /tickets/triage", () => {
  it("returns a deterministic TriageDecision for a valid payload", async () => {
    const res = await handleRequest(
      request(
        JSON.stringify({
          title: "Feature request: export CSV",
          description: "Show a useful error when export is unavailable",
        }),
        "application/json; charset=utf-8",
      ),
      dependencies(),
    );

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
  });

  it("returns a complete hybrid TriageDecision", async () => {
    const deterministic = new DeterministicTriageClassifier();
    const llm: TriageClassifier = {
      classify: async (input) => deterministic.classify(input),
    };
    const hybridDependencies = {
      checkDb: async () => true,
      triageTicket: new TriageTicket({
        mode: "hybrid",
        deterministicClassifier: deterministic,
        llmClassifier: llm,
      }),
    } satisfies ServerDependencies;

    const res = await handleRequest(
      request(JSON.stringify({ title: "Need help", description: "How do I export?" })),
      hybridDependencies,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      category: "SUPPORT",
      priority: "LOW",
      risk: "LOW",
      suggestedTeam: "SUPPORT",
      confidence: 0.9,
      requiresHumanReview: false,
      decisionSource: "HYBRID",
      reviewReasons: [],
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await handleRequest(request("{"), dependencies());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("returns 415 for an unsupported media type", async () => {
    const res = await handleRequest(request("title=x", "text/plain"), dependencies());
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_media_type" });
  });

  it.each([
    [{ description: "Missing title" }, "title"],
    [{ title: "Blank description", description: "   " }, "description"],
    [{ title: "x".repeat(201), description: "Too long" }, "title"],
    [{ title: "Valid", description: "Valid", extra: true }, "body"],
  ])("returns 422 for an invalid payload", async (payload, field) => {
    const res = await handleRequest(request(JSON.stringify(payload)), dependencies());
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      issues: Array<{ field: string; code: string }>;
    };
    expect(body.error).toBe("invalid_request");
    expect(body.issues.some((issue) => issue.field === field)).toBe(true);
  });

  it("does not leak classifier failures", async () => {
    const classifier: TriageClassifier = {
      classify: async () => {
        throw new Error("secret internal classifier state");
      },
    };
    const res = await handleRequest(
      request(JSON.stringify({ title: "Need help", description: "A question" })),
      dependencies(classifier),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"internal_error"}');
  });

  it.each([
    [new ClassifierTimeoutError(), 504, "classifier_timeout"],
    [new ClassifierUnavailableError(), 503, "classifier_unavailable"],
    [new ClassifierInvalidResponseError(), 502, "classifier_invalid_response"],
  ])("maps classifier errors without leaking details", async (error, status, code) => {
    const classifier: TriageClassifier = {
      classify: async () => {
        throw error;
      },
    };
    const res = await handleRequest(
      request(JSON.stringify({ title: "Need help", description: "A question" })),
      dependencies(classifier),
    );
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
  });
});
