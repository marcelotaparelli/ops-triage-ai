import { loadConfig } from "./config.ts";
import { DeterministicTriageClassifier } from "./application/classifiers/deterministic-triage-classifier.ts";
import { PersistedTriageService } from "./application/persisted-triage-service.ts";
import { TriageTicket } from "./application/triage-ticket.ts";
import type { TriageMode } from "./application/ports/triage-persistence.ts";
import { OllamaTriageClassifier } from "./infrastructure/ollama/ollama-triage-classifier.ts";
import {
  PrismaFeedbackRepository,
  PrismaTriageRunRepository,
} from "./infrastructure/persistence/prisma-triage-repositories.ts";
import { getPrisma } from "./db.ts";
import { startServer } from "./server.ts";

const config = loadConfig();
const deterministicClassifier = new DeterministicTriageClassifier();
const triageTicket =
  config.TRIAGE_CLASSIFIER === "deterministic"
    ? new TriageTicket({ mode: "deterministic", classifier: deterministicClassifier })
    : new TriageTicket(
        config.TRIAGE_CLASSIFIER === "ollama"
          ? { mode: "ollama", classifier: createOllamaClassifier() }
          : {
              mode: "hybrid",
              deterministicClassifier,
              llmClassifier: createOllamaClassifier(),
            },
      );
const prisma = getPrisma(config.DATABASE_URL);
const triageService = new PersistedTriageService(
  triageTicket,
  toTriageMode(config.TRIAGE_CLASSIFIER),
  new PrismaTriageRunRepository(prisma),
  new PrismaFeedbackRepository(prisma),
);
const server = startServer(config.PORT, config.DATABASE_URL, triageService);
console.log(`ops-triage-ai listening on :${server.port}`);

function createOllamaClassifier(): OllamaTriageClassifier {
  if (config.TRIAGE_CLASSIFIER === "deterministic") {
    throw new Error("Ollama classifier is not configured");
  }
  return new OllamaTriageClassifier({
    baseUrl: config.OLLAMA_BASE_URL,
    model: config.OLLAMA_MODEL,
    timeoutMs: config.OLLAMA_TIMEOUT_MS,
  });
}

function toTriageMode(value: "deterministic" | "ollama" | "hybrid"): TriageMode {
  return value.toUpperCase() as TriageMode;
}
