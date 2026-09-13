import { loadConfig } from "./config.ts";
import { DeterministicTriageClassifier } from "./application/classifiers/deterministic-triage-classifier.ts";
import type { TriageClassifier } from "./application/ports/triage-classifier.ts";
import { TriageTicket } from "./application/triage-ticket.ts";
import { OllamaTriageClassifier } from "./infrastructure/ollama/ollama-triage-classifier.ts";
import { startServer } from "./server.ts";

const config = loadConfig();
const classifier: TriageClassifier =
  config.TRIAGE_CLASSIFIER === "ollama"
    ? new OllamaTriageClassifier({
        baseUrl: config.OLLAMA_BASE_URL,
        model: config.OLLAMA_MODEL,
        timeoutMs: config.OLLAMA_TIMEOUT_MS,
      })
    : new DeterministicTriageClassifier();
const triageTicket = new TriageTicket(classifier);
const server = startServer(config.PORT, config.DATABASE_URL, triageTicket);
console.log(`ops-triage-ai listening on :${server.port}`);
