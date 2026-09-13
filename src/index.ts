import { loadConfig } from "./config.ts";
import { DeterministicTriageClassifier } from "./application/classifiers/deterministic-triage-classifier.ts";
import { TriageTicket } from "./application/triage-ticket.ts";
import { startServer } from "./server.ts";

const config = loadConfig();
const classifier = new DeterministicTriageClassifier();
const triageTicket = new TriageTicket(classifier);
const server = startServer(config.PORT, config.DATABASE_URL, triageTicket);
console.log(`ops-triage-ai listening on :${server.port}`);
