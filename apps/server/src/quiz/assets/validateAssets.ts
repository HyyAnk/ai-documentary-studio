import { access, readFile, stat } from "node:fs/promises";
import type { QuizAssetRequirement, QuizIssue } from "@studio/shared";
import type { ResolvedQuizAsset } from "./assetResolver.js";

export async function validateResolvedAssets(requirements: QuizAssetRequirement[], assets: ResolvedQuizAsset[]): Promise<QuizIssue[]> {
  const issues: QuizIssue[] = [];
  const resolved = new Map(assets.map((asset) => [asset.asset_id, asset]));
  for (const requirement of requirements) {
    const asset = resolved.get(requirement.asset_id);
    if (!asset) continue;
    try {
      await access(asset.path);
      const metadata = await stat(asset.path);
      if (!metadata.isFile() || metadata.size === 0) throw new Error("empty");
      const dimensions = pngDimensions(await readFile(asset.path));
      if (!dimensions) throw new Error("undecodable");
      if (!matchesAspectRatio(dimensions.width / dimensions.height, requirement.aspect_ratio)) throw new Error("aspect-ratio");
    } catch {
      issues.push({ code: "asset_file_invalid", severity: requirement.required ? "blocker" : "warning", message: "Asset " + requirement.asset_id + " cannot be decoded with the planned dimensions and aspect ratio.", next_action: "Resolve the asset again through the repository or provider boundary.", question_ids: requirement.question_id ? [requirement.question_id] : [], stage: "assets" });
    }
  }
  return issues;
}

function pngDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 24 || !data.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function matchesAspectRatio(ratio: number, requested: QuizAssetRequirement["aspect_ratio"]): boolean {
  const expected: Record<QuizAssetRequirement["aspect_ratio"], number> = {
    "1:1": 1,
    "4:3": 4 / 3,
    "3:4": 3 / 4,
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "2:3": 2 / 3,
    "3:2": 3 / 2,
  };
  const target = expected[requested] ?? 1;
  return Math.abs(ratio - target) / target <= 0.18;
}
