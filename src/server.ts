import { checkDatabase, closePrisma, getPrisma } from "./db.ts";
import type { TriageTicket } from "./application/triage-ticket.ts";
import { parseTicketInput } from "./http/triage-request.ts";

export type DbChecker = () => Promise<boolean>;

export interface ServerDependencies {
  checkDb: DbChecker;
  triageTicket: TriageTicket;
}

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
export async function handleRequest(
  req: Request,
  dependencies: ServerDependencies,
): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/health") {
    try {
      await dependencies.checkDb();
      return json(200, { status: "healthy", db: "up" });
    } catch {
      return json(503, { status: "unhealthy", db: "down" });
    }
  }

  if (req.method === "POST" && url.pathname === "/tickets/triage") {
    const mediaType = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      return json(415, { error: "unsupported_media_type" });
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return json(400, { error: "invalid_json" });
    }

    const parsed = parseTicketInput(payload);
    if (!parsed.success) {
      return json(422, { error: "invalid_request", issues: parsed.issues });
    }

    try {
      return json(200, await dependencies.triageTicket.execute(parsed.data));
    } catch {
      return json(500, { error: "internal_error" });
    }
  }

  return json(404, { status: "not_found" });
}

export function startServer(port: number, databaseUrl: string, triageTicket: TriageTicket) {
  const checkDb = createRealDbChecker(databaseUrl);
  const dependencies = { checkDb, triageTicket };
  const server = Bun.serve({
    port,
    fetch: (req) => handleRequest(req, dependencies),
  });
  return server;
}

export async function stopServer(server: { stop: () => void }): Promise<void> {
  server.stop();
  await closePrisma();
}
