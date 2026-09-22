import { writeFileSync } from "node:fs";

/** Reserve before making any request. Existing/incomplete attempts require manual review. */
export function reserveJevRun(path: string, metadata: unknown): void {
  writeFileSync(path, JSON.stringify(metadata) + "\n", { flag: "wx" });
}
