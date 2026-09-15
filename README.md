# ops-triage-ai

Applied AI case study: a deterministic classifier and a local LLM are combined
behind a hybrid policy for operational ticket triage. The service persists
tickets, runs, decisions, and append-only human feedback in PostgreSQL.

The public case is available in [PT-BR](docs/portfolio-case-pt-br.md) and
[English](docs/portfolio-case-en.md).

## Quickstart

```bash
bun install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres
DATABASE_URL='postgresql://ops:ops_dev_password@localhost:5432/ops_triage?schema=public' bunx prisma migrate deploy
bun run dev
```

Production requires `NODE_ENV=production` and a non-empty `TRIAGE_API_KEY`.
Business routes use `X-API-Key`; `/health` and `/ready` are public probes.

## Verification

Run suites separately:

```bash
bun run typecheck
bun run lint
bun run test:unit
DATABASE_URL='postgresql://ops:ops_dev_password@localhost:5432/ops_triage?schema=public' bun run test:integration
bun run build
```

## Evaluation

The deterministic development evaluation is:

```bash
bun run eval:dev
```

The independent hybrid harness compares deterministic, standalone Ollama, and
hybrid results and reports quality, severity recall, disagreement, fallback,
review reasons, and latency:

```bash
bun run eval:hybrid:dev
bun run eval:human-review:dev
bun run eval:adversarial:dev
```

The Ollama commands require `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, and
`OLLAMA_TIMEOUT_MS`. The frozen held-out dataset is never modified with review
labels. Its official evaluation is a one-time final run after the prompt,
classifiers, policy, model configuration, evaluator, and metric schema are
frozen. See [the Phase 7 methodology](docs/evaluation/phase7-methodology.md).

## Architecture and boundaries

```text
HTTP -> validation/security -> PersistedTriageService -> TriageTicket
                                  -> deterministic + Ollama classifiers
                                  -> HybridPolicy -> TriageDecision
       Prisma/PostgreSQL <- run state, decision and append-only feedback
```

`PersistedTriageService` orchestrates persisted lifecycle, IDs, run states and
repositories. `TriageTicket` orchestrates the classifiers and `HybridPolicy`.

The runtime has request correlation, structured redacted logs, in-memory
metrics, readiness, graceful shutdown, and stale-run reconciliation. The
evaluator is separate from the HTTP entrypoint and audit validation is pure.

## Evaluation evidence

- [Architecture notes](docs/architecture/hybrid-policy.md)
- [Phase 7 methodology](docs/evaluation/phase7-methodology.md)
- [Official held-out report](docs/evaluation/official-held-out-f36e8ef.md)
- [Official held-out artifact](artifacts/official-held-out-f36e8ef.json)
- [PT-BR portfolio case](docs/portfolio-case-pt-br.md)
- [English portfolio case](docs/portfolio-case-en.md)

Known limitations include local-model variability, in-memory metrics lost on
restart, and declared rather than federated human reviewer identity. This is
not a SaaS product and intentionally has no frontend, RAG, agents, or vector
database.
