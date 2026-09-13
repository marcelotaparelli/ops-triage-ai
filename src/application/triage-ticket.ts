import type { ClassifierResult, TicketInput } from "../domain/triage.ts";
import type { TriageClassifier } from "./ports/triage-classifier.ts";

export class TriageTicket {
  constructor(private readonly classifier: TriageClassifier) {}

  execute(input: TicketInput): Promise<ClassifierResult> {
    return this.classifier.classify(input);
  }
}
