# Official held-out evaluation — f36e8ef

The frozen held-out run was executed once on datasets/triage-eval.jsonl.
The machine-readable source is artifacts/official-held-out-f36e8ef.json.

Run metadata:

- commit: f36e8ef8fcc70be09ab5ba9883efc7c34f3591a2
- model: qwen2.5:7b-instruct-q5_K_S
- timeout: 120000ms
- prompt: ollama-triage-v3
- examples: 70
- generated: 2026-09-15T01:50:48.287Z

## Classification results

| Metric | Deterministic | LLM | Hybrid |
|---|---:|---:|---:|
| Category accuracy | 0.8286 | 0.9571 | 0.9571 |
| Category macro-F1 | 0.8512 | 0.9550 | not emitted |
| Priority accuracy | 0.9000 | 0.9143 | 0.9143 |
| Risk accuracy | 0.9571 | 0.9143 | 0.9143 |
| HIGH/CRITICAL priority recall | 0.7857 | 1.0000 | 1.0000 |
| HIGH risk recall | 0.5714 | 0.7143 | 0.7143 |
| Exact category/priority/risk tuple | not emitted | not emitted | 0.8286 |

Relative to the deterministic baseline, the LLM/hybrid improved category
accuracy by 12.85 percentage points, priority accuracy by 1.43 points, HIGH /
CRITICAL priority recall by 21.43 points, and HIGH-risk recall by 14.29
points. Risk accuracy decreased by 4.28 points.

## Operational results

- Hybrid decision source: HYBRID for 70/70 examples.
- Fallback rate: 0.
- LLM failures: none.
- Deterministic/LLM disagreement: 0.3286.
- Review rate: 0.5143.
- Review reasons:
  - HIGH_SEVERITY: 14
  - CLASSIFIER_DISAGREEMENT: 23
  - LOW_CONFIDENCE: 22
- Hybrid latency: p50 6257.7313ms, p95 7078.5636ms, max 7556.8916ms.

Human-review precision and recall are intentionally absent: the frozen
held-out dataset has no independent shouldRequireHumanReview ground truth.

Suggested-team correctness, persistence-vs-classification latency, and
HTTP-level latency were not emitted by this artifact and must not be inferred
from the classification metrics.

## Limitations

- The hybrid harness did not emit standalone LLM latency in this run.
- The artifact has no per-example predictions, so suggested-team correctness
  cannot be reconstructed after the run.
- Review rate and review reasons are descriptive, not precision/recall claims.
- The result is one frozen run and does not establish LLM variance.
