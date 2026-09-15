import { z } from "zod";
import { Category, Priority, Risk, type TicketInput } from "../domain/triage.ts";

const Schema = z.object({
  id: z.string().trim().min(1),
  input: z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(5_000) }).strict(),
  expected: z.object({ category: z.enum(Category), priority: z.enum(Priority), risk: z.enum(Risk) }).strict(),
  shouldRequireHumanReview: z.boolean(),
  reviewJustification: z.string().trim().min(1).max(500),
  tags: z.array(z.string().trim().min(1)).min(1),
}).strict();

export interface HumanReviewExample {
  id: string;
  input: TicketInput;
  expected: { category: Category; priority: Priority; risk: Risk };
  shouldRequireHumanReview: boolean;
  reviewJustification: string;
  tags: string[];
}

export function parseHumanReviewDataset(content: string): HumanReviewExample[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("Human review dataset must not be empty");
  const examples = lines.map((line, index) => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`Invalid human review JSON on line ${index + 1}`); }
    const parsed = Schema.safeParse(value);
    if (!parsed.success) throw new Error(`Invalid human review example on line ${index + 1}`);
    return parsed.data;
  });
  if (new Set(examples.map(({ id }) => id)).size !== examples.length) throw new Error("Human review dataset contains duplicate ids");
  return examples;
}
