import { describe, expect, it } from "vitest";
import { checkDatabase, closePrisma, getPrisma } from "../../src/db.ts";

const DATABASE_URL = process.env["DATABASE_URL"];

describe("postgres/prisma integration", () => {
  it("connects and answers SELECT 1 (tagged query)", async () => {
    if (!DATABASE_URL) throw new Error("DATABASE_URL is required for integration tests");
    const prisma = getPrisma(DATABASE_URL);
    try {
      await expect(checkDatabase(prisma)).resolves.toBe(true);
      // Direct tagged raw query as second proof (safe API, never $queryRawUnsafe)
      const rows = (await prisma.$queryRaw`SELECT 1 AS one`) as Array<{ one: number }>;
      expect(rows[0]?.one).toBe(1);
    } finally {
      await closePrisma();
    }
  });
});
