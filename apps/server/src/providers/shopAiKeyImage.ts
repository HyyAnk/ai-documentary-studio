import type { ImageProvider } from "./index.js";
import { RepositoryError, RepositoryService } from "../repository.js";

type ShopAiKeyImageTarget = {
  channelId: string;
  episodeId: string;
  bundleNumber: number;
  variant: number;
};

type ImageResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string; code?: string; type?: string };
};

const DEFAULT_BASE_URL = "https://direct.shopaikey.com/v1";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_SIZE = "1536x1024";
const DEFAULT_QUALITY = "low";

export class ShopAiKeyImageProvider implements ImageProvider {
  constructor(
    private readonly repository: RepositoryService,
    private readonly target: ShopAiKeyImageTarget,
  ) {}

  static isConfigured(): boolean {
    return Boolean(process.env.SHOPAIKEY_API_KEY?.trim());
  }

  async generateReference(prompt: string): Promise<{ asset_path: string }> {
    const apiKey = process.env.SHOPAIKEY_API_KEY?.trim();
    if (!apiKey) throw new RepositoryError("SHOPAIKEY_API_KEY is not configured on the server", "IMAGE_PROVIDER_NOT_CONFIGURED");

    const baseUrl = (process.env.SHOPAIKEY_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
    const model = process.env.SHOPAIKEY_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
    const size = process.env.SHOPAIKEY_IMAGE_SIZE?.trim() || DEFAULT_SIZE;
    const quality = process.env.SHOPAIKEY_IMAGE_QUALITY?.trim() || DEFAULT_QUALITY;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, prompt, size, quality, output_format: "png" }),
        signal: AbortSignal.timeout(15 * 60 * 1000),
      });
    } catch {
      throw new RepositoryError("ShopAIKey image API is unavailable", "IMAGE_PROVIDER_UNAVAILABLE");
    }

    const raw = await response.text();
    let payload: ImageResponse = {};
    try { payload = JSON.parse(raw) as ImageResponse; } catch { /* Preserve the provider status below. */ }
    if (!response.ok) {
      const providerMessage = payload.error?.message || raw.slice(0, 300) || "unknown provider error";
      throw new RepositoryError(`ShopAIKey image API failed (${response.status}): ${providerMessage}`, "IMAGE_PROVIDER_FAILED");
    }

    const result = payload.data?.[0];
    if (result?.b64_json) {
      const encoded = result.b64_json.replace(/^data:image\/[^;]+;base64,/i, "");
      return { asset_path: await this.repository.writeBundleImage(this.target.channelId, this.target.episodeId, this.target.bundleNumber, Buffer.from(encoded, "base64"), this.target.variant) };
    }
    if (result?.url) {
      const imageResponse = await fetch(result.url, { signal: AbortSignal.timeout(60_000) });
      if (!imageResponse.ok) throw new RepositoryError(`ShopAIKey image URL download failed (${imageResponse.status})`, "IMAGE_PROVIDER_FAILED");
      return { asset_path: await this.repository.writeBundleImage(this.target.channelId, this.target.episodeId, this.target.bundleNumber, new Uint8Array(await imageResponse.arrayBuffer()), this.target.variant) };
    }
    throw new RepositoryError("ShopAIKey image API returned no b64_json or url", "IMAGE_PROVIDER_EMPTY");
  }
}
