import { loadConfig } from "./config.ts";
import { startServer } from "./server.ts";

const config = loadConfig();
const server = startServer(config.PORT, config.DATABASE_URL);
console.log(`ops-triage-ai listening on :${server.port}`);
