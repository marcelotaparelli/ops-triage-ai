import { z } from "zod";

const BaseConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (v) => v.startsWith("postgresql://") || v.startsWith("postgres://"),
      "DATABASE_URL must be a postgresql connection string",
    ),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TRIAGE_API_KEY: z.string().trim().min(1).optional(),
  HTTP_BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(10_000_000).default(32_768),
  TRIAGE_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(1_000).default(8),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(600_000).default(310_000),
  STALE_RUN_THRESHOLD_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(600_000),
});

const OllamaSettingsSchema = z.object({
  OLLAMA_BASE_URL: z
    .url()
    .refine(
      (value) => value.startsWith("http://") || value.startsWith("https://"),
      "OLLAMA_BASE_URL must use http or https",
    ),
  OLLAMA_MODEL: z.string().trim().min(1, "OLLAMA_MODEL is required"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000),
});

const ConfigSchema = z.discriminatedUnion("TRIAGE_CLASSIFIER", [
  BaseConfigSchema.extend({
    TRIAGE_CLASSIFIER: z.literal("deterministic"),
  }),
  BaseConfigSchema.merge(OllamaSettingsSchema).extend({
    TRIAGE_CLASSIFIER: z.literal("ollama"),
  }),
  BaseConfigSchema.merge(OllamaSettingsSchema).extend({
    TRIAGE_CLASSIFIER: z.literal("hybrid"),
  }),
]);

export type AppConfig = z.infer<typeof ConfigSchema>;
export type OllamaSettings = z.infer<typeof OllamaSettingsSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse({
    PORT: env["PORT"],
    DATABASE_URL: env["DATABASE_URL"],
    TRIAGE_CLASSIFIER: env["TRIAGE_CLASSIFIER"] ?? "deterministic",
    OLLAMA_BASE_URL: env["OLLAMA_BASE_URL"],
    OLLAMA_MODEL: env["OLLAMA_MODEL"],
    OLLAMA_TIMEOUT_MS: env["OLLAMA_TIMEOUT_MS"],
    NODE_ENV: env["NODE_ENV"] ?? "development",
    TRIAGE_API_KEY: env["TRIAGE_API_KEY"],
    HTTP_BODY_LIMIT_BYTES: env["HTTP_BODY_LIMIT_BYTES"],
    TRIAGE_MAX_CONCURRENCY: env["TRIAGE_MAX_CONCURRENCY"],
    REQUEST_TIMEOUT_MS: env["REQUEST_TIMEOUT_MS"],
    STALE_RUN_THRESHOLD_MS: env["STALE_RUN_THRESHOLD_MS"],
  });
  if (!parsed.success) {
    throw configurationError(parsed.error);
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.TRIAGE_API_KEY) {
    throw new Error("Invalid configuration: TRIAGE_API_KEY is required in production");
  }
  return parsed.data;
}

export function loadOllamaSettings(
  env: Record<string, string | undefined> = process.env,
): OllamaSettings {
  const parsed = OllamaSettingsSchema.safeParse({
    OLLAMA_BASE_URL: env["OLLAMA_BASE_URL"],
    OLLAMA_MODEL: env["OLLAMA_MODEL"],
    OLLAMA_TIMEOUT_MS: env["OLLAMA_TIMEOUT_MS"],
  });
  if (!parsed.success) throw configurationError(parsed.error);
  return parsed.data;
}

function configurationError(error: z.ZodError): Error {
  const issues = error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  return new Error(`Invalid configuration: ${issues}`);
}
