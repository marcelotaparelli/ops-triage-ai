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
const fields = ["category", "priority", "risk"] as const;
const thresholds = [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99];
const ratio = (n: number, d: number) => d ? n / d : 0;
const round = (n: number) => Math.round(n * 10_000) / 10_000;
export function analyzeJev(rows: readonly JevRow[]) {
  if (!rows.length) throw new Error("Empty experiment");
  const successful = rows.filter(r => r.result);
  const correct = (r: JevRow, f: typeof fields[number]) => r.result?.answers[f].choice === r.expected[f];
  const tuple = (r: JevRow) => fields.every(f => correct(r, f));
  const accuracy = (f: typeof fields[number]) => round(ratio(rows.filter(r => correct(r, f)).length, rows.length));
  const positives = rows.filter(r => [Priority.HIGH, Priority.CRITICAL].includes(r.expected.priority));
  const highRisk = rows.filter(r => r.expected.risk === Risk.HIGH);
  const latency = rows.map(r => r.latencyMs).sort((a, b) => a - b);
  const percentile = (p: number) => latency[Math.max(0, Math.ceil(p * latency.length) - 1)]!;
  const probabilityAnalysis = Object.fromEntries(fields.map(f => {
    const details = successful.map(r => {
      const answer = r.result!.answers[f];
      const distribution = answer.probabilities as Record<string, number>;
      const ordered = Object.values(distribution).sort((a, b) => b - a);
      return { id: r.id, correct: correct(r, f), confidence: answer.confidence,
        topProbability: ordered[0]!, margin: ordered[0]! - ordered[1]!,
        brier: Object.entries(distribution).reduce((s, [label, p]) => s + (p - Number(label === r.expected[f])) ** 2, 0) };
    });
    const buckets = Array.from({ length: 5 }, (_, i) => {
      const low = i / 5, high = (i + 1) / 5;
      const selected = details.filter(r => r.topProbability >= low && (r.topProbability < high || i === 4));
      return { low, high, count: selected.length,
        accuracy: selected.length ? ratio(selected.filter(r => r.correct).length, selected.length) : null,
        meanTopProbability: selected.length ? ratio(selected.reduce((s, r) => s + r.topProbability, 0), selected.length) : null };
    });
    const confidenceBuckets = Array.from({ length: 5 }, (_, i) => {
      const selected = details.filter(r => r.confidence >= i / 5 && (r.confidence < (i + 1) / 5 || i === 4));
      return { low: i / 5, high: (i + 1) / 5, count: selected.length,
        accuracy: selected.length ? ratio(selected.filter(r => r.correct).length, selected.length) : null };
    });
    return [f, { details, buckets, confidenceBuckets,
      brier: details.length ? ratio(details.reduce((s, r) => s + r.brier, 0), details.length) : null,
      ece: details.length ? buckets.reduce((s, b) => s + b.count / details.length * Math.abs((b.accuracy ?? 0) - (b.meanTopProbability ?? 0)), 0) : null,
      selective: thresholds.map(threshold => {
        const selected = details.filter(r => r.confidence >= threshold);
        return { threshold, count: selected.length, coverage: ratio(selected.length, rows.length),
          accuracy: selected.length ? ratio(selected.filter(r => r.correct).length, selected.length) : null };
      }) }];
  }));
  const usage = rows.map(r => r.result?.usage ?? r.failure?.usage);
  const inputUsage = usage.map(u => u?.input_tokens);
  const costs = usage.map(u => u?.cost);
  return {
    examples: rows.length, successes: successful.length, failures: rows.length - successful.length,
    // Failures are incorrect/false negatives, never silently excluded or replaced.
    metrics: {
      categoryAccuracy: accuracy("category"),
      categoryMacroF1: round(Object.values(Category).reduce((sum, category) => {
        const tp = rows.filter(r => r.expected.category === category && correct(r, "category")).length;
        const fp = rows.filter(r => r.expected.category !== category && r.result?.answers.category.choice === category).length;
        const fn = rows.filter(r => r.expected.category === category && !correct(r, "category")).length;
        return sum + ratio(2 * tp, 2 * tp + fp + fn);
      }, 0) / Object.values(Category).length),
      priorityAccuracy: accuracy("priority"), riskAccuracy: accuracy("risk"),
      highCriticalPriorityRecall: round(ratio(positives.filter(r => r.result && [Priority.HIGH, Priority.CRITICAL].includes(r.result.answers.priority.choice)).length, positives.length)),
      highRiskRecall: round(ratio(highRisk.filter(r => correct(r, "risk")).length, highRisk.length)),
      exactTupleAccuracy: round(ratio(rows.filter(tuple).length, rows.length)),
    },
    latency: { population: "all attempts, including failures", p50Ms: percentile(0.5), p95Ms: percentile(0.95),
      maxMs: percentile(1), meanMs: ratio(latency.reduce((a, b) => a + b, 0), latency.length) },
    usage: { responsesWithInputTokens: inputUsage.filter(v => v !== undefined).length,
      reportedInputTokens: inputUsage.some(v => v !== undefined) ? inputUsage.reduce<number>((s, v) => s + (v ?? 0), 0) : null,
      responsesWithCost: costs.filter(v => v !== undefined).length,
      reportedCostUsd: costs.some(v => v !== undefined) ? costs.reduce<number>((s, v) => s + (v ?? 0), 0) : null,
      complete: costs.every(v => v !== undefined) && inputUsage.every(v => v !== undefined) },
    probabilityAnalysis,
    selectiveTuple: thresholds.map(threshold => {
      const selected = successful.filter(r => fields.every(f => r.result!.answers[f].confidence >= threshold));
      return { threshold, count: selected.length, coverage: ratio(selected.length, rows.length),
        exactTupleAccuracy: selected.length ? ratio(selected.filter(tuple).length, selected.length) : null };
    }),
  };
}
