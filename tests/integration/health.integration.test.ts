import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env["DATABASE_URL"];
const PORT = Number(process.env["HEALTH_TEST_PORT"] ?? "3459");
type BunServerProcess = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Real path: PostgreSQL disponível → processo Bun → Bun.serve → GET /health → 200 healthy.
 * Requires a live database (CI integration job). Fails without one —
 * that failure is the honest signal, never mocked here.
 */
describe("GET /health with real PostgreSQL", () => {
  it("returns 200 healthy with db up", async () => {
    if (!DATABASE_URL) throw new Error("DATABASE_URL is required for integration tests");

    const server = spawn("bun", ["src/index.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      await waitUntilListening(server);
      const res = await fetch(`http://localhost:${PORT}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "healthy", db: "up" });
    } finally {
      await stopProcess(server);
    }
  });
});

function waitUntilListening(server: BunServerProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Bun server did not start in time: ${stderr}`));
    }, 10_000);

    const onStdout = (chunk: Buffer) => {
      if (chunk.toString().includes(`listening on :${PORT}`)) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`Bun server exited before listening (${code ?? signal}): ${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      server.stdout.off("data", onStdout);
      server.stderr.off("data", onStderr);
      server.off("error", onError);
      server.off("exit", onExit);
    };

    server.stdout.on("data", onStdout);
    server.stderr.on("data", onStderr);
    server.once("error", onError);
    server.once("exit", onExit);
  });
}

async function stopProcess(server: BunServerProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => server.once("exit", () => resolve()));
}
