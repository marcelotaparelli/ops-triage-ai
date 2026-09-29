import { readFile } from "node:fs/promises";
import { loadOllamaSettings, type OllamaSettings } from "../src/config.ts";
import { DeterministicTriageClassifier } from "../src/application/classifiers/deterministic-triage-classifier.ts";
import { OllamaTriageClassifier } from "../src/infrastructure/ollama/ollama-triage-classifier.ts";
import { parseTriageDataset } from "../src/evaluation/triage-dataset.ts";
import { evaluateHybrid, type HybridMetrics } from "../src/evaluation/hybrid-evaluation.ts";
import { evaluateTriage, type EvaluationExample, type EvaluationResult } from "../src/evaluation/evaluate-triage.ts";
import { evaluationMetadata, type EvaluationArtifactMetadata } from "../src/evaluation/evaluation-artifact.ts";

function readDatasetPath(): string {
  const datasetPath = process.argv[2];
  if (!datasetPath) {
    throw new Error("Usage: bun scripts/evaluate-hybrid.ts <dataset.jsonl>");
  }
  return datasetPath;
}

async function loadDatasetExamples(datasetPath: string): Promise<EvaluationExample[]> {
  const content = await readFile(datasetPath, "utf8");
  return parseTriageDataset(content);
}

function createOllamaClassifier(settings: OllamaSettings): OllamaTriageClassifier {
  return new OllamaTriageClassifier({
    baseUrl: settings.OLLAMA_BASE_URL,
    model: settings.OLLAMA_MODEL,
    timeoutMs: settings.OLLAMA_TIMEOUT_MS,
  });
}

function buildMetadata(datasetPath: string, settings: OllamaSettings): EvaluationArtifactMetadata {
  return evaluationMetadata({
    dataset: datasetPath,
    classifierMode: "HYBRID",
    model: settings.OLLAMA_MODEL,
    timeoutMs: settings.OLLAMA_TIMEOUT_MS,
  });
}

// The LLM-only baseline is best-effort: an operational failure is reported
// by name instead of aborting the hybrid comparison.
async function evaluateLlmBaseline(
  settings: OllamaSettings,
  examples: readonly EvaluationExample[],
): Promise<EvaluationResult | { operationalError: string }> {
  try {
    return await evaluateTriage(createOllamaClassifier(settings), examples);
  } catch (error) {
    return { operationalError: error instanceof Error ? error.name : "unknown_error" };
  }
}

function printReport(options: {
  metadata: EvaluationArtifactMetadata;
  baseline: EvaluationResult;
  llm: EvaluationResult | { operationalError: string };
  hybrid: HybridMetrics;
}): void {
  console.log(
    JSON.stringify(
      { metadata: options.metadata, baseline: options.baseline, llm: options.llm, hybrid: options.hybrid },
      null,
      2,
    ),
  );
}

const datasetPath = readDatasetPath();
const examples = await loadDatasetExamples(datasetPath);
const settings = loadOllamaSettings();

const hybrid = await evaluateHybrid(
  new DeterministicTriageClassifier(),
  createOllamaClassifier(settings),
  examples,
);
const baseline = await evaluateTriage(new DeterministicTriageClassifier(), examples);
const llmOnly = await evaluateLlmBaseline(settings, examples);

printReport({ metadata: buildMetadata(datasetPath, settings), baseline, llm: llmOnly, hybrid: hybrid.metrics });
