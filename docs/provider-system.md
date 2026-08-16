# Provider system

The scene model is provider-neutral:

```ts
scene.dialogue
scene.visual_prompt
scene.duration_seconds
scene.aspect_ratio
```

Future interfaces are reserved for `VideoProvider.generateScene`, `AudioProvider.generateDialogue`, `ImageProvider.generateReference`, and `ResearchProvider.search`. A Google Veo adapter can be added behind `VideoProvider` without adding provider-specific parameters to the episode UI.
