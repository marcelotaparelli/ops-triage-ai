import { describe, expect, it } from "vitest";
import { evaluationMetadata } from "../../src/evaluation/evaluation-artifact.ts";

describe("evaluation artifacts", () => {
  it("contains reproducibility metadata without connection strings or payloads", () => {
    const artifact = evaluationMetadata({ dataset: "datasets/triage-dev.jsonl", classifierMode: "HYBRID", model: "qwen2.5:7b-instruct-q5_K_S", timeoutMs: 120_000 });
    expect(artifact).toMatchObject({ dataset: "datasets/triage-dev.jsonl", classifierMode: "HYBRID", model: "qwen2.5:7b-instruct-q5_K_S", timeoutMs: 120_000, promptVersion: "ollama-triage-v3" });
    expect(artifact.commit).toMatch(/^[0-9a-f]{40}$|^unknown$/);
    expect(artifact.generatedAt).toMatch(/Z$/);
    expect(JSON.stringify(artifact)).not.toContain("DATABASE_URL");
  });
});
