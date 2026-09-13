# Deterministic baseline v1

Baseline language: English only.

The deterministic classifier and both synthetic datasets were frozen in commit
`20d3ccc` before the held-out evaluation. The held-out dataset was executed
once. No classifier rule was changed after observing its result.

## Development dataset

Command: `bun run eval:dev`

Examples: 42

| Metric | Result |
| --- | ---: |
| Category accuracy | 1.0000 |
| Category macro-F1 | 1.0000 |
| Priority accuracy | 1.0000 |
| Risk accuracy | 1.0000 |
| HIGH/CRITICAL priority recall | 1.0000 |
| HIGH risk recall | 1.0000 |

The development dataset is available for rule tuning and continuous technical
checks. These results are not held-out performance.

## Held-out dataset

Command executed once: `bun run eval:heldout`

Examples: 70

| Metric | Result |
| --- | ---: |
| Category accuracy | 0.8286 |
| Category macro-F1 | 0.8512 |
| Priority accuracy | 0.9000 |
| Risk accuracy | 0.9571 |
| HIGH/CRITICAL priority recall | 0.7857 |
| HIGH risk recall | 0.5714 |

The held-out benchmark is outside continuous CI. Future changes to it must
create a new benchmark version so this result remains reproducible.
