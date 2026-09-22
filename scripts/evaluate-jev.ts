import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { JevEvaluationAdapter, JevError } from "../src/evaluation/jev/adapter.ts";
import { analyzeJev, type JevRow } from "../src/evaluation/jev/analysis.ts";
import { JEV_CONFIG, JEV_QUESTIONS } from "../src/evaluation/jev/questions.ts";
import { parseTriageDataset } from "../src/evaluation/triage-dataset.ts";
import { reserveJevRun } from "../src/evaluation/jev/cost-guard.ts";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const configuration = { ...JEV_CONFIG, questions: JEV_QUESTIONS,
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
  smokeIds: ["dev-incident-01", "dev-access-01", "dev-support-01"],
  metricsVersion: "jev-analysis-v1", thresholds: [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99],
  failurePolicy: "all attempts denominator; no fallback; no retry", latency: "performance.now; nearest rank", };
function sourceHash(): string {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? (e.name === "generated" ? [] : walk(join(dir, e.name))) : [join(dir, e.name)]);
  return hash([...walk("src"), ...walk("scripts"), ...walk("tests"), "package.json", "bun.lock", "tsconfig.json"]
    .sort().map(p => `${p}\n${readFileSync(p, "utf8")}`).join("\n"));
}
const freezePath = "artifacts/jev-1.13-freeze.json";
const journalPath = "artifacts/jev-1.13-held-out-attempts.jsonl";
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

async function main() {
  const mode = process.argv[2];
  if (!["dev", "freeze", "heldout"].includes(mode ?? "")) throw new Error("Usage: bun scripts/evaluate-jev.ts dev|freeze|heldout --allow-paid");
  const commit = git("rev-parse", "HEAD");
  const fingerprint = sourceHash();
  const smokePath = `artifacts/jev-1.13-dev-${fingerprint.slice(0, 12)}.json`;
  if (mode === "freeze") {
    if (git("status", "--porcelain")) throw new Error("Commit reviewed code and DEV smoke before freeze");
    const smoke = JSON.parse(readFileSync(smokePath, "utf8"));
    if (smoke.sourceHash !== fingerprint || smoke.analysis?.failures !== 0 || smoke.rows?.length !== 3 ||
      JSON.stringify(smoke.configuration) !== JSON.stringify(configuration)) throw new Error("Three successful DEV calls with current sources required");
    writeFileSync(freezePath, json({ configuration, codeCommit: commit, sourceHash: fingerprint,
      frozenAt: new Date().toISOString(), smokePath, smokeHash: hash(readFileSync(smokePath, "utf8")),
      datasetHash: hash(readFileSync("datasets/triage-eval.jsonl", "utf8")),
      plannedHeldoutCalls: 70, plannedRuns: 1 }), { flag: "wx" });
    console.log("Freeze recorded. Commit the manifest before heldout.");
    return;
  }
  if (process.argv[3] !== "--allow-paid") throw new Error("Paid calls require --allow-paid");
  const key = process.env["OPENROUTER_API_KEY"];
  if (!key) throw new Error("OPENROUTER_API_KEY is required");
  let freeze: Record<string, unknown> | undefined;
  const datasetPath = mode === "dev" ? "datasets/triage-dev.jsonl" : "datasets/triage-eval.jsonl";
  if (mode === "heldout") {
    if (git("status", "--porcelain")) throw new Error("Clean committed tree required");
    freeze = JSON.parse(readFileSync(freezePath, "utf8")) as Record<string, unknown>;
    if (freeze["sourceHash"] !== fingerprint || JSON.stringify(freeze["configuration"]) !== JSON.stringify(configuration) ||
      freeze["datasetHash"] !== hash(readFileSync(datasetPath, "utf8")) ||
      freeze["smokeHash"] !== hash(readFileSync(smokePath, "utf8"))) throw new Error("Freeze mismatch");
    git("merge-base", "--is-ancestor", String(freeze["codeCommit"]), commit);
  } else if (existsSync(freezePath)) throw new Error("DEV calls disabled after freeze");
  const examples = parseTriageDataset(readFileSync(datasetPath, "utf8"));
  if (mode === "heldout" && examples.length !== 70) throw new Error("Expected 70 frozen examples");
  const selected = mode === "dev" ? configuration.smokeIds.map(id => {
    const example = examples.find(e => e.id === id);
    if (!example) throw new Error("DEV smoke example missing");
    return example;
  }) : examples;
  const output = mode === "dev" ? smokePath : `artifacts/jev-1.13-held-out-${commit.slice(0, 7)}.json`;
  const startedAt = new Date().toISOString();
  // Exclusive durable ledger is created BEFORE any paid request. Never delete to retry silently.
  if (mode === "heldout") reserveJevRun(journalPath, { event: "run_started", commit, startedAt });
  reserveJevRun(output, { status: "running", commit, startedAt });
  const rows: JevRow[] = [];
  const adapter = new JevEvaluationAdapter(key);
  for (const example of selected) {
    if (mode === "heldout") appendFileSync(journalPath, JSON.stringify({ event: "attempt_started", id: example.id, at: new Date().toISOString() }) + "\n");
    const start = performance.now();
    let row: JevRow;
    try {
      const result = await adapter.decide(example.input);
      row = { id: example.id, expected: example.expected, result, latencyMs: performance.now() - start };
    } catch (error) {
      // Error causes may contain authorization headers; deliberately do not retain them.
      // eslint-disable-next-line preserve-caught-error
      if (!(error instanceof JevError)) throw new Error("Unexpected evaluation failure; inspect local code before any further calls");
      row = { id: example.id, expected: example.expected, latencyMs: performance.now() - start,
        failure: { code: error.code, ...(error.status === undefined ? {} : { status: error.status }),
          ...(error.usage === undefined ? {} : { usage: error.usage }) } };
    }
    rows.push(row);
    if (mode === "heldout") appendFileSync(journalPath, JSON.stringify({ event: "attempt_finished", row }) + "\n");
    writeFileSync(output, json({ status: rows.length === selected.length ? "complete" : "running", commit,
      startedAt, updatedAt: new Date().toISOString(), configuration, sourceHash: fingerprint,
      datasetPath, datasetHash: hash(readFileSync(datasetPath, "utf8")), freeze, rows, analysis: analyzeJev(rows) }));
    console.log(`${mode}: ${rows.length}/${selected.length} ${row.failure?.code ?? "validated"}`);
    // Integration failures in DEV stop spending immediately; heldout failures remain measured.
    if (mode === "dev" && row.failure) break;
  }
}
main().catch(() => { console.error("Jev run stopped. Check prerequisites, exclusive artifacts, and recorded status; no automatic retry."); process.exitCode = 1; });
