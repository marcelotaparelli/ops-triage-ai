import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";

describe("config", () => {
  it("loads valid env", () => {
    const cfg = loadConfig({
      PORT: "3000",
      DATABASE_URL: "postgresql://ops:pw@localhost:5432/ops_triage?schema=public",
    });
    expect(cfg.PORT).toBe(3000);
    expect(cfg.DATABASE_URL).toContain("postgresql://");
    expect(cfg.TRIAGE_CLASSIFIER).toBe("deterministic");
  });

  it("loads Ollama settings only when the provider is selected", () => {
    const cfg = loadConfig({
      PORT: "3000",
      DATABASE_URL: "postgresql://x@y/z",
      TRIAGE_CLASSIFIER: "ollama",
      OLLAMA_BASE_URL: "http://localhost:11434",
      OLLAMA_MODEL: "qwen2.5:7b-instruct-q5_K_S",
      OLLAMA_TIMEOUT_MS: "120000",
    });
    expect(cfg).toMatchObject({
      TRIAGE_CLASSIFIER: "ollama",
      OLLAMA_BASE_URL: "http://localhost:11434",
      OLLAMA_MODEL: "qwen2.5:7b-instruct-q5_K_S",
      OLLAMA_TIMEOUT_MS: 120000,
    });
  });

  it("does not require Ollama settings for the deterministic provider", () => {
    expect(
      loadConfig({
        PORT: "3000",
        DATABASE_URL: "postgresql://x@y/z",
        TRIAGE_CLASSIFIER: "deterministic",
      }),
    ).toMatchObject({ TRIAGE_CLASSIFIER: "deterministic" });
  });

  it.each([
    ["OLLAMA_BASE_URL", { OLLAMA_MODEL: "model", OLLAMA_TIMEOUT_MS: "1000" }],
    [
      "OLLAMA_MODEL",
      { OLLAMA_BASE_URL: "http://localhost:11434", OLLAMA_TIMEOUT_MS: "1000" },
    ],
    [
      "OLLAMA_TIMEOUT_MS",
      { OLLAMA_BASE_URL: "http://localhost:11434", OLLAMA_MODEL: "model" },
    ],
  ])("requires %s for the Ollama provider", (field, ollamaEnv) => {
    expect(() =>
      loadConfig({
        PORT: "3000",
        DATABASE_URL: "postgresql://x@y/z",
        TRIAGE_CLASSIFIER: "ollama",
        ...ollamaEnv,
      }),
    ).toThrow(new RegExp(field));
  });

  it("rejects invalid provider and Ollama settings", () => {
    expect(() =>
      loadConfig({
        PORT: "3000",
        DATABASE_URL: "postgresql://x@y/z",
        TRIAGE_CLASSIFIER: "unknown",
      }),
    ).toThrow(/TRIAGE_CLASSIFIER/);
    expect(() =>
      loadConfig({
        PORT: "3000",
        DATABASE_URL: "postgresql://x@y/z",
        TRIAGE_CLASSIFIER: "ollama",
        OLLAMA_BASE_URL: "file:///tmp/ollama.sock",
        OLLAMA_MODEL: "model",
        OLLAMA_TIMEOUT_MS: "0",
      }),
    ).toThrow(/OLLAMA_BASE_URL|OLLAMA_TIMEOUT_MS/);
  });

  it("fails fast on missing DATABASE_URL", () => {
    expect(() => loadConfig({ PORT: "3000" })).toThrow(/DATABASE_URL/);
  });

  it("fails fast on invalid PORT", () => {
    expect(() =>
      loadConfig({ PORT: "abc", DATABASE_URL: "postgresql://x@y/z" }),
    ).toThrow(/PORT/);
  });

  it("fails fast on non-postgres DATABASE_URL", () => {
    expect(() =>
      loadConfig({ PORT: "3000", DATABASE_URL: "mysql://x@y/z" }),
    ).toThrow(/postgresql/);
  });

  it("never echoes the connection string in the error", () => {
    const secret = "postgresql://ops:super-secret-pw@localhost:5432/db";
    try {
      loadConfig({ PORT: "99999", DATABASE_URL: secret });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain("super-secret-pw");
    }
  });
});
