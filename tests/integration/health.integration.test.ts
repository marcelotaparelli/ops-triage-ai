import { describe, expect, it } from "vitest";
import { startBunServer, stopBunServer } from "./bun-server.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const PORT = Number(process.env["HEALTH_TEST_PORT"] ?? "3459");

/**
 * Real path: PostgreSQL available → Bun process → Bun.serve → GET /health → 200 healthy.
 * Requires a live database (CI integration job). Fails without one.
 */
describe("GET /health with real PostgreSQL", () => {
  it("returns 200 healthy with db up", async () => {
    if (!DATABASE_URL) throw new Error("DATABASE_URL is required for integration tests");
    const server = await startBunServer(PORT, DATABASE_URL);
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "healthy", db: "up" });
    } finally {
      await stopBunServer(server);
    }
  });
});
