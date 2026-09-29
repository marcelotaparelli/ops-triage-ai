import { Category, Priority, Risk } from "../../domain/triage.ts";
import type { EvaluationExample } from "../evaluate-triage.ts";
import type { JevTriageResult, JevFailure, JevUsage } from "./adapter.ts";

export interface JevRow {
  id: string;
  expected: EvaluationExample["expected"];
  latencyMs: number;
  result?: JevTriageResult;
  failure?: { code: JevFailure; status?: number; usage?: JevUsage };
}

type JevField = "category" | "priority" | "risk";

const JEV_FIELDS: readonly JevField[] = ["category", "priority", "risk"];
const SELECTIVE_THRESHOLDS = [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99];
const CALIBRATION_BIN_COUNT = 5;

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

function roundToFourDecimals(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function isFieldCorrect(row: JevRow, field: JevField): boolean {
  return row.result?.answers[field].choice === row.expected[field];
}

function isTupleCorrect(row: JevRow): boolean {
  return JEV_FIELDS.every((field) => isFieldCorrect(row, field));
}

function fieldAccuracy(rows: readonly JevRow[], field: JevField): number {
  const correctCount = rows.filter((row) => isFieldCorrect(row, field)).length;
  return roundToFourDecimals(ratio(correctCount, rows.length));
}

function categoryMacroF1(rows: readonly JevRow[]): number {
  const perCategoryF1 = Object.values(Category).map((category) => {
    const truePositives = rows.filter(
      (row) => row.expected.category === category && isFieldCorrect(row, "category"),
    ).length;
    const falsePositives = rows.filter(
      (row) => row.expected.category !== category && row.result?.answers.category.choice === category,
    ).length;
    const falseNegatives = rows.filter(
      (row) => row.expected.category === category && !isFieldCorrect(row, "category"),
    ).length;
    return ratio(2 * truePositives, 2 * truePositives + falsePositives + falseNegatives);
  });
  const meanF1 = ratio(
    perCategoryF1.reduce((sum, value) => sum + value, 0),
    perCategoryF1.length,
  );
  return roundToFourDecimals(meanF1);
}

function highCriticalPriorityRecall(rows: readonly JevRow[]): number {
  const expectedPositives = rows.filter((row) =>
    [Priority.HIGH, Priority.CRITICAL].includes(row.expected.priority),
  );
  const recalledPositives = expectedPositives.filter(
    (row) =>
      row.result !== undefined &&
      [Priority.HIGH, Priority.CRITICAL].includes(row.result.answers.priority.choice),
  );
  return roundToFourDecimals(ratio(recalledPositives.length, expectedPositives.length));
}

function highRiskRecall(rows: readonly JevRow[]): number {
  const expectedHighRisk = rows.filter((row) => row.expected.risk === Risk.HIGH);
  const recalledHighRisk = expectedHighRisk.filter((row) => isFieldCorrect(row, "risk"));
  return roundToFourDecimals(ratio(recalledHighRisk.length, expectedHighRisk.length));
}

function exactTupleAccuracy(rows: readonly JevRow[]): number {
  return roundToFourDecimals(ratio(rows.filter(isTupleCorrect).length, rows.length));
}

function sortedLatencies(rows: readonly JevRow[]): number[] {
  return rows.map((row) => row.latencyMs).sort((a, b) => a - b);
}

// Nearest-rank percentile over all attempts, failures included.
function nearestRank(sortedValues: readonly number[], percentile: number): number {
  const rank = Math.ceil(percentile * sortedValues.length) - 1;
  return sortedValues[Math.max(0, rank)]!;
}

interface ProbabilityDetail {
  id: string;
  correct: boolean;
  confidence: number;
  topProbability: number;
  margin: number;
  brier: number;
}

function probabilityDetailsForField(
  successfulRows: readonly JevRow[],
  field: JevField,
): ProbabilityDetail[] {
  return successfulRows.map((row) => {
    const answer = row.result!.answers[field];
    const distribution = answer.probabilities as Record<string, number>;
    const sortedProbabilities = Object.values(distribution).sort((a, b) => b - a);
    const topProbability = sortedProbabilities[0]!;
    const secondProbability = sortedProbabilities[1]!;
    const brier = Object.entries(distribution).reduce(
      (sum, [label, probability]) => sum + (probability - Number(label === row.expected[field])) ** 2,
      0,
    );
    return {
      id: row.id,
      correct: isFieldCorrect(row, field),
      confidence: answer.confidence,
      topProbability,
      margin: topProbability - secondProbability,
      brier,
    };
  });
}

interface TopProbabilityBucket {
  low: number;
  high: number;
  count: number;
  accuracy: number | null;
  meanTopProbability: number | null;
}

// Bins are left-inclusive/right-exclusive; the final bin includes 1.
function topProbabilityBuckets(details: readonly ProbabilityDetail[]): TopProbabilityBucket[] {
  return Array.from({ length: CALIBRATION_BIN_COUNT }, (_, index) => {
    const low = index / CALIBRATION_BIN_COUNT;
    const high = (index + 1) / CALIBRATION_BIN_COUNT;
    const isLastBin = index === CALIBRATION_BIN_COUNT - 1;
    const selected = details.filter(
      (detail) => detail.topProbability >= low && (detail.topProbability < high || isLastBin),
    );
    return {
      low,
      high,
      count: selected.length,
      accuracy:
        selected.length > 0
          ? ratio(selected.filter((detail) => detail.correct).length, selected.length)
          : null,
      meanTopProbability:
        selected.length > 0
          ? ratio(
              selected.reduce((sum, detail) => sum + detail.topProbability, 0),
              selected.length,
            )
          : null,
    };
  });
}

interface ConfidenceBucket {
  low: number;
  high: number;
  count: number;
  accuracy: number | null;
}

function confidenceBuckets(details: readonly ProbabilityDetail[]): ConfidenceBucket[] {
  return Array.from({ length: CALIBRATION_BIN_COUNT }, (_, index) => {
    const low = index / CALIBRATION_BIN_COUNT;
    const high = (index + 1) / CALIBRATION_BIN_COUNT;
    const isLastBin = index === CALIBRATION_BIN_COUNT - 1;
    const selected = details.filter(
      (detail) => detail.confidence >= low && (detail.confidence < high || isLastBin),
    );
    return {
      low,
      high,
      count: selected.length,
      accuracy:
        selected.length > 0
          ? ratio(selected.filter((detail) => detail.correct).length, selected.length)
          : null,
    };
  });
}

function meanBrierScore(details: readonly ProbabilityDetail[]): number | null {
  if (details.length === 0) {
    return null;
  }
  return ratio(details.reduce((sum, detail) => sum + detail.brier, 0), details.length);
}

function expectedCalibrationError(
  details: readonly ProbabilityDetail[],
  buckets: readonly TopProbabilityBucket[],
): number | null {
  if (details.length === 0) {
    return null;
  }
  return buckets.reduce(
    (sum, bucket) =>
      sum +
      (bucket.count / details.length) * Math.abs((bucket.accuracy ?? 0) - (bucket.meanTopProbability ?? 0)),
    0,
  );
}

interface ConfidenceSelection {
  threshold: number;
  count: number;
  coverage: number;
  accuracy: number | null;
}

function selectiveAccuracyByConfidence(
  details: readonly ProbabilityDetail[],
  totalAttempts: number,
): ConfidenceSelection[] {
  return SELECTIVE_THRESHOLDS.map((threshold) => {
    const selected = details.filter((detail) => detail.confidence >= threshold);
    return {
      threshold,
      count: selected.length,
      coverage: ratio(selected.length, totalAttempts),
      accuracy:
        selected.length > 0
          ? ratio(selected.filter((detail) => detail.correct).length, selected.length)
          : null,
    };
  });
}

function analyzeFieldProbabilities(successfulRows: readonly JevRow[], totalAttempts: number) {
  return Object.fromEntries(
    JEV_FIELDS.map((field) => {
      const details = probabilityDetailsForField(successfulRows, field);
      const buckets = topProbabilityBuckets(details);
      return [
        field,
        {
          details,
          buckets,
          confidenceBuckets: confidenceBuckets(details),
          brier: meanBrierScore(details),
          ece: expectedCalibrationError(details, buckets),
          selective: selectiveAccuracyByConfidence(details, totalAttempts),
        },
      ];
    }),
  );
}

function summarizeLatency(rows: readonly JevRow[]) {
  const sorted = sortedLatencies(rows);
  return {
    population: "all attempts, including failures",
    p50Ms: nearestRank(sorted, 0.5),
    p95Ms: nearestRank(sorted, 0.95),
    maxMs: nearestRank(sorted, 1),
    meanMs: ratio(sorted.reduce((sum, value) => sum + value, 0), sorted.length),
  };
}

function summarizeUsage(rows: readonly JevRow[]) {
  const usages = rows.map((row) => row.result?.usage ?? row.failure?.usage);
  const inputTokens = usages.map((usage) => usage?.input_tokens);
  const costs = usages.map((usage) => usage?.cost);
  return {
    responsesWithInputTokens: inputTokens.filter((value) => value !== undefined).length,
    reportedInputTokens: inputTokens.some((value) => value !== undefined)
      ? inputTokens.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null,
    responsesWithCost: costs.filter((value) => value !== undefined).length,
    reportedCostUsd: costs.some((value) => value !== undefined)
      ? costs.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null,
    complete: costs.every((value) => value !== undefined) && inputTokens.every((value) => value !== undefined),
  };
}

interface TupleSelection {
  threshold: number;
  count: number;
  coverage: number;
  exactTupleAccuracy: number | null;
}

function selectiveTupleAccuracy(
  successfulRows: readonly JevRow[],
  totalAttempts: number,
): TupleSelection[] {
  return SELECTIVE_THRESHOLDS.map((threshold) => {
    const selected = successfulRows.filter((row) =>
      JEV_FIELDS.every((field) => row.result!.answers[field].confidence >= threshold),
    );
    return {
      threshold,
      count: selected.length,
      coverage: ratio(selected.length, totalAttempts),
      exactTupleAccuracy:
        selected.length > 0 ? ratio(selected.filter(isTupleCorrect).length, selected.length) : null,
    };
  });
}

export function analyzeJev(rows: readonly JevRow[]) {
  if (rows.length === 0) {
    throw new Error("Empty experiment");
  }
  const successfulRows = rows.filter((row) => row.result !== undefined);
  return {
    examples: rows.length,
    successes: successfulRows.length,
    failures: rows.length - successfulRows.length,
    // Failures are incorrect/false negatives, never silently excluded or replaced.
    metrics: {
      categoryAccuracy: fieldAccuracy(rows, "category"),
      categoryMacroF1: categoryMacroF1(rows),
      priorityAccuracy: fieldAccuracy(rows, "priority"),
      riskAccuracy: fieldAccuracy(rows, "risk"),
      highCriticalPriorityRecall: highCriticalPriorityRecall(rows),
      highRiskRecall: highRiskRecall(rows),
      exactTupleAccuracy: exactTupleAccuracy(rows),
    },
    latency: summarizeLatency(rows),
    usage: summarizeUsage(rows),
    probabilityAnalysis: analyzeFieldProbabilities(successfulRows, rows.length),
    selectiveTuple: selectiveTupleAccuracy(successfulRows, rows.length),
  };
}
