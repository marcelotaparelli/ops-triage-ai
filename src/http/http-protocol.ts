/**
 * HTTP wire concerns shared by the server handlers.
 *
 * This module only deals with the HTTP envelope: JSON responses,
 * content-type checks, bounded body reads, API-key comparison and
 * route-parameter validation. It never touches business rules.
 */

/** Successful bounded body read. */
export type JsonBodySuccess = { success: true; value: unknown };

/** Failed bounded body read. `status` is the HTTP status to return. */
export type JsonBodyFailure = {
  success: false;
  status: 400 | 413;
  error: "invalid_json" | "request_body_too_large";
};

export type JsonBodyResult = JsonBodySuccess | JsonBodyFailure;

/**
 * Build a JSON response that always propagates the request id.
 * Headers passed by the caller (e.g. `location`, `retry-after`)
 * are merged without overriding the envelope defaults.
 */
export function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      ...headers,
    },
  });
}

/** True when the request declares a JSON content type (charset suffix allowed). */
export function isJsonRequest(req: Request): boolean {
  const contentType = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return contentType === "application/json";
}

/**
 * Read and parse a JSON body enforcing an explicit byte limit.
 *
 * The declared `content-length` is checked first so oversized
 * payloads are rejected before buffering; the buffered byte
 * length is checked again to cover missing or lying headers.
 */
export async function readJsonBody(req: Request, limitBytes: number): Promise<JsonBodyResult> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    return { success: false, status: 413, error: "request_body_too_large" };
  }

  try {
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength > limitBytes) {
      return { success: false, status: 413, error: "request_body_too_large" };
    }
    return { success: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { success: false, status: 400, error: "invalid_json" };
  }
}

/**
 * Constant-time API-key comparison.
 * Requests are authorized when no key is configured.
 */
export function isApiKeyAuthorized(req: Request, expected: string | undefined): boolean {
  if (!expected) {
    return true;
  }

  const provided = req.headers.get("x-api-key");
  if (!provided || provided.length !== expected.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

/** True for canonical UUID route parameters (`/triage/:id`). */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
