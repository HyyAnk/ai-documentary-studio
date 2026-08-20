import { readFile } from "node:fs/promises";
import type { QuizAssetPlan, QuizAssetResolution, QuizIssue } from "@studio/shared";
import { StudioLogger } from "../../logger.js";
import type { RepositoryService } from "../../repository.js";
import { ShopAiKeyQuizImageProvider } from "../../providers/shopAiKeyImage.js";
import { assetFingerprint } from "./assetFingerprint.js";
import { compileQuizAssetPrompt } from "./promptCompiler.js";

export async function resolveQuizAssets(input: { repository: RepositoryService; channelId: string; episodeId: string; plan: QuizAssetPlan; onProgress?: (progress: { completed: number; total: number; reused: boolean }) => Promise<void> | void }): Promise<{ resolution: QuizAssetResolution; issues: QuizIssue[] }> {
  const existing = await input.repository.readQuizAssetResolution(input.channelId, input.episodeId);
  const byFingerprint = new Map(existing?.assets.map((asset) => [asset.fingerprint, asset]) ?? []);
  const assets: QuizAssetResolution["assets"] = [];
  const issues: QuizIssue[] = [];
  const logger = new StudioLogger(input.repository.rootDirectory);
  const consistencyGroups = new Map(input.plan.consistency_groups.map((group) => [group.group_id, group]));
  const provider = ShopAiKeyQuizImageProvider.isConfigured() ? new ShopAiKeyQuizImageProvider(input.repository, { channelId: input.channelId, episodeId: input.episodeId }) : null;
  for (const [index, request] of input.plan.assets.entries()) {
    let reused = false;
    const compiled = compileQuizAssetPrompt(request, request.consistency_group_id ? consistencyGroups.get(request.consistency_group_id) : undefined);
    logger.info(`Compiled prompt for ${request.asset_id}: ${JSON.stringify(compiled.prompt)}`, { profileId: input.channelId, workerId: input.episodeId, step: "compile_asset_prompt" });
    const fingerprint = assetFingerprint(request, provider ? "shopaikey" : "inline-fallback", compiled.cacheVersion);
    const cached = byFingerprint.get(fingerprint);
    try {
      if (cached && await isValidQuizAsset(input.repository, input.channelId, input.episodeId, cached.path)) {
        assets.push({ ...request, fingerprint, path: cached.path, source: "cache" });
        reused = true;
      } else if (!provider) {
        if (request.required) issues.push(issue(request, "asset_provider_unavailable", "blocker", "A semantically critical visual asset needs image generation, but ShopAIKey is not configured.", "Configure the existing image provider or attach an exact episode asset before rendering."));
      } else {
        const generated = await provider.generateAsset({ assetId: request.asset_id, fingerprint, prompt: compiled.prompt });
        assets.push({ ...request, fingerprint, path: generated.path, source: "provider" });
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

export async function isQuizAssetResolutionComplete(input: { repository: RepositoryService; channelId: string; episodeId: string; plan: QuizAssetPlan; resolution: QuizAssetResolution | null }): Promise<boolean> {
  if (!input.resolution || input.resolution.episode_id !== input.episodeId) return false;
  const providerName = ShopAiKeyQuizImageProvider.isConfigured() ? "shopaikey" : "inline-fallback";
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
    if (resolved.fingerprint !== fingerprint || resolved.semantic_key !== request.semantic_key || !(await isValidQuizAsset(input.repository, input.channelId, input.episodeId, resolved.path))) return false;
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
