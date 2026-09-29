import type { AppConfig } from "./config.ts";
import { DeterministicTriageClassifier } from "./application/classifiers/deterministic-triage-classifier.ts";
import { PersistedTriageService } from "./application/persisted-triage-service.ts";
import { TriageTicket } from "./application/triage-ticket.ts";
import type { TriageMode } from "./application/ports/triage-persistence.ts";
import { OllamaTriageClassifier } from "./infrastructure/ollama/ollama-triage-classifier.ts";
import {
  PrismaFeedbackRepository,
  PrismaTriageRunRepository,
} from "./infrastructure/persistence/prisma-triage-repositories.ts";
import type { PrismaClient } from "./generated/prisma/client.ts";
import { getPrisma } from "./db.ts";
import { Metrics, type AppLogger } from "./observability.ts";

export type ClassifierName = AppConfig["TRIAGE_CLASSIFIER"];

/** Ollama settings are required for every mode except deterministic. */
export function createOllamaClassifier(config: AppConfig): OllamaTriageClassifier {
  if (config.TRIAGE_CLASSIFIER === "deterministic") {
    throw new Error("Ollama classifier is not configured");
  }
  return new OllamaTriageClassifier({
    baseUrl: config.OLLAMA_BASE_URL,
    model: config.OLLAMA_MODEL,
    timeoutMs: config.OLLAMA_TIMEOUT_MS,
  });
}

function buildDeterministicTicket(classifier: DeterministicTriageClassifier): TriageTicket {
  return new TriageTicket({ mode: "deterministic", classifier });
}

function buildOllamaTicket(config: AppConfig): TriageTicket {
  return new TriageTicket({ mode: "ollama", classifier: createOllamaClassifier(config) });
}

function buildHybridTicket(
  config: AppConfig,
  deterministicClassifier: DeterministicTriageClassifier,
): TriageTicket {
  return new TriageTicket({
    mode: "hybrid",
    deterministicClassifier,
    llmClassifier: createOllamaClassifier(config),
  });
}

/**
 * Build the TriageTicket for one explicit mode per branch.
 * Each mode wires its own classifiers; no nested ternaries.
 */
export function buildTriageTicket(
  config: AppConfig,
  deterministicClassifier: DeterministicTriageClassifier,
): TriageTicket {
  if (config.TRIAGE_CLASSIFIER === "deterministic") {
    return buildDeterministicTicket(deterministicClassifier);
  }
  if (config.TRIAGE_CLASSIFIER === "ollama") {
    return buildOllamaTicket(config);
  }
  return buildHybridTicket(config, deterministicClassifier);
}

export function toTriageMode(value: ClassifierName): TriageMode {
  return value.toUpperCase() as TriageMode;
}

export interface ComposedTriageStack {
  prisma: PrismaClient;
  triageTicket: TriageTicket;
  triageService: PersistedTriageService;
  triageRunRepository: PrismaTriageRunRepository;
  metrics: Metrics;
}

/** Wire repositories and the persisted service around an explicit ticket. */
export function composeTriageStack(config: AppConfig, triageTicket: TriageTicket): ComposedTriageStack {
  const prisma = getPrisma(config.DATABASE_URL);
  const triageRunRepository = new PrismaTriageRunRepository(prisma);
  const metrics = new Metrics();
  const triageService = new PersistedTriageService(
    triageTicket,
    toTriageMode(config.TRIAGE_CLASSIFIER),
    triageRunRepository,
    new PrismaFeedbackRepository(prisma),
  );
  return { prisma, triageTicket, triageService, triageRunRepository, metrics };
}

export interface ReconciliationReport {
  reconciledCount: number;
  statusCounts: Record<string, number>;
}

/**
 * Mark abandoned runs as failed and publish the initial gauges.
 * Runs before the server starts accepting traffic.
 */
export async function reconcileAbandonedRuns(
  triageRunRepository: PrismaTriageRunRepository,
  metrics: Metrics,
  staleThresholdMs: number,
  logger: AppLogger,
): Promise<ReconciliationReport> {
  const cutoff = new Date(Date.now() - staleThresholdMs);
  const reconciledCount = await triageRunRepository.reconcileStaleRuns(cutoff);
  metrics.set("stale_runs_reconciled_total", reconciledCount);

  const statusCounts = await triageRunRepository.getStatusCounts();
  for (const [status, count] of Object.entries(statusCounts)) {
    metrics.set("triage_runs", count, { status });
  }

  logger.log("info", "stale_runs_reconciled", { count: reconciledCount });
  return { reconciledCount, statusCounts };
}

export interface ServerOptions {
  apiKey?: string;
  bodyLimitBytes: number;
  maxConcurrentTriages: number;
  requestTimeoutMs: number;
  metrics: Metrics;
  logger: AppLogger;
}

/** Translate flat config into the server's options object. */
export function buildServerOptions(config: AppConfig, metrics: Metrics, logger: AppLogger): ServerOptions {
  return {
    ...(config.TRIAGE_API_KEY === undefined ? {} : { apiKey: config.TRIAGE_API_KEY }),
    bodyLimitBytes: config.HTTP_BODY_LIMIT_BYTES,
    maxConcurrentTriages: config.TRIAGE_MAX_CONCURRENCY,
    requestTimeoutMs: config.REQUEST_TIMEOUT_MS,
    metrics,
    logger,
  };
}
