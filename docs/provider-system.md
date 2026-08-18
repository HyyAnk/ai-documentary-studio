# Provider system

The scene model is provider-neutral:

```ts
scene.dialogue
scene.visual_prompt
scene.duration_seconds
scene.aspect_ratio
scene.audio_asset_path
scene.audio_generated_at
scene.audio_duration_seconds
```

`AudioProvider.generateDialogue` is implemented by `ChatterboxProvider`. It sends a local HTTP request to the Chatterbox sidecar, validates the returned WAV, and writes it through the repository path resolver to the episode `assets/` folder. The task runner then reads the WAV header and persists its duration beside the scene.

```ts
export interface AudioProvider {
  generateDialogue(dialogue: string, voice: string): Promise<{ asset_path: string }>;
}
```

The optional `voice` value is either the channel's local `assets/voice_reference.wav` path or `default`. A reference clip is never required.

The sidecar loads `ChatterboxTTS` once at startup and exposes:

- `GET /health` for readiness checks;
- `POST /synthesize` with dialogue, optional voice reference, `exaggeration`, and `cfg_weight`, returning `audio/wav` bytes.

Narration-only `<!-- AUDIO_CUE: chuckle -->` and `<!-- AUDIO_CUE: laugh -->` comments are converted to native tags by the default Chatterbox Turbo sidecar. The launcher sets `CHATTERBOX_MODEL=turbo` and automatically replaces a cue-less sidecar if one is already running. `GET /health` reports the active model and `paralinguistic_tags` capability.

Audio failures are mapped to the plain-language task error `Audio service unavailable`; the browser does not receive a Python traceback. Audio tasks have no `codex_thread_id` or `codex_turn_id`.

Future interfaces remain reserved for `VideoProvider.generateScene`, `ImageProvider.generateReference`, and `ResearchProvider.search`. A Google Veo adapter can be added behind `VideoProvider` without adding provider-specific parameters to the episode UI.
