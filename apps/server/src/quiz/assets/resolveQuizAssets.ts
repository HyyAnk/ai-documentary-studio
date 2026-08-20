import type { QuizAssetPlan, QuizAssetResolution, QuizIssue } from "@studio/shared";
import type { RepositoryService } from "../../repository.js";
import { ShopAiKeyQuizImageProvider } from "../../providers/shopAiKeyImage.js";
import { assetFingerprint } from "./assetFingerprint.js";
import { compileQuizAssetPrompt } from "./promptCompiler.js";

export async function resolveQuizAssets(input: { repository: RepositoryService; channelId: string; episodeId: string; plan: QuizAssetPlan }): Promise<{ resolution: QuizAssetResolution; issues: QuizIssue[] }> {
  const existing = await input.repository.readQuizAssetResolution(input.channelId, input.episodeId);
  const byFingerprint = new Map(existing?.assets.map((asset) => [asset.fingerprint, asset]) ?? []);
  const assets: QuizAssetResolution["assets"] = [];
  const issues: QuizIssue[] = [];
  const consistencyGroups = new Map(input.plan.consistency_groups.map((group) => [group.group_id, group]));
  const provider = ShopAiKeyQuizImageProvider.isConfigured() ? new ShopAiKeyQuizImageProvider(input.repository, { channelId: input.channelId, episodeId: input.episodeId }) : null;
  for (const request of input.plan.assets) {
    const compiled = compileQuizAssetPrompt(request, request.consistency_group_id ? consistencyGroups.get(request.consistency_group_id) : undefined);
    const fingerprint = assetFingerprint(request, provider ? "shopaikey" : "inline-fallback", compiled.cacheVersion);
    const cached = byFingerprint.get(fingerprint);
    if (cached && await exists(input.repository, input.channelId, input.episodeId, cached.path)) {
      assets.push({ ...request, fingerprint, path: cached.path, source: "cache" });
      continue;
    }
    if (!provider) {
      if (request.required) issues.push(issue(request, "asset_provider_unavailable", "blocker", "A semantically critical visual asset needs image generation, but ShopAIKey is not configured.", "Configure the existing image provider or attach an exact episode asset before rendering."));
      continue;
    }
    try {
      const generated = await provider.generateAsset({ assetId: request.asset_id, fingerprint, prompt: compiled.prompt });
      assets.push({ ...request, fingerprint, path: generated.path, source: "provider" });
    } catch (error) {
      issues.push(issue(request, "asset_generation_failed", request.required ? "blocker" : "warning", `Image generation failed for ${request.asset_id}: ${error instanceof Error ? error.message : "unknown error"}`, request.required ? "Retry generation or attach the exact semantic asset before rendering." : "Continue with the deterministic illustration fallback or retry generation."));
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

async function exists(repository: RepositoryService, channelId: string, episodeId: string, assetPath: string): Promise<boolean> {
  try { await repository.resolveQuizAssetPath(channelId, episodeId, assetPath); return true; } catch { return false; }
}
