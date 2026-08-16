import type { Scene } from "@studio/shared";

export type VideoProviderConfig = { provider: string; model: string; aspect_ratio: string };

export interface VideoProvider {
  generateScene(scene: Scene, config: VideoProviderConfig): Promise<{ asset_path: string }>;
}

export interface AudioProvider {
  generateDialogue(dialogue: string, voice: string): Promise<{ asset_path: string }>;
}

export interface ImageProvider {
  generateReference(prompt: string): Promise<{ asset_path: string }>;
}

export interface ResearchProvider {
  search(query: string): Promise<{ title: string; url: string; excerpt: string }[]>;
}
