import { describe, expect, it } from "vitest";
import {
  ClassifierInvalidResponseError,
  ClassifierTimeoutError,
  ClassifierUnavailableError,
} from "../../src/application/errors/classifier-errors.ts";
import type { TriageClassifier } from "../../src/application/ports/triage-classifier.ts";
import {
  HybridPolicy,
  type HybridPolicyInput,
} from "../../src/application/policies/hybrid-policy.ts";
import { TriageTicket } from "../../src/application/triage-ticket.ts";
import {
  DecisionSource,
  HumanReviewReason,
} from "../../src/domain/triage-decision.ts";
import {
  Category,
  Priority,
  Risk,
  SuggestedTeam,
  type ClassifierResult,
  type TicketInput,
} from "../../src/domain/triage.ts";

const input = { title: "Need help", description: "How do I export?" };

function result(overrides: Partial<ClassifierResult> = {}): ClassifierResult {
  return {
    category: Category.SUPPORT,
    priority: Priority.LOW,
    risk: Risk.LOW,
    suggestedTeam: SuggestedTeam.SUPPORT,
    confidence: 0.7,
    summary: input.title,
    rationale: "Support request",
    ...overrides,
  };
}

class FakeClassifier implements TriageClassifier {
  received?: TicketInput;

  constructor(private readonly outcome: ClassifierResult | Error) {}

  async classify(received: TicketInput): Promise<ClassifierResult> {
    this.received = received;
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

class RecordingPolicy extends HybridPolicy {
  input?: HybridPolicyInput;

  override decide(input: HybridPolicyInput) {
    this.input = input;
    return super.decide(input);
  }
}

describe("TriageTicket", () => {
  it.each([
    ["deterministic", DecisionSource.DETERMINISTIC],
    ["ollama", DecisionSource.LLM],
  ] as const)("keeps the %s mode working", async (mode, decisionSource) => {
    const classifier = new FakeClassifier(result());
    const useCase = new TriageTicket({ mode, classifier });

    await expect(useCase.execute(input)).resolves.toEqual({
      ...result(),
      requiresHumanReview: false,
      decisionSource,
      reviewReasons: [],
    });
    expect(classifier.received).toEqual(input);
  });

  it("preserves the complete LLM result in hybrid mode", async () => {
    const llm = result({ summary: "LLM summary", rationale: "LLM rationale" });
    const useCase = new TriageTicket({
      mode: "hybrid",
      deterministicClassifier: new FakeClassifier(result()),
      llmClassifier: new FakeClassifier(llm),
    });

    await expect(useCase.execute(input)).resolves.toEqual({
      ...llm,
      requiresHumanReview: false,
      decisionSource: DecisionSource.HYBRID,
      reviewReasons: [],
    });
  });

  it.each([
    [new ClassifierTimeoutError(), "TIMEOUT"],
    [new ClassifierUnavailableError(), "UNAVAILABLE"],
    [new ClassifierInvalidResponseError(), "INVALID_RESPONSE"],
  ] as const)("maps a known LLM failure to deterministic fallback", async (error, reason) => {
    const deterministic = result({ summary: "Deterministic summary" });
    const policy = new RecordingPolicy();
    const useCase = new TriageTicket(
      {
        mode: "hybrid",
        deterministicClassifier: new FakeClassifier(deterministic),
        llmClassifier: new FakeClassifier(error),
      },
      policy,
    );

    await expect(useCase.execute(input)).resolves.toEqual({
      ...deterministic,
      requiresHumanReview: true,
      decisionSource: DecisionSource.DETERMINISTIC_FALLBACK,
      reviewReasons: [HumanReviewReason.LLM_UNAVAILABLE],
    });
    expect(policy.input?.llm).toEqual({ status: "failed", reason });
  });

  it("propagates an unexpected LLM failure", async () => {
    const unexpected = new Error("unexpected classifier defect");
    const useCase = new TriageTicket({
      mode: "hybrid",
      deterministicClassifier: new FakeClassifier(result()),
      llmClassifier: new FakeClassifier(unexpected),
    });
    await expect(useCase.execute(input)).rejects.toBe(unexpected);
  });
});
