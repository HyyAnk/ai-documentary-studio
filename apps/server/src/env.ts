import { readFile } from "node:fs/promises";
import path from "node:path";

const serverEnvKeys = new Set([
  "SHOPAIKEY_API_KEY",
  "SHOPAIKEY_BASE_URL",
  "SHOPAIKEY_IMAGE_MODEL",
  "SHOPAIKEY_IMAGE_SIZE",
  "SHOPAIKEY_IMAGE_QUALITY",
]);

/** Load only server-side ShopAIKey settings without overriding the parent environment. */
export async function loadServerEnv(rootDirectory: string): Promise<void> {
  const content = await readFile(path.join(rootDirectory, ".env"), "utf8").catch(() => "");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !serverEnvKeys.has(match[1]) || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2").trim();
    if (value) process.env[match[1]] = value;
  }
}
