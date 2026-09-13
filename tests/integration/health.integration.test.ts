import { afterAll, describe, expect, it } from "vitest";
import { closePrisma } from "../../src/db.ts";
import { startServer } from "../../src/server.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const PORT = Number(process.env["HEALTH_TEST_PORT"] ?? "3459");

/**
 * Real path: PostgreSQL disponível → Bun.serve → GET /health → 200 healthy.
 * Requires a live database (CI integration job). Fails without one —
 * that failure is the honest signal, never mocked here.
 */
describe("GET /health with real PostgreSQL", () => {
  it("returns 200 healthy with db up", async () => {
    if (!DATABASE_URL) throw new Error("DATABASE_URL is required for integration tests");
    const server = startServer(PORT, DATABASE_URL);
    try {
      const res = await fetch(`http://localhost:${server.port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "healthy", db: "up" });
    } finally {
      server.stop();
      await closePrisma();
    }
  });

  afterAll(async () => {
    await closePrisma();
  });
});
