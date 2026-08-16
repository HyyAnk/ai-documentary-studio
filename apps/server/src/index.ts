import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";

const workspaceRoot = process.env.STUDIO_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const app = await buildApp(workspaceRoot);
const port = Number(process.env.PORT ?? 4310);
const host = process.env.HOST ?? "127.0.0.1";
await app.server.listen({ port, host });
app.logger.ok(`AI Documentary Studio server listening on http://${host}:${port}`, { step: "startup", workerId: "server" });

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
