import { z } from "zod";
import { Category, Priority, Risk } from "../domain/triage.ts";
import type { FeedbackInput } from "../application/ports/triage-service.ts";

const FeedbackInputSchema = z
  .object({
    reviewedBy: z.string().trim().min(1).max(200),
    correction: z
      .object({
        category: z.enum(Category),
        priority: z.enum(Priority),
        risk: z.enum(Risk),
      })
      .strict(),
    comment: z.string().trim().max(5_000).optional(),
  })
  .strict();

export interface FeedbackRequestIssue {
  field: string;
  code: string;
}

export type FeedbackInputParseResult =
  | { success: true; data: FeedbackInput }
  | { success: false; issues: FeedbackRequestIssue[] };

export function parseFeedbackInput(payload: unknown): FeedbackInputParseResult {
  const parsed = FeedbackInputSchema.safeParse(payload);
  if (parsed.success) {
    return {
      success: true,
      data: {
        reviewedBy: parsed.data.reviewedBy,
        correctedCategory: parsed.data.correction.category,
        correctedPriority: parsed.data.correction.priority,
        correctedRisk: parsed.data.correction.risk,
        ...(parsed.data.comment === undefined ? {} : { comment: parsed.data.comment }),
      },
    };
  }
  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      code: issue.code,
    })),
  };
}
