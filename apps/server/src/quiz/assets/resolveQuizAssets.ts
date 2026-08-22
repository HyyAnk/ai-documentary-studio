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

import type { AntigravityClient } from "../../antigravity.js";

export async function resolveQuizAssets(input: {
  repository: RepositoryService;
  channelId: string;
  episodeId: string;
  plan: QuizAssetPlan;
  visualStyle?: QuizImageStyle;
  activeEngine?: "codex" | "antigravity";
  antigravityClient?: AntigravityClient;
  imageConfig?: { api_key?: string; model?: string };
  onProgress?: (progress: { completed: number; total: number; reused: boolean }) => Promise<void> | void;
}): Promise<{ resolution: QuizAssetResolution; issues: QuizIssue[] }> {
  const existing = await input.repository.readQuizAssetResolution(input.channelId, input.episodeId);
  const byFingerprint = new Map(existing?.assets.map((asset) => [asset.fingerprint, asset]) ?? []);
  const assets: QuizAssetResolution["assets"] = [];
  const issues: QuizIssue[] = [];
  const logger = new StudioLogger(input.repository.rootDirectory);
  const consistencyGroups = new Map(input.plan.consistency_groups.map((group) => [group.group_id, group]));
  const activeEngine = input.activeEngine ?? "codex";

  for (const [index, request] of input.plan.assets.entries()) {
    let reused = false;
    const compiled = compileQuizAssetPrompt(
      request,
      request.consistency_group_id ? consistencyGroups.get(request.consistency_group_id) : undefined,
      input.visualStyle ?? "pixar_3d",
    );
    logger.info(`Compiled prompt for ${request.asset_id}: ${JSON.stringify(compiled.prompt)}`, { profileId: input.channelId, workerId: input.episodeId, step: "compile_asset_prompt" });
    const providerName = Gpti2QuizImageProvider.isConfigured(input.imageConfig?.api_key)
      ? "gpti2"
      : activeEngine === "antigravity"
      ? "antigravity-chain"
      : ShopAiKeyQuizImageProvider.isConfigured()
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
        assets.push({
          ...request,
          fingerprint,
          path: quizAssetPath,
          source: "explicit_episode",
        });
        reused = true;
      } else if (cached && await isValidQuizAsset(input.repository, input.channelId, input.episodeId, cached.path)) {
        assets.push({
          ...request,
          fingerprint,
          path: cached.path,
          source: "cache",
          fallback_tier: cached.fallback_tier,
          degraded: cached.degraded,
        });
        if (cached.degraded || cached.fallback_tier === 3) {
          issues.push(issue(request, "asset_fallback_degraded", "warning", `Asset ${request.asset_id} used Tier 3 deterministic fallback. Visual review recommended.`, "Inspect the generated fallback card or replace with a dedicated image."));
        }
        reused = true;
      } else if (Gpti2QuizImageProvider.isConfigured(input.imageConfig?.api_key)) {
        const provider = new Gpti2QuizImageProvider(
          input.repository,
          { channelId: input.channelId, episodeId: input.episodeId },
          { apiKey: input.imageConfig?.api_key, model: input.imageConfig?.model },
        );
        let currentPrompt = compiled.prompt;
        let generated: { path: string } | null = null;
        const maxAttempts = 2;
        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
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
            throw err;
          }
        }
        if (!generated) throw new Error(`Failed to generate asset ${request.asset_id}`);
        assets.push({ ...request, fingerprint, path: generated.path, source: "provider" });
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
        const result = await chainProvider.generateReference(compiled.prompt);
        assets.push({
          ...request,
          fingerprint,
          path: result.asset_path,
          source: result.fallback_tier === 3 ? "fallback" : "provider",
          fallback_tier: result.fallback_tier,
          degraded: result.degraded,
        });
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
      } else if (!ShopAiKeyQuizImageProvider.isConfigured()) {
        if (request.required) {
          issues.push(issue(request, "asset_provider_unavailable", "blocker", "A semantically critical visual asset needs image generation, but no image provider is configured.", "Configure gpti2.store in Settings or switch to Antigravity engine before rendering."));
        }
      } else {
        const provider = new ShopAiKeyQuizImageProvider(input.repository, { channelId: input.channelId, episodeId: input.episodeId });
        const generated = await provider.generateAsset({ assetId: request.asset_id, fingerprint, prompt: compiled.prompt });
        assets.push({ ...request, fingerprint, path: generated.path, source: "provider" });
        if (request.purpose === "hero_question_image" && bundleNumber > 0) {
          try {
            const resolvedPath = await input.repository.resolveQuizAssetPath(input.channelId, input.episodeId, generated.path);
            const imageBytes = new Uint8Array(await readFile(resolvedPath));
            await input.repository.writeBundleImage(input.channelId, input.episodeId, bundleNumber, imageBytes);
          } catch {
            // Non-critical background sync
          }
        }
      }
    } catch (error) {
      issues.push(issue(request, "asset_generation_failed", request.required ? "blocker" : "warning", `Image generation failed for ${request.asset_id}: ${error instanceof Error ? error.message : "unknown error"}`, request.required ? "Retry generation or attach the exact semantic asset before rendering." : "Continue with the deterministic illustration fallback or retry generation."));
    } finally {
      await input.onProgress?.({ completed: index + 1, total: input.plan.assets.length, reused });
    }
  }
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
  const providerName = "gpti2";
  const consistencyGroups = new Map(input.plan.consistency_groups.map((group) => [group.group_id, group]));
  const byId = new Map(input.resolution.assets.map((asset) => [asset.asset_id, asset]));
  for (const request of input.plan.assets) {
    const compiled = compileQuizAssetPrompt(request, request.consistency_group_id ? consistencyGroups.get(request.consistency_group_id) : undefined);
    const fingerprint = assetFingerprint(request, providerName, compiled.cacheVersion);
    const resolved = byId.get(request.asset_id);
    if (!resolved) {
      if (request.required) return false;
      continue;
    }
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
