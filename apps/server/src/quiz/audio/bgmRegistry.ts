import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type BgmCategory = "100_bpm_gentle" | "120_bpm_upbeat";

export type BgmTrack = {
  id: string;
  filename: string;
  path: string;
  bpm: number;
  duration_seconds: number;
  key: string;
  rms_energy: number;
  category: BgmCategory;
  recommended_use: string;
};

export type BgmManifest = {
  version: string;
  pack_name: string;
  total_tracks: number;
  bpm_groups: Record<string, number>;
  tracks: BgmTrack[];
};

export type BgmPlacement = {
  id: string;
  trackId: string;
  filename: string;
  src: string;
  startSeconds: number;
  durationSeconds: number;
  volume: number;
  bpm: number;
};

export type ResolveBgmOptions = {
  bpmPreference?: BgmCategory | "auto";
  baseVolume?: number;
  seed?: number | string;
  trackId?: string;
  recentTrackIds?: string[];
  assets?: Record<string, string>;
  baseDirectory?: string;
};

export function hashStringToSeed(input?: string | number): number {
  if (typeof input === "number") return Math.abs(Math.floor(input));
  if (!input) return 0;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export class BgmRegistry {
  private manifest: BgmManifest | null = null;
  private readonly tracks = new Map<string, BgmTrack>();
  private readonly bgmDir: string;

  constructor(baseDirectory?: string) {
    this.bgmDir = baseDirectory || this.findBgmDirectory();
    this.loadManifest();
  }

  private findBgmDirectory(): string {
    const candidates = [
      path.resolve(process.cwd(), "assets/audio/bgm"),
      path.resolve(process.cwd(), "../../assets/audio/bgm"),
      path.resolve(process.cwd(), "../assets/audio/bgm"),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(path.join(cand, "manifest.json"))) {
        return cand;
      }
    }

    let curr = process.cwd();
    for (let i = 0; i < 5; i++) {
      const probe = path.join(curr, "assets/audio/bgm");
      if (fs.existsSync(path.join(probe, "manifest.json"))) {
        return probe;
      }
      const parent = path.dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }

    return path.resolve(process.cwd(), "assets/audio/bgm");
  }

  private loadManifest(): void {
    const manifestPath = path.join(this.bgmDir, "manifest.json");
    try {
      if (fs.existsSync(manifestPath)) {
        const raw = fs.readFileSync(manifestPath, "utf-8");
        this.manifest = JSON.parse(raw) as BgmManifest;
        for (const track of this.manifest.tracks) {
          this.tracks.set(track.id, track);
        }
      }
    } catch {
      this.manifest = null;
    }
  }

  getTracks(category?: BgmCategory): BgmTrack[] {
    const all = Array.from(this.tracks.values());
    if (all.length > 0) {
      return category ? all.filter((t) => t.category === category) : all;
    }
    const fallbacks: BgmTrack[] = [
      {
        id: "Games_in_the_Garden",
        filename: "Games_in_the_Garden.mp3",
        path: "tracks/Games_in_the_Garden.mp3",
        bpm: 117.5,
        duration_seconds: 182.6,
        key: "C",
        rms_energy: 0.1702,
        category: "120_bpm_upbeat",
        recommended_use: "Question countdown and game rounds",
      },
      {
        id: "Morning_in_the_Garden",
        filename: "Morning_in_the_Garden.mp3",
        path: "tracks/Morning_in_the_Garden.mp3",
        bpm: 99.4,
        duration_seconds: 180.1,
        key: "D",
        rms_energy: 0.1497,
        category: "100_bpm_gentle",
        recommended_use: "Intro, storytelling, and fact explanations",
      },
    ];
    return category ? fallbacks.filter((t) => t.category === category) : fallbacks;
  }

  getTrack(id: string): BgmTrack | null {
    return this.tracks.get(id) ?? null;
  }

  selectCandidateTrack(candidates: BgmTrack[], options?: ResolveBgmOptions): BgmTrack | null {
    if (candidates.length === 0) return null;

    if (options?.trackId) {
      const explicit = candidates.find((t) => t.id === options.trackId || t.filename === options.trackId);
      if (explicit) return explicit;
    }

    const seedNumber = hashStringToSeed(options?.seed);
    const recent = options?.recentTrackIds ?? [];

    if (recent.length === 0) {
      return candidates[seedNumber % candidates.length]!;
    }

    // Rank candidates by recency: distance from recent usage.
    // Index 0 in recent is the most recent (distance 0).
    // An unused track has distance Infinity.
    let maxDistance = -1;
    const scored = candidates.map((track) => {
      const idx = recent.indexOf(track.id);
      const distance = idx === -1 ? Number.POSITIVE_INFINITY : idx;
      if (distance > maxDistance) {
        maxDistance = distance;
      }
      return { track, distance };
    });

    const bestPool = scored
      .filter((item) => item.distance === maxDistance)
      .map((item) => item.track);

    return bestPool[seedNumber % bestPool.length]!;
  }

  resolveBgmSchedule(totalDurationSeconds: number, options?: ResolveBgmOptions): BgmPlacement[] {
    const duration = Math.max(1, totalDurationSeconds);
    const categoryPref = options?.bpmPreference ?? "120_bpm_upbeat";
    const baseVolume = options?.baseVolume ?? 0.18;
    const explicitTrack = options?.trackId
      ? (this.getTrack(options.trackId) ?? this.getTracks().find((t) => t.id === options.trackId || t.filename === options.trackId) ?? null)
      : null;
    const pool = explicitTrack ? [explicitTrack] : this.getTracks(categoryPref === "auto" ? undefined : categoryPref);
    const available = pool.length > 0 ? pool : this.getTracks();

    if (available.length === 0) return [];

    const seedNumber = hashStringToSeed(options?.seed);

    // If single track can cover the duration (standard <= 185s episode)
    const longEnoughTracks = available.filter((t) => t.duration_seconds >= duration - 1.0);
    if (longEnoughTracks.length > 0) {
      const track = this.selectCandidateTrack(longEnoughTracks, options)!;
      const customAsset = options?.assets?.[`bgm:${track.id}`] ?? options?.assets?.[track.filename];
      const src = customAsset ? formatAudioSource(customAsset) : `./bgm/${track.filename}`;

      return [
        {
          id: "bgm-clip-1-0",
          trackId: track.id,
          filename: track.filename,
          src,
          startSeconds: 0,
          durationSeconds: Number(duration.toFixed(3)),
          volume: baseVolume,
          bpm: track.bpm,
        },
      ];
    }

    // Otherwise sequence multiple tracks across the duration
    const placements: BgmPlacement[] = [];
    let cursor = 0;
    let index = 0;
    const usedInSequence: string[] = [...(options?.recentTrackIds ?? [])];

    while (cursor < duration - 0.1) {
      const remaining = duration - cursor;
      const track = this.selectCandidateTrack(available, {
        ...options,
        recentTrackIds: usedInSequence,
        seed: seedNumber + index,
      }) ?? available[(seedNumber + index) % available.length]!;

      usedInSequence.unshift(track.id);
      const segmentDuration = Math.min(remaining, track.duration_seconds);

      const customAsset = options?.assets?.[`bgm:${track.id}`] ?? options?.assets?.[track.filename];
      const src = customAsset ? formatAudioSource(customAsset) : `./bgm/${track.filename}`;

      placements.push({
        id: `bgm-clip-${index + 1}-${Math.round(cursor * 1000)}`,
        trackId: track.id,
        filename: track.filename,
        src,
        startSeconds: Number(cursor.toFixed(3)),
        durationSeconds: Number(segmentDuration.toFixed(3)),
        volume: baseVolume,
        bpm: track.bpm,
      });

      cursor += segmentDuration;
      index += 1;
    }

    return placements;
  }
}

function formatAudioSource(filePathOrUrl: string): string {
  if (/^(data:|https?:|file:)/i.test(filePathOrUrl) || filePathOrUrl.startsWith("./") || filePathOrUrl.startsWith("../")) {
    return filePathOrUrl;
  }
  return pathToFileURL(filePathOrUrl).href;
}

export const defaultBgmRegistry = new BgmRegistry();
