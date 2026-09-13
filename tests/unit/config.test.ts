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
