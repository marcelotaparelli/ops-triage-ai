# Laya evaluation protocol (pre-held-out freeze)

This is an evaluation-only, local Python/PyTorch experiment. It neither imports
the application runtime nor changes `TriageClassifier`, Ollama, the HTTP flow,
or `HybridPolicy`. The final report and machine-readable result are written only
after the committed freeze and one held-out execution.

## Primary sources and checkpoint decision

- [Official Laya repository](https://github.com/NandhaKishorM/laya),
  [v0.3.23 release](https://github.com/NandhaKishorM/laya/releases/tag/v0.3.23),
  [Python package specification](https://github.com/NandhaKishorM/laya/blob/v0.3.23/pyproject.toml),
  and [Apache-2.0 license](https://github.com/NandhaKishorM/laya/blob/v0.3.23/LICENSE).
- [English base model card](https://huggingface.co/convaiinnovations/laya),
  [multilingual model card](https://huggingface.co/convaiinnovations/laya-multilingual),
  and [typed-decisions model card](https://huggingface.co/convaiinnovations/laya-typed-decisions).
- [Official batching and confidence documentation](https://github.com/NandhaKishorM/laya/blob/v0.3.23/README.md#batch-mode-score-many-states-in-one-forward-pass).

The selected **principal checkpoint** is `convaiinnovations/laya` at Hub revision
`55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`, loaded by the official
`laya==0.3.23` Python package. This is the general English base checkpoint,
used **zero-shot on Ops Triage**. The English-only dataset makes the multilingual
checkpoint less directly suited to this principal comparison. The published
`laya-typed-decisions` checkpoint has been fine-tuned on four other synthetic
workflows (including customer service and security incidents). It has never
been trained on these 70 tickets, but its specialised training would change the
interpretation of an off-the-shelf result. It is not a post-hoc alternative
chosen after seeing held-out scores and will not be run in this official
evaluation. The base checkpoint's official card reports weak zero-shot typed
decision accuracy on its own benchmark; this is a known risk, not a reason to
switch checkpoints after evaluation.

The base checkpoint has 421M parameters and a default 512-token context,
including question and options; the option head budget is 192 tokens. The
runtime can silently truncate state, so this harness rejects any result whose
usage reports dropped state tokens or collapsed options. The checkpoint's
`model.safetensors` is 842,609,210 bytes, SHA-256
`891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c`.
No quantisation, compilation, temperature refit, training, or fine-tuning is
used. CPU fp32 is pinned because the available environment exposes no GPU.

The official `choice` output supplies the selected option, full distribution,
`answer_confidence` (rounded top-option probability), and `confidence`
(one minus normalised entropy). These are separate values. The official
documentation warns that shipped checkpoints can be over-confident; an
out-of-range temperature for the 11+ choice-options bucket is clamped at load
on this checkpoint. This protocol uses only 7/4/3-option questions and never
overrides calibration. Neither confidence value is assumed to be the empirical
chance of correctness. Probability analysis is descriptive.

## Frozen dataset and scoring

`datasets/triage-eval.jsonl` is the unchanged, synthetic English held-out:
70 unique tickets, SHA-256
`e3864aaefba8327dff78a0e7680df55650c995664e29daea31aaab85abe63ab0`.
The deterministic baseline was frozen at `20d3ccc`; the historical
deterministic/Ollama/hybrid run is `f36e8ef8fcc70be09ab5ba9883efc7c34f3591a2`.
The Jev freeze/run commit is `4c41e0b23478531d872b6537f8a39a400e638fe9`.
The held-out labels are 10 each for the seven categories;
priority LOW/MEDIUM/HIGH/CRITICAL is 40/16/10/4 and risk LOW/MEDIUM/HIGH is
54/9/7. Ground truth and metric definitions are untouched. Failures count in
quality denominators, as in the existing Jev analysis. Macro-F1 includes all
seven categories. Percentiles use nearest rank.

`scripts/laya-config.json` freezes the choice questions, label mapping, option
order, device, token budgets and thresholds. They adapt the pre-existing Jev
and Ollama v3 operational taxonomy to Laya's smaller option-token budget,
before seeing held-out predictions. Only title and description are passed as
state. Every output must contain exactly the three domain choices and complete,
finite distributions summing to one within Laya's four-decimal rounding error.
An invalid or truncated output is a counted failure; no fallback or retry is
performed. The category/priority/risk tuple is correct only if all three
choices match the frozen labels. HIGH/CRITICAL priority recall treats both as
positive, matching the historical metric.

For Brier, the harness averages the sum of squared errors over all labels in
each valid field distribution. ECE has five equal-width bins of top-option
probability; empty bins have no accuracy estimate. The descriptive coverage
table requires all three `answer_confidence` values to meet a predeclared
threshold. These numbers cannot be transferred directly from Jev's separate
`confidence` field. No automation threshold is selected.

## DEV, freeze and execution

The DEV source is `datasets/triage-dev.jsonl` (42 rows). Three IDs were
preselected: `dev-incident-01`, `dev-access-01`, `dev-support-01`. The first
attempt to load the model failed before inference because sandboxed DNS was
unavailable; it produced no artifact or prediction. After permitted network
access, the first DEV smoke produced three valid choices, with two priority
and one risk disagreements versus DEV labels. No accuracy-driven prompt or
mapping changes followed. The next DEV smoke added OS and checkpoint file
metadata; the final smoke added a locked Python dependency list and a separate
official `predict_batch` timing for the same three DEV states. All three
successful smokes are preserved in `artifacts/`, with the last one at
`artifacts/laya-dev-smoke.json`. The final smoke had three valid sequential
results, no truncation/collapsed options, and 3/3 batch-versus-sequential tuple
agreement. Its 3-ticket CPU batch took 5,149.5 ms (0.583 tickets/s); this is
not part of the held-out quality benchmark.

The final DEV environment is Debian 12, Linux x86_64, four AMD EPYC vCPUs,
4.13 GB reported RAM, no exposed GPU, Python 3.11.2, torch 2.5.1+cpu,
transformers 5.18.0, and Laya 0.3.23. The fully pinned tooling dependencies
are in `scripts/laya-requirements.txt`, outside the application dependency
graph. With Python 3.11, install them into a virtual environment using a CPU
PyTorch index, for example:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r scripts/laya-requirements.txt
HF_HOME="$PWD/.cache/huggingface" .venv/bin/python scripts/laya_eval.py dev
```

After the DEV commit and green gates, run `freeze`, commit its manifest, then
run `heldout` **once** with a clean tree. A reservation artifact and append-only
attempt journal are created before model load; the script refuses to overwrite
them. The held-out command uses the cached pinned revision and offline mode:

```bash
HF_HOME="$PWD/.cache/huggingface" HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv/bin/python scripts/laya_eval.py freeze
# commit artifacts/laya-freeze.json, then:
HF_HOME="$PWD/.cache/huggingface" HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv/bin/python scripts/laya_eval.py heldout
```

The quality run scores one ticket at a time. Load time, first inference,
remaining warm inferences, and DEV batch timing are recorded separately.
`/proc/self/status` supplies process resident memory; `/proc/meminfo` supplies
host memory. CPU time and energy are not monetised. Local inference incurs no
external per-token/request API charge, but uses hardware and electricity.
