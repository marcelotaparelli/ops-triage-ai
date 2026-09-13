import {
  ClassifierInvalidResponseError,
  ClassifierTimeoutError,
  ClassifierUnavailableError,
} from "../../application/errors/classifier-errors.ts";
import type { TriageClassifier } from "../../application/ports/triage-classifier.ts";
import type { ClassifierResult, TicketInput } from "../../domain/triage.ts";
import { suggestedTeamForCategory } from "../../domain/suggested-team.ts";
import {
  buildOllamaTicketPrompt,
  OLLAMA_TRIAGE_SYSTEM_PROMPT,
} from "./ollama-prompt-v1.ts";
import {
  OLLAMA_CLASSIFIER_RESULT_JSON_SCHEMA,
  OllamaClassifierResultSchema,
} from "./ollama-result-schema.ts";
import { z } from "zod";

export interface OllamaTriageClassifierConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export type HttpFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const OllamaResponseSchema = z.object({
  message: z.object({
    content: z.string().refine((value) => value.trim().length > 0),
  }),
});

export class OllamaTriageClassifier implements TriageClassifier {
  constructor(
    private readonly config: OllamaTriageClassifierConfig,
    private readonly fetchImpl: HttpFetch = fetch,
  ) {}

  async classify(input: TicketInput): Promise<ClassifierResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetchImpl(this.chatUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: OLLAMA_TRIAGE_SYSTEM_PROMPT },
            { role: "user", content: buildOllamaTicketPrompt(input) },
          ],
          stream: false,
          format: OLLAMA_CLASSIFIER_RESULT_JSON_SCHEMA,
          options: { temperature: 0 },
        }),
      });

      if (!response.ok) throw new ClassifierUnavailableError();

      let envelope: unknown;
      try {
        envelope = await response.json();
      } catch {
        throw new ClassifierInvalidResponseError();
      }

      const parsedEnvelope = OllamaResponseSchema.safeParse(envelope);
      if (!parsedEnvelope.success) throw new ClassifierInvalidResponseError();

      let content: unknown;
      try {
        content = JSON.parse(parsedEnvelope.data.message.content);
      } catch {
        throw new ClassifierInvalidResponseError();
      }

      const result = OllamaClassifierResultSchema.safeParse(content);
      if (!result.success) throw new ClassifierInvalidResponseError();
      return {
        ...result.data,
        suggestedTeam: suggestedTeamForCategory(result.data.category),
      };
    } catch (error) {
      if (error instanceof ClassifierTimeoutError) throw error;
      if (controller.signal.aborted) throw new ClassifierTimeoutError();
      if (
        error instanceof ClassifierInvalidResponseError ||
        error instanceof ClassifierUnavailableError
      ) {
        throw error;
      }
      throw new ClassifierUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }

  private chatUrl(): string {
    const baseUrl = this.config.baseUrl.endsWith("/")
      ? this.config.baseUrl
      : this.config.baseUrl + "/";
    return new URL("api/chat", baseUrl).toString();
  }
}
