# Session Handoff — OPS TRIAGE AI

## Estado final

A FASE 1 — FOUNDATION e a FASE 2 — DETERMINISTIC BASELINE + EVALUATION estão
concluídas. A implementação pré-integração real da FASE 3 — LLM CLASSIFIER
COM OLLAMA está concluída e validada pela CI. A integração com o modelo real
ainda não foi executada.

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
Ollama. Não há HybridPolicy, TriageDecision, persistência ou feedback.

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

## Fase 3 — estado pré-integração real

- `OllamaTriageClassifier` implementa o port `TriageClassifier` como adapter de
  infraestrutura, sem acoplar Domain ou Application ao Ollama.
- Provider padrão `deterministic`; Ollama exige ativação explícita com
  `TRIAGE_CLASSIFIER=ollama`.
- Endpoint, modelo e timeout do Ollama são configurados por ambiente.
- Prompt v1 pequeno e versionado, com tarefa fechada, enums permitidos,
  structured output e ticket tratado explicitamente como dado não confiável.
- Resposta do modelo validada por schema Zod estrito no adapter.
- Timeout, indisponibilidade e resposta inválida são convertidos nos erros
  genéricos da Application e mapeados na borda HTTP.
- Cliente HTTP injetável permite testes unitários sem Ollama real.
- CLI de evaluation reutiliza `evaluateTriage`; há entrypoint separado para a
  integração real.
- O modelo candidato é `qwen2.5:7b-instruct-q5_K_S`.

### Commits

- `35a51a4` — feat: add Ollama triage classifier adapter
- `3cbdcb9` — feat: add Ollama evaluation and integration entrypoints
- `b9ebdd9` — fix: tighten Ollama prompt and timeout handling

### CI pré-integração real

GitHub Actions run `34781093498` no commit `b9ebdd9`:

- QUALITY: PASS
  - install
  - Prisma generate 7.10.0
  - typecheck
  - lint
  - 62 unit tests
  - deterministic eval:dev, 42 exemplos e todas as métricas em 1.0000
  - build
- INTEGRATION: PASS
  - PostgreSQL 16 real e saudável
  - Prisma generate 7.10.0
  - 3 integration tests
  - conexão real ao banco, `GET /health` com HTTP 200 e DB up, e endpoint de
    triagem determinístico

Não foram executados download do modelo, integração real com Ollama,
`eval:ollama:dev` ou `eval:ollama:heldout`. A baseline, os datasets e o
benchmark held-out permanecem inalterados.

## Próximo marco

Confirmar RAM, espaço em disco e GPU do host que executará o Ollama. Depois,
baixar o modelo candidato e executar somente a integração real explicitamente
aprovada. Não executar o held-out antes de congelar prompt, modelo e
configuração da primeira versão do classifier LLM. Não implementar
HybridPolicy, persistência ou outras fases.
