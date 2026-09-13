# Session Handoff — OPS TRIAGE AI

## Estado final

As Fases 1 — FOUNDATION, 2 — DETERMINISTIC BASELINE + EVALUATION e 3 — OLLAMA
LLM CLASSIFIER estão concluídas. O experimento Ollama v3 foi congelado e sua
avaliação held-out final foi executada uma única vez.

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

## Fase 3 — Ollama LLM Classifier concluída

- `OllamaTriageClassifier` implementa o port `TriageClassifier` como adapter de
  infraestrutura, sem acoplar Domain ou Application ao Ollama.
- Provider padrão `deterministic`; Ollama exige ativação explícita com
  `TRIAGE_CLASSIFIER=ollama`.
- Endpoint, modelo e timeout do Ollama são configurados por ambiente.
- Prompt v3 pequeno e versionado, com tarefa fechada, enums permitidos,
  structured output e ticket tratado explicitamente como dado não confiável.
- Resposta do modelo validada por schema Zod estrito no adapter.
- Timeout, indisponibilidade e resposta inválida são convertidos nos erros
  genéricos da Application e mapeados na borda HTTP.
- Cliente HTTP injetável permite testes unitários sem Ollama real.
- CLI de evaluation reutiliza `evaluateTriage`; há entrypoint separado para a
  integração real.
- Modelo congelado: `qwen2.5:7b-instruct-q5_K_S`, ID `1a3492b0a1dc`, 5.3 GB.
- Configuração congelada: Ollama 0.34.0, temperature 0 e timeout 120000 ms.
- Integração real com Ollama e structured output validada.
- Diagnóstico DEV opcional expõe somente exemplos divergentes sem persistir
  predições.

### Commits

- `35a51a4` — feat: add Ollama triage classifier adapter
- `3cbdcb9` — feat: add Ollama evaluation and integration entrypoints
- `b9ebdd9` — fix: tighten Ollama prompt and timeout handling
- `c6be0ed` — fix: derive suggested team from category
- `bebce67` — feat: add dev evaluation diagnostics
- `efeaa78` — feat: refine Ollama triage prompt
- `59ae9e7` — feat: refine Ollama triage taxonomy
- `a693e1b` — docs: freeze Ollama v3 experiment

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

### Resultados finais Ollama v3

DEV, 42 exemplos:

- category accuracy: 1.0000
- category macro-F1: 1.0000
- priority accuracy: 0.9048
- risk accuracy: 0.9048
- recall HIGH/CRITICAL priority: 1.0000
- recall HIGH risk: 0.7500

Held-out, 70 exemplos, executado uma única vez após o freeze:

| Métrica | Deterministic v1 | Ollama v3 |
| --- | ---: | ---: |
| Category accuracy | 0.8286 | 0.9571 |
| Category macro-F1 | 0.8512 | 0.9550 |
| Priority accuracy | 0.9000 | 0.9143 |
| Risk accuracy | 0.9571 | 0.9143 |
| Recall HIGH/CRITICAL priority | 0.7857 | 1.0000 |
| Recall HIGH risk | 0.5714 | 0.7143 |

O Ollama v3 melhora fortemente category e os recalls de prioridade grave e
HIGH risk. A baseline determinística mantém melhor risk accuracy geral;
nenhuma abordagem domina todas as métricas. O desempenho held-out permaneceu
próximo do DEV, fornecendo evidência de generalização dentro dos benchmarks
sintéticos. O held-out não deve ser reexecutado para tuning e seus exemplos
não foram inspecionados.

## Próximo marco

Planejar uma fase futura de HybridPolicy usando os trade-offs medidos entre a
baseline determinística e o Ollama v3. Não implementar HybridPolicy,
persistência ou outras fases sem planejamento e aprovação explícitos.
