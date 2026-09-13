import { readFile } from "node:fs/promises";
import { DeterministicTriageClassifier } from "../src/application/classifiers/deterministic-triage-classifier.ts";
import { evaluateTriage } from "../src/evaluation/evaluate-triage.ts";
import { parseTriageDataset } from "../src/evaluation/triage-dataset.ts";

const datasetPath = process.argv[2];
if (!datasetPath) throw new Error("Usage: bun scripts/evaluate-triage.ts <dataset.jsonl>");

const content = await readFile(datasetPath, "utf8");
const examples = parseTriageDataset(content);
const result = await evaluateTriage(new DeterministicTriageClassifier(), examples);

console.log(JSON.stringify({ dataset: datasetPath, ...result }, null, 2));
