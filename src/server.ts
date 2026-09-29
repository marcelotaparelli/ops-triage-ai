import { checkDatabase, closePrisma, getPrisma } from "./db.ts";
import {
  ClassifierInvalidResponseError,
  ClassifierTimeoutError,
  ClassifierUnavailableError,
} from "./application/errors/classifier-errors.ts";
import type { TriageService } from "./application/ports/triage-service.ts";
import { parseFeedbackInput } from "./http/feedback-request.ts";
import {
  isApiKeyAuthorized,
  isJsonRequest,
  isUuid,
  jsonResponse,
  readJsonBody,
} from "./http/http-protocol.ts";
import { parseTicketInput } from "./http/triage-request.ts";
import { Metrics, safeRequestId, stdoutLogger, type AppLogger } from "./observability.ts";
import { limiterFor, withRequestTimeout } from "./server/request-limits.ts";

// ---------------------------------------------------------------------------
// Public contracts (used by tests and index.ts — do not change shape)
// ---------------------------------------------------------------------------

export type DbChecker = () => Promise<boolean>;

export interface ServerDependencies {
  checkDb: DbChecker;
  triageService: TriageService;
  apiKey?: string;
  bodyLimitBytes?: number;
  maxConcurrentTriages?: number;
  requestTimeoutMs?: number;
  metrics?: Metrics;
  logger?: AppLogger;
}

const DEFAULT_BODY_LIMIT = 32_768;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_REQUEST_TIMEOUT = 310_000;

const defaultMetrics = new WeakMap<object, Metrics>();

interface RequestContext {
  requestId: string;
  route: string;
  metrics: Metrics;
  logger: AppLogger;
}

// ---------------------------------------------------------------------------
// Top-level request pipeline: observability around routing
// ---------------------------------------------------------------------------

export async function handleRequest(req: Request, dependencies: ServerDependencies): Promise<Response> {
  const context = createRequestContext(req, dependencies);
  const startedAt = performance.now();
  let response: Response;

  try {
    response = await routeRequest(req, dependencies, context);
  } catch {
    context.metrics.increment("unexpected_errors_total", { route: context.route });
    context.logger.log("error", "unexpected_error", {
      requestId: context.requestId,
      route: context.route,
      code: "INTERNAL_ERROR",
    });
    response = jsonResponse(500, { error: "internal_error" }, context.requestId);
  }

  recordRequestCompleted(context, response, startedAt);
  return response;
}

function createRequestContext(req: Request, dependencies: ServerDependencies): RequestContext {
  return {
    requestId: safeRequestId(req.headers.get("x-request-id")),
    route: routeName(req),
    metrics: dependencies.metrics ?? metricsFor(dependencies),
    logger: dependencies.logger ?? stdoutLogger,
  };
}

function recordRequestCompleted(context: RequestContext, response: Response, startedAt: number): void {
  context.metrics.increment("requests_total", {
    route: context.route,
    status: String(response.status),
  });
  context.metrics.observe("request_duration_ms", performance.now() - startedAt, {
    route: context.route,
  });
  context.logger.log("info", "request_completed", {
    requestId: context.requestId,
    route: context.route,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
  });
}

// ---------------------------------------------------------------------------
// Router: dispatch only, no business logic
// ---------------------------------------------------------------------------

async function routeRequest(
  req: Request,
  dependencies: ServerDependencies,
  context: RequestContext,
): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/ready")) {
    return handleHealthOrReadiness(url.pathname, dependencies, context);
  }

  if (req.method === "GET" && url.pathname === "/metrics") {
    return handleMetrics(req, dependencies, context);
  }

  if (isBusinessRoute(url.pathname) && !isApiKeyAuthorized(req, dependencies.apiKey)) {
    return jsonResponse(401, { error: "unauthorized" }, context.requestId);
  }

  if (req.method === "POST" && url.pathname === "/tickets/triage") {
    return handleCreateTriage(req, dependencies, context);
  }

  const triageMatch = /^\/triage\/([^/]+)$/.exec(url.pathname);
  const feedbackMatch = /^\/triage\/([^/]+)\/feedback$/.exec(url.pathname);
  if (triageMatch || feedbackMatch) {
    return handleTriageById(req, triageMatch, feedbackMatch, dependencies, context);
  }

  return jsonResponse(404, { status: "not_found" }, context.requestId);
}

function isBusinessRoute(pathname: string): boolean {
  if (pathname === "/tickets/triage") {
    return true;
  }
  if (/^\/triage\/([^/]+)$/.test(pathname)) {
    return true;
  }
  return /^\/triage\/([^/]+)\/feedback$/.test(pathname);
}

// ---------------------------------------------------------------------------
// Handlers: health / readiness / metrics
// ---------------------------------------------------------------------------

async function handleHealthOrReadiness(
  pathname: string,
  dependencies: ServerDependencies,
  context: RequestContext,
): Promise<Response> {
  const isHealth = pathname === "/health";
  try {
    await dependencies.checkDb();
    return jsonResponse(
      200,
      isHealth ? { status: "healthy", db: "up" } : { status: "ready" },
      context.requestId,
    );
  } catch {
    context.metrics.increment(isHealth ? "health_failures_total" : "readiness_failures_total");
    return jsonResponse(
      503,
      isHealth ? { status: "unhealthy", db: "down" } : { status: "not_ready" },
      context.requestId,
    );
  }
}

function handleMetrics(
  req: Request,
  dependencies: ServerDependencies,
  context: RequestContext,
): Response {
  if (!isApiKeyAuthorized(req, dependencies.apiKey)) {
    return jsonResponse(401, { error: "unauthorized" }, context.requestId);
  }
  return jsonResponse(200, context.metrics.snapshot(), context.requestId);
}

// ---------------------------------------------------------------------------
// Handlers: triage creation
// ---------------------------------------------------------------------------

async function handleCreateTriage(
  req: Request,
  dependencies: ServerDependencies,
  context: RequestContext,
): Promise<Response> {
  if (!isJsonRequest(req)) {
    return jsonResponse(415, { error: "unsupported_media_type" }, context.requestId);
  }

  const payload = await readJsonBody(req, dependencies.bodyLimitBytes ?? DEFAULT_BODY_LIMIT);
  if (!payload.success) {
    return jsonResponse(payload.status, { error: payload.error }, context.requestId);
  }

  const parsed = parseTicketInput(payload.value);
  if (!parsed.success) {
    return jsonResponse(422, { error: "invalid_request", issues: parsed.issues }, context.requestId);
  }

  const limiter = limiterFor(dependencies, dependencies.maxConcurrentTriages ?? DEFAULT_CONCURRENCY);
  if (!limiter.tryAcquire()) {
    return jsonResponse(429, { error: "too_many_requests" }, context.requestId, {
      "retry-after": "1",
    });
  }

  context.logger.log("info", "triage_started", { requestId: context.requestId });
  const triageStarted = performance.now();
  try {
    const execution = await withRequestTimeout(
      dependencies.triageService.execute(parsed.data),
      dependencies.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT,
    );
    recordTriageSuccess(context, execution.decision, triageStarted);
    context.logger.log("info", "triage_completed", {
      requestId: context.requestId,
      decisionId: execution.decisionId,
      status: 201,
      durationMs: Math.round(performance.now() - triageStarted),
      decisionSource: execution.decision.decisionSource,
      requiresHumanReview: execution.decision.requiresHumanReview,
    });
    return jsonResponse(
      201,
      { id: execution.decisionId, ...execution.decision },
      context.requestId,
      { location: `/triage/${execution.decisionId}` },
    );
  } catch (error) {
    const mapped = mapClassifierError(error);
    context.metrics.increment(mapped.metric);
    context.logger.log(mapped.status >= 500 ? "warn" : "error", mapped.event, {
      requestId: context.requestId,
      code: mapped.code,
    });
    return jsonResponse(mapped.status, { error: mapped.code }, context.requestId);
  } finally {
    limiter.release();
  }
}

function recordTriageSuccess(
  context: RequestContext,
  decision: { decisionSource: string; requiresHumanReview: boolean; reviewReasons: string[] },
  triageStarted: number,
): void {
  context.metrics.increment("triage_total", { decisionSource: decision.decisionSource });
  if (decision.requiresHumanReview) {
    context.metrics.increment("triage_human_review_total");
  }
  for (const reason of decision.reviewReasons) {
    context.metrics.increment("triage_review_reasons_total", { reason });
  }
  context.metrics.observe("triage_duration_ms", performance.now() - triageStarted);
}

// ---------------------------------------------------------------------------
// Handlers: audit read and feedback write under /triage/:id
// ---------------------------------------------------------------------------

async function handleTriageById(
  req: Request,
  triageMatch: RegExpExecArray | null,
  feedbackMatch: RegExpExecArray | null,
  dependencies: ServerDependencies,
  context: RequestContext,
): Promise<Response> {
  const decisionId = (triageMatch ?? feedbackMatch)?.[1] ?? "";
  if (!isUuid(decisionId)) {
    return jsonResponse(400, { error: "invalid_triage_id" }, context.requestId);
  }

  if (req.method === "GET" && triageMatch) {
    return handleGetAudit(decisionId, dependencies, context);
  }

  if (req.method === "POST" && feedbackMatch) {
    return handleCreateFeedback(req, decisionId, dependencies, context);
  }

  return jsonResponse(404, { status: "not_found" }, context.requestId);
}

async function handleGetAudit(
  decisionId: string,
  dependencies: ServerDependencies,
  context: RequestContext,
): Promise<Response> {
  try {
    const audit = await dependencies.triageService.getDecisionAudit(decisionId);
    if (!audit) {
      return jsonResponse(404, { error: "triage_not_found" }, context.requestId);
    }
    return jsonResponse(200, audit, context.requestId);
  } catch {
    context.metrics.increment("persistence_errors_total");
    context.logger.log("error", "persistence_error", {
      requestId: context.requestId,
      decisionId,
      code: "AUDIT_READ_FAILED",
    });
    return jsonResponse(500, { error: "internal_error" }, context.requestId);
  }
}

async function handleCreateFeedback(
  req: Request,
  decisionId: string,
  dependencies: ServerDependencies,
  context: RequestContext,
): Promise<Response> {
  if (!isJsonRequest(req)) {
    return jsonResponse(415, { error: "unsupported_media_type" }, context.requestId);
  }

  const payload = await readJsonBody(req, dependencies.bodyLimitBytes ?? DEFAULT_BODY_LIMIT);
  if (!payload.success) {
    return jsonResponse(payload.status, { error: payload.error }, context.requestId);
  }

  const parsed = parseFeedbackInput(payload.value);
  if (!parsed.success) {
    return jsonResponse(422, { error: "invalid_feedback", issues: parsed.issues }, context.requestId);
  }

  try {
    const audit = await dependencies.triageService.getDecisionAudit(decisionId);
    if (!audit) {
      return jsonResponse(404, { error: "triage_not_found" }, context.requestId);
    }
    const feedback = await dependencies.triageService.addFeedback(decisionId, parsed.data);
    context.metrics.increment("feedback_created_total");
    context.logger.log("info", "feedback_created", {
      requestId: context.requestId,
      decisionId,
    });
    return jsonResponse(201, feedback, context.requestId);
  } catch {
    context.metrics.increment("persistence_errors_total");
    context.logger.log("error", "persistence_error", {
      requestId: context.requestId,
      decisionId,
      code: "FEEDBACK_CREATE_FAILED",
    });
    return jsonResponse(500, { error: "internal_error" }, context.requestId);
  }
}

// ---------------------------------------------------------------------------
// Transversal helpers: route names, error mapping, per-instance state
// ---------------------------------------------------------------------------

function routeName(req: Request): string {
  const path = new URL(req.url).pathname;
  if (path === "/tickets/triage") {
    return "POST /tickets/triage";
  }
  if (path === "/metrics") {
    return "GET /metrics";
  }
  if (path === "/health") {
    return "GET /health";
  }
  if (path === "/ready") {
    return "GET /ready";
  }
  if (/^\/triage\/[^/]+\/feedback$/.test(path)) {
    return "POST /triage/:id/feedback";
  }
  if (/^\/triage\/[^/]+$/.test(path)) {
    return "GET /triage/:id";
  }
  return "unknown";
}

interface MappedError {
  status: number;
  code: string;
  metric: string;
  event: string;
}

function mapClassifierError(error: unknown): MappedError {
  if (error instanceof ClassifierTimeoutError) {
    return {
      status: 504,
      code: "classifier_timeout",
      metric: "classifier_timeouts_total",
      event: "classifier_timeout",
    };
  }
  if (error instanceof ClassifierUnavailableError) {
    return {
      status: 503,
      code: "classifier_unavailable",
      metric: "classifier_unavailable_total",
      event: "classifier_unavailable",
    };
  }
  if (error instanceof ClassifierInvalidResponseError) {
    return {
      status: 502,
      code: "classifier_invalid_response",
      metric: "classifier_invalid_response_total",
      event: "classifier_invalid_response",
    };
  }
  if (error instanceof Error && error.message === "request_timeout") {
    return {
      status: 504,
      code: "request_timeout",
      metric: "request_timeouts_total",
      event: "request_timeout",
    };
  }
  return { status: 500, code: "internal_error", metric: "unexpected_errors_total", event: "unexpected_error" };
}

function metricsFor(dependencies: ServerDependencies): Metrics {
  const key = dependencies as object;
  let metrics = defaultMetrics.get(key);
  if (!metrics) {
    metrics = new Metrics();
    defaultMetrics.set(key, metrics);
  }
  return metrics;
}

// ---------------------------------------------------------------------------
// Server lifecycle: start, drain, stop
// ---------------------------------------------------------------------------

export function createRealDbChecker(databaseUrl: string): DbChecker {
  return async () => checkDatabase(getPrisma(databaseUrl));
}

export function startServer(
  port: number,
  databaseUrl: string,
  triageService: TriageService,
  options: Omit<ServerDependencies, "checkDb" | "triageService"> = {},
) {
  const dependencies: ServerDependencies = {
    ...options,
    checkDb: createRealDbChecker(databaseUrl),
    triageService,
  };
  let draining = false;
  let active = 0;
  let idleResolver: (() => void) | undefined;

  const server = Bun.serve({
    port,
    fetch: async (req) => {
      if (draining) {
        return jsonResponse(
          503,
          { error: "server_shutting_down" },
          safeRequestId(req.headers.get("x-request-id")),
          { "retry-after": "1" },
        );
      }
      active += 1;
      try {
        return await handleRequest(req, dependencies);
      } finally {
        active -= 1;
        if (active === 0) {
          idleResolver?.();
        }
      }
    },
  });

  return Object.assign(server, {
    beginShutdown: () => {
      draining = true;
    },
    waitForIdle: async (timeoutMs = 5_000) => {
      if (active === 0) {
        return;
      }
      await Promise.race([
        new Promise<void>((resolve) => {
          idleResolver = resolve;
        }),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    },
  });
}

export async function stopServer(server: {
  stop: () => void;
  beginShutdown?: () => void;
  waitForIdle?: () => Promise<void>;
}): Promise<void> {
  server.beginShutdown?.();
  server.stop();
  await server.waitForIdle?.();
  await closePrisma();
}
