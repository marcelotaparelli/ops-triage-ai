import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export type BunServerProcess = ChildProcessByStdio<null, Readable, Readable>;

export function startBunServer(port: number, databaseUrl: string): Promise<BunServerProcess> {
  const server = spawn("bun", ["src/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Bun server did not start in time: " + stderr));
    }, 10_000);

    const onStdout = (chunk: Buffer) => {
      const output = chunk.toString();
      if (output.includes(`"event":"server_started"`) && output.includes(`"status":${port}`)) {
        cleanup();
        resolve(server);
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
      reject(new Error("Bun server exited before listening (" + (code ?? signal) + "): " + stderr));
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

export async function stopBunServer(server: BunServerProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => server.once("exit", () => resolve()));
}
