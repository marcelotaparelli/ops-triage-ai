import type { TriageAuditRecord } from "../application/ports/triage-persistence.ts";

export interface AuditValidationResult { valid: boolean; errors: string[]; }

/** Pure validation for evaluation snapshots; intentionally independent of HTTP and Prisma. */
export function validateAuditTrail(before: TriageAuditRecord, after: TriageAuditRecord): AuditValidationResult {
  const errors: string[] = [];
  if (before.ticket.id !== after.ticket.id) errors.push("ticket changed");
  if (before.run.id !== after.run.id) errors.push("run changed");
  if (before.decision.id !== after.decision.id) errors.push("decision changed");
  if (before.decision.category !== after.decision.category || before.decision.priority !== after.decision.priority || before.decision.risk !== after.decision.risk) errors.push("decision labels changed");
  if (after.feedback.length < before.feedback.length) errors.push("feedback was removed");
  for (let index = 0; index < before.feedback.length; index += 1) {
    if (before.feedback[index]?.id !== after.feedback[index]?.id) errors.push("feedback history was reordered or overwritten");
  }
  return { valid: errors.length === 0, errors };
}
