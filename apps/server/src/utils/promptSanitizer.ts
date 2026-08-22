import { EventEmitter } from "node:events";
import type { AntigravityClient } from "../antigravity.js";
import type { CodexAppServerClient } from "../codex.js";

export type LLMClient = AntigravityClient | CodexAppServerClient;

/**
 * Checks if an error from an image generation API is caused by a safety or content moderation filter.
 */
export function isContentFilterError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object" && "code" in error && (error as { code?: string }).code === "IMAGE_CONTENT_FILTER_REJECTED") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /(?:rejected by (?:the )?content filter|content filter|safety filter|safety system|policy violation|prohibited content|inappropriate content|moderation filter|safety guidelines|trigger(?:ed)? (?:a |the )?safety)/i.test(message);
}

/**
 * Extracts a concise error reason from a content filter error.
 */
export function extractFilterReason(error: unknown): string {
  if (!error) return "Safety content filter triggered";
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

/**
 * Fast rule-based scrubber for obvious trigger words (fallback if LLM is offline).
 */
export function sanitizePromptRuleBased(prompt: string): string {
  let cleaned = prompt;
  const replacements: Array<[RegExp, string]> = [
    [/\b(bloody|blood|bleeding|gore|gory)\b/gi, "crimson-toned dramatic"],
    [/\b(dead|dying|corpse|corpses|slain|killed|decapitated|mutilated)\b/gi, "fallen"],
    [/\b(kill|killing|murder|slaughter|execution|torture|assassinate)\b/gi, "dramatic confrontation"],
    [/\b(gun|guns|pistol|rifle|firearm|shotgun|weapon)\b/gi, "cinematic prop"],
    [/\b(shoot|shooting)\b/gi, "filming"],
    [/\b(nude|naked|bikini|erotic|sensual|cleavage|undressed)\b/gi, "elegantly dressed"],
    [/\b(suicide|hang|hanging)\b/gi, "dramatic atmosphere"],
  ];
  for (const [pattern, replacement] of replacements) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  return cleaned;
}

/**
 * Executes a single standalone prompt turn with an LLM client (Antigravity or Codex) and returns the text result.
 */
export async function executeSinglePromptText(
  client: LLMClient,
  prompt: string,
  options: {
    modelOverride?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  await client.connect();
  const threadId = await client.startThread();

  return new Promise<string>((resolve, reject) => {
    let output = "";
    let turnId: string | null = null;

    const cleanup = () => {
      clearTimeout(timer);
      (client as unknown as EventEmitter).off("notification", onNotification);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      void client.deleteThread(threadId).catch(() => undefined);
    };

    const timer = setTimeout(() => {
      cleanup();
      if (output.trim()) {
        resolve(output.trim());
      } else {
        reject(new Error(`LLM single prompt turn timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      if (turnId) void client.interruptTurn(threadId, turnId).catch(() => undefined);
      reject(new Error("LLM single prompt turn aborted"));
    };

    const onNotification = (event: { method: string; params: Record<string, unknown> }) => {
      const eventThreadId = typeof event.params.threadId === "string"
        ? event.params.threadId
        : typeof (event.params.turn as { threadId?: unknown } | undefined)?.threadId === "string"
        ? (event.params.turn as { threadId: string }).threadId
        : null;
      const eventTurnId = typeof event.params.turnId === "string"
        ? event.params.turnId
        : typeof (event.params.turn as { id?: unknown } | undefined)?.id === "string"
        ? (event.params.turn as { id: string }).id
        : null;

      if (eventThreadId && eventThreadId !== threadId) return;
      if (turnId && eventTurnId && eventTurnId !== turnId) return;

      if (event.method === "item/agentMessage/delta") {
        const delta = typeof event.params.delta === "string"
          ? event.params.delta
          : event.params.delta && typeof event.params.delta === "object"
          ? JSON.stringify(event.params.delta)
          : "";
        output += delta;
      } else if (event.method === "turn/completed") {
        const turn = event.params.turn as { status?: string; error?: { message?: string } } | undefined;
        cleanup();
        if (turn?.status === "failed") {
          reject(new Error(turn.error?.message ?? "LLM turn failed"));
        } else if (turn?.status === "interrupted") {
          reject(new Error("LLM turn interrupted"));
        } else {
          resolve(output.trim());
        }
      } else if (event.method === "error") {
        const error = event.params.error as { message?: string } | undefined;
        cleanup();
        reject(new Error(error?.message ?? "LLM error"));
      }
    };

    if (options.signal) {
      if (options.signal.aborted) {
        cleanup();
        return reject(new Error("LLM single prompt turn aborted"));
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    (client as unknown as EventEmitter).on("notification", onNotification);

    const startTurnPromise = (client as any).startTurn(threadId, prompt, options.modelOverride);
    Promise.resolve(startTurnPromise)
      .then((tId: string) => {
        turnId = tId;
      })
      .catch((err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

/**
 * Rephrases and sanitizes an image prompt using Antigravity/Codex LLM to bypass safety moderation filters.
 */
export async function sanitizeImagePromptWithLLM(params: {
  client: LLMClient;
  originalPrompt: string;
  rejectionReason?: string;
  context?: string;
  modelOverride?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { client, originalPrompt, rejectionReason, context, modelOverride, signal } = params;

  const prompt = [
    `You are an expert AI prompt engineer and safety compliance director for AI image generation (DALL-E 3 / GPT-Image / Midjourney / Imagen).`,
    ``,
    `The following image prompt was REJECTED by an image provider's safety & content moderation filter:`,
    `---`,
    `[REJECTED PROMPT]:`,
    `"${originalPrompt}"`,
    `---`,
    `[REJECTION REASON]:`,
    `"${rejectionReason || "Your prompt was rejected by the content filter"}"`,
    ...(context ? [`---`, `[ADDITIONAL SCENE CONTEXT]:`, `"${context}"`] : []),
    `---`,
    ``,
    `TASK:`,
    `Rewrite and sanitize this prompt so it 100% passes all strict content moderation filters while maintaining 95%+ of the original artistic vision, cinematic mood, composition, lighting, camera angle, color palette, and character framing.`,
    ``,
    `STRICT COMPLIANCE RULES:`,
    `1. VIOLENCE / GORE: Replace blood, wounds, dead bodies, killing, violence, execution, combat gore with dramatic atmosphere, cinematic fog, dust particles, fallen banners, or tense standoff without blood or explicit injuries.`,
    `2. REAL PERSONS: Replace names of real living or historical figures with generic descriptions (e.g. "a distinguished 19th-century statesman in formal dark suit", "a veteran Asian general in ancient ceremonial armor").`,
    `3. COPYRIGHT: Replace copyrighted characters or brand names with generic artistic descriptions.`,
    `4. SENSITIVITY / NSFW: Rephrase clothing, poses, or sensitive themes into classical, dignified, or aesthetic terms.`,
    `5. DUAL-MEANING WORDS: Avoid words like "shooting", "slaying", "deadly", "explosive" that might trigger false-positive keyword filters. Use visual synonyms instead.`,
    `6. LANGUAGE: Keep the final output in descriptive, high-quality English suitable for image generation.`,
    `7. OUTPUT FORMAT: Return ONLY the rewritten prompt text. Do not include markdown quotes, explanations, prefixes like "Here is the prompt:", or commentary.`,
  ].join("\n");

  try {
    const rawResult = await executeSinglePromptText(client, prompt, {
      modelOverride: modelOverride || "flash",
      signal,
      timeoutMs: 45_000,
    });

    let cleaned = rawResult.trim();
    // Remove markdown code fences if wrapped
    cleaned = cleaned.replace(/^```(?:[a-z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```$/i, "$1").trim();
    // Remove surrounding quotes
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
      cleaned = cleaned.slice(1, -1).trim();
    }
    // Remove "Prompt:" prefix
    cleaned = cleaned.replace(/^(?:Prompt|Here is the (?:sanitized|rewritten|new)? prompt|Rewritten prompt)\s*:\s*/i, "").trim();

    if (cleaned.length > 10) {
      return cleaned;
    }
  } catch {
    // Fallback to rule-based scrubber if LLM fails
  }

  return sanitizePromptRuleBased(originalPrompt);
}
