import path from "node:path";
import type { QuizAssetPlan, QuizAssetRequirement, QuizIssue } from "@studio/shared";
import { assetFingerprint } from "./assetFingerprint.js";

export type ResolvedQuizAsset = QuizAssetRequirement & {
  fingerprint: string;
  path: string;
  source: "explicit_episode" | "channel_reusable" | "cache" | "provider" | "fallback";
};

export type AssetCandidate = { path: string; semantic_key: string; source?: ResolvedQuizAsset["source"] };
export type AssetLookup = {
  explicit_episode?: (request: QuizAssetRequirement) => Promise<AssetCandidate | null>;
  channel_reusable?: (request: QuizAssetRequirement) => Promise<AssetCandidate | null>;
  cache?: (request: QuizAssetRequirement, fingerprint: string) => Promise<AssetCandidate | null>;
  provider?: (request: QuizAssetRequirement) => Promise<AssetCandidate | null>;
  fallback?: (request: QuizAssetRequirement) => Promise<AssetCandidate | null>;
};

export class AssetResolver {
  constructor(private readonly lookup: AssetLookup) {}

  async resolve(plan: QuizAssetPlan): Promise<{ assets: ResolvedQuizAsset[]; issues: QuizIssue[] }> {
    const assets: ResolvedQuizAsset[] = [];
    const issues: QuizIssue[] = [];
    for (const request of plan.assets) {
      const fingerprint = assetFingerprint(request);
      const candidate = await this.findCandidate(request, fingerprint);
      if (!candidate) {
        issues.push({ code: "asset_missing", severity: request.required ? "blocker" : "warning", message: request.required ? "Required asset " + request.asset_id + " could not be resolved." : "Optional asset " + request.asset_id + " is unavailable.", next_action: request.required ? "Provide a semantically matching episode, channel, cache, or provider asset before rendering." : "Continue without the optional decorative asset or add it later.", question_ids: request.question_id ? [request.question_id] : [], stage: "assets" });
        continue;
      }
      if (!isSafeAssetReference(candidate.path)) {
        issues.push({ code: "asset_path_unsafe", severity: "blocker", message: "Asset " + request.asset_id + " resolved to an unsafe path.", next_action: "Regenerate or register the asset through the repository path boundary.", question_ids: request.question_id ? [request.question_id] : [], stage: "assets" });
        continue;
      }
      if (candidate.source === "fallback" && candidate.semantic_key !== request.semantic_key) {
        issues.push({ code: "asset_semantic_fallback", severity: request.required ? "blocker" : "warning", message: "Fallback for " + request.asset_id + " does not preserve the required semantic subject.", next_action: request.required ? "Resolve the exact subject asset before rendering." : "Omit the decorative fallback or provide a matching asset.", question_ids: request.question_id ? [request.question_id] : [], stage: "assets" });
        continue;
      }
      assets.push({ ...request, fingerprint, path: candidate.path, source: candidate.source ?? "provider" });
    }
    return { assets, issues };
  }

  private async findCandidate(request: QuizAssetRequirement, fingerprint: string): Promise<AssetCandidate | null> {
    const providers: Array<((request: QuizAssetRequirement) => Promise<AssetCandidate | null>) | undefined> = [
      this.lookup.explicit_episode,
      this.lookup.channel_reusable,
    ];
    for (const lookup of providers) {
      const result = lookup ? await lookup(request) : null;
      if (result) return { ...result, source: result.source ?? (lookup === this.lookup.explicit_episode ? "explicit_episode" : "channel_reusable") };
    }
    const cached = this.lookup.cache ? await this.lookup.cache(request, fingerprint) : null;
    if (cached) return { ...cached, source: cached.source ?? "cache" };
    const generated = this.lookup.provider ? await this.lookup.provider(request) : null;
    if (generated) return { ...generated, source: generated.source ?? "provider" };
    const fallback = this.lookup.fallback ? await this.lookup.fallback(request) : null;
    return fallback ? { ...fallback, source: fallback.source ?? "fallback" } : null;
  }
}

export function isSafeAssetReference(value: string): boolean {
  if (!value || value.includes("\0") || /^https?:\/\//i.test(value)) return false;
  const normalized = value.replaceAll("\\", "/");
  return !normalized.split("/").some((segment) => segment === "..") && path.basename(normalized) === path.basename(normalized).trim() && !path.basename(normalized).includes(":");
}
