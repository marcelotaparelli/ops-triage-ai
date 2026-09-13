import { describe, expect, it } from "vitest";
import {
  ClassifierInvalidResponseError,
  ClassifierTimeoutError,
  ClassifierUnavailableError,
} from "../../src/application/errors/classifier-errors.ts";
import {
  type HttpFetch,
  OllamaTriageClassifier,
} from "../../src/infrastructure/ollama/ollama-triage-classifier.ts";

const config = {
  baseUrl: "http://ollama.internal:11434",
  model: "qwen2.5:7b-instruct-q5_K_S",
  timeoutMs: 1000,
};

const validResult = {
  category: "INCIDENT",
  priority: "CRITICAL",
  risk: "HIGH",
  confidence: 0.9,
  summary: "Production checkout outage",
  rationale: "Broad production outage affects all customers.",
};

function ollamaResponse(content: unknown): Response {
  return new Response(
    JSON.stringify({
      model: config.model,
      message: { role: "assistant", content },
      done: true,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("OllamaTriageClassifier", () => {
  it("sends the correct structured, non-streaming request", async () => {
    let capturedUrl: string | URL | Request | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl: HttpFetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return ollamaResponse(JSON.stringify(validResult));
    };
    const classifier = new OllamaTriageClassifier(config, fetchImpl);

    await expect(
      classifier.classify({
        title: "Production checkout outage",
        description: "All customers are blocked",
      }),
    ).resolves.toEqual({ ...validResult, suggestedTeam: "INFRASTRUCTURE" });

    expect(capturedUrl).toBe("http://ollama.internal:11434/api/chat");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({ "content-type": "application/json" });
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body.model).toBe(config.model);
    expect(body.stream).toBe(false);
    expect(body).not.toHaveProperty("think");
    expect(body.options).toEqual({ temperature: 0 });
    expect(body.format).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: [
        "category",
        "priority",
        "risk",
        "confidence",
        "summary",
        "rationale",
      ],
    });
    expect(body.messages).toEqual([
      expect.objectContaining({ role: "system" }),
      expect.objectContaining({ role: "user" }),
    ]);
  });

  it.each([
    ["category", "UNKNOWN"],
    ["priority", "URGENT"],
    ["risk", "CRITICAL"],
    ["confidence", 0.8],
  ])("rejects an invalid %s", async (field, value) => {
    const fetchImpl: HttpFetch = async () =>
      ollamaResponse(JSON.stringify({ ...validResult, [field]: value }));
    const classifier = new OllamaTriageClassifier(config, fetchImpl);
    await expect(
      classifier.classify({ title: "Ticket", description: "Description" }),
    ).rejects.toBeInstanceOf(ClassifierInvalidResponseError);
  });

  it("rejects fields outside the ClassifierResult schema", async () => {
    const fetchImpl: HttpFetch = async () =>
      ollamaResponse(JSON.stringify({ ...validResult, internalReasoning: "hidden" }));
    await expect(
      new OllamaTriageClassifier(config, fetchImpl).classify({
        title: "Ticket",
        description: "Description",
      }),
    ).rejects.toBeInstanceOf(ClassifierInvalidResponseError);
  });

  it("derives suggestedTeam from the validated category", async () => {
    const fetchImpl: HttpFetch = async () =>
      ollamaResponse(JSON.stringify({ ...validResult, category: "BUG" }));
    await expect(
      new OllamaTriageClassifier(config, fetchImpl).classify({
        title: "Ticket",
        description: "Description",
      }),
    ).resolves.toMatchObject({ category: "BUG", suggestedTeam: "DEVELOPMENT" });
  });

  it.each([
    ["malformed model JSON", ollamaResponse("{")],
    ["empty model response", ollamaResponse("")],
    [
      "invalid Ollama envelope",
      new Response(JSON.stringify({ done: true }), { status: 200 }),
    ],
    ["malformed Ollama JSON", new Response("{", { status: 200 })],
  ])("rejects %s", async (_name, response) => {
    const fetchImpl: HttpFetch = async () => response;
    await expect(
      new OllamaTriageClassifier(config, fetchImpl).classify({
        title: "Ticket",
        description: "Description",
      }),
    ).rejects.toBeInstanceOf(ClassifierInvalidResponseError);
  });

  it("maps non-success HTTP responses to unavailable", async () => {
    const fetchImpl: HttpFetch = async () =>
      new Response(JSON.stringify({ error: "model not found: secret-model" }), { status: 404 });
    const promise = new OllamaTriageClassifier(config, fetchImpl).classify({
      title: "Ticket",
      description: "Description",
    });
    await expect(promise).rejects.toEqual(new ClassifierUnavailableError());
    await expect(promise).rejects.not.toThrow(/secret-model/);
  });

  it("maps connection errors to unavailable without leaking details", async () => {
    const fetchImpl: HttpFetch = async () => {
      throw new Error("connect ECONNREFUSED http://secret-host:11434");
    };
    const promise = new OllamaTriageClassifier(config, fetchImpl).classify({
      title: "Ticket",
      description: "Description",
    });
    await expect(promise).rejects.toEqual(new ClassifierUnavailableError());
    await expect(promise).rejects.not.toThrow(/secret-host/);
  });

  it("aborts and reports an explicit timeout", async () => {
    const fetchImpl: HttpFetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const classifier = new OllamaTriageClassifier(
      { ...config, timeoutMs: 5 },
      fetchImpl,
    );
    await expect(
      classifier.classify({ title: "Ticket", description: "Description" }),
    ).rejects.toBeInstanceOf(ClassifierTimeoutError);
  });
});
