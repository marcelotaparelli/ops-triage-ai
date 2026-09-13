# Ollama classifier v3 experiment freeze

The first Ollama classifier experiment is frozen at implementation commit
`59ae9e7` with the following configuration:

- Prompt version: `ollama-triage-v3`
- Model: `qwen2.5:7b-instruct-q5_K_S`
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
or evaluator tuning will occur before the held-out evaluation. The Ollama v3
held-out evaluation has not been executed.
