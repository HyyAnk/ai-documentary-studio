import { access, constants, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ImageProvider } from "./index.js";
import { RepositoryError, RepositoryService } from "../repository.js";
import { AntigravityClient } from "../antigravity.js";
import { StudioLogger } from "../logger.js";
import { loadConfig } from "../config.js";

type AntigravityNativeImageTarget = {
  channelId: string;
  episodeId: string;
  bundleNumber?: number;
  variant?: number;
  assetId?: string;
  fingerprint?: string;
  theme?: string;
};

export class AntigravityNativeImageProvider implements ImageProvider {
  private readonly logger: StudioLogger;
  private static imageQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repository: RepositoryService,
    private readonly target: AntigravityNativeImageTarget,
    private readonly client?: AntigravityClient,
  ) {
    this.logger = new StudioLogger(repository.rootDirectory);
  }

  async generateReference(prompt: string, cancellationSignal?: AbortSignal): Promise<{ asset_path: string; fallback_tier: 1; degraded: false }> {
    // Chain sequentially through static imageQueue to prevent concurrent rate limit bursts across tasks
    const result = await (AntigravityNativeImageProvider.imageQueue = AntigravityNativeImageProvider.imageQueue
      .catch(() => undefined)
      .then(async () => {
        return this.executeGenerationWithRetry(prompt, cancellationSignal);
      }));

    return result as { asset_path: string; fallback_tier: 1; degraded: false };
  }

  private async executeGenerationWithRetry(prompt: string, cancellationSignal?: AbortSignal): Promise<{ asset_path: string; fallback_tier: 1; degraded: false }> {
    const config = await loadConfig(this.repository.rootDirectory);
    const client = this.client ?? new AntigravityClient(this.repository.rootDirectory, config, this.logger);

    const imageName = this.target.assetId
      ? `quiz_${this.target.assetId.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`
      : `bundle_cb_${String(this.target.bundleNumber ?? 1).padStart(2, "0")}`;

    const cleanPrompt = this.extractCleanVisualPrompt(prompt);

    const maxAttempts = 5;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (cancellationSignal?.aborted) throw new Error("Image generation aborted");

      const turnStartTime = Date.now();

      let threadId: string | null = null;
      let turnId: string | null = null;

      try {
        const turnPrompt = [
          `You are an AI illustrator. Call the generate_image tool immediately:`,
          `- AspectRatio: "16:9"`,
          `- ImageName: "${imageName}"`,
          `- Prompt: "${cleanPrompt}"`,
          ``,
          `IMPORTANT RULES:`,
          `1. Call generate_image immediately in step 1.`,
          `2. DO NOT use schedule. DO NOT run sleep or wait commands.`,
          `3. If generate_image encounters an error or rate limit (e.g. 429 RESOURCE_EXHAUSTED), output the error message clearly so that the system retry loop can handle backoff.`,
        ].join("\n");

        threadId = await client.startThread();
        turnId = await client.startTurn(threadId, turnPrompt, "flash");

        // Actively poll for the image file in the Antigravity conversation directory for up to 45 seconds
        const pollDeadline = Date.now() + 45_000;
        let imageBytes: Uint8Array | null = null;
        let detectedRateLimit: string | null = null;

        while (Date.now() < pollDeadline && !imageBytes) {
          if (cancellationSignal?.aborted) {
            void client.interruptTurn(threadId, turnId);
            throw new Error("Image generation aborted");
          }

          const convId = client.getConversationId ? client.getConversationId(threadId) : null;
          imageBytes = await this.findGeneratedImage(imageName, turnStartTime, convId);
          if (imageBytes && imageBytes.length > 0) break;

          // Check if the conversation transcript logged a rate limit or 429 error
          if (convId) {
            detectedRateLimit = await this.findTranscriptError(convId);
            if (detectedRateLimit) {
              lastError = new RepositoryError(`Antigravity image generation hit rate limit: ${detectedRateLimit}`, "RATE_LIMIT_EXCEEDED");
              break;
            }
          }

          await new Promise((r) => setTimeout(r, process.env.NODE_ENV === "test" ? 20 : 1000));
        }

        if (imageBytes && imageBytes.length > 0) {
          let assetPath: string;
          if (this.target.assetId && this.target.fingerprint) {
            assetPath = await this.repository.writeQuizImageAsset(this.target.channelId, this.target.episodeId, this.target.assetId, this.target.fingerprint, imageBytes);
          } else {
            assetPath = await this.repository.writeBundleImage(this.target.channelId, this.target.episodeId, this.target.bundleNumber ?? 1, imageBytes, this.target.variant ?? 0);
          }

          // Mandatory cooldown (8s) between successive image generation calls to avoid backend rate limits
          const cooldownMs = process.env.NODE_ENV === "test" ? 10 : 8000;
          this.logger.info(`Image created and verified successfully for ${imageName}, cooling down for ${cooldownMs / 1000}s before next image...`);
          await new Promise((r) => setTimeout(r, cooldownMs));

          return { asset_path: assetPath, fallback_tier: 1, degraded: false };
        }

        if (!lastError || !/429|quota|rate limit|resource_exhausted|exhausted/i.test(lastError.message)) {
          lastError = new RepositoryError(`Antigravity native image tool did not produce an image for ${imageName} (attempt ${attempt}/${maxAttempts})`, "IMAGE_GENERATION_FAILED");
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      } finally {
        if (threadId && typeof client.deleteThread === "function") {
          void client.deleteThread(threadId).catch(() => undefined);
        }
      }

      if (attempt < maxAttempts) {
        const isRateLimit = /429|quota|rate limit|resource_exhausted|exhausted/i.test(lastError.message);
        const baseDelay = process.env.NODE_ENV === "test" ? 50 : isRateLimit ? 10000 : 3000;
        const retryDelay = attempt * baseDelay;
        this.logger.warn(`Antigravity image generation attempt ${attempt} failed (${lastError.message}), cooling down for ${retryDelay}ms before retry...`);
        await new Promise((r) => setTimeout(r, retryDelay));
      }
    }

    throw lastError || new RepositoryError(`Antigravity native image generation failed for ${imageName}`, "IMAGE_GENERATION_FAILED");
  }

  private extractCleanVisualPrompt(rawPrompt: string): string {
    // 1. If prompt has Anchor-frame prompt section (from visual bible or task manifest)
    const anchorMatch = rawPrompt.match(/Anchor[- ]frame prompt\s*:\s*([^\n\r]+)/i);
    if (anchorMatch && anchorMatch[1].trim()) {
      const cleanedAnchor = anchorMatch[1]
        .replace(/\b(?:with\s+a\s+|showing\s+a\s+|displaying\s+a\s+)?(?:question|quiz)\s+card(?:\s+overlay|\s+showing|\s+with)?[^,.]*/gi, "")
        .replace(/\b(?:choice\s+box(?:es)?|answer\s+buttons?|countdown\s+timer|timer\s+bar)\b[^,.]*/gi, "")
        .replace(/[`"]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return (cleanedAnchor || anchorMatch[1].replace(/[`"]/g, "").replace(/\s+/g, " ").trim()).slice(0, 450);
    }

    // 2. If prompt is compiled quiz asset prompt (e.g. Subject: ..., Purpose: ..., Solo hero art contract: ...)
    if (rawPrompt.includes("Subject:") || rawPrompt.includes("Visual Style Bible:") || rawPrompt.includes("Solo hero art contract:")) {
      const subjectMatch = rawPrompt.match(/Subject\s*:\s*([^\n\r.]+)/i);
      const subject = subjectMatch ? subjectMatch[1].trim() : "";
      const artStyleMatch = rawPrompt.match(/(?:Solo hero art contract|Consistency group)[^:]*:\s*([^\n\r.]+)/i);
      const artStyle = artStyleMatch ? artStyleMatch[1].trim() : "polished 3D clay-like illustration";
      const lightingMatch = rawPrompt.match(/Lighting\s*:\s*([^\n\r.]+)/i);
      const lighting = lightingMatch ? lightingMatch[1].trim() : "soft clean lighting";

      const parts = [
        subject ? `${subject}` : "",
        artStyle,
        lighting,
        "clean composition, vibrant colors, child-friendly high quality 16:9 visual illustration",
        "no text, no watermark, no split panels, no labels",
      ].filter(Boolean);

      return parts.join(", ").slice(0, 450);
    }

    // 3. If prompt is structured manifest, extract core visual instructions
    if (rawPrompt.includes("Task type:") || rawPrompt.includes("Channel DNA") || rawPrompt.includes("--- FILE:")) {
      const visualMatch = rawPrompt.match(/Generate exactly one reference image for continuity bundle [^.]*\.\s*([^\n\r]+)/i);
      if (visualMatch && visualMatch[1].trim()) {
        return visualMatch[1].replace(/[`"]/g, "").replace(/\s+/g, " ").trim().slice(0, 450);
      }
    }

    // 4. Fallback: clean raw prompt, remove markdown tags, clamp to max 400 chars
    const cleaned = rawPrompt
      .replace(/--- FILE:[\s\S]*$/i, "")
      .replace(/#+ [^\n\r]+/g, " ")
      .replace(/[`"\\#*]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return cleaned.slice(0, 400);
  }

  private async findGeneratedImage(imageNamePrefix: string, turnStartTime?: number, specificConvId?: string | null): Promise<Uint8Array | null> {
    const userHome = homedir();
    const brainDir = path.join(userHome, ".gemini", "antigravity", "brain");
    const exists = await access(brainDir, constants.R_OK).then(() => true).catch(() => false);
    if (!exists) return null;

    try {
      const normalizedPrefix = imageNamePrefix.toLowerCase().replace(/[^a-z0-9_]/g, "_");

      // 1. If specific conversation ID is known, search that folder first
      if (specificConvId) {
        const specificPath = path.join(brainDir, specificConvId);
        try {
          const files = await readdir(specificPath);
          for (const file of files) {
            if (/\.(png|jpe?g|webp)$/i.test(file) && (file.toLowerCase().startsWith(normalizedPrefix) || file.toLowerCase().includes(normalizedPrefix))) {
              const data = await readFile(path.join(specificPath, file));
              if (data.length >= 8) return new Uint8Array(data);
            }
          }
          // Also check any image file created in this specific folder after turn start
          for (const file of files) {
            if (/\.(png|jpe?g|webp)$/i.test(file)) {
              const filePath = path.join(specificPath, file);
              const st = await stat(filePath);
              if (!turnStartTime || st.mtimeMs >= turnStartTime - 10_000) {
                const data = await readFile(filePath);
                if (data.length >= 8) return new Uint8Array(data);
              }
            }
          }
        } catch {}
      }

      // 2. Scan top recent conversation directories
      const conversations = await readdir(brainDir);
      const convStats = await Promise.all(
        conversations.map(async (conv) => {
          const convPath = path.join(brainDir, conv);
          try {
            const st = await stat(convPath);
            return { conv, convPath, mtime: st.mtimeMs, isDir: st.isDirectory() };
          } catch {
            return null;
          }
        }),
      );

      const validConvs = convStats
        .filter((c): c is NonNullable<typeof c> => Boolean(c && c.isDir))
        .sort((a, b) => b.mtime - a.mtime);

      for (const { convPath } of validConvs.slice(0, 10)) {
        try {
          const files = await readdir(convPath);
          const imageFiles: Array<{ filename: string; filePath: string; mtime: number }> = [];

          for (const file of files) {
            if (/\.(png|jpe?g|webp)$/i.test(file)) {
              const filePath = path.join(convPath, file);
              try {
                const st = await stat(filePath);
                imageFiles.push({ filename: file, filePath, mtime: st.mtimeMs });
              } catch {}
            }
          }

          imageFiles.sort((a, b) => b.mtime - a.mtime);

          // Look for image starting with our imageName prefix
          const matching = imageFiles.find((img) => img.filename.toLowerCase().startsWith(normalizedPrefix) || img.filename.toLowerCase().includes(normalizedPrefix));
          if (matching) {
            const data = await readFile(matching.filePath);
            if (data.length >= 8) return new Uint8Array(data);
          }

          // If recent image created during this turn or within the last 5 minutes
          const minMtime = turnStartTime ? turnStartTime - 10_000 : Date.now() - 5 * 60 * 1000;
          const recentImage = imageFiles.find((img) => img.mtime >= minMtime);
          if (recentImage) {
            const data = await readFile(recentImage.filePath);
            if (data.length > 100) return new Uint8Array(data);
          }
        } catch {}
      }
    } catch (err) {
      this.logger.warn(`Failed searching Antigravity brain for generated image: ${err instanceof Error ? err.message : "unknown error"}`);
    }

    return null;
  }

  private async findTranscriptError(specificConvId?: string | null): Promise<string | null> {
    if (!specificConvId) return null;
    const userHome = homedir();
    const baseDir = path.join(userHome, ".gemini", "antigravity", "brain", specificConvId, ".system_generated", "logs");
    const transcriptFullPath = path.join(baseDir, "transcript_full.jsonl");
    const transcriptPath = path.join(baseDir, "transcript.jsonl");

    try {
      const fullExists = await access(transcriptFullPath, constants.R_OK).then(() => true).catch(() => false);
      const normExists = !fullExists && (await access(transcriptPath, constants.R_OK).then(() => true).catch(() => false));
      const filePath = fullExists ? transcriptFullPath : normExists ? transcriptPath : null;
      if (!filePath) return null;

      const raw = await readFile(filePath, "utf8");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        try {
          const step = JSON.parse(line) as {
            source?: string;
            type?: string;
            status?: string;
            content?: string;
          };
          const text = `${typeof step.content === "string" ? step.content : ""} ${typeof step.status === "string" ? step.status : ""}`;
          if (/429|RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|exhausted your capacity|quota/i.test(text)) {
            const match = text.match(/(?:429|RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|exhausted your capacity|quota)[^\n\r.]*/i);
            return match ? match[0].trim() : "429 RESOURCE_EXHAUSTED (RATE_LIMIT_EXCEEDED)";
          }
        } catch {}
      }
    } catch {}
    return null;
  }
}


