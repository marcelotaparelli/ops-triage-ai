import { loadConfig } from "./config.ts";
import {
  buildServerOptions,
  buildTriageTicket,
  composeTriageStack,
  reconcileAbandonedRuns,
} from "./bootstrap.ts";
import { DeterministicTriageClassifier } from "./application/classifiers/deterministic-triage-classifier.ts";
import { startServer } from "./server.ts";
import { stopServer } from "./server.ts";
import { stdoutLogger } from "./observability.ts";

// ---------------------------------------------------------------------------
// Application entry point: load → compose → reconcile → serve → trap signals.
// Each step is linear and named; details live in bootstrap.ts and server.ts.
// ---------------------------------------------------------------------------

const config = loadConfig();

// 1. Compose classifiers and ticket: one explicit branch per mode lives
//    inside buildTriageTicket (no nested ternaries).
const deterministicClassifier = new DeterministicTriageClassifier();
const triageTicket = buildTriageTicket(config, deterministicClassifier);

// 2. Compose persistence and the persisted service around that ticket.
const { triageService, triageRunRepository, metrics } = composeTriageStack(config, triageTicket);

// 3. Reconcile abandoned runs before accepting traffic.
await reconcileAbandonedRuns(
  triageRunRepository,
  metrics,
  config.STALE_RUN_THRESHOLD_MS,
  stdoutLogger,
);

// 4. Start the HTTP server.
const serverOptions = buildServerOptions(config, metrics, stdoutLogger);
const server = startServer(config.PORT, config.DATABASE_URL, triageService, serverOptions);
stdoutLogger.log("info", "server_started", { status: config.PORT });

// 5. Trap termination signals for graceful shutdown.
registerShutdownHandlers(server);

function registerShutdownHandlers(runningServer: typeof server): void {
  let stopping = false;

  async function shutdown(signal: string): Promise<void> {
    if (stopping) {
      return;
    }
    stopping = true;
    stdoutLogger.log("info", "shutdown_started", { code: signal });
    await stopServer(runningServer);
    stdoutLogger.log("info", "shutdown_completed", { code: signal });
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("uncaughtException", () => {
    stdoutLogger.log("error", "unexpected_error", { code: "UNCAUGHT_EXCEPTION" });
    void shutdown("uncaughtException").finally(() => process.exit(1));
  });
  process.on("unhandledRejection", () => {
    stdoutLogger.log("error", "unexpected_error", { code: "UNHANDLED_REJECTION" });
    void shutdown("unhandledRejection").finally(() => process.exit(1));
  });
}
