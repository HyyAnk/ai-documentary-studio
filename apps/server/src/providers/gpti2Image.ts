import { createHash } from "node:crypto";
import type { ImageProvider } from "./index.js";
import { RepositoryError, RepositoryService } from "../repository.js";

type Gpti2ImageTarget = {
  channelId: string;
  episodeId: string;
  bundleNumber?: number;
  variant?: number;
  assetId?: string;
  fingerprint?: string;
};

export type Gpti2ImageResult = {
  bytes: Uint8Array;
  price_vnd?: number;
  price_breakdown?: Record<string, number>;
  model?: string;
  aspect_ratio?: string;
  size?: string;
};

export type SupportedAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "2:3" | "3:2";

export function resolveImageDimensions(
  aspectRatio: string = "16:9",
  model: string = DEFAULT_MODEL,
): { size: string; aspect_ratio: string } {
  const normRatio = (aspectRatio.trim() || "16:9") as SupportedAspectRatio;

  if (model.startsWith("nano-banana")) {
    const validNanoRatios = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2"]);
    const ratio = validNanoRatios.has(normRatio) ? normRatio : "16:9";
    return { aspect_ratio: ratio, size: "2K" };
  }

  // gpt-image-2 exact supported sizes on gpti2.store (quality: low)
  const sizeMap: Record<string, string> = {
    "16:9": "1280x720",
    "9:16": "720x1280",
    "1:1": "1024x1024",
    "4:3": "1024x768",
    "3:4": "768x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
  };

  const size = sizeMap[normRatio] || "1280x720";
  return { size, aspect_ratio: normRatio };
}

export async function checkGpti2Balance(apiKey?: string): Promise<{ balance_vnd: number; rpm?: number }> {
  const key = (apiKey || process.env.GPTI2_API_KEY || process.env.SHOPAIKEY_API_KEY || "").trim();
  if (!key) {
    throw new RepositoryError("API key for gpti2.store is not configured.", "IMAGE_PROVIDER_NOT_CONFIGURED");
  }
  const response = await fetch(`${DEFAULT_BASE_URL}/v1/balance`, {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });
  const raw = await response.text();
  let payload: { balance_vnd?: number; rpm?: number; error?: { message?: string } } = {};
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    //
  }
  if (!response.ok) {
    const msg = payload.error?.message || raw || `HTTP ${response.status}`;
    throw new RepositoryError(`gpti2.store API failed (${response.status}): ${msg}`, "IMAGE_PROVIDER_FAILED");
  }
  return {
    balance_vnd: typeof payload.balance_vnd === "number" ? payload.balance_vnd : 0,
    rpm: payload.rpm,
  };
}

type Gpti2GenerationOptions = {
  apiKey?: string;
  model?: string;
  quality?: string;
  size?: string;
  aspect_ratio?: string;
  idempotencyKey?: string;
  cancellationSignal?: AbortSignal;
  pollIntervalMs?: number;
};

const DEFAULT_BASE_URL = "https://gpti2.store";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_SIZE = "1536x1024";
const DEFAULT_ASPECT_RATIO = "16:9";
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 60; // Up to 3 minutes for async generation
const REQUEST_TIMEOUT_MS = 120_000;

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactImagePrompt(prompt: string, aspectRatio?: string): string {
  const bundle = prompt.match(/--- FILE:[^\n]*visual_bible\.md#[^\n]*\n([\s\S]*?)(?=\n--- FILE:|$)/i)?.[1]?.trim();
  if (!bundle) return prompt;
  const ratioLabel = aspectRatio ? ` ${aspectRatio}` : " 16:9";
  return [
    `Create one${ratioLabel} documentary continuity anchor image.`,
    "Preserve every visual detail in this continuity bundle, including era, location, subjects, objects, palette, lighting, camera, action, atmosphere, and continuity:",
    bundle,
    "Do not add captions, charts, watermarks, labels, logos, or readable text.",
  ].join("\n\n");
}

function generateIdempotencyKey(prefix: string, seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 24);
  return `${prefix}_${hash}`;
}

export async function generateGpti2ImageBytes(
  prompt: string,
  options: Gpti2GenerationOptions = {},
): Promise<Gpti2ImageResult> {
  const apiKey = (options.apiKey || process.env.GPTI2_API_KEY || process.env.SHOPAIKEY_API_KEY || "").trim();
  if (!apiKey) {
    throw new RepositoryError(
      "API key for gpti2.store is not configured. Please enter your API key in Settings.",
      "IMAGE_PROVIDER_NOT_CONFIGURED",
    );
  }

  const model = options.model?.trim() || DEFAULT_MODEL;
  const isNano = model.startsWith("nano-banana");
  const dimensions = resolveImageDimensions(options.aspect_ratio || "16:9", model);
  const idempotencyKey = options.idempotencyKey || generateIdempotencyKey("img", `${model}:${dimensions.aspect_ratio}:${prompt}`);

  if (isNano) {
    return generateNanoBananaImage(apiKey, prompt, model, { ...options, aspect_ratio: dimensions.aspect_ratio }, idempotencyKey);
  } else {
    return generateGptImage(apiKey, prompt, model, { ...options, size: options.size || dimensions.size, aspect_ratio: dimensions.aspect_ratio }, idempotencyKey);
  }
}

async function generateGptImage(
  apiKey: string,
  rawPrompt: string,
  model: string,
  options: Gpti2GenerationOptions,
  idempotencyKey: string,
): Promise<Gpti2ImageResult> {
  const prompt = compactImagePrompt(rawPrompt, options.aspect_ratio);
  const size = options.size || DEFAULT_SIZE;
  const quality = "low";

  const requestSignal = options.cancellationSignal
    ? AbortSignal.any([options.cancellationSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${DEFAULT_BASE_URL}/v1/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Prefer: "respond-async", // Ensure job queues and does not get dropped
        "Idempotency-Key": idempotencyKey, // Prevent duplicate billing
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
        quality,
        n: 1,
      }),
      signal: requestSignal,
    });
  } catch (error) {
    if (options.cancellationSignal?.aborted) throw new Error("Image generation was cancelled");
    throw new RepositoryError(
      `Failed to connect to gpti2.store: ${error instanceof Error ? error.message : String(error)}`,
      "IMAGE_PROVIDER_UNAVAILABLE",
    );
  }

  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // raw payload
  }

  if (response.status === 202) {
    // Asynchronous queued job
    const jobId = typeof payload.id === "string" ? payload.id : null;
    if (!jobId) {
      throw new RepositoryError("gpti2.store returned 202 without a job ID", "IMAGE_PROVIDER_FAILED");
    }
    return pollGptJob(apiKey, jobId, model, payload.price_vnd as number | undefined, options.cancellationSignal, options.pollIntervalMs, options.aspect_ratio, size);
  }

  if (!response.ok) {
    const errorMsg = (payload.error as { message?: string } | undefined)?.message || raw.slice(0, 300) || "Unknown error";
    const isContentFilter = response.status === 400 && /(?:content filter|safety|moderation|policy|prohibited)/i.test(errorMsg);
    throw new RepositoryError(
      `gpti2.store API failed (${response.status}): ${errorMsg}`,
      isContentFilter ? "IMAGE_CONTENT_FILTER_REJECTED" : "IMAGE_PROVIDER_FAILED",
    );
  }

  const dataArray = payload.data as Array<{ b64_json?: string; url?: string }> | undefined;
  const item = dataArray?.[0];
  const priceVnd = typeof payload.price_vnd === "number" ? payload.price_vnd : 50;
  const priceBreakdown = (payload.price_breakdown as Record<string, number> | undefined) || undefined;

  if (item?.b64_json) {
    const base64Data = item.b64_json.replace(/^data:image\/[^;]+;base64,/i, "");
    return {
      bytes: Buffer.from(base64Data, "base64"),
      price_vnd: priceVnd,
      price_breakdown: priceBreakdown,
      model,
      aspect_ratio: options.aspect_ratio,
      size,
    };
  }

  if (item?.url) {
    const imageBytes = await downloadImageUrl(item.url, options.cancellationSignal);
    return {
      bytes: imageBytes,
      price_vnd: priceVnd,
      price_breakdown: priceBreakdown,
      model,
      aspect_ratio: options.aspect_ratio,
      size,
    };
  }

  throw new RepositoryError("gpti2.store returned no image data", "IMAGE_PROVIDER_EMPTY");
}

async function pollGptJob(
  apiKey: string,
  jobId: string,
  model: string,
  initialPriceVnd: number | undefined,
  cancellationSignal?: AbortSignal,
  pollIntervalMs = POLL_INTERVAL_MS,
  aspectRatio?: string,
  size?: string,
): Promise<Gpti2ImageResult> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    if (cancellationSignal?.aborted) throw new Error("Image generation was cancelled");
    await waitFor(pollIntervalMs);

    const pollSignal = cancellationSignal
      ? AbortSignal.any([cancellationSignal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000);

    let response: Response;
    try {
      response = await fetch(`${DEFAULT_BASE_URL}/v1/images/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: pollSignal,
      });
    } catch {
      continue;
    }

    if (!response.ok) continue;

    const payload = (await response.json()) as {
      status?: string;
      data?: Array<{ url?: string; b64_json?: string }>;
      price_vnd?: number;
      price_breakdown?: Record<string, number>;
      error?: { message?: string };
    };

    if (payload.status === "succeeded") {
      const item = payload.data?.[0];
      const priceVnd = payload.price_vnd ?? initialPriceVnd ?? 50;
      const priceBreakdown = payload.price_breakdown;

      if (item?.b64_json) {
        return {
          bytes: Buffer.from(item.b64_json.replace(/^data:image\/[^;]+;base64,/i, ""), "base64"),
          price_vnd: priceVnd,
          price_breakdown: priceBreakdown,
          model,
          aspect_ratio: aspectRatio,
          size,
        };
      }
      if (item?.url) {
        const imageBytes = await downloadImageUrl(item.url, cancellationSignal);
        return {
          bytes: imageBytes,
          price_vnd: priceVnd,
          price_breakdown: priceBreakdown,
          model,
          aspect_ratio: aspectRatio,
          size,
        };
      }
      throw new RepositoryError("Job succeeded but returned no image", "IMAGE_PROVIDER_EMPTY");
    }

    if (payload.status === "failed") {
      const errorMsg = payload.error?.message || "Unknown error";
      const isContentFilter = /(?:content filter|safety|moderation|policy|prohibited)/i.test(errorMsg);
      throw new RepositoryError(
        `Image job failed: ${errorMsg}`,
        isContentFilter ? "IMAGE_CONTENT_FILTER_REJECTED" : "IMAGE_PROVIDER_FAILED",
      );
    }
  }

  throw new RepositoryError("Image generation timed out waiting for queue response", "IMAGE_PROVIDER_TIMEOUT");
}

async function generateNanoBananaImage(
  apiKey: string,
  rawPrompt: string,
  model: string,
  options: Gpti2GenerationOptions,
  idempotencyKey: string,
): Promise<Gpti2ImageResult> {
  const prompt = compactImagePrompt(rawPrompt);
  const aspectRatio = options.aspect_ratio || DEFAULT_ASPECT_RATIO;

  const requestSignal = options.cancellationSignal
    ? AbortSignal.any([options.cancellationSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${DEFAULT_BASE_URL}/v1/images/nano/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        model,
        prompt,
        aspect_ratio: aspectRatio,
      }),
      signal: requestSignal,
    });
  } catch (error) {
    if (options.cancellationSignal?.aborted) throw new Error("Image generation was cancelled");
    throw new RepositoryError(
      `Failed to connect to gpti2.store Nano Banana API: ${error instanceof Error ? error.message : String(error)}`,
      "IMAGE_PROVIDER_UNAVAILABLE",
    );
  }

  const raw = await response.text();
  let payload: { id?: string; price_vnd?: number; error?: { message?: string } } = {};
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    // raw payload
  }

  if (!response.ok && response.status !== 202) {
    const errorMsg = payload.error?.message || raw.slice(0, 300) || "Unknown error";
    throw new RepositoryError(`Nano Banana API failed (${response.status}): ${errorMsg}`, "IMAGE_PROVIDER_FAILED");
  }

  const jobId = payload.id;
  if (!jobId) {
    throw new RepositoryError("Nano Banana API returned no job ID", "IMAGE_PROVIDER_FAILED");
  }

  return pollNanoJob(apiKey, jobId, model, payload.price_vnd ?? 100, options.cancellationSignal, options.pollIntervalMs, aspectRatio);
}

async function pollNanoJob(
  apiKey: string,
  jobId: string,
  model: string,
  initialPriceVnd: number,
  cancellationSignal?: AbortSignal,
  pollIntervalMs = POLL_INTERVAL_MS,
  aspectRatio?: string,
): Promise<Gpti2ImageResult> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    if (cancellationSignal?.aborted) throw new Error("Image generation was cancelled");
    await waitFor(pollIntervalMs);

    const pollSignal = cancellationSignal
      ? AbortSignal.any([cancellationSignal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000);

    let response: Response;
    try {
      response = await fetch(`${DEFAULT_BASE_URL}/v1/images/nano/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: pollSignal,
      });
    } catch {
      continue;
    }

    if (!response.ok) continue;

    const payload = (await response.json()) as {
      status?: string;
      priceVnd?: number;
      price_vnd?: number;
      data?: Array<{ url?: string; taiUrl?: string }>;
      error?: { message?: string } | string | null;
    };

    if (payload.status === "succeeded") {
      const item = payload.data?.[0];
      const imageUrl = item?.url || item?.taiUrl;
      const priceVnd = payload.priceVnd ?? payload.price_vnd ?? initialPriceVnd ?? 100;

      if (!imageUrl) {
        throw new RepositoryError("Nano Banana job succeeded but image URL is missing or expired", "IMAGE_PROVIDER_EMPTY");
      }

      const imageBytes = await downloadImageUrl(imageUrl, cancellationSignal);
      return {
        bytes: imageBytes,
        price_vnd: priceVnd,
        price_breakdown: { images_vnd: priceVnd },
        model,
        aspect_ratio: aspectRatio,
        size: "2K",
      };
    }

    if (payload.status === "failed") {
      const errMsg = typeof payload.error === "string" ? payload.error : payload.error?.message || "Generation failed";
      throw new RepositoryError(`Nano Banana job failed: ${errMsg}`, "IMAGE_PROVIDER_FAILED");
    }
  }

  throw new RepositoryError("Nano Banana image generation timed out", "IMAGE_PROVIDER_TIMEOUT");
}

async function downloadImageUrl(url: string, cancellationSignal?: AbortSignal): Promise<Uint8Array> {
  const signal = cancellationSignal
    ? AbortSignal.any([cancellationSignal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000);

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new RepositoryError(`Failed to download generated image (${response.status})`, "IMAGE_PROVIDER_FAILED");
  }
  return new Uint8Array(await response.arrayBuffer());
}

export class Gpti2ImageProvider implements ImageProvider {
  static isConfigured(apiKey?: string): boolean {
    return Boolean((apiKey || process.env.GPTI2_API_KEY || process.env.SHOPAIKEY_API_KEY || "").trim());
  }

  constructor(
    private readonly repository: RepositoryService,
    private readonly target: Gpti2ImageTarget,
    private readonly options: { apiKey?: string; model?: string; aspectRatio?: string } = {},
  ) {}

  async generateReference(
    prompt: string,
    cancellationSignal?: AbortSignal,
  ): Promise<{ asset_path: string; price_vnd?: number; price_breakdown?: Record<string, number>; model?: string; aspect_ratio?: string }> {
    const bundleNumber = this.target.bundleNumber ?? 1;
    const variant = this.target.variant ?? 0;
    const aspectRatio = this.options.aspectRatio || "16:9";
    const idempotencyKey = generateIdempotencyKey(
      "bundle",
      `${this.target.channelId}:${this.target.episodeId}:bundle-${bundleNumber}:${variant}:${aspectRatio}:${prompt}`,
    );

    const result = await generateGpti2ImageBytes(prompt, {
      apiKey: this.options.apiKey,
      model: this.options.model,
      aspect_ratio: aspectRatio,
      idempotencyKey,
      cancellationSignal,
    });

    const assetPath = await this.repository.writeBundleImage(
      this.target.channelId,
      this.target.episodeId,
      bundleNumber,
      result.bytes,
      variant,
      {
        price_vnd: result.price_vnd,
        price_breakdown: result.price_breakdown,
        model: result.model,
        aspect_ratio: result.aspect_ratio || aspectRatio,
        size: result.size,
      },
    );

    return {
      asset_path: assetPath,
      price_vnd: result.price_vnd,
      price_breakdown: result.price_breakdown,
      model: result.model,
      aspect_ratio: result.aspect_ratio || aspectRatio,
    };
  }
}

export class Gpti2QuizImageProvider {
  static isConfigured(apiKey?: string): boolean {
    return Boolean((apiKey || process.env.GPTI2_API_KEY || process.env.SHOPAIKEY_API_KEY || "").trim());
  }

  constructor(
    private readonly repository: RepositoryService,
    private readonly target: { channelId: string; episodeId: string },
    private readonly options: { apiKey?: string; model?: string } = {},
  ) {}

  async generateAsset(
    input: { assetId: string; fingerprint: string; prompt: string; aspect_ratio?: string },
    cancellationSignal?: AbortSignal,
  ): Promise<{ path: string; price_vnd?: number; price_breakdown?: Record<string, number>; model?: string; aspect_ratio?: string }> {
    const aspectRatio = input.aspect_ratio || "1:1";
    const idempotencyKey = generateIdempotencyKey(
      "quiz",
      `${this.target.channelId}:${this.target.episodeId}:${input.assetId}:${input.fingerprint}:${aspectRatio}`,
    );

    const result = await generateGpti2ImageBytes(input.prompt, {
      apiKey: this.options.apiKey,
      model: this.options.model,
      aspect_ratio: aspectRatio,
      idempotencyKey,
      cancellationSignal,
    });

    const assetPath = await this.repository.writeQuizImageAsset(
      this.target.channelId,
      this.target.episodeId,
      input.assetId,
      input.fingerprint,
      result.bytes,
      {
        price_vnd: result.price_vnd,
        price_breakdown: result.price_breakdown,
        model: result.model,
        aspect_ratio: result.aspect_ratio || aspectRatio,
        size: result.size,
      },
    );

    return {
      path: assetPath,
      price_vnd: result.price_vnd,
      price_breakdown: result.price_breakdown,
      model: result.model,
      aspect_ratio: result.aspect_ratio || aspectRatio,
    };
  }
}
