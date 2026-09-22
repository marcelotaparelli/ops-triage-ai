import { z } from "zod";
import { Category, Priority, Risk, type TicketInput } from "../../domain/triage.ts";
import { JEV_CONFIG, JEV_QUESTIONS } from "./questions.ts";

function decisionSchema<T extends string>(labels: readonly T[]) {
  return z.object({
    type: z.literal("choice"),
    choice: z.enum(labels as [T, ...T[]]),
    confidence: z.number().finite().min(0).max(1),
    probabilities: z.record(z.enum(labels as [T, ...T[]]), z.number().finite().min(0).max(1)),
  }).superRefine((value, ctx) => {
    const probabilities = value.probabilities as Record<T, number>;
    const sum = labels.reduce((total, label) => total + probabilities[label], 0);
    if (Math.abs(sum - 1) > JEV_CONFIG.probabilitySumTolerance ||
      labels.some(label => probabilities[label] > probabilities[value.choice] + 1e-12)) {
      ctx.addIssue({ code: "custom", message: "Invalid decision distribution" });
    }
  });
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
export type JevFailure = "TIMEOUT" | "NETWORK" | "AUTH" | "RATE_LIMIT" | "UNAVAILABLE" |
  "HTTP_ERROR" | "MALFORMED_JSON" | "INVALID_RESPONSE";
export class JevError extends Error {
  constructor(readonly code: JevFailure, readonly status?: number, readonly usage?: JevUsage) {
    super(`Jev evaluation failed: ${code}`);
    this.name = "JevError";
  }
}

export class JevEvaluationAdapter {
  #apiKey: string;
  constructor(apiKey: string, private readonly http: typeof fetch = fetch,
    private readonly timeoutMs: number = JEV_CONFIG.timeoutMs) {
    if (!apiKey.trim()) throw new Error("OPENROUTER_API_KEY is required");
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid timeout");
    this.#apiKey = apiKey;
  }

  async decide(input: TicketInput): Promise<JevTriageResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new JevError("TIMEOUT")); }, this.timeoutMs);
    });
    const request = async () => {
      let response: Response;
      try {
        response = await this.http(JEV_CONFIG.endpoint, {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: JEV_CONFIG.model,
            state: { title: input.title, description: input.description }, questions: JEV_QUESTIONS }),
        });
      } catch { throw new JevError(controller.signal.aborted ? "TIMEOUT" : "NETWORK"); }
      if (!response.ok) {
        const s = response.status;
        throw new JevError(s === 401 || s === 403 ? "AUTH" : s === 429 ? "RATE_LIMIT" :
          s >= 500 ? "UNAVAILABLE" : "HTTP_ERROR", s);
      }
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw new JevError("MALFORMED_JSON"); }
      const parsed = JevResponseSchema.safeParse(payload);
      if (!parsed.success) {
        const metadata = z.object({ usage: JevUsageSchema }).safeParse(payload);
        throw new JevError("INVALID_RESPONSE", undefined, metadata.success ? metadata.data.usage : undefined);
      }
      // Never expose upstream error bodies, Zod issues, fetch errors, or request headers.
      return parsed.data;
    };
    try { return await Promise.race([request(), deadline]); }
    finally { clearTimeout(timer); }
  }
}
