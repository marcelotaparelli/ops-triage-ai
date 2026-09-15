# Phase 7 evaluation methodology

Phase 7 compares the deterministic baseline, the standalone Ollama classifier,
and the hybrid policy without importing the HTTP entrypoint. The harness emits
classification quality, exact tuple accuracy, severity recall, disagreement,
fallback, review reasons, and p50/p95/max latency.
Its JSON artifacts also include commit hash, dataset, classifier mode, prompt
version, model, timeout, and generation timestamp; no connection strings or
ticket payloads are recorded.

The existing `triage-dev.jsonl` and frozen `triage-eval.jsonl` datasets contain
classification labels only. They do not contain independent human-review
ground truth. Therefore review precision and recall are never computed from
those datasets. The held-out dataset remains unchanged.

`human-review-dev.jsonl` is a separate, small operational evaluation set. Each
case has an explicit `shouldRequireHumanReview` label and a
`reviewJustification`. These labels describe the desired operational handling;
they are not copied from `HybridPolicy` outputs. Precision and recall are
reported only for this labeled set.

## Reproduction

```bash
bun run eval:dev
bun run eval:hybrid:dev
bun run eval:human-review:dev
```

The adversarial development set is `datasets/triage-adversarial-dev.jsonl`.
It is used for regression checks and is not a substitute for the frozen
held-out benchmark.

The Ollama commands require `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, and
`OLLAMA_TIMEOUT_MS`. The official held-out run is intentionally not part of
the normal development commands. Run it once only after the prompt,
classifiers, policy, model configuration, evaluator, and metric schema are
frozen.

Audit validation is pure and independent from HTTP and Prisma. It compares
before/after audit snapshots to ensure the decision is unchanged and feedback
history is append-only.
