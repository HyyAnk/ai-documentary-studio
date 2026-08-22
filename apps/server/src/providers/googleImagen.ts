import type { ImageProvider } from "./index.js";
import { RepositoryError, RepositoryService } from "../repository.js";
import { StudioLogger } from "../logger.js";

type GoogleImagenTarget = {
  channelId: string;
  episodeId: string;
  bundleNumber?: number;
  variant?: number;
  assetId?: string;
  fingerprint?: string;
};

export class GoogleImagenProvider implements ImageProvider {
  private readonly logger: StudioLogger;

  constructor(
    private readonly repository: RepositoryService,
    private readonly target: GoogleImagenTarget,
    private readonly apiKey: string,
    private readonly model: string = "gemini-3.1-flash-image",
    private readonly apiBaseUrl: string = "https://generativelanguage.googleapis.com/v1beta",
  ) {
    this.logger = new StudioLogger(repository.rootDirectory);
  }

  async generateReference(prompt: string, cancellationSignal?: AbortSignal): Promise<{ asset_path: string; fallback_tier: number; degraded: boolean }> {
    if (!this.apiKey.trim()) {
      throw new RepositoryError(`Google Gemini/Imagen API Key is required for ${this.model}`, "API_KEY_REQUIRED");
    }

    const cleanPrompt = this.extractCleanVisualPrompt(prompt);
    const isGeminiContentModel = !this.model.startsWith("imagen-");
    const method = isGeminiContentModel ? "generateContent" : "predict";
    const url = `${this.apiBaseUrl.replace(/\/+$/, "")}/models/${this.model}:${method}?key=${this.apiKey.trim()}`;

    const requestBody = isGeminiContentModel
      ? {
          contents: [
            {
              parts: [{ text: `${cleanPrompt}, 16:9 aspect ratio, high quality` }],
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
          },
        }
      : {
          instances: [
            {
              prompt: cleanPrompt,
            },
          ],
          parameters: {
            sampleCount: 1,
            aspectRatio: "16:9",
            outputOptions: {
              mimeType: "image/png",
            },
          },
        };

    const maxAttempts = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (cancellationSignal?.aborted) throw new Error("Image generation aborted");

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: cancellationSignal,
        });

        if (!response.ok) {
          const raw = await response.text();
          if (response.status === 401 || response.status === 403) {
            throw new RepositoryError(`Google Gemini/Imagen API key is unauthorized (${response.status})`, "IMAGE_GENERATION_FAILED");
          }
          if (response.status === 429) {
            throw new RepositoryError(`Google Gemini/Imagen quota exceeded (429)`, "RATE_LIMIT_EXCEEDED");
          }
          throw new RepositoryError(`Google Gemini/Imagen request failed (${response.status}): ${raw.slice(0, 200)}`, "IMAGE_GENERATION_FAILED");
        }

        const data = (await response.json()) as {
          predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
          candidates?: Array<{
            content?: {
              parts?: Array<{
                text?: string;
                inlineData?: { data?: string; mimeType?: string };
                inline_data?: { data?: string; mime_type?: string };
              }>;
            };
          }>;
        };

        const base64 =
          data.predictions?.[0]?.bytesBase64Encoded ??
          data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data)?.inlineData?.data ??
          data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data)?.inline_data?.data;

        if (!base64) {
          throw new RepositoryError("Google Gemini/Imagen did not return image bytes", "IMAGE_GENERATION_FAILED");
        }

        const imageBytes = Buffer.from(base64, "base64");
        let assetPath: string;
        if (this.target.assetId && this.target.fingerprint) {
          assetPath = await this.repository.writeQuizImageAsset(this.target.channelId, this.target.episodeId, this.target.assetId, this.target.fingerprint, imageBytes);
        } else {
          assetPath = await this.repository.writeBundleImage(this.target.channelId, this.target.episodeId, this.target.bundleNumber ?? 1, imageBytes, this.target.variant ?? 0);
        }

        const cooldownMs = process.env.NODE_ENV === "test" ? 10 : 8000;
        await new Promise((r) => setTimeout(r, cooldownMs));

        return { asset_path: assetPath, fallback_tier: 1, degraded: false };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxAttempts) {
          const isRateLimit = lastError instanceof RepositoryError && lastError.code === "RATE_LIMIT_EXCEEDED";
          const delay = process.env.NODE_ENV === "test" ? 20 : isRateLimit ? attempt * 5000 : attempt * 2000;
          this.logger.warn(`Google Imagen attempt ${attempt} failed (${lastError.message}), retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError || new RepositoryError("Google Imagen generation failed", "IMAGE_GENERATION_FAILED");
  }

  private extractCleanVisualPrompt(rawPrompt: string): string {
    const anchorMatch = rawPrompt.match(/Anchor[- ]frame prompt\s*:\s*([^\n\r]+)/i);
    if (anchorMatch && anchorMatch[1].trim()) {
      return anchorMatch[1].replace(/[`"]/g, "").replace(/\s+/g, " ").trim().slice(0, 450);
    }
    return rawPrompt.replace(/\s+/g, " ").trim().slice(0, 450);
  }
}
