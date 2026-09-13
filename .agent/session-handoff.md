# Session Handoff — OPS TRIAGE AI

## Estado final

A FASE 1 — FOUNDATION e a FASE 2 — DETERMINISTIC BASELINE + EVALUATION estão
concluídas. A Fase 3 não foi implementada.

## Fase 2 implementada

- Domain com `TicketInput`, `Category`, `Priority`, `Risk`,
  `SuggestedTeam` e `ClassifierResult`.
- Port `TriageClassifier` assíncrono.
- Application `TriageTicket`, dependente do port.
- `DeterministicTriageClassifier` em
  `src/application/classifiers/deterministic-triage-classifier.ts`.
- Scoring explícito por categoria: frases específicas têm maior peso,
  sinais no título pesam mais que sinais na descrição e desempate só ocorre
  em empate exato.
- Regras de prioridade, risco, equipe, confidence heurística
  (0.50/0.70/0.90) e rationale auditável.
- `POST /tickets/triage` com Zod somente na borda HTTP.
- Datasets sintéticos em inglês:
  `datasets/triage-dev.jsonl` e `datasets/triage-eval.jsonl`.
- Evaluator reproduzível sem thresholds arbitrários.
- `eval:dev` integrado ao job `quality`.
- Held-out fora da CI contínua.

Domain e Application não dependem de Zod, Prisma, PostgreSQL, Bun HTTP ou
Ollama. Não há LLM, HybridPolicy, TriageDecision, persistência ou feedback.

## Commits da Fase 2

- `38ebee2` — feat: add deterministic triage baseline core
- `b8be133` — feat: expose deterministic ticket triage endpoint
- `20d3ccc` — feat: add reproducible triage evaluation
- `3928371` — docs: record deterministic baseline v1 metrics

## CI

GitHub Actions run `34779989863`:

- QUALITY: PASS
  - install
  - Prisma generate
  - typecheck
  - lint
  - 36 unit tests
  - eval:dev
  - build
- INTEGRATION: PASS
  - PostgreSQL real
  - Prisma generate
  - integration tests

## Métricas da baseline v1

### Dev

- category accuracy: 1.0000
- category macro-F1: 1.0000
- priority accuracy: 1.0000
- risk accuracy: 1.0000
- recall HIGH/CRITICAL priority: 1.0000
- recall HIGH risk: 1.0000

### Held-out

- category accuracy: 0.8286
- category macro-F1: 0.8512
- priority accuracy: 0.9000
- risk accuracy: 0.9571
- recall HIGH/CRITICAL priority: 0.7857
- recall HIGH risk: 0.5714

O benchmark held-out está congelado. Ele foi executado uma única vez depois do
congelamento e não deve ser usado para tuning ou ajuste de regras. A principal
limitação observada é o recall de HIGH risk no held-out: 0.5714.

## Próximo marco

Planejar a Fase 3, comparando a baseline determinística com um classifier
baseado em LLM/Ollama. Não iniciar a implementação da Fase 3 a partir deste
handoff.
