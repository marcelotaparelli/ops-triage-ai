import { readFile } from "node:fs/promises";
import { loadOllamaSettings, type OllamaSettings } from "../src/config.ts";
import { DeterministicTriageClassifier } from "../src/application/classifiers/deterministic-triage-classifier.ts";
import { OllamaTriageClassifier } from "../src/infrastructure/ollama/ollama-triage-classifier.ts";
import { parseHumanReviewDataset, type HumanReviewExample } from "../src/evaluation/human-review-dataset.ts";
import {
  calculateHumanReviewMetrics,
  evaluateHybrid,
  type HumanReviewMetrics,
  type HybridMetrics,
} from "../src/evaluation/hybrid-evaluation.ts";
import { evaluationMetadata, type EvaluationArtifactMetadata } from "../src/evaluation/evaluation-artifact.ts";

function readDatasetPath(): string {
  const datasetPath = process.argv[2];
  if (!datasetPath) {
    throw new Error("Usage: bun scripts/evaluate-human-review.ts <dataset.jsonl>");
  }
  return datasetPath;
}

async function loadDatasetExamples(datasetPath: string): Promise<HumanReviewExample[]> {
  const content = await readFile(datasetPath, "utf8");
  return parseHumanReviewDataset(content);
}

function buildMetadata(datasetPath: string, settings: OllamaSettings): EvaluationArtifactMetadata {
  return evaluationMetadata({
    dataset: datasetPath,
    classifierMode: "HYBRID",
    model: settings.OLLAMA_MODEL,
    timeoutMs: settings.OLLAMA_TIMEOUT_MS,
  });
}

function printReport(options: {
  metadata: EvaluationArtifactMetadata;
  metrics: HybridMetrics;
  humanReview: HumanReviewMetrics;
}): void {
  console.log(
    JSON.stringify(
      { metadata: options.metadata, metrics: options.metrics, humanReview: options.humanReview },
      null,
      2,
    ),
  );
}

const datasetPath = readDatasetPath();
const examples = await loadDatasetExamples(datasetPath);
const settings = loadOllamaSettings();

const result = await evaluateHybrid(
  new DeterministicTriageClassifier(),
  new OllamaTriageClassifier({
    baseUrl: settings.OLLAMA_BASE_URL,
    model: settings.OLLAMA_MODEL,
    timeoutMs: settings.OLLAMA_TIMEOUT_MS,
  }),
  examples,
);

printReport({
  metadata: buildMetadata(datasetPath, settings),
  metrics: result.metrics,
  humanReview: calculateHumanReviewMetrics(examples, result.predictions),
});
