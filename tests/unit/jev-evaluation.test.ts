import { describe, expect, it, vi } from "vitest";
import { Category, Priority, Risk } from "../../src/domain/triage.ts";
import { JevEvaluationAdapter, JevResponseSchema } from "../../src/evaluation/jev/adapter.ts";
import { JEV_CONFIG, JEV_QUESTIONS } from "../../src/evaluation/jev/questions.ts";
import { analyzeJev, type JevRow } from "../../src/evaluation/jev/analysis.ts";
import { reserveJevRun } from "../../src/evaluation/jev/cost-guard.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateTriage } from "../../src/evaluation/evaluate-triage.ts";
import { suggestedTeamForCategory } from "../../src/domain/suggested-team.ts";

const secret = "mock-credential-do-not-expose";
const input = { title: "Guidance", description: "How do I use the dashboard?" };
function decision<T extends string>(labels: T[], choice: T) {
  return { type: "choice" as const, choice, confidence: 0.73,
    probabilities: Object.fromEntries(labels.map(l => [l, l === choice ? 0.8 : 0.2 / (labels.length - 1)])) };
}
function payload() {
  return { id: "test-response", model: "typesafe/jev-1.13-20260917", provider: "TypeSafe",
    answers: { category: decision(Object.values(Category), Category.SUPPORT),
      priority: decision(Object.values(Priority), Priority.LOW), risk: decision(Object.values(Risk), Risk.LOW) },
    usage: { input_tokens: 100, output_tokens: 10, cost: 0.0000042 } };
}
function mocked(body: unknown = payload(), status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("Jev experimental boundary", () => {
  it("posts pinned model, only ticket state and all three choice questions with native fetch", async () => {
    const http = mocked();
    const result = await new JevEvaluationAdapter(secret, http).decide(input);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({ Authorization: `Bearer ${secret}`, "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ model: "typesafe/jev-1.13", state: input, questions: JEV_QUESTIONS });
    expect(result).toEqual(payload());
    expect(result.answers.category.confidence).toBe(0.73);
    expect(result.answers.category.probabilities.SUPPORT).toBe(0.8);
    expect(Object.keys(JEV_QUESTIONS.category.criteria)).toEqual(Object.values(Category));
    expect(Object.keys(JEV_QUESTIONS.priority.criteria)).toEqual(Object.values(Priority));
    expect(Object.keys(JEV_QUESTIONS.risk.criteria)).toEqual(Object.values(Risk));
    expect(http).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JEV_CONFIG.retries).toBe(0);
  });

  it.each([401, 403, 429, 500, 502, 503, 524, 402, 400])("sanitizes HTTP %i without retry", async status => {
    const http = mocked({ error: { message: secret } }, status);
    const promise = new JevEvaluationAdapter(secret, http).decide(input);
    await expect(promise).rejects.toMatchObject({ code: status === 401 || status === 403 ? "AUTH" :
      status === 429 ? "RATE_LIMIT" : status >= 500 ? "UNAVAILABLE" : "HTTP_ERROR", status });
    await expect(promise).rejects.not.toThrow(secret);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("sanitizes network failures and keeps credential private on serialization", async () => {
    const http = vi.fn<typeof fetch>().mockRejectedValue(new Error(secret));
    const adapter = new JevEvaluationAdapter(secret, http);
    expect(JSON.stringify(adapter)).not.toContain(secret);
    await expect(adapter.decide(input)).rejects.toMatchObject({ code: "NETWORK", message: "Jev evaluation failed: NETWORK" });
  });
  it("times out even when fetch does not cooperate with abort", async () => {
    const http = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    await expect(new JevEvaluationAdapter(secret, http, 5).decide(input)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(http.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
  it("times out while reading a stalled body", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    await expect(new JevEvaluationAdapter(secret, http, 5).decide(input)).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it("rejects malformed JSON without exposing response content", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response(secret));
    await expect(new JevEvaluationAdapter(secret, http).decide(input)).rejects.toMatchObject({ code: "MALFORMED_JSON" });
  });
  it.each([
    ["answers", undefined], ["answers.risk", undefined],
    ["answers.category.choice", "INVALID"], ["answers.priority.confidence", undefined],
    ["answers.risk.confidence", 1.1], ["answers.category.probabilities", undefined],
    ["answers.category.probabilities.BUG", undefined], ["answers.risk.probabilities.OTHER", 0],
    ["answers.risk.probabilities.LOW", -0.1], ["answers.risk.probabilities.LOW", "0.8"],
    ["answers.risk.probabilities.LOW", 0.4], ["answers.risk.choice", "HIGH"],
    ["model", "typesafe/jev-latest"],
  ])("rejects malformed %s = %s", async (path, value) => {
    const body = payload();
    const parts = String(path).split(".");
    let object = body as unknown as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) object = object[part] as Record<string, unknown>;
    if (value === undefined) delete object[parts.at(-1)!];
    else object[parts.at(-1)!] = value;
    await expect(new JevEvaluationAdapter(secret, mocked(body)).decide(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("preserves absence of usage instead of inventing cost", async () => {
    const body: Record<string, unknown> = payload();
    delete body["usage"];
    expect((await new JevEvaluationAdapter(secret, mocked(body)).decide(input)).usage).toBeUndefined();
  });
  it("retains validated billing metadata on invalid decisions", async () => {
    const body = { ...payload(), answers: {} };
    await expect(new JevEvaluationAdapter(secret, mocked(body)).decide(input)).rejects.toMatchObject({
      code: "INVALID_RESPONSE", usage: body.usage,
    });
  });
});

describe("Jev analysis", () => {
  const result = JevResponseSchema.parse(payload());
  const expected = { category: Category.SUPPORT, priority: Priority.LOW, risk: Risk.LOW };
  const rows: JevRow[] = [
    { id: "correct", expected, result, latencyMs: 10 },
    { id: "wrong", expected: { category: Category.INCIDENT, priority: Priority.CRITICAL, risk: Risk.HIGH }, result, latencyMs: 20 },
    { id: "failed", expected: { category: Category.INCIDENT, priority: Priority.HIGH, risk: Risk.HIGH }, failure: { code: "TIMEOUT" }, latencyMs: 30 },
  ];
  it("includes failures in quality denominators and uses historical macro-F1 definition", () => {
    const a = analyzeJev(rows);
    expect(a.metrics).toEqual({ categoryAccuracy: 0.3333, categoryMacroF1: 0.0952,
      priorityAccuracy: 0.3333, riskAccuracy: 0.3333, highCriticalPriorityRecall: 0, highRiskRecall: 0, exactTupleAccuracy: 0.3333 });
    expect(a.latency).toMatchObject({ p50Ms: 20, p95Ms: 30, maxMs: 30, meanMs: 20 });
    expect(a.failures).toBe(1);
  });
  it("reports empty selections as null and coverage over all attempted tickets", () => {
    const a = analyzeJev(rows);
    expect(a.selectiveTuple.find(r => r.threshold === 0.7)).toMatchObject({ coverage: 2 / 3, exactTupleAccuracy: 0.5 });
    expect(a.selectiveTuple.find(r => r.threshold === 0.8)).toMatchObject({ count: 0, exactTupleAccuracy: null });
    expect(a.probabilityAnalysis["risk"]!.ece).toBeCloseTo(0.3);
    expect(a.probabilityAnalysis["risk"]!.brier).toBeCloseTo(0.76);
    expect(a.probabilityAnalysis["risk"]!.details[0]).toMatchObject({ confidence: 0.73, topProbability: 0.8 });
    expect(a.probabilityAnalysis["risk"]!.details[0]!.margin).toBeCloseTo(0.7);
    expect(a.usage.complete).toBe(false);
  });
  it("handles all failed without misleading calibration", () => {
    const a = analyzeJev([rows[2]!]);
    expect(a.probabilityAnalysis["category"]!.ece).toBeNull();
    expect(a.probabilityAnalysis["category"]!.brier).toBeNull();
    expect(a.usage.complete).toBe(false);
    expect(a.usage.reportedCostUsd).toBeNull();
  });
  it("matches historical metrics on the same offline predictions", async () => {
    const examples = rows.slice(0, 2).map(r => ({ id: r.id, input, expected: r.expected, tags: ["test"] }));
    const baseline = await evaluateTriage({ classify: async () => ({
      category: Category.SUPPORT, priority: Priority.LOW, risk: Risk.LOW,
      suggestedTeam: suggestedTeamForCategory(Category.SUPPORT), confidence: 0.7,
      summary: "Test fixture", rationale: "Test fixture",
    }) }, examples);
    expect(analyzeJev(rows.slice(0, 2)).metrics).toMatchObject(baseline.metrics);
  });
  it("blocks repeated spending and preserves the original attempt ledger", () => {
    const directory = mkdtempSync(join(tmpdir(), "jev-guard-"));
    const path = join(directory, "attempt.json");
    try {
      reserveJevRun(path, { status: "running" });
      expect(() => reserveJevRun(path, { status: "second run" })).toThrow();
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ status: "running" });
    } finally { rmSync(directory, { recursive: true }); }
  });
});
