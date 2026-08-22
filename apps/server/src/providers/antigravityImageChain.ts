import type { ImageProvider } from "./index.js";
import { AntigravityNativeImageProvider } from "./antigravityNativeImage.js";
import { GoogleImagenProvider } from "./googleImagen.js";
import { PngEncoderProvider } from "./pngEncoder.js";
import { RepositoryError, RepositoryService } from "../repository.js";
import { StudioLogger } from "../logger.js";
import { AntigravityClient } from "../antigravity.js";

type AntigravityImageTarget = {
  channelId: string;
  episodeId: string;
  bundleNumber?: number;
  variant?: number;
  assetId?: string;
  fingerprint?: string;
  theme?: string;
};

export class AntigravityImageChainProvider implements ImageProvider {
  private readonly imagenTier: GoogleImagenProvider | null = null;
  private readonly tier1: AntigravityNativeImageProvider;
  private readonly tier3: PngEncoderProvider;
  private readonly logger: StudioLogger;
  private readonly allowTier3Fallback: boolean;

  constructor(
    repository: RepositoryService,
    private readonly target: AntigravityImageTarget,
    client?: AntigravityClient,
    options: { allowTier3Fallback?: boolean; apiKey?: string } = {},
  ) {
    const apiKey = options.apiKey || (client as unknown as { config?: { antigravity?: { api_key?: string } } })?.config?.antigravity?.api_key || "";
    if (apiKey.trim()) {
      this.imagenTier = new GoogleImagenProvider(repository, target, apiKey.trim(), "gemini-3.1-flash-lite-image");
    }
    this.tier1 = new AntigravityNativeImageProvider(repository, target, client);
    this.tier3 = new PngEncoderProvider(repository, target);
    this.logger = new StudioLogger(repository.rootDirectory);
    this.allowTier3Fallback = options.allowTier3Fallback ?? false;
  }

  async generateReference(prompt: string, cancellationSignal?: AbortSignal): Promise<{ asset_path: string; fallback_tier: number; degraded: boolean }> {
    const context = { profileId: this.target.channelId, workerId: this.target.episodeId, step: "antigravity_image_chain" };
    let tier1Error: Error | null = null;

    // Tier 1A: Google Gemini Flash Lite Image (gemini-3.1-flash-lite-image) if API Key is available
    if (this.imagenTier) {
      try {
        const result = await this.imagenTier.generateReference(prompt, cancellationSignal);
        this.logger.info("Generated image with Google Gemini Flash Lite Image (gemini-3.1-flash-lite-image)", context);
        return result;
      } catch (error) {
        tier1Error = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`Google Gemini Flash Lite Image (gemini-3.1-flash-lite-image) failed: ${tier1Error.message}, falling back to Native Tool...`, context);
      }
    }

    // Tier 1B: Antigravity Native Image Tool (Direct Zero-API-Key Generation via IDE session using gemini-3.1-flash-image)
    try {
      const result = await this.tier1.generateReference(prompt, cancellationSignal);
      this.logger.info("Generated image with Tier 1 (Antigravity Native Tool - gemini-3.1-flash-image)", context);
      return result;
    } catch (error) {
      tier1Error = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`Tier 1 (Antigravity Native Tool) failed: ${tier1Error.message}`, context);
    }

    // No Tier 2 repeated/reused image fallback. If generation failed and deterministic fallback is not enabled, fail immediately.
    if (!this.allowTier3Fallback) {
      const reason = tier1Error?.message || "Unknown error";
      this.logger.error(`Image generation failed: ${reason}`, context);
      throw new RepositoryError(`Image generation failed: ${reason}`, "IMAGE_GENERATION_FAILED");
    }

    // Tier 3: Theme-Aware PNG Encoder Placeholder (only when explicitly permitted)
    const result = await this.tier3.generateReference(prompt);
    this.logger.warn("Resolved image with Tier 3 (Deterministic Fallback Placeholder, marked degraded: true)", context);
    return result;
  }
}


