import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageProvider } from "./index.js";
import { RepositoryService } from "../repository.js";

type CodexImageTarget = {
  channelId: string;
  episodeId: string;
  bundleNumber: number;
  variant: number;
};

export class CodexImageProvider implements ImageProvider {
  constructor(
    private readonly repository: RepositoryService,
    private readonly target: CodexImageTarget,
    private readonly output: string,
  ) {}

  async generateReference(_prompt: string): Promise<{ asset_path: string }> {
    const destination = await this.repository.getBundleImagePath(this.target.channelId, this.target.episodeId, this.target.bundleNumber, this.target.variant);
    try {
      await readFile(destination.absolutePath);
      return { asset_path: destination.path };
    } catch {
      // Codex may have returned image bytes or written the file under another workspace path.
    }

    const dataUrl = this.output.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/i)?.[1]?.replace(/\s+/g, "")
      ?? this.output.match(/"(?:b64_json|base64|data)"\s*:\s*"([A-Za-z0-9+/=]+)"/i)?.[1];
    if (dataUrl) {
      return { asset_path: await this.repository.writeBundleImage(this.target.channelId, this.target.episodeId, this.target.bundleNumber, Buffer.from(dataUrl, "base64"), this.target.variant) };
    }

    const reportedPath = findReportedImagePath(this.output);
    if (reportedPath) {
      const resolvedPath = path.isAbsolute(reportedPath) ? reportedPath : path.resolve(this.repository.rootDirectory, reportedPath);
      try {
        return { asset_path: await this.repository.writeBundleImageFromFile(this.target.channelId, this.target.episodeId, this.target.bundleNumber, resolvedPath, this.target.variant) };
      } catch (error) {
        if (!(error instanceof Error) || !/ENOENT|not found/i.test(error.message)) throw error;
      }
    }

    throw new Error(`Image generation returned no PNG at ${destination.path}. The connected Codex account/model may be text-only; configure an image-capable provider (for example, an OpenAI-compatible image service) or disable continuity anchor images.`);
  }
}

function findReportedImagePath(output: string): string | null {
  const matches = output.match(/(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/|(?:channels|assets)[\\/])[^"'`\r\n]+\.(?:png|jpe?g|webp)\b/gi) ?? [];
  return matches.map((value) => value.trim().replace(/[),.;]+$/, "")).find(Boolean) ?? null;
}
