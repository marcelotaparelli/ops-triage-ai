# Triage datasets

Both datasets contain synthetic English-only tickets. Each JSONL row has a
unique `id`, an `input`, expected category/priority/risk labels, and tags.

- `triage-dev.jsonl` is available for rule development and regression checks.
- `triage-eval.jsonl` is the frozen held-out benchmark for baseline v1. Do not
  tune rules against individual held-out errors. Any future dataset change must
  create a new benchmark version and preserve the previous result.

Confidence, summary, rationale, and suggested team are not evaluation labels.
The evaluator reports only the approved metrics and has no quality threshold.
