import type { TriageClassifier } from "../application/ports/triage-classifier.ts";
import {
  Category,
  type ClassifierResult,
  Priority,
  Risk,
  type TicketInput,
} from "../domain/triage.ts";

export interface EvaluationExample {
  id: string;
  input: TicketInput;
  expected: {
    category: Category;
    priority: Priority;
    risk: Risk;
  };
  tags: string[];
}

export interface EvaluationMetrics {
  categoryAccuracy: number;
  categoryMacroF1: number;
  priorityAccuracy: number;
  riskAccuracy: number;
  highCriticalPriorityRecall: number;
  highRiskRecall: number;
}

export interface EvaluationResult {
  examples: number;
  metrics: EvaluationMetrics;
}

export interface EvaluationPrediction {
  id: string;
  expected: EvaluationExample["expected"];
  actual: ClassifierResult;
}

export interface DetailedEvaluationResult extends EvaluationResult {
  predictions: readonly EvaluationPrediction[];
}

export async function evaluateTriage(
  classifier: TriageClassifier,
  examples: readonly EvaluationExample[],
): Promise<EvaluationResult> {
  const result = await evaluateTriageDetailed(classifier, examples);
  return { examples: result.examples, metrics: result.metrics };
}

export async function evaluateTriageDetailed(
  classifier: TriageClassifier,
  examples: readonly EvaluationExample[],
): Promise<DetailedEvaluationResult> {
  if (examples.length === 0) throw new Error("Evaluation dataset must not be empty");

  const predictions: EvaluationPrediction[] = [];
  for (const example of examples) {
    predictions.push({
      id: example.id,
      expected: example.expected,
      actual: await classifier.classify(example.input),
    });
  }

  return {
    examples: examples.length,
    metrics: calculateMetrics(predictions),
    predictions,
  };
}

function calculateMetrics(predictions: readonly EvaluationPrediction[]): EvaluationMetrics {
  return {
      categoryAccuracy: round(
        ratio(predictions.filter((row) => row.actual.category === row.expected.category).length, predictions.length),
      ),
      categoryMacroF1: round(
        average(
          Object.values(Category).map((category) => {
            const truePositive = predictions.filter(
              (row) => row.expected.category === category && row.actual.category === category,
            ).length;
            const falsePositive = predictions.filter(
              (row) => row.expected.category !== category && row.actual.category === category,
            ).length;
            const falseNegative = predictions.filter(
              (row) => row.expected.category === category && row.actual.category !== category,
            ).length;
            return ratio(2 * truePositive, 2 * truePositive + falsePositive + falseNegative);
          }),
        ),
      ),
      priorityAccuracy: round(
        ratio(predictions.filter((row) => row.actual.priority === row.expected.priority).length, predictions.length),
      ),
      riskAccuracy: round(
        ratio(predictions.filter((row) => row.actual.risk === row.expected.risk).length, predictions.length),
      ),
      highCriticalPriorityRecall: round(
        recallWhere(
          predictions,
          (priority) => priority === Priority.HIGH || priority === Priority.CRITICAL,
          (row) => row.actual.priority === Priority.HIGH || row.actual.priority === Priority.CRITICAL,
          (row) => row.expected.priority,
        ),
      ),
      highRiskRecall: round(
        recallWhere(
          predictions,
          (risk) => risk === Risk.HIGH,
          (row) => row.actual.risk === Risk.HIGH,
          (row) => row.expected.risk,
        ),
      ),
  };
}

function recallWhere<T, TValue>(
  rows: readonly T[],
  isPositive: (value: TValue) => boolean,
  predictedPositive: (row: T) => boolean,
  expectedValue: (row: T) => TValue,
): number {
  const positives = rows.filter((row) => isPositive(expectedValue(row)));
  return ratio(positives.filter(predictedPositive).length, positives.length);
}

function average(values: readonly number[]): number {
  return ratio(values.reduce((sum, value) => sum + value, 0), values.length);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
