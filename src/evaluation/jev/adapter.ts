import { z } from "zod";
import { Category, Priority, Risk, type TicketInput } from "../../domain/triage.ts";
import { JEV_CONFIG, JEV_QUESTIONS } from "./questions.ts";

const CHOICE_PROBABILITY_TIE_TOLERANCE = 1e-12;

function decisionSchema<T extends string>(labels: readonly T[]) {
  return z
    .object({
      type: z.literal("choice"),
      choice: z.enum(labels as [T, ...T[]]),
      confidence: z.number().finite().min(0).max(1),
      probabilities: z.record(z.enum(labels as [T, ...T[]]), z.number().finite().min(0).max(1)),
    })
    .superRefine((value, ctx) => {
      if (!hasValidDistribution(labels, value.probabilities, value.choice)) {
        ctx.addIssue({ code: "custom", message: "Invalid decision distribution" });
      }
    });
}

function hasValidDistribution<T extends string>(
  labels: readonly T[],
  probabilities: Record<T, number>,
  choice: T,
): boolean {
  const total = labels.reduce((sum, label) => sum + probabilities[label], 0);
  const sumsToOne = Math.abs(total - 1) <= JEV_CONFIG.probabilitySumTolerance;
  const choiceHasHighestProbability = labels.every(
    (label) => probabilities[label] <= probabilities[choice] + CHOICE_PROBABILITY_TIE_TOLERANCE,
  );
  return sumsToOne && choiceHasHighestProbability;
}

export const JevUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  cost: z.number().finite().nonnegative().optional(),
});
export type JevUsage = z.infer<typeof JevUsageSchema>;
export const JevResponseSchema = z.object({
  id: z.string().min(1),
  model: z.string().regex(/^typesafe\/jev-1\.13(?:-\d{8})?$/),
  provider: z.literal("TypeSafe"),
  answers: z.object({
    category: decisionSchema(Object.values(Category)),
    priority: decisionSchema(Object.values(Priority)),
    risk: decisionSchema(Object.values(Risk)),
  }),
  usage: JevUsageSchema.optional(),
});

// Separate boundary: no fabricated prose, heuristic confidence, or TriageClassifier coercion.
export type JevTriageResult = z.infer<typeof JevResponseSchema>;
export type JevFailure =
  | "TIMEOUT"
  | "NETWORK"
  | "AUTH"
  | "RATE_LIMIT"
  | "UNAVAILABLE"
  | "HTTP_ERROR"
  | "MALFORMED_JSON"
  | "INVALID_RESPONSE";
export class JevError extends Error {
  constructor(
    readonly code: JevFailure,
    readonly status?: number,
    readonly usage?: JevUsage,
  ) {
    super(`Jev evaluation failed: ${code}`);
    this.name = "JevError";
  }
}

function failureForHttpStatus(status: number): JevFailure {
  if (status === 401 || status === 403) {
    return "AUTH";
  }
  if (status === 429) {
    return "RATE_LIMIT";
  }
  if (status >= 500) {
    return "UNAVAILABLE";
  }
  return "HTTP_ERROR";
}

function usageFromInvalidPayload(payload: unknown): JevUsage | undefined {
  const metadata = z.object({ usage: JevUsageSchema }).safeParse(payload);
  if (metadata.success) {
    return metadata.data.usage;
  }
  return undefined;
}

export class JevEvaluationAdapter {
  #apiKey: string;
  constructor(
    apiKey: string,
    private readonly http: typeof fetch = fetch,
    private readonly timeoutMs: number = JEV_CONFIG.timeoutMs,
  ) {
    if (!apiKey.trim()) {
      throw new Error("OPENROUTER_API_KEY is required");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Invalid timeout");
    }
    this.#apiKey = apiKey;
  }

  async decide(input: TicketInput): Promise<JevTriageResult> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new JevError("TIMEOUT"));
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([this.postDecision(input, controller.signal), deadline]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postDecision(input: TicketInput, signal: AbortSignal): Promise<JevTriageResult> {
    let response: Response;
    try {
      response = await this.http(JEV_CONFIG.endpoint, {
        method: "POST",
        redirect: "error",
        signal,
        headers: { Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: JEV_CONFIG.model,
          state: { title: input.title, description: input.description },
          questions: JEV_QUESTIONS,
        }),
      });
    } catch {
      throw new JevError(signal.aborted ? "TIMEOUT" : "NETWORK");
    }

    if (!response.ok) {
      throw new JevError(failureForHttpStatus(response.status), response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new JevError("MALFORMED_JSON");
    }

    const parsed = JevResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new JevError("INVALID_RESPONSE", undefined, usageFromInvalidPayload(payload));
    }
    // Never expose upstream error bodies, Zod issues, fetch errors, or request headers.
    return parsed.data;
  }
}
