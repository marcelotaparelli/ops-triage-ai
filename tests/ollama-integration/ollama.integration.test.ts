import { describe, expect, it } from "vitest";
import { loadOllamaSettings } from "../../src/config.ts";
import {
  Category,
  Priority,
  Risk,
  SuggestedTeam,
} from "../../src/domain/triage.ts";
import { OllamaTriageClassifier } from "../../src/infrastructure/ollama/ollama-triage-classifier.ts";

describe("OllamaTriageClassifier with real Ollama", () => {
  it("classifies a strong production outage into a valid result", async () => {
    const settings = loadOllamaSettings();
    const classifier = new OllamaTriageClassifier({
      baseUrl: settings.OLLAMA_BASE_URL,
      model: settings.OLLAMA_MODEL,
      timeoutMs: settings.OLLAMA_TIMEOUT_MS,
    });

    const result = await classifier.classify({
      title: "Production checkout is down",
      description: "The outage affects all customers and blocks every purchase.",
    });

    expect(result).toMatchObject({
      category: Category.INCIDENT,
      priority: Priority.CRITICAL,
      risk: Risk.HIGH,
      suggestedTeam: SuggestedTeam.INFRASTRUCTURE,
    });
    expect([0.5, 0.7, 0.9]).toContain(result.confidence);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.rationale.length).toBeGreaterThan(0);
  });
});
