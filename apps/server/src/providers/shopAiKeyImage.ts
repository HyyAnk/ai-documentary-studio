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
const DEFAULT_MODELS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-2-all"] as const;
const DEFAULT_SIZE = "1536x1024";
const DEFAULT_QUALITY = "low";
const MAX_ATTEMPTS = 3;
const IMAGE_REQUEST_TIMEOUT_MS = 180_000;
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function waitForRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
}

function compactImagePrompt(prompt: string): string {
  const bundle = prompt.match(/--- FILE:[^\n]*visual_bible\.md#[^\n]*\n([\s\S]*?)(?=\n--- FILE:|$)/i)?.[1]?.trim();
  if (!bundle) return prompt;
  return [
    "Create one 16:9 documentary continuity anchor image.",
    "Preserve every visual detail in this continuity bundle, including era, location, subjects, objects, palette, lighting, camera, action, atmosphere, and continuity:",
    bundle,
    "Do not add captions, charts, watermarks, labels, logos, or readable text.",
  ].join("\n\n");
}

function imageModelChain(): string[] {
  const primary = process.env.SHOPAIKEY_IMAGE_MODEL?.trim() || DEFAULT_MODELS[0];
  const configuredFallbacks = process.env.SHOPAIKEY_IMAGE_FALLBACK_MODELS?.split(",")
    .map((model) => model.trim())
    .filter(Boolean)
    ?? [];
  // Preserve the previous one-model setting for existing deployments.
  const legacyFallback = process.env.SHOPAIKEY_IMAGE_FALLBACK_MODEL?.trim();
  const fallbacks = configuredFallbacks.length > 0
    ? configuredFallbacks
    : legacyFallback
      ? [legacyFallback]
      : DEFAULT_MODELS.slice(1);
  return [...new Set([primary, ...fallbacks])];
}

function canTryNextModel(status: number): boolean {
  // Credentials and access policy cannot be repaired by changing the model.
  return status !== 401 && status !== 403;
}

export async function generateShopAiKeyImageBytes(prompt: string, cancellationSignal?: AbortSignal): Promise<Uint8Array> {
  const apiKey = process.env.SHOPAIKEY_API_KEY?.trim();
  if (!apiKey) throw new RepositoryError("SHOPAIKEY_API_KEY is not configured on the server", "IMAGE_PROVIDER_NOT_CONFIGURED");
  const baseUrl = (process.env.SHOPAIKEY_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const size = process.env.SHOPAIKEY_IMAGE_SIZE?.trim() || DEFAULT_SIZE;
  const quality = process.env.SHOPAIKEY_IMAGE_QUALITY?.trim() || DEFAULT_QUALITY;
  let lastNetworkError: unknown = null;
  let lastFailureMessage = "unknown provider error";
  const requestedModels = imageModelChain();
  for (const [modelIndex, requestedModel] of requestedModels.entries()) {
    let retryFallback = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const requestSignal = cancellationSignal ? AbortSignal.any([cancellationSignal, AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/images/generations`, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: requestedModel, prompt: compactImagePrompt(prompt), size, quality, output_format: "png" }), signal: requestSignal });
      } catch (error) {
        lastNetworkError = error;
        if (attempt < MAX_ATTEMPTS && !(modelIndex < requestedModels.length - 1 && attempt === 1)) { await waitForRetry(attempt); continue; }
        retryFallback = modelIndex < requestedModels.length - 1;
        break;
      }
      const raw = await response.text();
      let payload: ImageResponse = {};
      try { payload = JSON.parse(raw) as ImageResponse; } catch { /* Preserve provider status below. */ }
      if (!response.ok) {
        const providerMessage = payload.error?.message || raw.slice(0, 300) || "unknown provider error";
        lastFailureMessage = providerMessage;
        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) { await waitForRetry(attempt); continue; }
        if (canTryNextModel(response.status) && modelIndex < requestedModels.length - 1) { retryFallback = true; break; }
        throw new RepositoryError(`ShopAIKey image API failed (${response.status}): ${providerMessage}`, "IMAGE_PROVIDER_FAILED");
      }
      const result = payload.data?.[0];
      if (result?.b64_json) return Buffer.from(result.b64_json.replace(/^data:image\/[^;]+;base64,/i, ""), "base64");
      if (result?.url) {
        const imageResponse = await fetch(result.url, { signal: cancellationSignal ? AbortSignal.any([cancellationSignal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
        if (!imageResponse.ok) throw new RepositoryError(`ShopAIKey image URL download failed (${imageResponse.status})`, "IMAGE_PROVIDER_FAILED");
        return new Uint8Array(await imageResponse.arrayBuffer());
      }
      lastFailureMessage = "ShopAIKey image API returned no b64_json or url";
      if (modelIndex < requestedModels.length - 1) { retryFallback = true; break; }
      throw new RepositoryError(lastFailureMessage, "IMAGE_PROVIDER_EMPTY");
    }
    if (!retryFallback) break;
  }
  if (lastNetworkError) throw new RepositoryError(`ShopAIKey image API unavailable for ${requestedModels.join(" then ")}`, "IMAGE_PROVIDER_UNAVAILABLE");
  throw new RepositoryError(`ShopAIKey image API failed for ${requestedModels.join(" then ")}: ${lastFailureMessage}`, "IMAGE_PROVIDER_FAILED");
}

export class ShopAiKeyImageProvider implements ImageProvider {
  constructor(
    private readonly repository: RepositoryService,
    private readonly target: ShopAiKeyImageTarget,
  ) {}

  static isConfigured(): boolean {
    return Boolean(process.env.SHOPAIKEY_API_KEY?.trim());
  }

  async generateReference(prompt: string, cancellationSignal?: AbortSignal): Promise<{ asset_path: string }> {
    return { asset_path: await this.repository.writeBundleImage(this.target.channelId, this.target.episodeId, this.target.bundleNumber, await generateShopAiKeyImageBytes(prompt, cancellationSignal), this.target.variant) };
  }
}

export class ShopAiKeyQuizImageProvider {
  constructor(private readonly repository: RepositoryService, private readonly target: { channelId: string; episodeId: string }) {}

  static isConfigured(): boolean { return ShopAiKeyImageProvider.isConfigured(); }

  async generateAsset(input: { assetId: string; fingerprint: string; prompt: string }): Promise<{ path: string }> {
    return { path: await this.repository.writeQuizImageAsset(this.target.channelId, this.target.episodeId, input.assetId, input.fingerprint, await generateShopAiKeyImageBytes(input.prompt)) };
  }
}
