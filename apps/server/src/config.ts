import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { AppConfigSchema, AudioSettingsInputSchema, CodexSettingsInputSchema, ImageSettingsInputSchema, VideoSettingsInputSchema, type AppConfig, type AudioSettingsInput, type CodexSettingsInput, type ImageSettingsInput, type VideoSettingsInput } from "@studio/shared";

export const DEFAULT_CONFIG: AppConfig = {
  video_generation: {
    provider: "none",
    model: "",
    max_scene_duration_seconds: 8,
    default_scene_duration_seconds: 6,
    narration_words_per_second: 2.3,
    aspect_ratio: "16:9",
  },
  image_generation: {
    enabled: false,
    images_per_bundle: 1,
  },
  codex: {
    max_concurrent_tasks: 3,
    transport: "app_server",
    app_server_endpoint: "stdio://",
    command: "codex",
    model: "",
    experimental_api: false,
    api_base_url: "",
    api_key: "",
    auto_delete_threads: true,
    failed_thread_retention_days: 7,
  },
  audio_generation: {
    provider: "chatterbox",
    service_url: "http://127.0.0.1:8890",
    exaggeration: 0.5,
    cfg_weight: 0.5,
    max_concurrent_tasks: 2,
    merge_gap_ms: 300,
    match_target_duration: true,
  },
};

export type StorageSettings = {
  storage_path: string;
};

const storageSettingsFilename = "storage.local.json";
const codexSettingsFilename = "codex.local.json";
const audioSettingsFilename = "audio.local.json";
const imageSettingsFilename = "image.local.json";

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function loadConfig(rootDirectory: string): Promise<AppConfig> {
  const configPath = path.join(rootDirectory, ".documentary-studio", "config.json");
  const localConfigPath = path.join(rootDirectory, ".documentary-studio", codexSettingsFilename);
  try {
    const raw = await readJsonFile(configPath);
    const local = await readJsonFile(localConfigPath);
    const localAudio = await readJsonFile(path.join(rootDirectory, ".documentary-studio", audioSettingsFilename));
    const localImage = await readJsonFile(path.join(rootDirectory, ".documentary-studio", imageSettingsFilename));
    const trackedCodex = raw.codex && typeof raw.codex === "object" ? raw.codex as Record<string, unknown> : {};
    const localCodex = local.codex && typeof local.codex === "object" ? local.codex as Record<string, unknown> : {};
    const trackedAudio = raw.audio_generation && typeof raw.audio_generation === "object" ? raw.audio_generation as Record<string, unknown> : {};
    const localAudioSettings = localAudio.audio_generation && typeof localAudio.audio_generation === "object" ? localAudio.audio_generation as Record<string, unknown> : {};
    const trackedImages = raw.image_generation && typeof raw.image_generation === "object" ? raw.image_generation as Record<string, unknown> : {};
    const localImageSettings = localImage.image_generation && typeof localImage.image_generation === "object" ? localImage.image_generation as Record<string, unknown> : {};
    return AppConfigSchema.parse({
      ...DEFAULT_CONFIG,
      ...raw,
      video_generation: { ...DEFAULT_CONFIG.video_generation, ...(raw.video_generation as object | undefined) },
      codex: { ...DEFAULT_CONFIG.codex, ...trackedCodex, api_key: "", ...localCodex },
      audio_generation: { ...DEFAULT_CONFIG.audio_generation, ...trackedAudio, ...localAudioSettings },
      image_generation: { ...DEFAULT_CONFIG.image_generation, ...trackedImages, ...localImageSettings },
    });
  } catch {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
    const local = await readJsonFile(localConfigPath);
    const localCodex = local.codex && typeof local.codex === "object" ? local.codex as Record<string, unknown> : {};
    const localAudio = await readJsonFile(path.join(rootDirectory, ".documentary-studio", audioSettingsFilename));
    const localAudioSettings = localAudio.audio_generation && typeof localAudio.audio_generation === "object" ? localAudio.audio_generation as Record<string, unknown> : {};
    const localImage = await readJsonFile(path.join(rootDirectory, ".documentary-studio", imageSettingsFilename));
    const localImageSettings = localImage.image_generation && typeof localImage.image_generation === "object" ? localImage.image_generation as Record<string, unknown> : {};
    return AppConfigSchema.parse({ ...DEFAULT_CONFIG, codex: { ...DEFAULT_CONFIG.codex, ...localCodex }, audio_generation: { ...DEFAULT_CONFIG.audio_generation, ...localAudioSettings }, image_generation: { ...DEFAULT_CONFIG.image_generation, ...localImageSettings } });
  }
}

export async function saveCodexSettings(rootDirectory: string, input: CodexSettingsInput): Promise<AppConfig> {
  const parsed = CodexSettingsInputSchema.parse(input);
  const settingsDirectory = path.join(rootDirectory, ".documentary-studio");
  const localPath = path.join(settingsDirectory, codexSettingsFilename);
  const currentLocal = await readJsonFile(localPath);
  const currentCodex = currentLocal.codex && typeof currentLocal.codex === "object" ? currentLocal.codex as Record<string, unknown> : {};
  const nextCodex = { ...currentCodex } as Record<string, unknown>;
  for (const key of ["transport", "model", "api_base_url", "api_key", "app_server_endpoint", "command", "auto_delete_threads", "failed_thread_retention_days"] as const) {
    const value = parsed[key];
    if (value !== undefined) nextCodex[key] = value;
  }
  await mkdir(settingsDirectory, { recursive: true });
  await writeFile(localPath, `${JSON.stringify({ codex: nextCodex }, null, 2)}\n`, "utf8");
  return loadConfig(rootDirectory);
}

export async function saveAudioSettings(rootDirectory: string, input: AudioSettingsInput): Promise<AppConfig> {
  const parsed = AudioSettingsInputSchema.parse(input);
  const settingsDirectory = path.join(rootDirectory, ".documentary-studio");
  const localPath = path.join(settingsDirectory, audioSettingsFilename);
  const currentLocal = await readJsonFile(localPath);
  const currentAudio = currentLocal.audio_generation && typeof currentLocal.audio_generation === "object" ? currentLocal.audio_generation as Record<string, unknown> : {};
  const nextAudio = { ...currentAudio } as Record<string, unknown>;
  for (const key of ["provider", "service_url", "exaggeration", "cfg_weight", "max_concurrent_tasks", "merge_gap_ms", "match_target_duration"] as const) {
    const value = parsed[key];
    if (value !== undefined) nextAudio[key] = value;
  }
  await mkdir(settingsDirectory, { recursive: true });
  await writeFile(localPath, `${JSON.stringify({ audio_generation: nextAudio }, null, 2)}\n`, "utf8");
  return loadConfig(rootDirectory);
}

export async function saveVideoSettings(rootDirectory: string, input: VideoSettingsInput): Promise<AppConfig> {
  const parsed = VideoSettingsInputSchema.parse(input);
  const current = await loadConfig(rootDirectory);
  const next = { ...current.video_generation, ...parsed };
  const configPath = path.join(rootDirectory, ".documentary-studio", "config.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  const raw = await readJsonFile(configPath);
  await writeFile(configPath, `${JSON.stringify({ ...raw, video_generation: next }, null, 2)}\n`, "utf8");
  return loadConfig(rootDirectory);
}

export async function saveImageSettings(rootDirectory: string, input: ImageSettingsInput): Promise<AppConfig> {
  const parsed = ImageSettingsInputSchema.parse(input);
  const settingsDirectory = path.join(rootDirectory, ".documentary-studio");
  const localPath = path.join(settingsDirectory, imageSettingsFilename);
  const currentLocal = await readJsonFile(localPath);
  const currentImage = currentLocal.image_generation && typeof currentLocal.image_generation === "object" ? currentLocal.image_generation as Record<string, unknown> : {};
  const nextImage = { ...currentImage } as Record<string, unknown>;
  for (const key of ["enabled", "images_per_bundle"] as const) {
    const value = parsed[key];
    if (value !== undefined) nextImage[key] = value;
  }
  await mkdir(settingsDirectory, { recursive: true });
  await writeFile(localPath, `${JSON.stringify({ image_generation: nextImage }, null, 2)}\n`, "utf8");
  return loadConfig(rootDirectory);
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
