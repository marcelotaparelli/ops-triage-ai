# Laya English base checkpoint: frozen held-out evaluation

This report describes one isolated evaluation on the same 70 synthetic English
tickets used by the historical deterministic, Ollama and Jev experiments. It
does not change the production runtime or `HybridPolicy`. The [protocol and
primary-source review](laya-protocol.md), [freeze manifest](../../artifacts/laya-freeze.json),
[full result](../../artifacts/laya-held-out.json), [attempt journal](../../artifacts/laya-held-out-attempts.jsonl),
and [complete Laya error list](laya-errors.md) are part of the evidence.

## Reproducibility and execution

| Item | Observed/frozen value |
| --- | --- |
| Main comparison | General English `convaiinnovations/laya`, **zero-shot for Ops Triage** |
| Checkpoint revision | `55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851` |
| Weight file | 842,609,210 bytes; SHA-256 `891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c` |
| License | Apache-2.0, per official repository/model card |
| Library/runtime | `laya==0.3.23`, Python 3.11.2, PyTorch 2.5.1+cpu, transformers 5.18.0 |
| Inference | Official Python `laya.load(..., revision=...)` and `Agent.predict`; CPU, fp32, 4 torch threads; no compile, quantisation, temperature override or batching in quality run |
| Questions | Three `choice` questions, 7/4/3 labels; exact text in the freeze manifest; 512-token context, 192-token option budget |
| DEV | 42 available; preselected three-ticket smoke; 3/3 final sequential and 3/3 batch outputs valid, no state or option truncation |
| DEV implementation changes before freeze | Added OS/checkpoint-file metadata, a locked Python dependency list, and separate official batch timing. Earlier smoke artifacts retained. No accuracy-driven prompt, mapping, threshold or checkpoint changes. |
| DEV implementation commit | `e39d25e98d56440bad85834dc684ad88b0e57402` |
| Freeze/execution commit | `a9725eaf341a52bb21e4c68a4591b90c9ce2beb0` |
| Frozen dataset | `datasets/triage-eval.jsonl`; 70 unique tickets; SHA-256 `e3864aaefba8327dff78a0e7680df55650c995664e29daea31aaab85abe63ab0` |
| Ground truth | 10 per category; priority LOW/MEDIUM/HIGH/CRITICAL 40/16/10/4; risk LOW/MEDIUM/HIGH 54/9/7; unchanged |
| Official run | 2026-10-02 UTC; one `run_started`, 70 unique `attempt_started`, 70 `attempt_finished`, one `run_completed`; no retries/discarded held-out calls |
| Outputs | 70 valid choices, 0 model failures, 0 schema failures, 0 truncated inputs, 0 collapsed-option outputs |

The alternative `laya-typed-decisions` checkpoint was not run here. It is
fine-tuned on four external synthetic workflows, including customer service and
security incidents, and would represent a different transfer-learning question.
It was excluded before the held-out run. The multilingual base checkpoint was
also excluded because this benchmark is English. The official [English model
card](https://huggingface.co/convaiinnovations/laya) documents weak zero-shot
typed-decision performance on its own dataset; the published 0.766 figure
belongs to the [specialised checkpoint](https://huggingface.co/convaiinnovations/laya-typed-decisions)
trained on that benchmark's training split, not this model.

## Classification quality

All columns below use the same frozen labels. `—` means the historical
artifact did not emit that metric. Standalone classifier results and the
`HybridPolicy` path are distinct. Laya failures would count as incorrect in
quality denominators; none occurred.

| Metric | Deterministic standalone, historical | Ollama standalone, historical | Hybrid, historical | Jev 1.13 standalone | Laya standalone |
| --- | ---: | ---: | ---: | ---: | ---: |
| Category accuracy | 0.8286 | 0.9571 | 0.9571 | 1.0000 | 0.8429 (59/70) |
| Category macro-F1 | 0.8512 | 0.9550 | — | 1.0000 | 0.8377 |
| Priority accuracy | 0.9000 | 0.9143 | 0.9143 | 0.9857 | 0.3143 (22/70) |
| Risk accuracy | 0.9571 | 0.9143 | 0.9143 | 0.9571 | 0.6286 (44/70) |
| HIGH/CRITICAL priority recall | 0.7857 | 1.0000 | 1.0000 | 1.0000 | 0.9286 (13/14) |
| HIGH risk recall | 0.5714 | 0.7143 | 0.7143 | 0.8571 | 0.5714 (4/7) |
| Exact category/priority/risk tuple | — | — | 0.8286 | 0.9429 (66/70) | 0.1143 (8/70) |

The historical deterministic/Ollama/hybrid values come from the [official
held-out artifact](../../artifacts/official-held-out-f36e8ef.json) at commit
`f36e8ef8fcc70be09ab5ba9883efc7c34f3591a2`. The historical exact-tuple
0.8286 is **hybrid only**; neither standalone deterministic nor standalone
Ollama emitted an exact-tuple result. Jev values come from its [single-run
artifact](../../artifacts/jev-1.13-held-out-4c41e0b.json), frozen at
`4c41e0b23478531d872b6537f8a39a400e638fe9`. Historical values have
not been reconstructed from later code.

## Environment, lifecycle and inference

The run used Debian GNU/Linux 12 (bookworm), Linux 6.12.98, x86_64, a virtual
AMD EPYC CPU with four vCPUs, and no GPU/VRAM/CUDA exposed. `/proc/meminfo`
reported 4,131,598,336 bytes total RAM and 3,576,418,304 bytes available at
measurement. The process RSS before load was 232,935,424 bytes; after load it
was 2,038,161,408 bytes, an increase of about 1,805 MB (1,722 MiB). Peak
process RSS during the run was 2,885,160,960 bytes (2,752 MiB). This is
process memory, not a model-only allocation estimate.

| Measure | Laya CPU standalone | Jev 1.13 hosted standalone | Historical hybrid path |
| --- | ---: | ---: | ---: |
| Cached model load | 4,993.0 ms | Not emitted/client model load not applicable | Not emitted |
| First inference after load | 1,519.0 ms | Not emitted | Not emitted |
| Remaining 69 mean | 1,412.8 ms | Not emitted | Not emitted |
| Inference mean | 1,414.3 ms | 569.4 ms | Not emitted |
| Inference p50 | 1,412.4 ms | 545.5 ms | ~6,257.7 ms |
| Inference p95 | 1,479.7 ms | 712.2 ms | ~7,078.6 ms |
| Inference maximum | 1,519.0 ms | 1,142.2 ms | ~7,556.9 ms |
| Sequential inference throughput | 0.707 tickets/s | Not emitted | Not emitted |
| Total wall time including cached load | 109.2 s (0.641 tickets/s) | Not emitted | Not emitted |

Laya inference latency times each `Agent.predict` call, including local
tokenization, one three-question forward pass, output parsing and validation;
the first inference is separated above. The initial uncached DEV load took
25.6 s including model download, while the final cached DEV load took 5.3 s.
The download phase was not independently timed as a standalone network
measure. The official `predict_batch` API was measured only on the final
three-ticket DEV smoke: 5,149.5 ms for one batch of 3 (0.583 tickets/s), with
3/3 tuple agreement versus sequential calls. It was slower on this small CPU
sample and was not mixed into the held-out quality or latency run.

Jev latency is an end-to-end network/API adapter call under a different
serving environment. Historical hybrid latency includes both classifiers and
policy work; the historical artifact did not emit standalone Ollama latency.
The table records observed timings, not a matched hardware or path comparison.
Deterministic and standalone Ollama latency were not emitted and are not
inferred.

## External usage charge and infrastructure

Laya inference was local after the checkpoint download, with **USD 0 external
per-token/request model API charges** for 70 tickets. It used this four-vCPU,
roughly 4-GB-RAM virtual environment for 109.2 seconds of wall time and up to
2.89 GB process RSS. The instance type, cloud region, rental price, electricity
and CPU energy were not available, so infrastructure/energy cost is **not
monetised**. This is not a claim of zero total cost. Jev's API-reported hosted
usage cost was USD 0.003789618 for its 70 requests and 90,229 reported input
tokens. The historical deterministic/Ollama paths did not emit equivalent
usage or infrastructure cost.

## Probability, confidence and exploratory coverage

Laya's `confidence` is one minus normalised entropy for `choice` outputs;
`answer_confidence` is the top-choice probability after the checkpoint's
shipped temperature scaling. The harness retained both and the complete
four-decimal distributions for every field. Brier is the mean sum of squared
errors over all options; ECE has five top-probability bins. Both use all 70
valid decisions per field. Neither statistic proves calibration in future
traffic.

| Field | Mean top probability | Mean entropy confidence | Mean top-1/top-2 margin | Brier | Top-probability ECE | Wrong-field mean top probability |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Category | 0.8026 | 0.6644 | 0.7048 | 0.1954 | 0.0600 | 0.5210 (11 errors) |
| Priority | 0.6121 | 0.2805 | 0.3850 | 0.7921 | 0.3160 | 0.6233 (48 errors) |
| Risk | 0.6265 | 0.2751 | 0.3173 | 0.4863 | 0.0838 | 0.6123 (26 errors) |

For context, Jev's [published run](jev-1.13-held-out-4c41e0b.md) reported
Brier 0.0005/0.0386/0.0800 and ECE 0.0054/0.0329/0.0226 for
category/priority/risk using the same per-field definitions. Jev's reported
`confidence` is distinct from Laya's entropy confidence; numeric thresholds
on those two fields are not equivalent. Both sets of ECE values are unstable
with only 70 observations and sparse bins. The Laya artifact contains every
bin count and per-ticket value.

Some wrong choices had high top probability: `eval-bug-09` predicted MEDIUM
risk instead of LOW at 0.8810; `eval-incident-05` predicted CRITICAL priority
instead of HIGH at 0.8050, and HIGH risk instead of MEDIUM at 0.8002. Correct
choices can also have low top probability: seven correct priority labels were
below 0.5 (minimum 0.3618), and three correct risk labels were below 0.5.
This is evidence about these outputs, not evidence that the values are
probabilities of real-world correctness.

The predeclared descriptive gate requires all three Laya **top probabilities**
to meet the threshold. It does not alter predictions or set a production
threshold. Jev's earlier coverage table gated on its separate reported
`confidence`, so equal numeric thresholds should not be interpreted as a
like-for-like automation policy.

| Laya threshold | Selected / 70 | Coverage | Selected exact tuple accuracy |
| ---: | ---: | ---: | ---: |
| 0 | 70 | 100.00% | 11.43% |
| 0.5 | 49 | 70.00% | 8.16% |
| 0.7 | 5 | 7.14% | 0.00% |
| 0.8 | 1 | 1.43% | 0.00% |
| 0.9 | 0 | 0.00% | undefined |
| 0.95 | 0 | 0.00% | undefined |
| 0.99 | 0 | 0.00% | undefined |

## Error observations and limits of attribution

The [complete 62-ticket list](laya-errors.md) gives each frozen label tuple,
Laya tuple, wrong fields and Jev tuple status. Historical deterministic and
Ollama artifacts hold only aggregates, so their per-ticket overlap cannot be
established. Jev missed four tuples; Laya and Jev both missed
`eval-incident-06`, `eval-incident-10` and `eval-access-03`, while Jev alone
missed `eval-bug-08` (which Laya got right). This is descriptive overlap.

Observed patterns:

- All 40 LOW-priority tickets were predicted MEDIUM. Five HIGH tickets were
  predicted CRITICAL; one CRITICAL ticket was predicted MEDIUM. The 13/14
  HIGH/CRITICAL recall therefore coexists with low overall priority accuracy.
- Risk errors comprised 19 LOW→MEDIUM, four MEDIUM→HIGH and three HIGH→MEDIUM.
  The three HIGH misses were `eval-incident-06`, `eval-bug-07` and
  `eval-access-08`.
- The 11 category errors were four SUPPORT, four ACCESS, two FEATURE_REQUEST
  and one CONTENT_CHANGE. Examples include guidance requests mapped to OTHER
  and access problems mapped to BUG or INCIDENT. INCIDENT, BUG and OTHER were
  each 10/10 on category in this run.
- Text lengths were short across the dataset. Mean character length for
  correct versus wrong priority was 55.27 versus 55.27; no state or option
  truncation was reported. This sample offers no evidence about long-ticket
  behavior.

One hypothesis is that the model's current question representation or
checkpoint favors MEDIUM over LOW for priority. The 40/40 LOW→MEDIUM pattern
supports the observation, but this single run cannot isolate whether the
checkpoint, instructions, option order, calibration or synthetic wording caused
it. The category confusion on access and support can also reflect vocabulary
or ambiguity, but no causal attribution was tested. No questions, mapping,
thresholds or checkpoint were changed after these errors were observed.

## Limitations and verification

The dataset is synthetic, only 70 tickets, domain-specific and English-only;
there is no real traffic or production validation. This is one official
held-out execution on one CPU-only hardware configuration and one exact
zero-shot checkpoint. Its probability bins and coverage subsets are especially
small. The current baseline/Ollama results are historical, not paired
per-ticket raw outputs; serving dates and latency paths differ. No latency
ranking across paths or production automation threshold follows from these
observations.

Before freeze, typecheck, lint, build, all 165 existing TypeScript unit tests,
three PostgreSQL/Bun integration tests and seven new Python harness tests
passed. The final result commit rechecked the frozen hashes, journal counts,
artifact schema, secret scan and `git diff --check`. No application policy,
HTTP behavior, labels or historical artifacts were modified. No push was made.
