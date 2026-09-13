import { describe, expect, it } from "vitest";
import type { TriageClassifier } from "../../src/application/ports/triage-classifier.ts";
import { TriageTicket } from "../../src/application/triage-ticket.ts";
import {
  Category,
  Priority,
  Risk,
  SuggestedTeam,
  type ClassifierResult,
  type TicketInput,
} from "../../src/domain/triage.ts";

class RecordingClassifier implements TriageClassifier {
  input?: TicketInput;

  async classify(input: TicketInput): Promise<ClassifierResult> {
    this.input = input;
    return {
      category: Category.SUPPORT,
      priority: Priority.LOW,
      risk: Risk.LOW,
      suggestedTeam: SuggestedTeam.SUPPORT,
      confidence: 0.7,
      summary: input.title,
      rationale: "SUPPORT_PARTIAL_SIGNAL: help",
    };
  }
}

describe("TriageTicket", () => {
  it("delegates to the classifier and returns its ClassifierResult", async () => {
    const classifier = new RecordingClassifier();
    const useCase = new TriageTicket(classifier);
    const input = { title: "Need help", description: "How do I export?" };

    const result = await useCase.execute(input);

    expect(classifier.input).toEqual(input);
    expect(result).toMatchObject({ category: Category.SUPPORT, confidence: 0.7 });
    expect(result).not.toHaveProperty("requiresHumanReview");
  });
});
