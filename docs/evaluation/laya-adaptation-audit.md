# Experiment B prerequisite: read-only audit of Experiment A

Audited at commit `2e812fb`, before creating any domain-training data or running training. The frozen 70-ticket file remains `datasets/triage-eval.jsonl`, SHA-256 `e3864aaefba8327dff78a0e7680df55650c995664e29daea31aaab85abe63ab0`. The Experiment A artifact, attempts journal, and report have SHA-256 respectively `75400a5f527ba719ff8b2b82969d3c02134cd1d9d77c9c84710e2d155d904a51`, `e91c1822b596a48c0b82ef7ecbe08cb74451ee7d93b790bb6eeb4a0e1f82de89`, and `7475d6c13066c7914f57aabf3dbd9c4b20079e6d21081ee52794a6bafb35f44e`.

## Mapping audit

`scripts/laya-config.json` defines three `choice` questions. Priority criteria are ordered `LOW | MEDIUM | HIGH | CRITICAL`; category is `INCIDENT | BUG | FEATURE_REQUEST | CONTENT_CHANGE | SUPPORT | ACCESS | OTHER`; risk is `LOW | MEDIUM | HIGH`. The installed Laya 0.3.23 `Agent._to_internal` retains dictionary insertion order. `Agent._decode_answers` obtains `keys = list(criteria.keys())`, selects `keys[int(p.argmax())]`, and zips the same keys to probabilities. No option permutation was configured. `laya.common.build_sequence` serializes the input state as JSON; the adapter supplies only title and description. The adapter's `parse_result` validates choice membership, complete probability keys, probability sum, top choice, and answer confidence, then copies choice and probabilities unchanged. It derives only top-two margin. There is no `LOW` to `MEDIUM` conversion in serialization, the official primitive, or adapter normalization.

The journal stores the **parsed** output, not the untouched native response; its copied choice and probability fields agree with the final artifact. Thus the archived evidence is sufficient to check these mappings, but a byte-for-byte raw native-response audit is unavailable.

| Ticket | Expected priority | Published choice | P(LOW) | P(MEDIUM) | P(HIGH) | P(CRITICAL) | Category choice | Risk choice |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `eval-feature-02` | LOW | MEDIUM | .0987 | .7514 | .0889 | .0611 | FEATURE_REQUEST | LOW |
| `eval-support-01` | LOW | MEDIUM | .1257 | .7700 | .0529 | .0514 | SUPPORT | LOW |
| `eval-other-07` | LOW | MEDIUM | .1235 | .7850 | .0520 | .0394 | OTHER | LOW |

For all three, the top priority probability is MEDIUM, exactly the normalized choice. Their category and risk top probabilities also correspond to the published choices. All 40 expected-LOW priority rows in Experiment A were classified MEDIUM. This audit found no integration bug invalidating the zero-shot result; it did not change or rerun Experiment A.
