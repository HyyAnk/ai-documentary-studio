import { useCallback, useEffect, useState } from "react";
import type { Episode, ProductionAssessment, Scene } from "@studio/shared";
import { api, type QuizV2State } from "../api";
import type { BundleImage } from "../api";

export function useEpisode(channelId: string, episodeId: string, onError: (error: Error) => void) {
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [script, setScript] = useState("");
  const [research, setResearch] = useState("");
  const [treatment, setTreatment] = useState("");
  const [visualBible, setVisualBible] = useState("");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [assessment, setAssessment] = useState<ProductionAssessment | null>(null);
  const [bundleImages, setBundleImages] = useState<BundleImage[]>([]);
  const [quizV2, setQuizV2] = useState<QuizV2State | null>(null);
  const load = useCallback(async () => {
    const [episodesResponse, researchResponse, treatmentResponse, scriptResponse, visualBibleResponse, scenesResponse, assessmentResponse, bundleImagesResponse, quizV2Response] = await Promise.all([
      api.episodes(channelId),
      api.file(channelId, episodeId, "research.md"),
      api.file(channelId, episodeId, "treatment.md"),
      api.file(channelId, episodeId, "script.md"),
      api.file(channelId, episodeId, "visual_bible.md"),
      api.scenes(channelId, episodeId),
      api.productionAssessment(channelId, episodeId),
      api.bundleImages(channelId, episodeId).catch(() => ({ images: [] })),
      api.quizV2(channelId, episodeId).catch(() => null),
    ]);
    setEpisode(episodesResponse.episodes.find((item) => item.episode_id === episodeId) ?? null);
    setResearch(researchResponse.content);
    setTreatment(treatmentResponse.content);
    setScript(scriptResponse.content);
    setVisualBible(visualBibleResponse.content);
    setScenes(scenesResponse.scenes);
    setAssessment(assessmentResponse.assessment);
    setBundleImages(bundleImagesResponse.images);
    setQuizV2(quizV2Response);
  }, [channelId, episodeId]);
  useEffect(() => { void load().catch((error: Error) => onError(error)); }, [load, onError]);
  return { episode, setEpisode, research, setResearch, treatment, setTreatment, script, setScript, visualBible, setVisualBible, scenes, setScenes, assessment, setAssessment, bundleImages, setBundleImages, quizV2, setQuizV2, load };
}
