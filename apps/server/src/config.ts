import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { AppConfigSchema, type AppConfig } from "@studio/shared";

export const DEFAULT_CONFIG: AppConfig = {
  video_generation: {
    provider: "none",
    model: "",
    max_scene_duration_seconds: 8,
    default_scene_duration_seconds: 6,
    aspect_ratio: "16:9",
  },
  codex: {
    max_concurrent_tasks: 3,
    app_server_endpoint: "stdio://",
    command: "codex",
    model: "",
    experimental_api: false,
  },
};

export type StorageSettings = {
  storage_path: string;
};

const storageSettingsFilename = "storage.local.json";

export async function loadConfig(rootDirectory: string): Promise<AppConfig> {
  const configPath = path.join(rootDirectory, ".documentary-studio", "config.json");
  try {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    return AppConfigSchema.parse({
      ...DEFAULT_CONFIG,
      ...(raw as object),
      video_generation: { ...DEFAULT_CONFIG.video_generation, ...(raw as { video_generation?: object }).video_generation },
      codex: { ...DEFAULT_CONFIG.codex, ...(raw as { codex?: object }).codex },
    });
  } catch {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
    return DEFAULT_CONFIG;
  }
}

export async function loadStorageRoot(rootDirectory: string): Promise<string | null> {
  try {
    const settingsPath = path.join(rootDirectory, ".documentary-studio", storageSettingsFilename);
    const raw = JSON.parse(await readFile(settingsPath, "utf8")) as Partial<StorageSettings>;
    return typeof raw.storage_path === "string" && raw.storage_path.trim() ? path.resolve(rootDirectory, raw.storage_path) : null;
  } catch {
    return null;
  }
}

export async function saveStorageRoot(rootDirectory: string, storageRoot: string): Promise<void> {
  const settingsDirectory = path.join(rootDirectory, ".documentary-studio");
  await mkdir(settingsDirectory, { recursive: true });
  await writeFile(path.join(settingsDirectory, storageSettingsFilename), `${JSON.stringify({ storage_path: path.resolve(storageRoot) }, null, 2)}\n`, "utf8");
}
