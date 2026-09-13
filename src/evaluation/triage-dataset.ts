import { z } from "zod";
import { Category, Priority, Risk } from "../domain/triage.ts";
import type { EvaluationExample } from "./evaluate-triage.ts";

const EvaluationExampleSchema = z.object({
  id: z.string().trim().min(1),
  input: z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(5_000),
  }),
  expected: z.object({
    category: z.enum(Category),
    priority: z.enum(Priority),
    risk: z.enum(Risk),
  }),
  tags: z.array(z.string().trim().min(1)).min(1),
});

export function parseTriageDataset(content: string): EvaluationExample[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("Evaluation dataset must not be empty");

  const examples = lines.map((line, index) => {
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      throw new Error("Invalid JSON on dataset line " + (index + 1));
    }
    const parsed = EvaluationExampleSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Invalid evaluation example on dataset line " + (index + 1));
    }
    return parsed.data;
  });

  const ids = new Set(examples.map(({ id }) => id));
  if (ids.size !== examples.length) throw new Error("Evaluation dataset contains duplicate ids");
  return examples;
}
