# Jev 1.13 experimental evaluation protocol

Status on 2026-09-22: three real DEV smoke calls completed successfully.
Held-out executions: 0 at the time of this protocol revision. The configuration
is ready to freeze; no held-out result or architectural decision exists yet.
README remains unchanged until actual results exist.

## Offline validation completed

On 2026-09-22: typecheck and lint passed; all 156 tests in 19 files passed
(34 new Jev tests, 119 existing unit tests, three existing integration tests).
Integration ran against a local disposable PostgreSQL 15 database with the
existing migrations and a real Bun server. API request/response tests use
mocked fetch, including independent confidence/probability preservation,
timeout during fetch/body reading, errors, malformed distributions, secret
sanitization, billing metadata, historical metric parity and exclusive run
reservation. The CLI also refused a DEV invocation without `--allow-paid`.
The later live DEV smoke was separate from this offline suite. No live Ollama
model test was run. `git diff --check` passed.

## API and boundary

The [official OpenRouter Decisions reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request)
was checked on 2026-09-22. Use `POST https://openrouter.ai/api/alpha/decisions`,
not chat completions. Request model: `typesafe/jev-1.13`, version 1.13.
The gateway is OpenRouter; the expected provider is TypeSafe. Preserve the
resolved dated model ID from every validated response. This is an alpha API;
schema changes are technical failures to investigate on DEV, not reasons to
silently fall back or change the held-out protocol.

No project dependency or SDK was added. The adapter uses native fetch and the
existing Zod dependency. Bun 1.4.2 and Git were installed as environment tools;
existing dependencies were installed with the frozen lockfile.

`src/evaluation/jev/adapter.ts` defines `JevEvaluationAdapter` and
`JevTriageResult`, separately from `TriageClassifier`:

```text
id, model, provider
answers.category: { type: choice, choice: Category, confidence, probabilities }
answers.priority: { type: choice, choice: Priority, confidence, probabilities }
answers.risk:     { type: choice, choice: Risk, confidence, probabilities }
usage?: { input_tokens?, output_tokens?, cost? }
```

Each distribution must include precisely all domain labels, finite values in
[0,1], sum to one within 0.0001, and a selected choice with maximal probability
(ties allowed). Confidence is a separate finite [0,1] field, preserved without
rounding or mapping to heuristic confidence. Missing metadata stays missing.
There is no summary, rationale, fabricated team, or application policy change.
If a future consumer needs a team, use `suggestedTeamForCategory`.

API errors distinguish timeout, network, authentication (401/403), rate limit
(429), unavailable (5xx), other HTTP failures, malformed JSON, and invalid
responses. Unknown response keys are stripped; missing required answers are
rejected. Error bodies, credentials, underlying fetch errors and Zod diagnostics
are never logged or included in artifacts. Independently valid usage metadata
on invalid decisions is retained; unavailable billing data is not estimated.
No retries or deterministic fallback are performed.

## Questions and DEV

The exact, versioned questions are in `src/evaluation/jev/questions.ts` and are
embedded in every run artifact. Three `choice` questions ask for category,
operational priority, and operational risk. Criteria use the existing Ollama v3
taxonomy, including ACCESS precedence, category defaults, production/broad
impact requirements, and evidence of security compromise or data loss. No
held-out tickets were inspected for wording. Only title and description enter
the request state; expected labels, tags and IDs are excluded.

Available DEV data:

| Dataset | Examples | Use |
| --- | ---: | --- |
| `triage-dev.jsonl` | 42 | Primary taxonomy/integration development |
| `triage-adversarial-dev.jsonl` | 4 | Available adversarial checks; not called |
| `human-review-dev.jsonl` | 6 | Review-policy scenarios; not needed for standalone smoke |

The bounded smoke selects `dev-incident-01`, `dev-access-01`, and
`dev-support-01` from triage DEV. It proves integration, not general quality.
It stops at the first integration failure. All three real calls validated against
the current schema. Each response reported provider `TypeSafe`, resolved model
`typesafe/jev-1.13-20260917`, complete choice distributions, confidence, input
tokens and cost. All three tuples matched DEV labels; this tiny smoke is not
a quality estimate. Observed latency was 537.7–883.7 ms; total reported input
usage was 3,869 tokens and reported cost was USD 0.000162498. The durable DEV
artifact is `artifacts/jev-1.13-dev-739e6d731cd0.json`. Mocked unit tests never
consume API credits.

## Execution and freeze procedure

Supply the credential securely through environment; do not put a value in
commands, logs, fixtures, docs or Git. `.env.example` has a commented empty
placeholder only. From the repository root:

1. Complete tests and commit the reviewed implementation.
2. `bun scripts/evaluate-jev.ts dev --allow-paid`
3. Inspect the DEV artifact. If technical fixes are needed, document the reason,
   preserve every prior artifact and count every request. New source fingerprints
   get distinct DEV artifact names; unchanged sources cannot repeat a smoke.
   No held-out tuning is allowed.
4. Commit the successful DEV artifact and any reviewed code changes. Run
   `bun scripts/evaluate-jev.ts freeze` from a clean tree.
5. Commit `artifacts/jev-1.13-freeze.json`. This HEAD is the freeze commit to
   record in the final report.
6. `bun scripts/evaluate-jev.ts heldout --allow-paid`
7. Review results offline, create the factual comparison report and update README.
   Commit new artifacts/docs, verify clean status, and stop. Do not push.

Freeze requires three validated DEV results from identical sources/configuration.
It records the source hash, code commit, model, all questions/criteria, timeout
(30 seconds including body parsing), parser/metrics sources, runtime, thresholds,
dataset hash, smoke hash, and UTC timestamp. The held-out runner requires clean
Git state, unchanged hashes/configuration and code-commit ancestry. It records
the executing commit, resolved model/provider, UTC times and per-ticket results.
Runtime information includes Bun version, platform and architecture.

Cost guards require explicit `--allow-paid`, three DEV calls or exactly 70
held-out examples, concurrency one, and zero retries. The held-out journal is
created exclusively before the first request and records each attempt before
and after execution. A second run cannot overwrite it. Each completed response
also updates the separate run artifact. An interrupted run remains visibly
incomplete: do not delete its ledger or reuse it for tuning. A technical repeat
requires a documented protocol amendment and preserved incomplete artifacts.
The application does not retry; internal gateway behavior is outside its control.

Planned new outputs:

- `artifacts/jev-1.13-dev-<source-hash>.json`
- `artifacts/jev-1.13-freeze.json`
- `artifacts/jev-1.13-held-out-attempts.jsonl`
- `artifacts/jev-1.13-held-out-<freeze-commit>.json`
- `docs/evaluation/jev-1.13-held-out-<freeze-commit>.md` (after real results)

Only the DEV artifact exists at this protocol revision. Official
`official-held-out-f36e8ef` files and all datasets remain untouched.

## Predeclared analysis

Quality uses the existing evaluator definitions: category accuracy, macro-F1
over all seven categories (zero denominator yields zero), priority/risk accuracy,
HIGH-or-CRITICAL group recall, and HIGH risk recall. Final quality metrics round
to four decimals, as before. Exact tuple accuracy requires all three labels
correct. Failed calls count as incorrect/false negatives in the full denominator;
there is no fallback and no silent successful-only quality score. A parity unit
test checks the historical evaluator on shared offline predictions.

Latency uses `performance.now()` around each standalone adapter call, including
parsing. Report nearest-rank p50/p95/max and mean over all attempts, with failures
identified. Do not label historical hybrid latency as Ollama standalone latency.
No additional Ollama run is planned in this preparation.

Preserve every distribution, choice, confidence and top-1/top-2 margin. Report
multiclass Brier as the mean sum of squared probability errors (not divided by
class count). Top-label ECE uses five equal-width bins of top-1 probability.
Bins are left-inclusive/right-exclusive, except the final bin includes 1.
Separate confidence buckets describe observed accuracy without claiming that
confidence equals probability of correctness. Empty bins/subsets report null.
Calibration analysis uses validated responses only and explicitly reports that
selection limitation; only 70 synthetic English tickets cannot establish domain
calibration, production reliability, or statistically robust subgroup behavior.

Predeclared exploratory confidence thresholds: 0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99.
For each field, report selected count, coverage over **all attempts**, and accuracy
on the selected subset. Tuple selection requires all three confidences to meet
the threshold. Do not optimize thresholds on held-out or adopt production gates.
Report usage/cost only from validated API metadata, with reporting counts and
a completeness indicator. Missing cost is null, not a zero-cost assertion.

## Historical comparison to populate after measurement

These values are historical, not recalculated by this experiment:

| Metric | Deterministic | Ollama | Jev |
| --- | ---: | ---: | --- |
| Category accuracy | 0.8286 | 0.9571 | Pending |
| Category macro-F1 | 0.8512 | 0.9550 | Pending |
| Priority accuracy | 0.9000 | 0.9143 | Pending |
| Risk accuracy | 0.9571 | 0.9143 | Pending |
| HIGH/CRITICAL recall | 0.7857 | 1.0000 | Pending |
| HIGH risk recall | 0.5714 | 0.7143 | Pending |

Historical hybrid latency p50 ~6257.7 ms, p95 ~7078.6 ms, max ~7556.9 ms measures
a different path. It is not a matched standalone latency benchmark. Historical
cost/failure/uncertainty metadata must not be invented. Deterministic and current
Ollama heuristic confidence are not directly comparable to Jev distributions.
Shared synthetic held-out labels enable quality comparison, but different dates,
hardware, remote service conditions and architectures limit latency/cost claims.

Type/domain constraints prevent out-of-domain outputs from being accepted; they
do **not** guarantee semantic correctness. A valid choice can still be wrong.
Do not claim that Jev cannot hallucinate or is calibrated for this domain.

Decision gate remains pending evidence. After measurement, consider A–F (no role,
benchmark-only, standalone replacement candidate, first-stage candidate,
confidence gate candidate, hybrid candidate) without declaring an overall winner
or implementing any integration. Ollama and HybridPolicy remain as they are.
