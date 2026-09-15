import { HybridPolicy, type LlmOutcome } from "../application/policies/hybrid-policy.ts";
import { ClassifierInvalidResponseError, ClassifierTimeoutError, ClassifierUnavailableError } from "../application/errors/classifier-errors.ts";
import type { TriageClassifier } from "../application/ports/triage-classifier.ts";
import type { ClassifierResult } from "../domain/triage.ts";
import { Priority, Risk } from "../domain/triage.ts";
import type { EvaluationExample } from "./evaluate-triage.ts";
import type { HumanReviewExample } from "./human-review-dataset.ts";

export interface HybridPrediction {
  id: string;
  expected: EvaluationExample["expected"];
  deterministic: ClassifierResult;
  llm: LlmOutcome;
  decision: ReturnType<HybridPolicy["decide"]>;
  durationMs: number;
}

export interface HybridMetrics {
  examples: number;
  categoryAccuracy: number;
  priorityAccuracy: number;
  riskAccuracy: number;
  exactTupleAccuracy: number;
  highCriticalPriorityRecall: number;
  highRiskRecall: number;
  reviewRate: number;
  decisionSources: Record<string, number>;
  reviewReasons: Record<string, number>;
  fallbackRate: number;
  llmFailures: Record<string, number>;
  disagreementRate: number;
  latencyMs: { p50: number; p95: number; max: number };
}

export interface HumanReviewMetrics {
  examples: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
}

export async function evaluateHybrid(
  deterministic: TriageClassifier,
  llm: TriageClassifier,
  examples: readonly EvaluationExample[],
  policy = new HybridPolicy(),
): Promise<{ metrics: HybridMetrics; predictions: HybridPrediction[] }> {
  if (examples.length === 0) throw new Error("Evaluation dataset must not be empty");
  const predictions: HybridPrediction[] = [];
  for (const example of examples) {
    const started = performance.now();
    const deterministicResult = await deterministic.classify(example.input);
    let outcome: LlmOutcome;
    try { outcome = { status: "available", result: await llm.classify(example.input) }; }
    catch (error) { outcome = { status: "failed", reason: failureReason(error) }; }
    predictions.push({ id: example.id, expected: example.expected, deterministic: deterministicResult, llm: outcome, decision: policy.decide({ deterministic: deterministicResult, llm: outcome }), durationMs: performance.now() - started });
  }
  return { metrics: calculateHybridMetrics(predictions), predictions };
}

export function calculateHumanReviewMetrics(
  examples: readonly HumanReviewExample[],
  predictions: readonly Pick<HybridPrediction, "id" | "decision">[],
): HumanReviewMetrics {
  const expected = new Map(examples.map((example) => [example.id, example.shouldRequireHumanReview]));
  if (predictions.length !== examples.length || predictions.some(({ id }) => !expected.has(id)) || new Set(predictions.map(({ id }) => id)).size !== predictions.length) {
    throw new Error("Human review predictions and independent ground truth must match exactly");
  }
  let truePositive = 0; let falsePositive = 0; let trueNegative = 0; let falseNegative = 0;
  for (const prediction of predictions) {
    const actual = prediction.decision.requiresHumanReview;
    const wanted = expected.get(prediction.id);
    if (wanted && actual) truePositive += 1;
    else if (!wanted && actual) falsePositive += 1;
    else if (!wanted && !actual) trueNegative += 1;
    else falseNegative += 1;
  }
  return { examples: predictions.length, truePositive, falsePositive, trueNegative, falseNegative, precision: round(ratio(truePositive, truePositive + falsePositive)), recall: round(ratio(truePositive, truePositive + falseNegative)) };
}

function calculateHybridMetrics(rows: readonly HybridPrediction[]): HybridMetrics {
  const count = rows.length;
  const decisionSources: Record<string, number> = {}; const reviewReasons: Record<string, number> = {}; const llmFailures: Record<string, number> = {};
  for (const row of rows) {
    decisionSources[row.decision.decisionSource] = (decisionSources[row.decision.decisionSource] ?? 0) + 1;
    for (const reason of row.decision.reviewReasons) reviewReasons[reason] = (reviewReasons[reason] ?? 0) + 1;
    if (row.llm.status === "failed") llmFailures[row.llm.reason] = (llmFailures[row.llm.reason] ?? 0) + 1;
  }
  const sorted = rows.map(({ durationMs }) => durationMs).sort((a, b) => a - b);
  return {
    examples: count,
    categoryAccuracy: accuracy(rows, (row) => row.decision.category === row.expected.category),
    priorityAccuracy: accuracy(rows, (row) => row.decision.priority === row.expected.priority),
    riskAccuracy: accuracy(rows, (row) => row.decision.risk === row.expected.risk),
    exactTupleAccuracy: accuracy(rows, (row) => row.decision.category === row.expected.category && row.decision.priority === row.expected.priority && row.decision.risk === row.expected.risk),
    highCriticalPriorityRecall: recall(rows, (row) => row.expected.priority === Priority.HIGH || row.expected.priority === Priority.CRITICAL, (row) => row.decision.priority === Priority.HIGH || row.decision.priority === Priority.CRITICAL),
    highRiskRecall: recall(rows, (row) => row.expected.risk === Risk.HIGH, (row) => row.decision.risk === Risk.HIGH),
    reviewRate: round(rows.filter(({ decision }) => decision.requiresHumanReview).length / count),
    decisionSources, reviewReasons, fallbackRate: round((decisionSources["DETERMINISTIC_FALLBACK"] ?? 0) / count), llmFailures,
    disagreementRate: round(rows.filter(({ deterministic, llm }) => llm.status === "available" && (deterministic.category !== llm.result.category || deterministic.priority !== llm.result.priority || deterministic.risk !== llm.result.risk)).length / count),
    latencyMs: { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: round(sorted[sorted.length - 1] ?? 0) },
  };
}

function failureReason(error: unknown): "TIMEOUT" | "UNAVAILABLE" | "INVALID_RESPONSE" {
  if (error instanceof ClassifierTimeoutError) return "TIMEOUT";
  if (error instanceof ClassifierUnavailableError) return "UNAVAILABLE";
  if (error instanceof ClassifierInvalidResponseError) return "INVALID_RESPONSE";
  throw error;
}
function accuracy(rows: readonly HybridPrediction[], predicate: (row: HybridPrediction) => boolean): number { return round(rows.filter(predicate).length / rows.length); }
function recall(rows: readonly HybridPrediction[], expected: (row: HybridPrediction) => boolean, actual: (row: HybridPrediction) => boolean): number { const positives = rows.filter(expected); return round(positives.filter(actual).length / positives.length); }
function percentile(values: readonly number[], percentileValue: number): number { return round(values.length === 0 ? 0 : values[Math.min(values.length - 1, Math.ceil(values.length * percentileValue) - 1)] ?? 0); }
function ratio(numerator: number, denominator: number): number { return denominator === 0 ? 0 : numerator / denominator; }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }
