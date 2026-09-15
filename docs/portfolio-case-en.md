# ops-triage-ai — Applied AI Case Study

## Summary

This project addresses operational ticket triage across category, priority,
risk, and suggested team. It combines a deterministic baseline, a local LLM,
and a hybrid policy while preserving fallback, human review, and a persisted
audit trail.

The deterministic baseline provides predictable behavior, low cost, low
latency, and a quantitative reference point. The LLM improves coverage for
less structured language. `HybridPolicy` combines both signals and routes
high-severity, low-confidence, unavailable, or disagreeing cases to human
review.

## Architecture

```text
HTTP
  → validation and security
  → PersistedTriageService
  → TriageTicket
      → DeterministicTriageClassifier
      → OllamaTriageClassifier
      → HybridPolicy
  → TriageDecision
  → Prisma/PostgreSQL
  → append-only feedback / audit trail
```

`PersistedTriageService` orchestrates the persisted lifecycle, generates IDs,
starts and completes runs, records failures, and coordinates repositories.
`TriageTicket` orchestrates the classifiers and `HybridPolicy` without knowing
about HTTP or Prisma.

The runtime includes API-key protection, body and concurrency limits, timeouts,
request correlation, redacted JSON logs, in-memory metrics, `/health`,
`/ready`, graceful shutdown, and reconciliation of stale runs to `ABANDONED`.

## Official evaluation

The frozen held-out benchmark contains 70 synthetic examples. It was run once
on commit `f36e8ef8fcc70be09ab5ba9883efc7c34f3591a2`, using
`qwen2.5:7b-instruct-q5_K_S`, a `120000ms` timeout, and prompt version
`ollama-triage-v3`.

| Metric | Baseline | LLM | Hybrid |
|---|---:|---:|---:|
| Category accuracy | 0.8286 | 0.9571 | 0.9571 |
| Category macro-F1 | 0.8512 | 0.9550 | not emitted |
| Priority accuracy | 0.9000 | 0.9143 | 0.9143 |
| Risk accuracy | 0.9571 | 0.9143 | 0.9143 |
| HIGH/CRITICAL priority recall | 0.7857 | 1.0000 | 1.0000 |
| HIGH risk recall | 0.5714 | 0.7143 | 0.7143 |
| Exact tuple | not emitted | not emitted | 0.8286 |

Hybrid operational results:

- review rate: `0.5143`;
- deterministic/LLM disagreement: `0.3286`;
- fallback rate: `0`;
- LLM failures: none;
- p50/p95/max latency: `6257.7313ms` / `7078.5636ms` /
  `7556.8916ms`;
- review reasons: `HIGH_SEVERITY` 14, `CLASSIFIER_DISAGREEMENT` 23, and
  `LOW_CONFIDENCE` 22.

The LLM improved category accuracy, category macro-F1, and high-priority
recall. The deterministic baseline retained higher risk accuracy (`0.9571` vs
`0.9143`). The quality gain came with approximately 6–7 seconds of latency per
ticket.

## Limitations

- synthetic dataset with only 70 examples;
- one local model;
- one official run;
- confidence is heuristic, not a calibrated probability;
- no independent human-review ground truth exists in the held-out set;
- review rate and review reasons are not precision/recall;
- suggested-team correctness was not emitted;
- standalone LLM, persistence, and HTTP latency were not emitted;
- no validation under real production traffic;
- the adversarial baseline result was category `0.5`, priority `0.5`, and risk
  `0.75`, with no subsequent tuning.

## Evidence and reproduction

- [README](../README.md)
- [Methodology](evaluation/phase7-methodology.md)
- [Official report](evaluation/official-held-out-f36e8ef.md)
- [JSON artifact](../artifacts/official-held-out-f36e8ef.json)
- [Architecture](architecture/hybrid-policy.md)
- [Datasets](../datasets/README.md)
- [Tests](../tests/)
- [Migrations](../prisma/migrations/)
- [CI](../.github/workflows/ci.yml)

## Short copy

Software Engineer who built an Applied AI case for operational ticket triage,
combining a deterministic baseline, a local LLM, and a hybrid policy with
fallback, human review, and an audit trail. On a frozen 70-ticket held-out
benchmark, category accuracy increased from 82.9% to 95.7%, with explicit risk
and latency trade-offs.
