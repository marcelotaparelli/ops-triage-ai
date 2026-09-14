import type { TicketInput, Category, Priority, Risk } from "../../domain/triage.ts";
import type { TriageDecision } from "../../domain/triage-decision.ts";
import type { FeedbackRecord, TriageAuditRecord } from "./triage-persistence.ts";

export interface FeedbackInput {
  reviewedBy: string;
  correctedCategory: Category;
  correctedPriority: Priority;
  correctedRisk: Risk;
  comment?: string;
}

export interface TriageExecution {
  decisionId: string;
  decision: TriageDecision;
}

export interface TriageService {
  execute(input: TicketInput): Promise<TriageExecution>;
  getDecisionAudit(decisionId: string): Promise<TriageAuditRecord | null>;
  addFeedback(decisionId: string, input: FeedbackInput): Promise<FeedbackRecord>;
}
