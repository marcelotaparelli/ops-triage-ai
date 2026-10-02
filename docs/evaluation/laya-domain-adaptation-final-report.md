# Laya domain adaptation — final evaluation report

## Run identity and freeze

| Item | Value |
| --- | --- |
| Freeze 2 commit | `00a9a64d26e058feac2283493ef234be4f5f3aaf` |
| Freeze 2 manifest SHA-256 | `5637216e695838a9a697c18e04e93cc68d6a716ce5335235dc2230b8f9334930` |
| Pre-freeze preparation commit | `3744c9654a89a9acc061a96ca6abbdf0961f79fd` |
| Corrected AMP training code commit | `db3c97f55cc34d2e3ed5e90fca7b5cd24288a2a9` |
| Official held-out run | One run; 70/70 attempts finished; 0 failures |
| Held-out SHA-256 | `e3864aaefba8327dff78a0e7680df55650c995664e29daea31aaab85abe63ab0` |
| Freeze hash | See `artifacts/laya-adapt-held-out.json` (`freeze_hash`) |
| Selected epoch | 4; selected by the predeclared VALIDATION selector |
| Selected weight SHA-256 | `423cf6a850e77c2e2b4699c02379967be6428bc19c4f836a434cc888e5252fa7` |
| Selected weight size | 842,609,220 bytes; retained outside Git at `.cache/laya-adapt-selected/model.safetensors` |

Freeze 2 records the base model and revision, base weight hash, TRAIN/VALIDATION/held-out hashes, protocol settings, inference configuration, taxonomy labels and mapping, temperature and selective thresholds, hardware/runtime, checkpoint selector, and corrected optimizer accounting. It also records the first training run as methodologically invalid because its scheduler advanced after a GradScaler-skipped update. That run remains in the audit trail; its accuracy did not determine its rejection.

The official inference ran locally on CPU after Freeze 2 was committed. It did not use or depend on the GPU Pod. The result and attempt journal are the single official adapted held-out run; no retry, model change, calibration, threshold adjustment, or prompt change followed it.

## Laya base versus adapted on the same held-out tickets

Both Laya rows below use the same 70 frozen ticket labels. The base values are the existing Experiment A zero-shot result; adapted values are the single post-Freeze-2 run.

| Metric | Laya base zero-shot | Laya domain-adapted |
| --- | ---: | ---: |
| Category accuracy | 0.8429 (59/70) | 0.9714 (68/70) |
| Category Macro-F1 | 0.8377 | 0.9705 |
| Priority accuracy | 0.3143 (22/70) | 0.9429 (66/70) |
| Risk accuracy | 0.6286 (44/70) | 0.9286 (65/70) |
| HIGH/CRITICAL priority recall | 0.9286 (13/14) | 0.8571 (12/14) |
| HIGH risk recall | 0.5714 (4/7) | 1.0000 (7/7) |
| Exact category/priority/risk tuple | 0.1143 (8/70) | **0.8571 (60/70)** |
| Failures | 0/70 | 0/70 |

The adapted model had two category errors, four priority errors, and five risk errors. Some errors affect more than one field, giving ten incorrect tuples.

## Historical model comparison

These historical deterministic, Ollama, and Jev numbers are reported as recorded; they were not rerun or recalculated here. “—” means that the historical source did not emit that metric.

| Metric | Deterministic | Ollama v3 | Jev 1.13 | Laya zero-shot | Laya adapted |
| --- | ---: | ---: | ---: | ---: | ---: |
| Category accuracy | 0.8286 | 0.9571 | 1.0000 | 0.8429 | 0.9714 |
| Category Macro-F1 | 0.8512 | 0.9550 | 1.0000 | 0.8377 | 0.9705 |
| Priority accuracy | 0.9000 | 0.9143 | 0.9857 | 0.3143 | 0.9429 |
| Risk accuracy | 0.9571 | 0.9143 | 0.9571 | 0.6286 | 0.9286 |
| HIGH/CRITICAL priority recall | 0.7857 | 1.0000 | 1.0000 | 0.9286 | 0.8571 |
| HIGH risk recall | 0.5714 | 0.7143 | 0.8571 | 0.5714 | 1.0000 |
| Exact tuple accuracy | — | — | 0.9429 | 0.1143 | 0.8571 |

The standalone historical deterministic and Ollama classifiers did not emit exact-tuple accuracy. The historical Ollama hybrid tuple score is not substituted because it measures a different decision path. Jev received no training specific to this domain. Laya adapted was fine-tuned on 1,120 domain-specific TRAIN tickets. Any numerical comparison therefore reflects different training exposure and does not establish general superiority.

## LOW → MEDIUM

On the shared held-out set, **40/40 expected LOW** priorities were classified MEDIUM by Laya base zero-shot; the adapted model classified **0/40** as MEDIUM. Jev also had 0/40 LOW→MEDIUM errors in its historical result.

For context, VALIDATION showed the same direction: base Laya had 131/135 LOW→MEDIUM errors, while the selected adapted checkpoint had 0/135. This VALIDATION result was used only within the predeclared selection process; it was not used to alter the model after Freeze 2.

## TRAIN → VALIDATION → HELD-OUT

The splits retain separate roles: TRAIN measures fit, VALIDATION supported checkpoint selection, and HELD-OUT was evaluated once after Freeze 2.

| Split / checkpoint | N | Category accuracy | Category Macro-F1 | Priority accuracy | Risk accuracy | High/critical recall | High-risk recall | Exact tuple |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TRAIN, selected epoch 4 | 1,120 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| VALIDATION, selected epoch 4 | 280 | 0.9821 | 0.9756 | 0.9536 | 0.9857 | 0.9014 | 1.0000 | 0.9250 |
| HELD-OUT, selected epoch 4 | 70 | 0.9714 | 0.9705 | 0.9429 | 0.9286 | 0.8571 | 1.0000 | 0.8571 |

Exact-tuple accuracy changes by −7.50 percentage points from TRAIN to VALIDATION and −6.79 points from VALIDATION to HELD-OUT. TRAIN is perfectly fit and has confidence 1.0 for all three fields; held-out exact tuple is 0.8571. These are observed split differences, not estimates of production performance. VALIDATION shares authored scenario families with TRAIN; the frozen sample has 70 synthetic tickets.

## Calibration, confidence, and selective coverage

Laya held-out per-field values:

| Field | Mean answer confidence | Multiclass Brier | Top-label ECE |
| --- | ---: | ---: | ---: |
| Category | 0.99986 | 0.05715 | 0.02844 |
| Priority | 0.99997 | 0.11429 | 0.05711 |
| Risk | 0.99884 | 0.13841 | 0.07027 |

Confidence is nearly saturated despite ten incorrect tuples. The Brier and ECE values describe this 70-ticket sample and do not establish calibration on future traffic. For reference, the base Laya held-out mean confidence / Brier / ECE were category 0.80257 / 0.19538 / 0.06000; priority 0.61205 / 0.79213 / 0.31600; risk 0.62650 / 0.48634 / 0.08384.

The predeclared selective thresholds were retained unchanged. Coverage and exact-tuple accuracy for both Laya checkpoints were:

| Confidence threshold | Base selected / coverage | Base exact tuple | Adapted selected / coverage | Adapted exact tuple |
| ---: | ---: | ---: | ---: | ---: |
| 0.00 | 70 / 100.00% | 0.1143 | 70 / 100.00% | 0.8571 |
| 0.50 | 49 / 70.00% | 0.0816 | 70 / 100.00% | 0.8571 |
| 0.70 | 5 / 7.14% | 0.0000 | 70 / 100.00% | 0.8571 |
| 0.80 | 1 / 1.43% | 0.0000 | 70 / 100.00% | 0.8571 |
| 0.90 | 0 / 0.00% | — | 70 / 100.00% | 0.8571 |
| 0.95 | 0 / 0.00% | — | 69 / 98.57% | 0.8696 |
| 0.99 | 0 / 0.00% | — | 69 / 98.57% | 0.8696 |

No threshold was selected or changed using held-out outcomes.

Jev's historical report recorded mean API confidence of 0.9927 / 0.9363 / 0.8996, Brier 0.0005 / 0.0386 / 0.0800, and ECE 0.0054 / 0.0329 / 0.0226 for category / priority / risk. Jev API confidence and Laya's answer confidence are produced by different systems and are not assumed to be equivalent.

Laya calibration by split (confidence / Brier / ECE):

| Split | Category | Priority | Risk |
| --- | --- | --- | --- |
| TRAIN | 1.00000 / 0.00000 / 0.00000 | 1.00000 / 0.00000 / 0.00000 | 1.00000 / 0.00000 / 0.00000 |
| VALIDATION | 0.99009 / 0.03341 / 0.01755 | 0.99753 / 0.09410 / 0.04878 | 0.99970 / 0.02843 / 0.01399 |
| HELD-OUT | 0.99986 / 0.05715 / 0.02844 | 0.99997 / 0.11429 / 0.05711 | 0.99884 / 0.13841 / 0.07027 |

## Latency, throughput, and cost

The Laya measurements below used local CPU inference on the final checkout (`torch 2.5.1+cpu`, four threads). They include per-request inference latency; `wall time` additionally includes model load.

| Model | Mean request latency | p50 | p95 | Max | Sequential throughput | Wall including load |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Laya base zero-shot | 1,414 ms | 1,412 ms | 1,480 ms | 1,519 ms | 0.707 req/s | 109.16 s |
| Laya adapted | 1,619 ms | 1,618 ms | 1,690 ms | 1,769 ms | 0.618 req/s | 121.07 s |
| Jev 1.13 historical | 569 ms mean | 546 ms | 712 ms | 1,142 ms | — | — |

Jev latency is a historical network/API measurement under a different serving path. Deterministic standalone latency and Ollama standalone latency were not emitted. Historical Ollama hybrid latency is not treated as standalone model latency.

The Pod rate recorded from the user's deployment was approximately **US$0.27/GPU-hour**, or **US$0.28/hour with container disk**. Measured GPU task time was 481.81 s for base VALIDATION, 523.84 s for the first anomalous train/evaluation run, and 517.86 s for the corrected train/evaluation run: **1,523.51 s (25m24s; 0.4232 h)** total. This gives an estimated **US$0.1185** at the deployment rate (US$0.1143 at the GPU-only rate). This is an estimate from measured task durations; it excludes environment setup, provider startup, and idle time. Exact total billed Pod time/invoice was unavailable. The official adapted held-out pass ran locally on CPU and added no GPU Pod time.

## Per-ticket error comparison with Jev

Both artifacts contain rows for the same 70 ticket IDs. There were **no shared incorrect exact tuples** between adapted Laya and Jev. Adapted Laya had ten tuple errors; Jev had four.

| Expected tuple | Ticket IDs where adapted Laya was wrong | Ticket IDs where Jev was wrong |
| --- | --- | --- |
| ACCESS / MEDIUM / LOW | `eval-access-02`, `eval-access-06`, `eval-access-09` | — |
| ACCESS / CRITICAL / HIGH | `eval-access-08` | — |
| ACCESS / MEDIUM / MEDIUM | — | `eval-access-03` |
| BUG / MEDIUM / LOW | `eval-bug-04` | — |
| BUG / MEDIUM / MEDIUM | — | `eval-bug-08` |
| BUG / CRITICAL / HIGH | `eval-bug-07` | — |
| INCIDENT / HIGH / MEDIUM | `eval-incident-05` | — |
| INCIDENT / CRITICAL / HIGH | `eval-incident-09` | — |
| INCIDENT / HIGH / HIGH | — | `eval-incident-06`, `eval-incident-10` |
| OTHER / LOW / LOW | `eval-other-08`, `eval-other-10` | — |

## Run accounting, artifacts, and limitations

- Freeze 2 was committed before held-out inference. The final result records that freeze commit and the held-out dataset SHA.
- The attempt journal has one `run_started`, 70 `attempt_started`, 70 `attempt_finished`, and one `run_completed` event. All 70 attempts finished validly.
- The selected 842,609,220-byte checkpoint is local and outside the Pod. It is intentionally not in Git because the repository has no Git LFS or large-artifact mechanism. Its hash, local path, size, selected epoch, and inference-config hash are in `artifacts/laya-adapt-checkpoint-metadata.json` and Freeze 2.
- The first run's artifacts are committed under `artifacts/laya-adapt-run1-scheduler-anomaly/`. It is retained for audit and rejected only for the scheduler/update validity anomaly, not for its accuracy.
- No training, tuning, calibration, threshold change, prompt change, or checkpoint change occurred after the held-out result. No push was made. The GPU Pod was not destroyed.
- Limits: one frozen set of 70 authored synthetic tickets; different training exposure for Jev and adapted Laya; very high adapted confidence; TRAIN is perfectly fit; VALIDATION scenario families are related to TRAIN; latency was collected on different hardware and at different times; exact Pod billing was unavailable.

Machine-readable artifacts: [Freeze 2](../../artifacts/laya-adapt-freeze.json), [adapted held-out result](../../artifacts/laya-adapt-held-out.json), [attempt journal](../../artifacts/laya-adapt-held-out-attempts.jsonl), [selected training evaluation](../../artifacts/laya-adapt-selected-train.json), and [checkpoint metadata](../../artifacts/laya-adapt-checkpoint-metadata.json).
