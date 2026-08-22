import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageProvider } from "./index.js";
import { RepositoryError, RepositoryService } from "../repository.js";

type MatchAiArtTarget = {
  channelId: string;
  episodeId: string;
  bundleNumber?: number;
  variant?: number;
  assetId?: string;
  fingerprint?: string;
};

export class MatchAiArtProvider implements ImageProvider {
  constructor(
    private readonly repository: RepositoryService,
    private readonly target: MatchAiArtTarget,
    private readonly artDirectory = path.join(repository.rootDirectory, "assets", "ai-art"),
  ) {}

  async generateReference(prompt: string): Promise<{ asset_path: string; fallback_tier: number; degraded: false }> {
    const matchingPath = await this.findMatchingArt(prompt);
    if (!matchingPath) {
      throw new RepositoryError("No matching 3D cinematic AI art asset found in assets/ai-art/", "AI_ART_NOT_FOUND");
    }

    const bytes = await readFile(matchingPath);
    let assetPath: string;
    if (this.target.assetId && this.target.fingerprint) {
      assetPath = await this.repository.writeQuizImageAsset(this.target.channelId, this.target.episodeId, this.target.assetId, this.target.fingerprint, bytes);
    } else {
      assetPath = await this.repository.writeBundleImage(this.target.channelId, this.target.episodeId, this.target.bundleNumber ?? 1, bytes, this.target.variant ?? 0);
    }

    return { asset_path: assetPath, fallback_tier: 2, degraded: false };
  }

  private async findMatchingArt(prompt: string): Promise<string | null> {
    try {
      const entries = await readdir(this.artDirectory, { withFileTypes: true });
      const imageFiles = entries.filter((e) => e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)).map((e) => e.name);
      if (imageFiles.length === 0) return null;

      const normalizedPrompt = prompt.toLowerCase();
      const tokens = normalizedPrompt.match(/[\p{L}\p{N}]+/gu) ?? [];
      const tokenSet = new Set(tokens.filter((t) => t.length >= 3));

      let bestMatch = imageFiles[0];
      let bestScore = -1;

      for (const filename of imageFiles) {
        const nameWithoutExt = path.parse(filename).name.toLowerCase();
        const nameTokens = nameWithoutExt.split(/[-_ ]+/);
        let score = 0;
        for (const token of nameTokens) {
          if (tokenSet.has(token)) score += 2;
          else if (normalizedPrompt.includes(token)) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestMatch = filename;
        }
      }

      return path.join(this.artDirectory, bestMatch);
    } catch {
      return null;
    }
  }
}
