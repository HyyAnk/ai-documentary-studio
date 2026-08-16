# Channel DNA

`templates/example_channel_dna.md` is the canonical schema example. A channel starts with that structure, either unchanged, uploaded, or adapted by Codex from the channel description.

The editor saves directly to `channels/<channel-slug>/channel_dna.md`. The server validates the path and the content is immediately used by the next context build. A channel can be drafted before its DNA is final; saving DNA moves a draft to active.
