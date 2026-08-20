# Quiz Engine V2

Quiz Engine V2 is the default and only production path for fresh Quiz episodes. The primary **Build video** action runs this complete versioned, local-first chain automatically:

    research → treatment → script → visual bible → scenes → QuizV2 → DirectorPlan → AssetPlan + VoicePlan → QuizTimeline → pre-render QA → HyperFrames → post-render QA

The canonical Quiz artifact stores question facts, choice IDs, the single correct choice ID, explanations, fun facts, and source IDs. Director plans reference question IDs and semantic presentation enums only. They cannot redefine question text, choices, answers, explanations, or sources.

Artifacts are persisted under each episode's fixed quiz directory through explicit RepositoryService methods. Every JSON artifact is Zod-validated, contains schema_version 2, and is written atomically.

The timeline compiler is pure and deterministic. It uses the Quiz, DirectorPlan, VoicePlan, measured durations when available, and a centralized age-band timing policy. It emits semantic events such as countdown.tick, answer.reveal, reward.play, and narration.segment.

Render preflight blocks canonical answer mismatches, missing required semantic assets, insufficient thinking time, invalid timeline bounds, missing source IDs, and missing measured narration. Post-render QA uses FFprobe to verify the file, video stream, audio stream, duration, resolution, frame rate, and audio/video duration relationship. Render manifests persist stage evidence and avoid machine-specific absolute paths.

The first Director route uses a deterministic semantic plan so the operator workflow is testable without a paid provider. The existing Codex context engine remains the provider boundary for future LLM-directed plans. The existing V1 scene renderer remains in the codebase only as a compatibility fallback for already-rendered legacy Quiz episodes; it is not selected for a new Quiz episode when V2 artifacts are absent.
