import { useCallback, useEffect, useState } from "react";
import type { Episode, Scene } from "@studio/shared";
import { api } from "../api";

export function useEpisode(channelId: string, episodeId: string, onError: (error: Error) => void) {
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [script, setScript] = useState("");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const load = useCallback(async () => { const [episodesResponse, scriptResponse, scenesResponse] = await Promise.all([api.episodes(channelId), api.file(channelId, episodeId, "script.md"), api.scenes(channelId, episodeId)]); setEpisode(episodesResponse.episodes.find((item) => item.episode_id === episodeId) ?? null); setScript(scriptResponse.content); setScenes(scenesResponse.scenes); }, [channelId, episodeId]);
  useEffect(() => { void load().catch((error: Error) => onError(error)); }, [load, onError]);
  return { episode, setEpisode, script, setScript, scenes, setScenes, load };
}
