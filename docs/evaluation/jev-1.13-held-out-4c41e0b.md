# Jev 1.13 experimental held-out evaluation — 4c41e0b

This is an isolated evaluation of a typed decision model for operational ticket
triage. It does not change the production classifier, Ollama, or HybridPolicy.
The pre-existing [official held-out report](official-held-out-f36e8ef.md) and
its numbers remain historical and unchanged.

## Reproducibility and execution discipline

| Item | Recorded value |
| --- | --- |
| Gateway / provider | OpenRouter / TypeSafe |
| API | `POST https://openrouter.ai/api/alpha/decisions` (alpha) |
| Requested model / version | `typesafe/jev-1.13` / 1.13 |
| Resolved model in all 73 real responses | `typesafe/jev-1.13-20260917` |
| DEV dataset | `datasets/triage-dev.jsonl` (42 available); three preselected smoke tickets |
| DEV calls / result | 3; all valid; zero failures |
| Freeze source commit | `1b6d7ff6229c8b1c022b3c3c682f0567c1a2b498` |
| Freeze commit / held-out execution commit | `4c41e0b23478531d872b6537f8a39a400e638fe9` |
| Frozen at (UTC) | 2026-09-22 20:35:02 |
| Held-out execution (UTC) | 2026-09-22 20:36:32–20:37:12 |
| Dataset | 70 frozen synthetic English tickets; SHA-256 `e3864aaefba8327dff78a0e7680df55650c995664e29daea31aaab85abe63ab0` |
| Held-out runs / requests | 1 / 70; 70 unique IDs; 70 completed journal entries |
| Runtime | Bun 1.4.2, Linux x64; native fetch; existing Zod; no added project dependency |

The [freeze manifest](../../artifacts/jev-1.13-freeze.json) records the exact
question text, criteria, source hash, dataset hash, smoke hash, runtime,
timeout, parser/metrics version, and planned call count. The three `choice`
questions ask category (7 domain options), priority (4), and risk (3). Their
criteria mirror the pre-existing Ollama v3 operational taxonomy: access and
support distinctions; category priority defaults; and explicit production,
security, or data-loss evidence for severe labels. Only title and description
were passed as state. No held-out examples were used to revise the questions.

Configuration: 30,000 ms timeout including body parsing; concurrency 1; zero
application retries; fixed `typesafe/jev-1.13` model; response schema requires
every domain probability, a finite [0,1] confidence, a full distribution summing
to one within 0.0001, and a valid top choice. Failure policy counts failures
as errors, without deterministic substitution. Latency uses `performance.now()`
and nearest-rank percentiles. Metrics and exploratory thresholds were declared
before the held-out call. The [DEV smoke artifact](../../artifacts/jev-1.13-dev-739e6d731cd0.json)
contains the three real DEV responses; the [held-out artifact](../../artifacts/jev-1.13-held-out-4c41e0b.json)
contains every validated decision and probability distribution. The
[attempt journal](../../artifacts/jev-1.13-held-out-attempts.jsonl) records one
run start, 70 starts and 70 finishes. Neither artifact contains the API key.

## Quality on the same frozen labels

| Metric | Deterministic (historical) | Ollama (historical) | Jev 1.13 |
| --- | ---: | ---: | ---: |
| Category accuracy | 0.8286 | 0.9571 | **1.0000** (70/70) |
| Category macro-F1 | 0.8512 | 0.9550 | **1.0000** |
| Priority accuracy | 0.9000 | 0.9143 | **0.9857** (69/70) |
| Risk accuracy | **0.9571** | 0.9143 | **0.9571** (67/70) |
| HIGH/CRITICAL priority recall | 0.7857 | **1.0000** | **1.0000** (14/14) |
| HIGH risk recall | 0.5714 | 0.7143 | **0.8571** (6/7) |
| Exact category/priority/risk tuple | Not emitted for standalone classifier | Not emitted for standalone classifier | **0.9429** (66/70) |

Historical hybrid exact tuple accuracy was 0.8286. It reflects a different
decision path and is therefore not labeled as the standalone Ollama tuple score.
The old quality metrics were not recalculated. The Jev evaluator uses the
existing definitions, including macro-F1 across seven categories and group
recall for HIGH/CRITICAL priority. Four Jev tuples differ from the frozen
labels: one HIGH incident risk was labeled MEDIUM, one HIGH incident priority
was labeled CRITICAL, and two MEDIUM risks were labeled LOW. The HIGH-risk miss
had risk confidence 0.86, demonstrating that a valid typed output and a high
confidence value can coexist with a semantic error.

## Latency, cost, failures and uncertainty

| Measure | Jev standalone (70 requests) | Historical hybrid path |
| --- | ---: | ---: |
| p50 | 545.5 ms | ~6,257.7 ms |
| p95 | 712.2 ms | ~7,078.6 ms |
| Maximum | 1,142.2 ms | ~7,556.9 ms |
| Mean | 569.4 ms | Not emitted |
| API/schema failures | 0/70 | LLM failures: 0/70 |
| Reported input tokens | 90,229 (70/70 responses) | Not emitted |
| API-reported cost | USD 0.003789618 (70/70 responses) | Not emitted |

The DEV smoke separately used 3,869 reported input tokens and USD 0.000162498.
The cost numbers above come from OpenRouter response metadata, not pricing
estimates. Provider-side routing, server load and billing policies are outside
the harness. The hybrid latency includes both classifiers and policy work; the
historical artifact did not emit standalone Ollama latency. Its 6–7 second
latency is **not** a matched standalone Ollama comparison. Deterministic latency
and historical model costs were not emitted and are not inferred. All Jev
latencies are end-to-end adapter calls, including network and validation.

Jev preserved each top choice, its complete probability distribution, the
reported confidence, and the top-1/top-2 probability margin:

| Field | Mean confidence | Mean top probability | Mean margin | Margin minimum | Multiclass Brier | Top-label ECE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Category | 0.9927 | 0.9946 | 0.9893 | 0.82 | 0.0005 | 0.0054 |
| Priority | 0.9363 | 0.9529 | 0.9093 | 0.14 | 0.0386 | 0.0329 |
| Risk | 0.8996 | 0.9346 | 0.8711 | 0.02 | 0.0800 | 0.0226 |

Confidence is an API field distinct from top-choice probability. We did not
assume they are interchangeable. Brier is the mean sum of squared errors across
all choices. ECE uses five equally spaced top-probability bins. For category,
all 70 top probabilities fall into the 0.8–1.0 bin; four lower bins have no
observations. Priority has 2/5/63 examples in the 0.4–0.6 / 0.6–0.8 / 0.8–1.0
bins; risk has 2/8/60. Such sparse bins make the ECE estimates unstable.
These descriptive scores on 70 synthetic tickets do **not** establish domain
calibration or future error rates.

Observed accuracy by reported confidence bucket further illustrates the small
sample. Category has 70/70 correct in the 0.8–1.0 bucket. Priority has 2/2
correct at 0.4–0.6, 7/8 at 0.6–0.8, and 60/60 at 0.8–1.0. Risk has 2/2 at
0.2–0.4, 3/5 at 0.4–0.6, 7/7 at 0.6–0.8, and 55/56 at 0.8–1.0. Empty buckets
carry no accuracy estimate. One incorrect risk label had confidence 0.86.

The following predeclared exploratory gate accepts a ticket only when all three
reported confidences meet the threshold. Coverage uses all 70 tickets:

| Threshold | Selected | Coverage | Observed exact tuple accuracy |
| ---: | ---: | ---: | ---: |
| 0 | 70 | 100.0% | 94.29% |
| 0.5 | 65 | 92.86% | 95.38% |
| 0.7 | 60 | 85.71% | 96.67% |
| 0.8 | 54 | 77.14% | 100.0% |
| 0.9 | 51 | 72.86% | 100.0% |
| 0.95 | 45 | 64.29% | 100.0% |
| 0.99 | 37 | 52.86% | 100.0% |

Per-field threshold tables are in the machine-readable artifact. This is a
post-run description using thresholds fixed before the run, **not** a production
threshold selection. No confidence gate has been added to the application.

## Interpretation and decision gate

Jev showed measurable value on this synthetic frozen sample: better category
and priority quality than both historical classifiers, better HIGH risk recall,
and complete uncertainty distributions at a low reported cost. Deterministic
and Jev tied on overall risk accuracy. The latency observations suggest a fast
remote decision path, but the old hybrid latency is not a like-for-like model
latency measure. Historical failures, cost, and uncertainty are not consistently
available for comparison. All evaluations used the same frozen labels, but were
run at different times and under different serving conditions.

Recommendation: **B — benchmark-only interesting result now**. A separate
study could assess D (first-stage candidate) or E (confidence gate candidate)
with representative operational tickets, repeated runs, reliability/cost limits,
and an interface design that preserves probabilities. The current
`TriageClassifier` also requires summary, rationale and heuristic confidence;
Jev supplies none of those semantics. No standalone replacement or HybridPolicy
integration follows from this one 70-ticket synthetic run. Type/domain
constraints prevent invalid labels from being accepted, but do not guarantee
the label is correct. We make no claim that Jev cannot hallucinate or is
calibrated for this domain.

Validation: 34 Jev unit tests, 156 total tests across 19 files including the
existing PostgreSQL/Bun integration suite, typecheck and lint passed. The
working tree and secret scan are verified in the final commit, not inferred
from model output. No push was made.
