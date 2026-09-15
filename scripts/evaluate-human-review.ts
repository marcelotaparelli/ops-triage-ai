import { readFile } from "node:fs/promises";
import { loadOllamaSettings } from "../src/config.ts";
import { DeterministicTriageClassifier } from "../src/application/classifiers/deterministic-triage-classifier.ts";
import { OllamaTriageClassifier } from "../src/infrastructure/ollama/ollama-triage-classifier.ts";
import { parseHumanReviewDataset } from "../src/evaluation/human-review-dataset.ts";
import { evaluateHybrid, calculateHumanReviewMetrics } from "../src/evaluation/hybrid-evaluation.ts";
import { evaluationMetadata } from "../src/evaluation/evaluation-artifact.ts";

const datasetPath = process.argv[2];
if (!datasetPath) throw new Error("Usage: bun scripts/evaluate-human-review.ts <dataset.jsonl>");
const examples = parseHumanReviewDataset(await readFile(datasetPath, "utf8"));
const settings = loadOllamaSettings();
const result = await evaluateHybrid(new DeterministicTriageClassifier(), new OllamaTriageClassifier({ baseUrl: settings.OLLAMA_BASE_URL, model: settings.OLLAMA_MODEL, timeoutMs: settings.OLLAMA_TIMEOUT_MS }), examples);
console.log(JSON.stringify({ metadata: evaluationMetadata({ dataset: datasetPath, classifierMode: "HYBRID", model: settings.OLLAMA_MODEL, timeoutMs: settings.OLLAMA_TIMEOUT_MS }), metrics: result.metrics, humanReview: calculateHumanReviewMetrics(examples, result.predictions) }, null, 2));
