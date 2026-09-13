import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadOllamaSettings } from "../src/config.ts";
import {
  evaluateTriage,
  evaluateTriageDetailed,
  type EvaluationPrediction,
  type EvaluationResult,
} from "../src/evaluation/evaluate-triage.ts";
import { parseTriageDataset } from "../src/evaluation/triage-dataset.ts";
import { OllamaTriageClassifier } from "../src/infrastructure/ollama/ollama-triage-classifier.ts";
import { OLLAMA_TRIAGE_PROMPT_VERSION } from "../src/infrastructure/ollama/ollama-prompt-v1.ts";

const datasetPath = process.argv[2];
if (!datasetPath) {
  throw new Error("Usage: bun scripts/evaluate-ollama-triage.ts <dataset.jsonl>");
}
const details = process.argv.slice(3).includes("--details");
if (details && resolve(datasetPath) !== resolve("datasets/triage-dev.jsonl")) {
  throw new Error("--details is available only for datasets/triage-dev.jsonl");
}

const settings = loadOllamaSettings();
const content = await readFile(datasetPath, "utf8");
const examples = parseTriageDataset(content);
const classifier = new OllamaTriageClassifier({
  baseUrl: settings.OLLAMA_BASE_URL,
  model: settings.OLLAMA_MODEL,
  timeoutMs: settings.OLLAMA_TIMEOUT_MS,
});
let result: EvaluationResult;
let divergences:
  | Array<{
      id: string;
      expected: EvaluationPrediction["expected"];
      actual: Pick<EvaluationPrediction["actual"], "category" | "priority" | "risk">;
    }>
  | undefined;
if (details) {
  const detailedResult = await evaluateTriageDetailed(classifier, examples);
  result = { examples: detailedResult.examples, metrics: detailedResult.metrics };
  divergences = detailedResult.predictions
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
} else {
  result = await evaluateTriage(classifier, examples);
}

console.log(
  JSON.stringify(
    {
      classifier: "ollama",
      promptVersion: OLLAMA_TRIAGE_PROMPT_VERSION,
      model: settings.OLLAMA_MODEL,
      dataset: datasetPath,
      ...result,
      ...(details ? { divergences } : {}),
    },
    null,
    2,
  ),
);
