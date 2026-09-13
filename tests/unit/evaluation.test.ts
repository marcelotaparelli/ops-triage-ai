import { describe, expect, it } from "vitest";
import type { TriageClassifier } from "../../src/application/ports/triage-classifier.ts";
import {
  Category,
  Priority,
  Risk,
  SuggestedTeam,
  type ClassifierResult,
} from "../../src/domain/triage.ts";
import {
  evaluateTriage,
  evaluateTriageDetailed,
  type EvaluationExample,
} from "../../src/evaluation/evaluate-triage.ts";
import { parseTriageDataset } from "../../src/evaluation/triage-dataset.ts";

class FixedClassifier implements TriageClassifier {
  constructor(private readonly results: ClassifierResult[]) {}

  async classify(): Promise<ClassifierResult> {
    const result = this.results.shift();
    if (!result) throw new Error("Missing fixed result");
    return result;
  }
}

function result(category: Category, priority: Priority, risk: Risk): ClassifierResult {
  return {
    category,
    priority,
    risk,
    suggestedTeam: SuggestedTeam.HUMAN_REVIEW,
    confidence: 0.5,
    summary: "Synthetic",
    rationale: "CATEGORY_DEFAULT",
  };
}

const examples: EvaluationExample[] = [
  {
    id: "one",
    input: { title: "One", description: "One" },
    expected: { category: Category.INCIDENT, priority: Priority.CRITICAL, risk: Risk.HIGH },
    tags: ["danger"],
  },
  {
    id: "two",
    input: { title: "Two", description: "Two" },
    expected: { category: Category.BUG, priority: Priority.LOW, risk: Risk.LOW },
    tags: ["routine"],
  },
];

describe("triage evaluation", () => {
  it("calculates the approved metrics with stable rounding", async () => {
    const classifier = new FixedClassifier([
      result(Category.INCIDENT, Priority.HIGH, Risk.HIGH),
      result(Category.OTHER, Priority.LOW, Risk.LOW),
    ]);

    await expect(evaluateTriage(classifier, examples)).resolves.toEqual({
      examples: 2,
      metrics: {
        categoryAccuracy: 0.5,
        categoryMacroF1: 0.1429,
        priorityAccuracy: 0.5,
        riskAccuracy: 1,
        highCriticalPriorityRecall: 1,
        highRiskRecall: 1,
      },
    });
  });

  it("rejects empty evaluation input", async () => {
    await expect(evaluateTriage(new FixedClassifier([]), [])).rejects.toThrow(/must not be empty/);
  });

  it("exposes prediction details while preserving the aggregate metrics", async () => {
    const detailed = await evaluateTriageDetailed(
      new FixedClassifier([
        result(Category.INCIDENT, Priority.HIGH, Risk.HIGH),
        result(Category.OTHER, Priority.LOW, Risk.LOW),
      ]),
      examples,
    );

    expect(detailed.metrics.categoryAccuracy).toBe(0.5);
    expect(detailed.predictions).toEqual([
      {
        id: "one",
        expected: examples[0]!.expected,
        actual: result(Category.INCIDENT, Priority.HIGH, Risk.HIGH),
      },
      {
        id: "two",
        expected: examples[1]!.expected,
        actual: result(Category.OTHER, Priority.LOW, Risk.LOW),
      },
    ]);
  });

  it("validates JSONL and rejects duplicate ids", () => {
    const line = JSON.stringify(examples[0]);
    expect(parseTriageDataset(line)).toHaveLength(1);
    expect(() => parseTriageDataset("{")).toThrow(/Invalid JSON.*line 1/);
    expect(() => parseTriageDataset(line + "\n" + line)).toThrow(/duplicate ids/);
  });

  it("rejects invalid labels", () => {
    const invalid = JSON.stringify({
      ...examples[0],
      expected: { ...examples[0]!.expected, category: "UNKNOWN" },
    });
    expect(() => parseTriageDataset(invalid)).toThrow(/Invalid evaluation example/);
  });
});
