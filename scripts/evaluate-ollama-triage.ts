import { readFile } from "node:fs/promises";
import { loadOllamaSettings } from "../src/config.ts";
import { evaluateTriage } from "../src/evaluation/evaluate-triage.ts";
import { parseTriageDataset } from "../src/evaluation/triage-dataset.ts";
import { OllamaTriageClassifier } from "../src/infrastructure/ollama/ollama-triage-classifier.ts";
import { OLLAMA_TRIAGE_PROMPT_VERSION } from "../src/infrastructure/ollama/ollama-prompt-v1.ts";

const datasetPath = process.argv[2];
if (!datasetPath) {
  throw new Error("Usage: bun scripts/evaluate-ollama-triage.ts <dataset.jsonl>");
}

const settings = loadOllamaSettings();
const content = await readFile(datasetPath, "utf8");
const examples = parseTriageDataset(content);
const classifier = new OllamaTriageClassifier({
  baseUrl: settings.OLLAMA_BASE_URL,
  model: settings.OLLAMA_MODEL,
  timeoutMs: settings.OLLAMA_TIMEOUT_MS,
});
const result = await evaluateTriage(classifier, examples);

console.log(
  JSON.stringify(
    {
      classifier: "ollama",
      promptVersion: OLLAMA_TRIAGE_PROMPT_VERSION,
      model: settings.OLLAMA_MODEL,
      dataset: datasetPath,
      ...result,
    },
    null,
    2,
  ),
);
