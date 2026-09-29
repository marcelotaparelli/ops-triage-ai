import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { JevEvaluationAdapter, JevError } from "../src/evaluation/jev/adapter.ts";
import { analyzeJev, type JevRow } from "../src/evaluation/jev/analysis.ts";
import { JEV_CONFIG, JEV_QUESTIONS } from "../src/evaluation/jev/questions.ts";
import { parseTriageDataset } from "../src/evaluation/triage-dataset.ts";
import { reserveJevRun } from "../src/evaluation/jev/cost-guard.ts";
import type { EvaluationExample } from "../src/evaluation/evaluate-triage.ts";

type JevMode = "dev" | "freeze" | "heldout";

const FREEZE_PATH = "artifacts/jev-1.13-freeze.json";
const JOURNAL_PATH = "artifacts/jev-1.13-held-out-attempts.jsonl";
const DEV_DATASET_PATH = "datasets/triage-dev.jsonl";
const HELDOUT_DATASET_PATH = "datasets/triage-eval.jsonl";
const EXPECTED_HELDOUT_EXAMPLES = 70;
const PLANNED_HELDOUT_CALLS = 70;
const PLANNED_RUNS = 1;

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function runGit(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function buildConfiguration() {
  return {
    ...JEV_CONFIG,
    questions: JEV_QUESTIONS,
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
    smokeIds: ["dev-incident-01", "dev-access-01", "dev-support-01"],
    metricsVersion: "jev-analysis-v1",
    thresholds: [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99],
    failurePolicy: "all attempts denominator; no fallback; no retry",
    latency: "performance.now; nearest rank",
  };
}

const configuration = buildConfiguration();

function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "generated") {
        files.push(...collectSourceFiles(fullPath));
      }
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function computeSourceHash(): string {
  const trackedFiles = [
    ...collectSourceFiles("src"),
    ...collectSourceFiles("scripts"),
    ...collectSourceFiles("tests"),
    "package.json",
    "bun.lock",
    "tsconfig.json",
  ];
  const hashedContent = trackedFiles
    .sort()
    .map((path) => `${path}\n${readFileSync(path, "utf8")}`)
    .join("\n");
  return sha256Hex(hashedContent);
}

function hashFile(path: string): string {
  return sha256Hex(readFileSync(path, "utf8"));
}

function parseMode(rawMode: string | undefined): JevMode {
  if (rawMode === "dev" || rawMode === "freeze" || rawMode === "heldout") {
    return rawMode;
  }
  throw new Error("Usage: bun scripts/evaluate-jev.ts dev|freeze|heldout --allow-paid");
}

function requirePaidFlag(): void {
  if (process.argv[3] !== "--allow-paid") {
    throw new Error("Paid calls require --allow-paid");
  }
}

function requireApiKey(): string {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required");
  }
  return apiKey;
}

function requireCleanTree(): void {
  if (runGit("status", "--porcelain")) {
    throw new Error("Clean committed tree required");
  }
}

function readJsonFile(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function devArtifactPath(sourceHash: string): string {
  return `artifacts/jev-1.13-dev-${sourceHash.slice(0, 12)}.json`;
}

function heldoutArtifactPath(commit: string): string {
  return `artifacts/jev-1.13-held-out-${commit.slice(0, 7)}.json`;
}

function runFreeze(commit: string, sourceHash: string): void {
  if (runGit("status", "--porcelain")) {
    throw new Error("Commit reviewed code and DEV smoke before freeze");
  }
  const smokePath = devArtifactPath(sourceHash);
  const smoke = readJsonFile(smokePath);
  const smokeIsValid =
    smoke["sourceHash"] === sourceHash &&
    (smoke["analysis"] as { failures?: number } | undefined)?.failures === 0 &&
    (smoke["rows"] as unknown[] | undefined)?.length === 3 &&
    JSON.stringify(smoke["configuration"]) === JSON.stringify(configuration);
  if (!smokeIsValid) {
    throw new Error("Three successful DEV calls with current sources required");
  }
  writeFileSync(
    FREEZE_PATH,
    toPrettyJson({
      configuration,
      codeCommit: commit,
      sourceHash,
      frozenAt: new Date().toISOString(),
      smokePath,
      smokeHash: hashFile(smokePath),
      datasetHash: hashFile(HELDOUT_DATASET_PATH),
      plannedHeldoutCalls: PLANNED_HELDOUT_CALLS,
      plannedRuns: PLANNED_RUNS,
    }),
    { flag: "wx" },
  );
  console.log("Freeze recorded. Commit the manifest before heldout.");
}

function readFreezeManifest(expectedSourceHash: string, smokePath: string): Record<string, unknown> {
  const freeze = readJsonFile(FREEZE_PATH);
  const matchesFreeze =
    freeze["sourceHash"] === expectedSourceHash &&
    JSON.stringify(freeze["configuration"]) === JSON.stringify(configuration) &&
    freeze["datasetHash"] === hashFile(HELDOUT_DATASET_PATH) &&
    freeze["smokeHash"] === hashFile(smokePath);
  if (!matchesFreeze) {
    throw new Error("Freeze mismatch");
  }
  return freeze;
}

function selectExamples(mode: "dev" | "heldout", datasetPath: string): EvaluationExample[] {
  const examples = parseTriageDataset(readFileSync(datasetPath, "utf8"));
  if (mode === "heldout") {
    if (examples.length !== EXPECTED_HELDOUT_EXAMPLES) {
      throw new Error("Expected 70 frozen examples");
    }
    return examples;
  }
  return configuration.smokeIds.map((id) => {
    const example = examples.find((candidate) => candidate.id === id);
    if (!example) {
      throw new Error("DEV smoke example missing");
    }
    return example;
  });
}

async function evaluateSingleExample(
  adapter: JevEvaluationAdapter,
  example: EvaluationExample,
): Promise<JevRow> {
  const startedAt = performance.now();
  try {
    const result = await adapter.decide(example.input);
    return { id: example.id, expected: example.expected, result, latencyMs: performance.now() - startedAt };
  } catch (error) {
    // Error causes may contain authorization headers; deliberately do not retain them.
    if (!(error instanceof JevError)) {
      // eslint-disable-next-line preserve-caught-error
      throw new Error("Unexpected evaluation failure; inspect local code before any further calls");
    }
    const failure: NonNullable<JevRow["failure"]> = { code: error.code };
    if (error.status !== undefined) {
      failure.status = error.status;
    }
    if (error.usage !== undefined) {
      failure.usage = error.usage;
    }
    return { id: example.id, expected: example.expected, latencyMs: performance.now() - startedAt, failure };
  }
}

function writeProgressArtifact(options: {
  outputPath: string;
  commit: string;
  startedAt: string;
  sourceHash: string;
  datasetPath: string;
  freeze: Record<string, unknown> | undefined;
  rows: JevRow[];
  totalExamples: number;
}): void {
  const status = options.rows.length === options.totalExamples ? "complete" : "running";
  writeFileSync(
    options.outputPath,
    toPrettyJson({
      status,
      commit: options.commit,
      startedAt: options.startedAt,
      updatedAt: new Date().toISOString(),
      configuration,
      sourceHash: options.sourceHash,
      datasetPath: options.datasetPath,
      datasetHash: hashFile(options.datasetPath),
      freeze: options.freeze,
      rows: options.rows,
      analysis: analyzeJev(options.rows),
    }),
  );
}

async function runPaidEvaluation(options: {
  mode: "dev" | "heldout";
  commit: string;
  sourceHash: string;
  outputPath: string;
  datasetPath: string;
  freeze: Record<string, unknown> | undefined;
  apiKey: string;
}): Promise<void> {
  const examples = selectExamples(options.mode, options.datasetPath);
  const startedAt = new Date().toISOString();
  // Exclusive durable ledger is created BEFORE any paid request. Never delete to retry silently.
  if (options.mode === "heldout") {
    reserveJevRun(JOURNAL_PATH, { event: "run_started", commit: options.commit, startedAt });
  }
  reserveJevRun(options.outputPath, { status: "running", commit: options.commit, startedAt });

  const rows: JevRow[] = [];
  const adapter = new JevEvaluationAdapter(options.apiKey);
  for (const example of examples) {
    if (options.mode === "heldout") {
      appendFileSync(
        JOURNAL_PATH,
        JSON.stringify({ event: "attempt_started", id: example.id, at: new Date().toISOString() }) + "\n",
      );
    }
    const row = await evaluateSingleExample(adapter, example);
    rows.push(row);
    if (options.mode === "heldout") {
      appendFileSync(JOURNAL_PATH, JSON.stringify({ event: "attempt_finished", row }) + "\n");
    }
    writeProgressArtifact({
      outputPath: options.outputPath,
      commit: options.commit,
      startedAt,
      sourceHash: options.sourceHash,
      datasetPath: options.datasetPath,
      freeze: options.freeze,
      rows,
      totalExamples: examples.length,
    });
    console.log(`${options.mode}: ${rows.length}/${examples.length} ${row.failure?.code ?? "validated"}`);
    // Integration failures in DEV stop spending immediately; heldout failures remain measured.
    if (options.mode === "dev" && row.failure) {
      break;
    }
  }
}

async function runDev(commit: string, sourceHash: string, apiKey: string): Promise<void> {
  if (existsSync(FREEZE_PATH)) {
    throw new Error("DEV calls disabled after freeze");
  }
  await runPaidEvaluation({
    mode: "dev",
    commit,
    sourceHash,
    outputPath: devArtifactPath(sourceHash),
    datasetPath: DEV_DATASET_PATH,
    freeze: undefined,
    apiKey,
  });
}

async function runHeldout(commit: string, sourceHash: string, apiKey: string): Promise<void> {
  requireCleanTree();
  const freeze = readFreezeManifest(sourceHash, devArtifactPath(sourceHash));
  runGit("merge-base", "--is-ancestor", String(freeze["codeCommit"]), commit);
  await runPaidEvaluation({
    mode: "heldout",
    commit,
    sourceHash,
    outputPath: heldoutArtifactPath(commit),
    datasetPath: HELDOUT_DATASET_PATH,
    freeze,
    apiKey,
  });
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv[2]);
  const commit = runGit("rev-parse", "HEAD");
  const sourceHash = computeSourceHash();

  if (mode === "freeze") {
    runFreeze(commit, sourceHash);
    return;
  }

  requirePaidFlag();
  const apiKey = requireApiKey();
  if (mode === "dev") {
    await runDev(commit, sourceHash, apiKey);
    return;
  }
  await runHeldout(commit, sourceHash, apiKey);
}

main().catch(() => {
  console.error(
    "Jev run stopped. Check prerequisites, exclusive artifacts, and recorded status; no automatic retry.",
  );
  process.exitCode = 1;
});
