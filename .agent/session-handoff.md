# Session Handoff — OPS TRIAGE AI (Fase 1 Foundation)

> Backup histórico `.agent/session-broken-backup.json` NÃO reutilizado (apenas referência).
> Sem secrets neste arquivo.

## Objetivo atual
FASE 1 concluída (implementação): Bun + TS strict + config validada + HTTP bootstrap +
GET /health com check real PostgreSQL + validação Prisma × Bun + testes + CI. Sem IA.
Aguardando validação do relatório; NÃO avançar p/ Fase 2 sem autorização.

## Decisões tomadas
- Stack: Bun runtime/pm/toolchain, TS strict, PostgreSQL, Prisma 7.10.0, Zod 4.6.4 só bordas/config, Vitest 5.0.0, Compose só PostgreSQL, GitHub Actions 2 jobs.
- HTTP: Bun nativo (`Bun.serve`), handler puro `handleRequest` testável. Hono/Elysia avaliados e rejeitados p/ 1 rota (deps desnecessárias).
- Health DB: query segura tagged `prisma.$queryRaw\`SELECT 1\`` via `checkDatabase()`; 200 healthy / 503 unhealthy; sem segredos/stacks; 404 p/ demais rotas.
- Prisma: versão real instalada 7.10.0 (CLI+client alinhados; rejeitado `prisma@8.0.0-rc.14` que o `latest` resolveu e causava mismatch). API v7: `prisma7.config.ts` + `defineConfig` + adapter `@prisma/adapter-pg`. Schema sem tabelas (Fase 2 cria domínio).
- TypeScript fixado em 5.9.2 (typescript-eslint não suporta TS 7.0 — gate lint exigiu downgrade).
- CI 2 jobs: `quality` (install→generate→typecheck→lint→unit→build) e `integration` (postgres:16 service + generate + integration). `prisma generate` exige DATABASE_URL resolvível → quality usa URL dummy, integration usa URL do service.
- `.env.example`: PORT, DATABASE_URL + POSTGRES_USER/PASSWORD/DB (exemplo dev, sem secrets). `.env` real nunca commitado (gitignored, inexistente no repo).
- Docker ausente localmente → integração real SÓ na CI; gates Docker/PG locais = BLOCKED LOCALMENTE.

## Implementação concluída
- [x] Scaffold Bun + TS strict + Zod config fail-fast + .env.example
- [x] compose.yaml (somente postgres:16-alpine + healthcheck)
- [x] Prisma × Bun: generate PASS, import PASS, ECONNREFUSED sem PG (prova de conexão real tentada)
- [x] GET /health Bun nativo (live: 503 sem DB, 404 unknown, sem leak)
- [x] Vitest unit (9 testes) + integration (SELECT 1 tagged)
- [x] CI quality + integration
- [x] Gates locais executados (ver abaixo)

## Gates executados
- bun install → PASS
- bun run typecheck → PASS (tsc --noEmit, TS 5.9.2)
- bun run lint → PASS (eslint, após fix TS)
- bun run test:unit → PASS (2 files, 9 tests)
- bun run build → PASS (dist/index.js ~5.9MB)
- prisma generate (Bun) → PASS (client 7.10.0 em src/generated/prisma)
- import client sob Bun → PASS
- GET /health live sem DB → PASS (503 unhealthy, sem segredos)
- fail-fast config inválida → PASS (PORT/DATABASE_URL)
- test:integration local → BLOCKED LOCALMENTE (ECONNREFUSED, sem PG/Docker; teste é real, Quebra de propósito sem banco)
- docker compose up -d → BLOCKED LOCALMENTE (docker ausente)
- GET /health com DB up + failure-drill PG parado → BLOCKED LOCALMENTE (pendente CI ou host com Docker)

## Problemas conhecidos
1. `bun add prisma` (latest) resolveu `8.0.0-rc.14` com client 7.10.0 (mismatch) → fixado `prisma@7.10.0`.
2. typescript-eslint 8.70 não suporta TS 7.0.2 → TS fixado em 5.9.2.
3. Sem Docker/curl/psql no host → validação PG real só na CI.
4. `src/generated/` é gitignored; CI gera antes de typecheck/test.

## Próximo passo
- Revisar relatório Fase 1; validar CI verde no GitHub (push); então planejar Fase 2 (fora deste escopo).
