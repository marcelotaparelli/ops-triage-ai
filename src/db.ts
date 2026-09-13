import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

let client: PrismaClient | null = null;

export function getPrisma(databaseUrl: string): PrismaClient {
  if (client) return client;
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  client = new PrismaClient({ adapter });
  return client;
}

export async function closePrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

/** Safe tagged query — never $queryRawUnsafe. Returns true when DB answers. */
export async function checkDatabase(prisma: PrismaClient): Promise<boolean> {
  await prisma.$queryRaw`SELECT 1`;
  return true;
}
