import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadOllamaSettings, type OllamaSettings } from "../src/config.ts";
import {
  evaluateTriage,
  evaluateTriageDetailed,
  type EvaluationExample,
  type EvaluationPrediction,
  type EvaluationResult,
} from "../src/evaluation/evaluate-triage.ts";
import { parseTriageDataset } from "../src/evaluation/triage-dataset.ts";
import { OllamaTriageClassifier } from "../src/infrastructure/ollama/ollama-triage-classifier.ts";
import { OLLAMA_TRIAGE_PROMPT_VERSION } from "../src/infrastructure/ollama/ollama-prompt-v1.ts";

const DETAILS_DATASET = "datasets/triage-dev.jsonl";

type OllamaDivergence = {
  id: string;
  expected: EvaluationPrediction["expected"];
  actual: Pick<EvaluationPrediction["actual"], "category" | "priority" | "risk">;
};

function readCliArguments(): { datasetPath: string; showDetails: boolean } {
  const datasetPath = process.argv[2];
  if (!datasetPath) {
    throw new Error("Usage: bun scripts/evaluate-ollama-triage.ts <dataset.jsonl>");
  }
  const showDetails = process.argv.slice(3).includes("--details");
  if (showDetails && resolve(datasetPath) !== resolve(DETAILS_DATASET)) {
    throw new Error("--details is available only for datasets/triage-dev.jsonl");
  }
  return { datasetPath, showDetails };
}

async function loadDatasetExamples(datasetPath: string): Promise<EvaluationExample[]> {
  const content = await readFile(datasetPath, "utf8");
  return parseTriageDataset(content);
}

function createClassifier(settings: OllamaSettings): OllamaTriageClassifier {
  return new OllamaTriageClassifier({
    baseUrl: settings.OLLAMA_BASE_URL,
    model: settings.OLLAMA_MODEL,
    timeoutMs: settings.OLLAMA_TIMEOUT_MS,
  });
}

function collectDivergences(predictions: readonly EvaluationPrediction[]): OllamaDivergence[] {
  return predictions
    .filter(
      ({ expected, actual }) =>
        expected.category !== actual.category ||
        expected.priority !== actual.priority ||
        expected.risk !== actual.risk,
    )
    .map(({ id, expected, actual }) => ({
      id,
      expected,
      actual: {
        category: actual.category,
        priority: actual.priority,
        risk: actual.risk,
      },
    }));
}

async function evaluateWithDivergences(
  classifier: OllamaTriageClassifier,
  examples: readonly EvaluationExample[],
): Promise<{ result: EvaluationResult; divergences: OllamaDivergence[] }> {
  const detailedResult = await evaluateTriageDetailed(classifier, examples);
  return {
    result: { examples: detailedResult.examples, metrics: detailedResult.metrics },
    divergences: collectDivergences(detailedResult.predictions),
  };
}

function printReport(options: {
  settings: OllamaSettings;
  datasetPath: string;
  result: EvaluationResult;
  divergences?: OllamaDivergence[];
}): void {
  console.log(
    JSON.stringify(
      {
        classifier: "ollama",
        promptVersion: OLLAMA_TRIAGE_PROMPT_VERSION,
        model: options.settings.OLLAMA_MODEL,
        dataset: options.datasetPath,
        ...options.result,
        ...(options.divergences ? { divergences: options.divergences } : {}),
      },
      null,
      2,
    ),
  );
}

const { datasetPath, showDetails } = readCliArguments();
const settings = loadOllamaSettings();
const examples = await loadDatasetExamples(datasetPath);
const classifier = createClassifier(settings);

if (showDetails) {
  const { result, divergences } = await evaluateWithDivergences(classifier, examples);
  printReport({ settings, datasetPath, result, divergences });
} else {
  const result = await evaluateTriage(classifier, examples);
  printReport({ settings, datasetPath, result });
}
