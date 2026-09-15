# ops-triage-ai — Case de Applied AI

## Resumo

Este projeto resolve a triagem de tickets operacionais em categoria,
prioridade, risco e equipe sugerida. O sistema combina um baseline
determinístico, um LLM local e uma política híbrida, mantendo fallback,
revisão humana e audit trail persistido.

O baseline determinístico fornece previsibilidade, baixo custo, baixa latência
e uma referência quantitativa. O LLM amplia a cobertura para linguagem menos
estruturada. A `HybridPolicy` combina os sinais e encaminha casos de maior
risco, baixa confiança, indisponibilidade ou divergência para revisão humana.

## Arquitetura

```text
HTTP
  → validação e segurança
  → PersistedTriageService
  → TriageTicket
      → DeterministicTriageClassifier
      → OllamaTriageClassifier
      → HybridPolicy
  → TriageDecision
  → Prisma/PostgreSQL
  → Feedback append-only / Audit Trail
```

`PersistedTriageService` orquestra o lifecycle persistido, gera IDs, inicia e
conclui runs, registra falhas e coordena os repositories. `TriageTicket`
orquestra os classifiers e a `HybridPolicy`, sem conhecer HTTP ou Prisma.

O runtime inclui API key, limites de body e concorrência, timeouts, request
correlation, logs JSON redigidos, métricas em memória, `/health`, `/ready`,
graceful shutdown e reconciliação de runs antigos para `ABANDONED`.

## Avaliação oficial

O benchmark held-out congelado contém 70 exemplos sintéticos. Foi executado
uma única vez no commit `f36e8ef8fcc70be09ab5ba9883efc7c34f3591a2`, usando o
modelo `qwen2.5:7b-instruct-q5_K_S`, timeout de `120000ms` e prompt
`ollama-triage-v3`.

| Métrica | Baseline | LLM | Hybrid |
|---|---:|---:|---:|
| Category accuracy | 0.8286 | 0.9571 | 0.9571 |
| Category macro-F1 | 0.8512 | 0.9550 | não emitido |
| Priority accuracy | 0.9000 | 0.9143 | 0.9143 |
| Risk accuracy | 0.9571 | 0.9143 | 0.9143 |
| Recall HIGH/CRITICAL | 0.7857 | 1.0000 | 1.0000 |
| Recall HIGH risk | 0.5714 | 0.7143 | 0.7143 |
| Exact tuple | não emitido | não emitido | 0.8286 |

Resultados operacionais do híbrido:

- review rate: `0.5143`;
- divergência determinístico/LLM: `0.3286`;
- fallback: `0`;
- falhas LLM: nenhuma;
- latência p50/p95/máxima: `6257.7313ms` / `7078.5636ms` /
  `7556.8916ms`;
- review reasons: `HIGH_SEVERITY` 14, `CLASSIFIER_DISAGREEMENT` 23 e
  `LOW_CONFIDENCE` 22.

O LLM melhorou category accuracy, category macro-F1 e recall de prioridades
altas. O baseline manteve maior risk accuracy (`0.9571` contra `0.9143`).
O ganho veio com latência de aproximadamente 6–7 segundos por ticket.

## Limitações

- dataset sintético com apenas 70 exemplos;
- um único modelo local;
- uma única execução oficial;
- confidence é heurística, não probabilidade calibrada;
- não há ground truth independente de human review no held-out;
- review rate e review reasons não são precision/recall;
- suggested-team correctness não foi emitido;
- latência de LLM isolado, persistência e HTTP não foi emitida;
- não houve validação sob tráfego de produção real;
- o resultado adversarial do baseline foi category `0.5`, priority `0.5` e
  risk `0.75`, sem tuning posterior.

## Evidências e reprodução

- [README](../README.md)
- [Metodologia](evaluation/phase7-methodology.md)
- [Relatório oficial](evaluation/official-held-out-f36e8ef.md)
- [Artifact JSON](../artifacts/official-held-out-f36e8ef.json)
- [Arquitetura](architecture/hybrid-policy.md)
- [Datasets](../datasets/README.md)
- [Testes](../tests/)
- [Migrations](../prisma/migrations/)
- [CI](../.github/workflows/ci.yml)

## Copy curto

Software Engineer que desenvolveu um case de Applied AI para triagem
operacional, combinando baseline determinístico, LLM local e política híbrida
com fallback, human review e audit trail. Em um held-out congelado de 70
tickets, o LLM elevou a acurácia de categoria de 82,9% para 95,7%, com
trade-offs explícitos de risco e latência.
