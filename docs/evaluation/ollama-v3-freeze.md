# Ollama classifier v3 experiment freeze

The first Ollama classifier experiment is frozen at implementation commit
`59ae9e7` with the following configuration:

- Prompt version: `ollama-triage-v3`
- Model: `qwen2.5:7b-instruct-q5_K_S`
- Model ID: `1a3492b0a1dc`
- Model size: 5.3 GB
- Ollama version: `0.34.0`
- Temperature: `0`
- Timeout: `120000 ms`
- Development dataset: `datasets/triage-dev.jsonl`
- Development examples: 42

## Development results

| Metric | Result |
| --- | ---: |
| Category accuracy | 1.0000 |
| Category macro-F1 | 1.0000 |
| Priority accuracy | 0.9048 |
| Risk accuracy | 0.9048 |
| HIGH/CRITICAL priority recall | 1.0000 |
| HIGH risk recall | 0.7500 |

Six development examples diverged from their expected labels. The main
remaining limitation is HIGH risk recall at 0.7500.

No further prompt, model, taxonomy, classifier, schema, temperature, dataset,
or evaluator tuning occurred after this freeze.

## Final held-out comparison

The frozen Ollama v3 experiment was evaluated once on
`datasets/triage-eval.jsonl` with 70 examples. The held-out examples were not
inspected and the evaluation will not be used for further tuning.

| Metric | Deterministic v1 | Ollama v3 | Difference |
| --- | ---: | ---: | ---: |
| Category accuracy | 0.8286 | 0.9571 | +0.1285 |
| Category macro-F1 | 0.8512 | 0.9550 | +0.1038 |
| Priority accuracy | 0.9000 | 0.9143 | +0.0143 |
| Risk accuracy | 0.9571 | 0.9143 | -0.0428 |
| HIGH/CRITICAL priority recall | 0.7857 | 1.0000 | +0.2143 |
| HIGH risk recall | 0.5714 | 0.7143 | +0.1429 |

Ollama v3 strongly improves category classification and improves recall for
HIGH/CRITICAL priority and HIGH risk. The deterministic baseline retains
better overall risk accuracy, so neither classifier dominates every metric.
This trade-off motivates evaluating a future HybridPolicy.

Held-out performance remained close to development performance: category
accuracy changed from 1.0000 to 0.9571, category macro-F1 from 1.0000 to
0.9550, priority accuracy from 0.9048 to 0.9143, risk accuracy from 0.9048 to
0.9143, HIGH/CRITICAL priority recall remained 1.0000, and HIGH risk recall
changed from 0.7500 to 0.7143. Within these synthetic benchmarks, this is
evidence that the frozen configuration generalized beyond the development
set.
