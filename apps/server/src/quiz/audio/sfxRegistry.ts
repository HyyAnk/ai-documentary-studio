import type { SfxIntent } from "./types.js";

export type SfxAsset = { intent: SfxIntent; path: string; decorative: boolean };

export class SfxRegistry {
  private readonly assets = new Map<SfxIntent, SfxAsset>();

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
