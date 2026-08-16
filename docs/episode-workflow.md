# Episode workflow

The supported flow is:

```text
candidate topics → confirm one → brief.md → script.md → scene_plan.md
```

Suggestion is preview-only and always returns exactly five candidates. Confirming one creates the episode directory and copies the selected topic into `episode.json` and `brief.md`. Unselected candidates remain in topic history so future suggestions can avoid repeats.

Scenes are stored in readable Markdown plus derived dialogue and prompt files. Manual edits write files directly. Regeneration backs up the scene plan before replacing the selected scene.
