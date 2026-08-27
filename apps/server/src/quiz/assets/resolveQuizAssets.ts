import { readFile } from "node:fs/promises";
import type { QuizAssetPlan, QuizAssetResolution, QuizImageStyle, QuizIssue } from "@studio/shared";
import { StudioLogger } from "../../logger.js";
import type { RepositoryService } from "../../repository.js";
import { Gpti2QuizImageProvider } from "../../providers/gpti2Image.js";
import { ShopAiKeyQuizImageProvider } from "../../providers/shopAiKeyImage.js";
import { AntigravityImageChainProvider } from "../../providers/antigravityImageChain.js";
import { assetFingerprint } from "./assetFingerprint.js";
import { compileQuizAssetPrompt } from "./promptCompiler.js";
import { isContentFilterError, extractFilterReason, sanitizeImagePromptWithLLM } from "../../utils/promptSanitizer.js";
import { runConcurrent } from "../../utils/concurrency.js";

import type { AntigravityClient } from "../../antigravity.js";

export async function resolveQuizAssets(input: {
  repository: RepositoryService;
  channelId: string;
  episodeId: string;
  plan: QuizAssetPlan;
  visualStyle?: QuizImageStyle;
  activeEngine?: "codex" | "antigravity";
  antigravityClient?: AntigravityClient;
  imageConfig?: {
    api_key?: string;
    model?: string;
    provider?: "gpti2" | "shopaikey" | "custom";
    base_url?: string;
    quality?: string;
  };
  onProgress?: (progress: { completed: number; total: number; reused: boolean }) => Promise<void> | void;
  maxRounds?: number;
}): Promise<{ resolution: QuizAssetResolution; issues: QuizIssue[] }> {
  const existing = await input.repository.readQuizAssetResolution(input.channelId, input.episodeId);
  const byFingerprint = new Map(existing?.assets.map((asset) => [asset.fingerprint, asset]) ?? []);
  const resolvedMap = new Map<string, QuizAssetResolution["assets"][number]>();
  const issues: QuizIssue[] = [];
  const logger = new StudioLogger(input.repository.rootDirectory);
  const consistencyGroups = new Map(input.plan.consistency_groups.map((group) => [group.group_id, group]));
  const activeEngine = input.activeEngine ?? "codex";
  const maxRounds = input.maxRounds ?? 3;

  // Pre-load valid existing assets
  if (existing?.assets) {
    for (const asset of existing.assets) {
      if (await isValidQuizAsset(input.repository, input.channelId, input.episodeId, asset.path)) {
        resolvedMap.set(asset.asset_id, asset);
      }
    }
  }

  const persistIncrementalResolution = async () => {
    const currentAssets = input.plan.assets
      .map((req) => resolvedMap.get(req.asset_id))
      .filter((asset): asset is QuizAssetResolution["assets"][number] => Boolean(asset));
    const partialResolution: QuizAssetResolution = {
      schema_version: 2,
      episode_id: input.episodeId,
      template_id: "candy_arcade",
      assets: currentAssets,
    };
    await input.repository.writeQuizAssetResolution(input.channelId, input.episodeId, partialResolution);
  };

  const ASSET_CONCURRENCY = 4;

  for (let round = 1; round <= maxRounds; round++) {
    const pendingRequests = input.plan.assets.filter((req) => !resolvedMap.has(req.asset_id));
    if (pendingRequests.length === 0) break;

    if (round > 1) {
      logger.warn(`Quiz assets retry round ${round}/${maxRounds}: regenerating ${pendingRequests.length} missing assets...`, {
        profileId: input.channelId,
        workerId: input.episodeId,
        step: "retry_quiz_assets",
      });
      await new Promise((resolve) => setTimeout(resolve, round * 500));
    } else if (resolvedMap.size > 0) {
      await input.onProgress?.({ completed: resolvedMap.size, total: input.plan.assets.length, reused: true });
    }

    let persistQueue = Promise.resolve();
    const safePersistIncrementalResolution = () => {
      persistQueue = persistQueue.then(() => persistIncrementalResolution()).catch(() => undefined);
      return persistQueue;
    };

    await runConcurrent(pendingRequests, ASSET_CONCURRENCY, async (request) => {
      let reused = false;
      const compiled = compileQuizAssetPrompt(
        request,
        request.consistency_group_id ? consistencyGroups.get(request.consistency_group_id) : undefined,
        input.visualStyle ?? "pixar_3d",
      );
      logger.info(`Compiled prompt for ${request.asset_id}: ${JSON.stringify(compiled.prompt)} (round ${round}/${maxRounds})`, {
        profileId: input.channelId,
        workerId: input.episodeId,
        step: "compile_asset_prompt",
      });
      const configuredProvider = input.imageConfig?.provider ?? "gpti2";
      const providerName =
        configuredProvider === "gpti2" && Gpti2QuizImageProvider.isConfigured(input.imageConfig?.api_key)
          ? "gpti2"
          : configuredProvider === "shopaikey" && (input.imageConfig?.api_key || ShopAiKeyQuizImageProvider.isConfigured())
          ? "shopaikey"
          : configuredProvider === "custom" && input.imageConfig?.api_key
          ? "custom"
          : activeEngine === "antigravity"
          ? "antigravity-chain"
          : ShopAiKeyQuizImageProvider.isConfigured(input.imageConfig?.api_key)
          ? "shopaikey"
          : "inline-fallback";
      const fingerprint = assetFingerprint(request, providerName, compiled.cacheVersion);
      const cached = byFingerprint.get(fingerprint);
      const bundleNumber = request.question_id ? Number(/^question-(\d+)$/i.exec(request.question_id)?.[1] ?? 0) : 0;
      let existingBundleFile: Awaited<ReturnType<RepositoryService["getBundleImageFile"]>> | null = null;
      if (request.purpose === "hero_question_image" && bundleNumber > 0) {
        const bundleTarget = await input.repository.getBundleImagePath(input.channelId, input.episodeId, bundleNumber);
        existingBundleFile = await input.repository.getBundleImageFile(input.channelId, input.episodeId, bundleTarget.filename).catch(() => null);
      }

      try {
        if (existingBundleFile) {
          const bundleBytes = new Uint8Array(await readFile(existingBundleFile.absolutePath));
          const quizAssetPath = await input.repository.writeQuizImageAsset(
            input.channelId,
            input.episodeId,
            request.asset_id,
            fingerprint,
            bundleBytes,
            {
              price_vnd: existingBundleFile.price_vnd,
              price_breakdown: existingBundleFile.price_breakdown,
              model: existingBundleFile.model,
              aspect_ratio: existingBundleFile.aspect_ratio,
            },
          );
          const assetEntry: QuizAssetResolution["assets"][number] = {
            ...request,
            fingerprint,
            path: quizAssetPath,
            source: "explicit_episode",
          };
          resolvedMap.set(request.asset_id, assetEntry);
          reused = true;
        } else if (cached && await isValidQuizAsset(input.repository, input.channelId, input.episodeId, cached.path)) {
          const assetEntry: QuizAssetResolution["assets"][number] = {
            ...request,
            fingerprint,
            path: cached.path,
            source: "cache",
            fallback_tier: cached.fallback_tier,
            degraded: cached.degraded,
          };
          resolvedMap.set(request.asset_id, assetEntry);
          if (cached.degraded || cached.fallback_tier === 3) {
            issues.push(issue(request, "asset_fallback_degraded", "warning", `Asset ${request.asset_id} used Tier 3 deterministic fallback. Visual review recommended.`, "Inspect the generated fallback card or replace with a dedicated image."));
          }
          reused = true;
        } else if (configuredProvider === "gpti2" && Gpti2QuizImageProvider.isConfigured(input.imageConfig?.api_key)) {
          const provider = new Gpti2QuizImageProvider(
            input.repository,
            { channelId: input.channelId, episodeId: input.episodeId },
            { apiKey: input.imageConfig?.api_key, model: input.imageConfig?.model },
          );
          let currentPrompt = compiled.prompt;
          let generated: { path: string } | null = null;
          const maxAttempts = 3;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              generated = await provider.generateAsset({
                assetId: request.asset_id,
                fingerprint,
                prompt: currentPrompt,
                aspect_ratio: request.aspect_ratio,
              });
              break;
            } catch (err) {
              if (isContentFilterError(err) && attempt < maxAttempts && input.antigravityClient) {
                const reason = extractFilterReason(err);
                logger.warn(`Quiz asset ${request.asset_id} rejected by content filter (${reason}). Auto-rephrasing...`, { profileId: input.channelId, workerId: input.episodeId });
                const rephrased = await sanitizeImagePromptWithLLM({
                  client: input.antigravityClient,
                  originalPrompt: currentPrompt,
                  rejectionReason: reason,
                  context: `Quiz visual asset for question ${request.asset_id}`,
                });
                if (rephrased && rephrased !== currentPrompt) {
                  currentPrompt = rephrased;
                  continue;
                }
              }
              if (attempt < maxAttempts) {
                logger.warn(`Quiz asset ${request.asset_id} generation attempt ${attempt} failed (${err instanceof Error ? err.message : String(err)}). Retrying in ${attempt * 500}ms...`, { profileId: input.channelId, workerId: input.episodeId });
                await new Promise((resolve) => setTimeout(resolve, attempt * 500));
                continue;
              }
              throw err;
            }
          }
          if (!generated) throw new Error(`Failed to generate asset ${request.asset_id}`);
          const assetEntry: QuizAssetResolution["assets"][number] = { ...request, fingerprint, path: generated.path, source: "provider" };
          resolvedMap.set(request.asset_id, assetEntry);
          if (request.purpose === "hero_question_image" && bundleNumber > 0) {
            try {
              const resolvedPath = await input.repository.resolveQuizAssetPath(input.channelId, input.episodeId, generated.path);
              const imageBytes = new Uint8Array(await readFile(resolvedPath));
              await input.repository.writeBundleImage(input.channelId, input.episodeId, bundleNumber, imageBytes);
            } catch {
              // Non-critical background sync
            }
          }
        } else if ((configuredProvider === "shopaikey" || configuredProvider === "custom") && (input.imageConfig?.api_key || ShopAiKeyQuizImageProvider.isConfigured())) {
          const provider = new ShopAiKeyQuizImageProvider(
            input.repository,
            { channelId: input.channelId, episodeId: input.episodeId },
            {
              apiKey: input.imageConfig?.api_key || process.env.SHOPAIKEY_API_KEY,
              baseUrl: input.imageConfig?.base_url || (configuredProvider === "shopaikey" ? "https://direct.shopaikey.com/v1" : "https://api.openai.com/v1"),
              model: input.imageConfig?.model || "gpt-image-2",
              quality: input.imageConfig?.quality,
            },
          );
          let generated: Awaited<ReturnType<typeof provider.generateAsset>> | null = null;
          const maxAttempts = 3;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              generated = await provider.generateAsset({ assetId: request.asset_id, fingerprint, prompt: compiled.prompt });
              break;
            } catch (err) {
              if (attempt < maxAttempts) {
                logger.warn(`Quiz asset ${request.asset_id} ${configuredProvider} generation attempt ${attempt} failed (${err instanceof Error ? err.message : String(err)}). Retrying in ${attempt * 500}ms...`, { profileId: input.channelId, workerId: input.episodeId });
                await new Promise((resolve) => setTimeout(resolve, attempt * 500));
                continue;
              }
              throw err;
            }
          }
          if (!generated) throw new Error(`Failed to generate ${configuredProvider} asset ${request.asset_id}`);
          const assetEntry: QuizAssetResolution["assets"][number] = { ...request, fingerprint, path: generated.path, source: "provider" };
          resolvedMap.set(request.asset_id, assetEntry);
          if (request.purpose === "hero_question_image" && bundleNumber > 0) {
            try {
              const resolvedPath = await input.repository.resolveQuizAssetPath(input.channelId, input.episodeId, generated.path);
              const imageBytes = new Uint8Array(await readFile(resolvedPath));
              await input.repository.writeBundleImage(input.channelId, input.episodeId, bundleNumber, imageBytes);
            } catch {
              // Non-critical background sync
            }
          }
        } else if (activeEngine === "antigravity") {
          const episode = await input.repository.getEpisode(input.channelId, input.episodeId);
          const chainProvider = new AntigravityImageChainProvider(input.repository, {
            channelId: input.channelId,
            episodeId: input.episodeId,
            assetId: request.asset_id,
            fingerprint,
            theme: episode.quiz_config.visual_theme,
          }, input.antigravityClient, { allowTier3Fallback: false });
          let result: Awaited<ReturnType<typeof chainProvider.generateReference>> | null = null;
          const maxAttempts = 3;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              result = await chainProvider.generateReference(compiled.prompt);
              break;
            } catch (err) {
              if (attempt < maxAttempts) {
                logger.warn(`Quiz asset ${request.asset_id} Antigravity generation attempt ${attempt} failed (${err instanceof Error ? err.message : String(err)}). Retrying in ${attempt * 500}ms...`, { profileId: input.channelId, workerId: input.episodeId });
                await new Promise((resolve) => setTimeout(resolve, attempt * 500));
                continue;
              }
              throw err;
            }
          }
          if (!result) throw new Error(`Failed to generate Antigravity asset ${request.asset_id}`);
          const assetEntry: QuizAssetResolution["assets"][number] = {
            ...request,
            fingerprint,
            path: result.asset_path,
            source: result.fallback_tier === 3 ? "fallback" : "provider",
            fallback_tier: result.fallback_tier,
            degraded: result.degraded,
          };
          resolvedMap.set(request.asset_id, assetEntry);
          if (result.degraded || result.fallback_tier === 3) {
            issues.push(issue(request, "asset_fallback_degraded", "warning", `Asset ${request.asset_id} used Tier 3 deterministic fallback. Visual review recommended.`, "Inspect the generated fallback card or replace with a dedicated image."));
          } else if (request.purpose === "hero_question_image" && bundleNumber > 0) {
            try {
              const resolvedPath = await input.repository.resolveQuizAssetPath(input.channelId, input.episodeId, result.asset_path);
              const imageBytes = new Uint8Array(await readFile(resolvedPath));
              await input.repository.writeBundleImage(input.channelId, input.episodeId, bundleNumber, imageBytes);
            } catch {
              // Non-critical background sync
            }
          }
        } else if (ShopAiKeyQuizImageProvider.isConfigured(input.imageConfig?.api_key)) {
          const provider = new ShopAiKeyQuizImageProvider(
            input.repository,
            { channelId: input.channelId, episodeId: input.episodeId },
            {
              apiKey: input.imageConfig?.api_key || process.env.SHOPAIKEY_API_KEY,
              baseUrl: input.imageConfig?.base_url || "https://direct.shopaikey.com/v1",
              model: input.imageConfig?.model,
            },
          );
          let generated: Awaited<ReturnType<typeof provider.generateAsset>> | null = null;
          const maxAttempts = 3;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              generated = await provider.generateAsset({ assetId: request.asset_id, fingerprint, prompt: compiled.prompt });
              break;
            } catch (err) {
              if (attempt < maxAttempts) {
                logger.warn(`Quiz asset ${request.asset_id} ShopAiKey generation attempt ${attempt} failed (${err instanceof Error ? err.message : String(err)}). Retrying in ${attempt * 500}ms...`, { profileId: input.channelId, workerId: input.episodeId });
                await new Promise((resolve) => setTimeout(resolve, attempt * 500));
                continue;
              }
              throw err;
            }
          }
          if (!generated) throw new Error(`Failed to generate ShopAiKey asset ${request.asset_id}`);
          const assetEntry: QuizAssetResolution["assets"][number] = { ...request, fingerprint, path: generated.path, source: "provider" };
          resolvedMap.set(request.asset_id, assetEntry);
          if (request.purpose === "hero_question_image" && bundleNumber > 0) {
            try {
              const resolvedPath = await input.repository.resolveQuizAssetPath(input.channelId, input.episodeId, generated.path);
              const imageBytes = new Uint8Array(await readFile(resolvedPath));
              await input.repository.writeBundleImage(input.channelId, input.episodeId, bundleNumber, imageBytes);
            } catch {
              // Non-critical background sync
            }
          }
        } else {
          issues.push(issue(request, "asset_provider_unavailable", "blocker", "A semantically critical visual asset needs image generation, but no image provider is configured.", "Configure an image provider (gpti2.store, ShopAiKey, or Custom) in Settings or switch to Antigravity engine before rendering."));
        }
      } catch (error) {
        if (round === maxRounds) {
          issues.push(issue(request, "asset_generation_failed", "blocker", `Image generation failed for ${request.asset_id} after ${maxRounds} retry rounds: ${error instanceof Error ? error.message : "unknown error"}`, "Retry generation or attach the exact semantic asset before rendering."));
        }
      } finally {
        if (resolvedMap.has(request.asset_id)) {
          void safePersistIncrementalResolution();
        }
        await input.onProgress?.({ completed: resolvedMap.size, total: input.plan.assets.length, reused });
      }
    });

    await safePersistIncrementalResolution();
  }

  const assets = input.plan.assets
    .map((req) => resolvedMap.get(req.asset_id))
    .filter((asset): asset is QuizAssetResolution["assets"][number] => Boolean(asset));

  for (const group of input.plan.consistency_groups) {
    const groupAssets = assets.filter((asset) => asset.consistency_group_id === group.group_id);
    if (groupAssets.length !== group.asset_ids.length) continue;
    issues.push({
      code: "needs_visual_review",
      severity: "warning",
      message: `Visual answer set ${group.group_id} is technically resolved but needs a human fairness review.`,
      next_action: "Review the generated options together for matching medium, framing, lighting, saturation, and no pre-reveal answer cue.",
      question_ids: [group.question_id],
      stage: "assets",
    });
  }

  const resolution: QuizAssetResolution = { schema_version: 2, episode_id: input.episodeId, template_id: "candy_arcade", assets };
  await input.repository.writeQuizAssetResolution(input.channelId, input.episodeId, resolution);
  return { resolution, issues };
}

function issue(request: QuizAssetPlan["assets"][number], code: string, severity: "blocker" | "warning", message: string, nextAction: string): QuizIssue {
  return { code, severity, message, next_action: nextAction, question_ids: request.question_id ? [request.question_id] : [], stage: "assets" };
}

export async function isQuizAssetResolutionComplete(input: {
  repository: RepositoryService;
  channelId: string;
  episodeId: string;
  plan: QuizAssetPlan;
  resolution: QuizAssetResolution | null;
  activeEngine?: "codex" | "antigravity";
}): Promise<boolean> {
  if (!input.resolution || input.resolution.episode_id !== input.episodeId) return false;
  if (input.resolution.assets.length < input.plan.assets.length) return false;
  const providerName = "gpti2";
  const consistencyGroups = new Map(input.plan.consistency_groups.map((group) => [group.group_id, group]));
  const byId = new Map(input.resolution.assets.map((asset) => [asset.asset_id, asset]));
  for (const request of input.plan.assets) {
    const compiled = compileQuizAssetPrompt(request, request.consistency_group_id ? consistencyGroups.get(request.consistency_group_id) : undefined);
    const fingerprint = assetFingerprint(request, providerName, compiled.cacheVersion);
    const resolved = byId.get(request.asset_id);
    if (!resolved) return false;
    if ((resolved.fingerprint !== fingerprint && !resolved.path) || resolved.semantic_key !== request.semantic_key || !(await isValidQuizAsset(input.repository, input.channelId, input.episodeId, resolved.path))) return false;
  }
  return true;
}

async function isValidQuizAsset(repository: RepositoryService, channelId: string, episodeId: string, assetPath: string): Promise<boolean> {
  try {
    const absolutePath = await repository.resolveQuizAssetPath(channelId, episodeId, assetPath);
    const data = new Uint8Array(await readFile(absolutePath));
    if (data.length < 24 || !data.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) return false;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return view.getUint32(16) > 0 && view.getUint32(20) > 0;
  } catch {
    return false;
  }
}
