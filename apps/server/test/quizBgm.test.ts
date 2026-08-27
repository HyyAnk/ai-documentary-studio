import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QuizV2Schema } from "@studio/shared";
import { BgmRegistry, defaultBgmRegistry } from "../src/quiz/audio/bgmRegistry.js";
import { buildQuizVoicePlan } from "../src/quiz/audio/voicePlan.js";
import { createDefaultDirectorPlan } from "../src/quiz/director/parseDirectorPlan.js";
import { buildCandyArcadeCompositionBundle } from "../src/quiz/render/candyArcadeComposition.js";
import { compileQuizTimeline } from "../src/quiz/timeline/compileTimeline.js";
import { RepositoryService } from "../src/repository.js";

const quiz = QuizV2Schema.parse({
  schema_version: 2,
  episode_id: "bgm-demo",
  age_band: "7-9",
  language: "English",
  questions: [
    {
      id: "question-01",
      number: 1,
      format: "multiple_choice",
      difficulty: 1,
      question: "Which ocean is the largest on Earth?",
      choices: [
        { id: "choice-a", text: "Pacific Ocean" },
        { id: "choice-b", text: "Atlantic Ocean" },
        { id: "choice-c", text: "Arctic Ocean" },
      ],
      correct_choice_id: "choice-a",
      explanation: "The Pacific Ocean is the largest ocean on Earth.",
      fun_fact: "It covers more than 30% of Earth's surface!",
      source_ids: ["S01"],
      visual_opportunity: "Globe showing vast blue ocean",
      validation: { semantic_status: "validated", source_coverage: true, fact_locked: true },
    },
    {
      id: "question-02",
      number: 2,
      format: "image_guess",
      difficulty: 1,
      question: "What animal is known as the king of the jungle?",
      choices: [
        { id: "choice-a", text: "Lion" },
        { id: "choice-b", text: "Tiger" },
        { id: "choice-c", text: "Bear" },
      ],
      correct_choice_id: "choice-a",
      explanation: "Lions are often called the king of the jungle.",
      fun_fact: "Lions live in groups called prides!",
      source_ids: ["S02"],
      visual_opportunity: "Majestic friendly lion cartoon",
      validation: { semantic_status: "validated", source_coverage: true, fact_locked: true },
    },
  ],
});

describe("BGM Registry and Audio Pipeline", () => {
  it("loads BGM manifest with BPM groups and accurate metadata", () => {
    const registry = new BgmRegistry();
    const tracks = registry.getTracks();
    expect(tracks.length).toBeGreaterThanOrEqual(2);

    const upbeat = registry.getTracks("120_bpm_upbeat");
    const gentle = registry.getTracks("100_bpm_gentle");

    expect(upbeat.length).toBeGreaterThan(0);
    expect(gentle.length).toBeGreaterThan(0);

    for (const track of upbeat) {
      expect(track.bpm).toBeGreaterThan(110);
      expect(track.category).toBe("120_bpm_upbeat");
    }

    for (const track of gentle) {
      expect(track.bpm).toBeLessThan(110);
      expect(track.category).toBe("100_bpm_gentle");
    }
  });

  it("resolves single-track BGM schedule for standard length episode", () => {
    const registry = defaultBgmRegistry;
    const schedule = registry.resolveBgmSchedule(175, { bpmPreference: "120_bpm_upbeat" });

    expect(schedule.length).toBe(1);
    expect(schedule[0]?.startSeconds).toBe(0);
    expect(schedule[0]?.durationSeconds).toBe(175);
    expect(schedule[0]?.volume).toBe(0.18);
    expect(schedule[0]?.bpm).toBeGreaterThan(110);
  });

  it("resolves multi-track BGM schedule for long-form episodes (> 200s)", () => {
    const registry = defaultBgmRegistry;
    const schedule = registry.resolveBgmSchedule(380, { bpmPreference: "120_bpm_upbeat" });

    expect(schedule.length).toBeGreaterThanOrEqual(2);
    expect(schedule[0]?.startSeconds).toBe(0);
    expect(schedule[1]?.startSeconds).toBeGreaterThan(0);

    const totalCovered = schedule.reduce((sum, item) => sum + item.durationSeconds, 0);
    expect(totalCovered).toBeCloseTo(380, 1);
  });

  it("integrates BGM clip into Candy Arcade HTML composition bundle", () => {
    const director = createDefaultDirectorPlan(quiz);
    const timeline = compileQuizTimeline({ quiz, director, voicePlan: buildQuizVoicePlan(quiz) });
    const bundle = buildCandyArcadeCompositionBundle({
      quiz,
      director,
      timeline,
      theme: "candy_arcade",
      audioPath: "./narration.wav",
      narrationDurationSeconds: timeline.duration_seconds,
    });

    // Check BGM tag
    expect(bundle.html).toContain('class="clip bgm-clip"');
    expect(bundle.html).toContain('data-track-index="4"');
    expect(bundle.html).toContain('data-volume="0.18"');
    expect(bundle.html).toContain('data-automation="');
    expect(bundle.html).toContain('src="./bgm/');
    expect(bundle.html).not.toContain('src="file:///');

    // Parse automation attribute to verify fade-in and fade-out keyframes
    const bgmMatch = bundle.html.match(/<audio id="bgm-clip-[^"]*"[^>]*data-automation="([^"]+)"/);
    expect(bgmMatch).toBeTruthy();
    const automationJson = bgmMatch![1]!.replaceAll("&quot;", '"');
    const automation = JSON.parse(automationJson);
    expect(automation.version).toBe(1);
    expect(automation.lanes).toHaveLength(1);
    expect(automation.lanes[0].target).toBe("volume");

    const points = automation.lanes[0].points;
    expect(points.length).toBeGreaterThanOrEqual(3);
    // Starts at 0 (fade-in)
    expect(points[0]).toEqual({ t: 0, v: 0 });
    // Ramps to base volume 0.18
    expect(points[1]).toEqual({ t: 0.5, v: 0.18 });
    // Ends at 0 (fade-out at total duration)
    expect(points[points.length - 1].v).toBe(0);
    expect(points[points.length - 1].t).toBeCloseTo(timeline.duration_seconds, 1);

    // Check narration and SFX tracks coexist cleanly
    expect(bundle.html).toContain('id="quiz-narration"');
    expect(bundle.html).toContain('data-track-index="2"');
    expect(bundle.html).toContain('class="clip sfx-clip"');
    expect(bundle.html).toContain('data-track-index="3"');
  });

  it("avoids recently used tracks and selects unused tracks (LRU policy)", () => {
    const registry = defaultBgmRegistry;
    const upbeatTracks = registry.getTracks("120_bpm_upbeat");
    expect(upbeatTracks.length).toBeGreaterThanOrEqual(5);

    // Initial pick without history
    const initialSchedule = registry.resolveBgmSchedule(120, {
      bpmPreference: "120_bpm_upbeat",
      seed: "episode-01",
    });
    const firstTrackId = initialSchedule[0]!.trackId;

    // Next episode with firstTrackId in recent history
    const nextSchedule = registry.resolveBgmSchedule(120, {
      bpmPreference: "120_bpm_upbeat",
      recentTrackIds: [firstTrackId],
      seed: "episode-02",
    });
    const secondTrackId = nextSchedule[0]!.trackId;

    expect(secondTrackId).not.toBe(firstTrackId);
  });

  it("performs clean Round-Robin selection across multiple consecutive episodes", () => {
    const registry = defaultBgmRegistry;
    const history: string[] = [];
    const chosenTracks: string[] = [];
    const episodeCount = 10;

    for (let i = 1; i <= episodeCount; i++) {
      const schedule = registry.resolveBgmSchedule(120, {
        bpmPreference: "120_bpm_upbeat",
        recentTrackIds: history,
        seed: `episode-series-${i}`,
      });
      const chosen = schedule[0]!.trackId;
      chosenTracks.push(chosen);
      history.unshift(chosen);
    }

    // All 10 episodes should have chosen unique BGM tracks
    const uniqueChosen = new Set(chosenTracks);
    expect(uniqueChosen.size).toBe(episodeCount);
  });

  it("produces deterministic BGM choice for the same episode ID and state", () => {
    const registry = defaultBgmRegistry;
    const run1 = registry.resolveBgmSchedule(150, {
      bpmPreference: "120_bpm_upbeat",
      recentTrackIds: ["track_a", "track_b"],
      seed: "episode-deterministic-check",
    });
    const run2 = registry.resolveBgmSchedule(150, {
      bpmPreference: "120_bpm_upbeat",
      recentTrackIds: ["track_a", "track_b"],
      seed: "episode-deterministic-check",
    });

    expect(run1[0]!.trackId).toBe(run2[0]!.trackId);
    expect(run1[0]!.src).toBe(run2[0]!.src);
  });

  it("supports pinning an explicit track ID", () => {
    const registry = defaultBgmRegistry;
    const schedule = registry.resolveBgmSchedule(150, {
      bpmPreference: "120_bpm_upbeat",
      trackId: "Morning_in_the_Garden",
    });

    expect(schedule[0]!.trackId).toBe("Morning_in_the_Garden");
  });

  it("persists and prunes channel BGM history in repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "quiz-bgm-history-"));
    try {
      await mkdir(path.join(root, "templates"), { recursive: true });
      await writeFile(path.join(root, "templates", "example_channel_dna.md"), "# DNA\n", "utf8");
      await writeFile(path.join(root, "templates", "quiz_channel_dna.md"), "# Quiz DNA\n", "utf8");
      await writeFile(path.join(root, "templates", "example_style_guide.md"), "# Style\n", "utf8");
      const repository = new RepositoryService(root);
      const channel = await repository.createChannel({
        name: "BGM Channel",
        description: "",
        target_audience: "",
        language: "English",
        market: "",
        dna_mode: "example",
        group_id: "quiz",
      });

      // Initially empty
      expect(await repository.readBgmHistory(channel.channel_id)).toEqual([]);

      // Append first track
      await repository.appendBgmHistory(channel.channel_id, "ep-1", "A_Pocketful_of_Marbles", "A_Pocketful_of_Marbles.mp3");
      const history1 = await repository.readBgmHistory(channel.channel_id);
      expect(history1).toHaveLength(1);
      expect(history1[0]!.track_id).toBe("A_Pocketful_of_Marbles");
      expect(history1[0]!.episode_id).toBe("ep-1");

      // Append second track
      await repository.appendBgmHistory(channel.channel_id, "ep-2", "Building_a_Paper_Castle", "Building_a_Paper_Castle.mp3");
      const history2 = await repository.readBgmHistory(channel.channel_id);
      expect(history2).toHaveLength(2);
      expect(history2[0]!.track_id).toBe("Building_a_Paper_Castle");
      expect(history2[1]!.track_id).toBe("A_Pocketful_of_Marbles");

      // Re-appending same episode replaces previous entry for that episode
      await repository.appendBgmHistory(channel.channel_id, "ep-2", "Chasing_Paper_Planes", "Chasing_Paper_Planes.mp3");
      const history3 = await repository.readBgmHistory(channel.channel_id);
      expect(history3).toHaveLength(2);
      expect(history3[0]!.track_id).toBe("Chasing_Paper_Planes");
      expect(history3[1]!.track_id).toBe("A_Pocketful_of_Marbles");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
