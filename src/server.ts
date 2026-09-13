import { checkDatabase, closePrisma, getPrisma } from "./db.ts";

export type DbChecker = () => Promise<boolean>;

export function createRealDbChecker(databaseUrl: string): DbChecker {
  return async () => {
    const prisma = getPrisma(databaseUrl);
    return checkDatabase(prisma);
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Pure handler — testable without network. Never leaks secrets/stacks. */
export async function handleRequest(req: Request, checkDb: DbChecker): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/health") {
    try {
      await checkDb();
      return json(200, { status: "healthy", db: "up" });
    } catch {
      return json(503, { status: "unhealthy", db: "down" });
    }
  }
  return json(404, { status: "not_found" });
}

export function startServer(port: number, databaseUrl: string) {
  const checkDb = createRealDbChecker(databaseUrl);
  const server = Bun.serve({
    port,
    fetch: (req) => handleRequest(req, checkDb),
  });
  return server;
}

export async function stopServer(server: { stop: () => void }): Promise<void> {
  server.stop();
  await closePrisma();
}
