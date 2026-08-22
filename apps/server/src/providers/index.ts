import type { Scene } from "@studio/shared";

export type VideoProviderConfig = { provider: string; model: string; aspect_ratio: string };

export interface VideoProvider {
  generateScene(scene: Scene, config: VideoProviderConfig): Promise<{ asset_path: string }>;
}

export interface AudioProvider {
  generateDialogue(dialogue: string, voice: string): Promise<{ asset_path: string }>;
}

export interface ImageProvider {
  generateReference(prompt: string, cancellationSignal?: AbortSignal): Promise<{ asset_path: string; fallback_tier?: number; degraded?: boolean }>;
}

export interface ResearchProvider {
  search(query: string): Promise<{ title: string; url: string; excerpt: string }[]>;
}

export * from "./codexImage.js";
export * from "./shopAiKeyImage.js";
export * from "./antigravityNativeImage.js";
export * from "./matchAiArt.js";
export * from "./pngEncoder.js";
export * from "./googleImagen.js";
export * from "./antigravityImageChain.js";
export * from "./chatterbox.js";
