import { readFile } from "node:fs/promises";
import { loadOllamaSettings } from "../src/config.ts";
import { DeterministicTriageClassifier } from "../src/application/classifiers/deterministic-triage-classifier.ts";
import { OllamaTriageClassifier } from "../src/infrastructure/ollama/ollama-triage-classifier.ts";
import { parseTriageDataset } from "../src/evaluation/triage-dataset.ts";
import { evaluateHybrid } from "../src/evaluation/hybrid-evaluation.ts";
import { evaluateTriage } from "../src/evaluation/evaluate-triage.ts";
import { evaluationMetadata } from "../src/evaluation/evaluation-artifact.ts";

const datasetPath = process.argv[2];
if (!datasetPath) throw new Error("Usage: bun scripts/evaluate-hybrid.ts <dataset.jsonl>");
const examples = parseTriageDataset(await readFile(datasetPath, "utf8"));
const settings = loadOllamaSettings();
const deterministic = new DeterministicTriageClassifier();
const llm = new OllamaTriageClassifier({ baseUrl: settings.OLLAMA_BASE_URL, model: settings.OLLAMA_MODEL, timeoutMs: settings.OLLAMA_TIMEOUT_MS });
const result = await evaluateHybrid(deterministic, llm, examples);
const baseline = await evaluateTriage(new DeterministicTriageClassifier(), examples);
let llmOnly: unknown;
try {
  llmOnly = await evaluateTriage(new OllamaTriageClassifier({ baseUrl: settings.OLLAMA_BASE_URL, model: settings.OLLAMA_MODEL, timeoutMs: settings.OLLAMA_TIMEOUT_MS }), examples);
} catch (error) {
  llmOnly = { operationalError: error instanceof Error ? error.name : "unknown_error" };
}
console.log(JSON.stringify({ metadata: evaluationMetadata({ dataset: datasetPath, classifierMode: "HYBRID", model: settings.OLLAMA_MODEL, timeoutMs: settings.OLLAMA_TIMEOUT_MS }), baseline, llm: llmOnly, hybrid: result.metrics }, null, 2));
