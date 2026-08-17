import type { RepositoryService } from "../repository.js";
import type { AudioProvider } from "./index.js";

export type ChatterboxTarget = {
  channelId: string;
  episodeId: string;
  sceneNumber: number;
};

export type ChatterboxConfig = {
  service_url: string;
  exaggeration: number;
  cfg_weight: number;
};

export class AudioServiceUnavailableError extends Error {
  readonly code = "AUDIO_SERVICE_UNAVAILABLE";

  constructor(message = "Audio service unavailable") {
    super(message);
    this.name = "AudioServiceUnavailableError";
  }
}

export class ChatterboxProvider implements AudioProvider {
  constructor(
    private readonly repository: RepositoryService,
    private readonly config: ChatterboxConfig,
    private readonly target: ChatterboxTarget,
  ) {}

  async generateDialogue(dialogue: string, voice: string): Promise<{ asset_path: string }> {
    if (!dialogue.trim()) throw new Error("Scene dialogue cannot be empty");
    const body = {
      text: dialogue,
      ...(voice && voice !== "default" ? { voice_reference_path: voice } : {}),
      exaggeration: this.config.exaggeration,
      cfg_weight: this.config.cfg_weight,
    };
    let response: Response;
    try {
      response = await fetch(`${this.config.service_url.replace(/\/$/, "")}/synthesize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15 * 60 * 1000),
      });
    } catch {
      throw new AudioServiceUnavailableError();
    }
    if (!response.ok) throw new AudioServiceUnavailableError();
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.length < 12 || new TextDecoder().decode(audio.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(audio.slice(8, 12)) !== "WAVE") {
      throw new AudioServiceUnavailableError("Audio service returned an invalid WAV file");
    }
    const assetPath = await this.repository.writeSceneAudio(this.target.channelId, this.target.episodeId, this.target.sceneNumber, audio);
    return { asset_path: assetPath };
  }
}
