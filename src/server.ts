import { checkDatabase, closePrisma, getPrisma } from "./db.ts";
import {
  ClassifierInvalidResponseError,
  ClassifierTimeoutError,
  ClassifierUnavailableError,
} from "./application/errors/classifier-errors.ts";
import type { TriageService } from "./application/ports/triage-service.ts";
import { parseFeedbackInput } from "./http/feedback-request.ts";
import { parseTicketInput } from "./http/triage-request.ts";

export type DbChecker = () => Promise<boolean>;

export interface ServerDependencies {
  checkDb: DbChecker;
  triageService: TriageService;
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
      const execution = await dependencies.triageService.execute(parsed.data);
      return new Response(JSON.stringify({ id: execution.decisionId, ...execution.decision }), {
        status: 201,
        headers: {
          "content-type": "application/json",
          location: `/triage/${execution.decisionId}`,
        },
      });
    } catch (error) {
      if (error instanceof ClassifierTimeoutError) {
        return json(504, { error: "classifier_timeout" });
      }
      if (error instanceof ClassifierUnavailableError) {
        return json(503, { error: "classifier_unavailable" });
      }
      if (error instanceof ClassifierInvalidResponseError) {
        return json(502, { error: "classifier_invalid_response" });
      }
      return json(500, { error: "internal_error" });
    }
  }

  const triagePath = /^\/triage\/([^/]+)$/.exec(url.pathname);
  if (triagePath && (req.method === "GET" || req.method === "POST")) {
    const decisionId = triagePath[1] ?? "";
    if (!isUuid(decisionId)) return json(400, { error: "invalid_triage_id" });

    if (req.method === "GET") {
      try {
        const audit = await dependencies.triageService.getDecisionAudit(decisionId);
        if (!audit) return json(404, { error: "triage_not_found" });
        return json(200, audit);
      } catch {
        return json(500, { error: "internal_error" });
      }
    }

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

    const parsed = parseFeedbackInput(payload);
    if (!parsed.success) return json(422, { error: "invalid_feedback", issues: parsed.issues });

    try {
      const audit = await dependencies.triageService.getDecisionAudit(decisionId);
      if (!audit) return json(404, { error: "triage_not_found" });
      const feedback = await dependencies.triageService.addFeedback(decisionId, parsed.data);
      return json(201, feedback);
    } catch {
      return json(500, { error: "internal_error" });
    }
  }

  return json(404, { status: "not_found" });
}

export function startServer(port: number, databaseUrl: string, triageService: TriageService) {
  const checkDb = createRealDbChecker(databaseUrl);
  const dependencies = { checkDb, triageService };
  const server = Bun.serve({
    port,
    fetch: (req) => handleRequest(req, dependencies),
  });
  return server;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function stopServer(server: { stop: () => void }): Promise<void> {
  server.stop();
  await closePrisma();
}
