import path from "node:path";
import type { SfxIntent } from "./types.js";

export type SfxAsset = { intent: SfxIntent; path: string; decorative: boolean };

export const DEFAULT_SFX_MAP: Record<SfxIntent, string> = {
  ui_pop: "ui_pop.wav",
  ui_soft: "ui_pop.wav",
  countdown_tick: "countdown_tick.wav",
  countdown_final: "countdown_final.wav",
  correct_small: "correct_ding.wav",
  correct_medium: "correct_ding.wav",
  correct_big: "correct_triumph.wav",
  transition_soft: "bubble_splash.wav",
  transition_fast: "lightning_brush.wav",
  score_gain: "streak.wav",
  streak: "streak.wav",
};

export class SfxRegistry {
  private readonly assets = new Map<SfxIntent, SfxAsset>();

  constructor(baseDirectory?: string) {
    if (baseDirectory) {
      for (const [intent, filename] of Object.entries(DEFAULT_SFX_MAP)) {
        this.register({
          intent: intent as SfxIntent,
          path: path.join(baseDirectory, filename),
          decorative: true,
        });
      }
    }
  }

  register(asset: SfxAsset): void {
    this.assets.set(asset.intent, asset);
  }

  resolve(intent: SfxIntent): SfxAsset | null {
    return this.assets.get(intent) ?? null;
  }

  resolveMany(intents: SfxIntent[]): { assets: SfxAsset[]; missing: SfxIntent[] } {
    const assets: SfxAsset[] = [];
    const missing: SfxIntent[] = [];
    for (const intent of intents) {
      const asset = this.resolve(intent);
      if (asset) assets.push(asset);
      else missing.push(intent);
    }
    return { assets, missing };
  }
}
