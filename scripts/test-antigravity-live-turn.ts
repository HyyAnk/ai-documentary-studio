import path from "node:path";
import { DEFAULT_CONFIG } from "../apps/server/src/config.js";
import { AntigravityClient } from "../apps/server/src/antigravity.js";
import { StudioLogger } from "../apps/server/src/logger.js";

async function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const logger = new StudioLogger(root);
  await logger.init();

  const client = new AntigravityClient(root, DEFAULT_CONFIG, logger);

  console.log("Detecting Antigravity installation...");
  const detection = await client.detectInstallation();
  console.log("Detection:", detection);

  console.log("Connecting to Antigravity...");
  await client.connect();
  console.log("Connected! isConnected =", client.isConnected);

  console.log("Getting models...");
  const models = await client.getModels();
  console.log("Models:", models);

  console.log("Starting a live turn with Antigravity (Zero API Key)...");
  const threadId = await client.startThread();
  let accumulatedOutput = "";

  client.on("notification", (event) => {
    if (event.method === "item/agentMessage/delta") {
      const delta = (event.params as { delta?: string })?.delta ?? "";
      accumulatedOutput += delta;
      process.stdout.write(delta);
    }
  });

  const turnId = await client.startTurn(
    threadId,
    "You are an assistant. Reply with exactly one short sentence confirming that the Antigravity IDE connection is live and healthy."
  );

  await new Promise<void>((resolve, reject) => {
    client.on("notification", (event) => {
      if (event.method === "turn/completed") {
        const turn = (event.params as { turn?: { status?: string; error?: { message?: string } } })?.turn;
        if (turn?.status === "completed") {
          resolve();
        } else {
          reject(new Error(`Turn failed: ${turn?.error?.message ?? turn?.status}`));
        }
      }
    });
  });

  console.log("\n[SUCCESS] Turn completed successfully!");
  console.log("Accumulated output:", accumulatedOutput.trim());
  await client.close();
}

main().catch((err) => {
  console.error("[FAILED]", err);
  process.exit(1);
});
