import type { AppConfig, Channel, CodexSettingsResponse, StorageInfo } from "@studio/shared";

export type Page = "dashboard" | "channels" | "tasks" | "settings";
export type Notice = { tone: "good" | "bad" | "neutral"; message: string; title?: string; duration?: number } | null;
export type Theme = "dark" | "light";
export type GitInfo = { branch: string | null; dirty: boolean; changed_files: number };
export type AudioSettings = AppConfig["audio_generation"];
export type SettingsProps = { channels: Channel[]; appConfig: AppConfig | null; codex: CodexSettingsResponse | null; codexStatus: string; git: GitInfo; storage: StorageInfo | null };
