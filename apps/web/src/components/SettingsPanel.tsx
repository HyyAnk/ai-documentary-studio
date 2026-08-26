import { ArrowsClockwise, CircleNotch, Eye, EyeSlash, FileText, FloppyDisk, HardDrives, Info, Play, Plus, SlidersHorizontal, Sparkle, SpeakerHigh, TerminalWindow, Trash, VideoCamera } from "@phosphor-icons/react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { AppConfig, Channel, CodexSettingsResponse, AntigravitySettingsResponse, StorageInfo, VoiceProfile } from "@studio/shared";
import { api } from "../api";
import { PageTitle, StatusLine } from "./AppChrome";
import type { Notice } from "./types";

export type SettingsTab = "engines" | "voice" | "media" | "system";

type SettingsViewProps = {
  channels: Channel[];
  appConfig: AppConfig | null;
  codex: CodexSettingsResponse | null;
  codexStatus: string;
  antigravity?: AntigravitySettingsResponse | null;
  antigravityStatus?: string;
  git: { branch: string | null; dirty: boolean; changed_files: number };
  storage: StorageInfo | null;
  activeTab?: string | null;
  onTabChange?: (tab: string) => void;
  onStorageSaved: (storage: StorageInfo) => void | Promise<void>;
  onCodexSaved: (response: CodexSettingsResponse) => void;
  onAntigravitySaved?: (response: AntigravitySettingsResponse) => void;
  onAudioSaved: (audio: AppConfig["audio_generation"]) => void | Promise<void>;
  onVideoSaved: (video: AppConfig["video_generation"]) => void | Promise<void>;
  onImageSaved: (image: AppConfig["image_generation"]) => void | Promise<void>;
  onChannelUpdated: (channel: Channel) => void;
  onNotice: (notice: NonNullable<Notice>) => void;
  simplifyMode?: boolean;
  onSimplifyChange?: (enabled: boolean) => void;
};

function SimplifyToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="session-cleanup-switch">
      <input
        type="checkbox"
        role="switch"
        aria-label="Toggle Simplify mode"
        checked={enabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="session-cleanup-track" aria-hidden="true">
        <span>Off</span>
        <span>On</span>
        <i />
      </span>
    </label>
  );
}

function SessionCleanupToggle({
  engine,
  enabled,
  disabled,
  onChange,
}: {
  engine: "Codex" | "Antigravity";
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="session-cleanup-toggle">
      <span>Session cleanup</span>
      <span className="session-cleanup-switch">
        <input
          type="checkbox"
          role="switch"
          aria-label={`Enable ${engine} session cleanup`}
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="session-cleanup-track" aria-hidden="true">
          <span>Off</span>
          <span>On</span>
          <i />
        </span>
      </span>
    </label>
  );
}

export function SettingsView({
  channels,
  appConfig,
  codex,
  codexStatus,
  antigravity,
  antigravityStatus,
  git,
  storage,
  activeTab,
  onTabChange,
  onStorageSaved,
  onCodexSaved,
  onAntigravitySaved,
  onAudioSaved,
  onVideoSaved,
  onImageSaved,
  onChannelUpdated,
  onNotice,
  simplifyMode = true,
  onSimplifyChange,
}: SettingsViewProps) {
  const initialTab: SettingsTab =
    activeTab === "engines" || activeTab === "voice" || activeTab === "media" || activeTab === "system"
      ? activeTab
      : "engines";
  const [currentTab, setCurrentTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    if (
      activeTab &&
      (activeTab === "engines" || activeTab === "voice" || activeTab === "media" || activeTab === "system") &&
      activeTab !== currentTab
    ) {
      setCurrentTab(activeTab);
    }
  }, [activeTab]);

  const switchTab = (tab: SettingsTab) => {
    setCurrentTab(tab);
    onTabChange?.(tab);
  };

  const [storagePath, setStoragePath] = useState(storage?.path ?? "");
  const [transport, setTransport] = useState(codex?.settings.transport ?? "app_server");
  const [baseUrl, setBaseUrl] = useState(codex?.settings.api_base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [agyApiKey, setAgyApiKey] = useState("");
  const [agyCommand, setAgyCommand] = useState(appConfig?.antigravity.command ?? "agy");
  const [agyBaseUrl, setAgyBaseUrl] = useState(appConfig?.antigravity.api_base_url ?? "");
  const [autoDeleteThreads, setAutoDeleteThreads] = useState(appConfig?.codex.auto_delete_threads ?? false);
  const [failedThreadRetentionDays, setFailedThreadRetentionDays] = useState(
    appConfig?.codex.failed_thread_retention_days ?? 7
  );
  const [agyAutoDeleteThreads, setAgyAutoDeleteThreads] = useState(
    appConfig?.antigravity.auto_delete_threads ?? false
  );
  const [agyFailedThreadRetentionDays, setAgyFailedThreadRetentionDays] = useState(
    appConfig?.antigravity.failed_thread_retention_days ?? 7
  );
  const [audioUrl, setAudioUrl] = useState(appConfig?.audio_generation.service_url ?? "http://127.0.0.1:8890");
  const [exaggeration, setExaggeration] = useState(appConfig?.audio_generation.exaggeration ?? 0.5);
  const [cfgWeight, setCfgWeight] = useState(appConfig?.audio_generation.cfg_weight ?? 0.5);
  const [mergeGapMs, setMergeGapMs] = useState(appConfig?.audio_generation.merge_gap_ms ?? 300);
  const [matchTargetDuration, setMatchTargetDuration] = useState(
    appConfig?.audio_generation.match_target_duration ?? true
  );
  const [maxSceneDuration, setMaxSceneDuration] = useState(
    appConfig?.video_generation.max_scene_duration_seconds ?? 8
  );
  const [narrationWordsPerSecond, setNarrationWordsPerSecond] = useState(
    appConfig?.video_generation.narration_words_per_second ?? 2.3
  );
  const [maxConcurrentVideoTasks, setMaxConcurrentVideoTasks] = useState(
    appConfig?.video_generation.max_concurrent_tasks ?? 2
  );
  const [imageEnabled, setImageEnabled] = useState(appConfig?.image_generation?.enabled ?? true);
  const [imagesPerBundle, setImagesPerBundle] = useState(appConfig?.image_generation?.images_per_bundle ?? 1);
  const [imageModel, setImageModel] = useState(appConfig?.image_generation?.model ?? "gpt-image-2");
  const [imageApiKey, setImageApiKey] = useState(appConfig?.image_generation?.api_key ?? "");
  const [showImageKey, setShowImageKey] = useState(false);
  const [hasImageApiKey, setHasImageApiKey] = useState(
    Boolean(appConfig?.image_generation?.has_api_key || appConfig?.image_generation?.api_key)
  );
  const [maxConcurrentImageTasks, setMaxConcurrentImageTasks] = useState(
    appConfig?.image_generation?.max_concurrent_tasks ?? 3
  );
  const [historyEnabled, setHistoryEnabled] = useState(appConfig?.question_history?.enabled ?? true);
  const [passThreshold, setPassThreshold] = useState(appConfig?.question_history?.pass_threshold ?? 2);
  const [ttlDays, setTtlDays] = useState(appConfig?.question_history?.ttl_days ?? 30);
  const [autoRemix, setAutoRemix] = useState(appConfig?.question_history?.auto_remix ?? false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState(channels[0]?.channel_id ?? "");
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [savingStorage, setSavingStorage] = useState(false);
  const [savingCodex, setSavingCodex] = useState(false);
  const [savingAntigravity, setSavingAntigravity] = useState(false);
  const [savingAudio, setSavingAudio] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [checkingImageBalance, setCheckingImageBalance] = useState(false);
  const [imageBalanceInfo, setImageBalanceInfo] = useState<{ balance_vnd: number; rpm?: number } | null>(null);
  const [cleaningThreads, setCleaningThreads] = useState(false);
  const [cleaningAgyThreads, setCleaningAgyThreads] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);

  const selectedChannel = channels.find((channel) => channel.channel_id === selectedChannelId) ?? null;
  const selectedVoice = voices.find((voice) => voice.reference_path === selectedChannel?.voice_reference_path) ?? null;
  const codexCleanupSaved = codex?.settings.auto_delete_threads ?? appConfig?.codex.auto_delete_threads ?? false;
  const antigravityCleanupSaved =
    antigravity?.settings.auto_delete_threads ?? appConfig?.antigravity.auto_delete_threads ?? false;

  useEffect(() => {
    setStoragePath(storage?.path ?? "");
  }, [storage?.path]);

  useEffect(() => {
    setTransport(codex?.settings.transport ?? "app_server");
    setBaseUrl(codex?.settings.api_base_url ?? "");
    setAutoDeleteThreads(codex?.settings.auto_delete_threads ?? appConfig?.codex.auto_delete_threads ?? false);
    setFailedThreadRetentionDays(
      codex?.settings.failed_thread_retention_days ?? appConfig?.codex.failed_thread_retention_days ?? 7
    );
  }, [codex, appConfig?.codex.auto_delete_threads, appConfig?.codex.failed_thread_retention_days]);

  useEffect(() => {
    setAgyCommand(antigravity?.settings.command ?? appConfig?.antigravity.command ?? "agy");
    setAgyBaseUrl(antigravity?.settings.api_base_url ?? appConfig?.antigravity.api_base_url ?? "");
    setAgyAutoDeleteThreads(
      antigravity?.settings.auto_delete_threads ?? appConfig?.antigravity.auto_delete_threads ?? false
    );
    setAgyFailedThreadRetentionDays(
      antigravity?.settings.failed_thread_retention_days ?? appConfig?.antigravity.failed_thread_retention_days ?? 7
    );
  }, [antigravity, appConfig?.antigravity]);

  useEffect(() => {
    if (!selectedChannelId && channels[0]) setSelectedChannelId(channels[0].channel_id);
  }, [channels, selectedChannelId]);

  useEffect(() => {
    void api
      .voices()
      .then((response) => setVoices(response.voices))
      .catch((error: Error) => onNotice({ tone: "bad", message: error.message }));
  }, [onNotice]);

  useEffect(() => {
    const audio = appConfig?.audio_generation;
    const video = appConfig?.video_generation;
    if (audio) {
      setAudioUrl(audio.service_url);
      setExaggeration(audio.exaggeration);
      setCfgWeight(audio.cfg_weight);
      setMergeGapMs(audio.merge_gap_ms);
      setMatchTargetDuration(audio.match_target_duration);
    }
    if (video) {
      setMaxSceneDuration(video.max_scene_duration_seconds ?? 8);
      setNarrationWordsPerSecond(video.narration_words_per_second ?? 2.3);
      setMaxConcurrentVideoTasks(video.max_concurrent_tasks ?? 2);
    }
    if (appConfig?.image_generation) {
      setImageEnabled(appConfig.image_generation.enabled);
      setImagesPerBundle(appConfig.image_generation.images_per_bundle);
      setImageModel(appConfig.image_generation.model ?? "gpt-image-2");
      setMaxConcurrentImageTasks(appConfig.image_generation.max_concurrent_tasks ?? 3);
      setHasImageApiKey(Boolean(appConfig.image_generation.has_api_key || appConfig.image_generation.api_key));
      setImageApiKey(appConfig.image_generation.api_key ?? "");
    }
    if (appConfig?.question_history) {
      setHistoryEnabled(appConfig.question_history.enabled ?? true);
      setPassThreshold(appConfig.question_history.pass_threshold ?? 2);
      setTtlDays(appConfig.question_history.ttl_days ?? 30);
      setAutoRemix(appConfig.question_history.auto_remix ?? false);
    }
  }, [appConfig]);

  const saveHistory = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setSavingHistory(true);
      await api.saveHistorySettings({
        enabled: historyEnabled,
        pass_threshold: passThreshold,
        ttl_days: ttlDays,
        auto_remix: autoRemix,
      });
      onNotice({ tone: "good", message: "Saved Question History & Anti-Duplicate settings successfully!" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Failed to save history settings" });
    } finally {
      setSavingHistory(false);
    }
  };

  const saveStorage = async (event: FormEvent) => {
    event.preventDefault();
    if (!storagePath.trim()) return;
    setSavingStorage(true);
    try {
      const next = await api.setStorage(storagePath);
      await onStorageSaved(next);
      onNotice({ tone: "good", message: "Storage folder saved" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not update storage" });
    } finally {
      setSavingStorage(false);
    }
  };

  const saveCodex = async (event: FormEvent) => {
    event.preventDefault();
    setSavingCodex(true);
    try {
      const next = await api.saveCodexSettings({
        transport,
        api_base_url: baseUrl,
        auto_delete_threads: autoDeleteThreads,
        failed_thread_retention_days: failedThreadRetentionDays,
        ...(apiKey ? { api_key: apiKey } : {}),
      });
      onCodexSaved(next);
      setApiKey("");
      onNotice({ tone: "good", message: "Codex settings saved locally" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save Codex settings" });
    } finally {
      setSavingCodex(false);
    }
  };

  const saveAntigravity = async (event: FormEvent) => {
    event.preventDefault();
    setSavingAntigravity(true);
    try {
      const next = await api.saveAntigravitySettings({
        command: agyCommand,
        api_base_url: agyBaseUrl,
        auto_delete_threads: agyAutoDeleteThreads,
        failed_thread_retention_days: agyFailedThreadRetentionDays,
        ...(agyApiKey ? { api_key: agyApiKey } : {}),
      });
      onAntigravitySaved?.(next);
      setAgyApiKey("");
      onNotice({ tone: "good", message: "Antigravity settings saved locally" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save Antigravity settings" });
    } finally {
      setSavingAntigravity(false);
    }
  };

  const cleanupCodex = async () => {
    setCleaningThreads(true);
    try {
      const result = await api.cleanupCodex();
      onNotice({
        tone: "good",
        message: result.removed
          ? `${result.removed} old Codex session${result.removed === 1 ? "" : "s"} cleaned up`
          : "No old Codex sessions needed cleanup",
      });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not clean up Codex sessions" });
    } finally {
      setCleaningThreads(false);
    }
  };

  const cleanupAntigravity = async () => {
    setCleaningAgyThreads(true);
    try {
      const result = await api.cleanupAntigravity();
      onNotice({
        tone: "good",
        message: result.removed
          ? `${result.removed} old Antigravity session${result.removed === 1 ? "" : "s"} cleaned up`
          : "No old Antigravity sessions needed cleanup",
      });
    } catch (error) {
      onNotice({
        tone: "bad",
        message: error instanceof Error ? error.message : "Could not clean up Antigravity sessions",
      });
    } finally {
      setCleaningAgyThreads(false);
    }
  };

  const saveAudio = async (event: FormEvent) => {
    event.preventDefault();
    setSavingAudio(true);
    try {
      const next = await api.saveAudioSettings({
        provider: "chatterbox",
        service_url: audioUrl,
        exaggeration,
        cfg_weight: cfgWeight,
        max_concurrent_tasks: appConfig?.audio_generation.max_concurrent_tasks ?? 2,
        merge_gap_ms: mergeGapMs,
        match_target_duration: matchTargetDuration,
      });
      await onAudioSaved(next.audio_generation);
      onNotice({ tone: "good", message: "Audio settings saved locally" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save audio settings" });
    } finally {
      setSavingAudio(false);
    }
  };

  const saveVideo = async (event: FormEvent) => {
    event.preventDefault();
    setSavingVideo(true);
    try {
      const next = await api.saveVideoSettings({
        max_scene_duration_seconds: maxSceneDuration,
        narration_words_per_second: narrationWordsPerSecond,
        max_concurrent_tasks: maxConcurrentVideoTasks,
      });
      await onVideoSaved(next.video_generation);
      onNotice({ tone: "good", message: "Video settings saved locally" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save video settings" });
    } finally {
      setSavingVideo(false);
    }
  };

  const saveImage = async (event: FormEvent) => {
    event.preventDefault();
    setSavingImage(true);
    try {
      const next = await api.saveImageSettings({
        enabled: imageEnabled,
        images_per_bundle: imagesPerBundle,
        provider: "gpti2",
        model: imageModel,
        quality: "low",
        max_concurrent_tasks: maxConcurrentImageTasks,
        api_key: imageApiKey.trim(),
      });
      await onImageSaved(next.image_generation);
      setHasImageApiKey(Boolean(next.image_generation.api_key || next.image_generation.has_api_key));
      setImageApiKey(next.image_generation.api_key ?? "");
      onNotice({ tone: "good", message: "Image generation settings saved" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save image settings" });
    } finally {
      setSavingImage(false);
    }
  };

  const clearImageKey = async () => {
    if (!window.confirm("Are you sure you want to remove this gpti2.store API key?")) return;
    setSavingImage(true);
    try {
      const next = await api.saveImageSettings({
        api_key: "",
      });
      await onImageSaved(next.image_generation);
      setImageApiKey("");
      setHasImageApiKey(false);
      setImageBalanceInfo(null);
      onNotice({ tone: "good", message: "gpti2.store API key removed" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not remove API key" });
    } finally {
      setSavingImage(false);
    }
  };

  const checkImageBalance = async () => {
    setCheckingImageBalance(true);
    try {
      const result = await api.imageBalance();
      setImageBalanceInfo(result);
      onNotice({
        tone: "good",
        message: `Valid API key! Balance: ${result.balance_vnd.toLocaleString("en-US")} VND${result.rpm ? ` (RPM: ${result.rpm})` : ""}`,
      });
    } catch (error) {
      setImageBalanceInfo(null);
      onNotice({
        tone: "bad",
        message: error instanceof Error ? error.message : "API key verification failed",
      });
    } finally {
      setCheckingImageBalance(false);
    }
  };

  const assignVoice = async (voiceId: string | null) => {
    if (!selectedChannel) return;
    setVoiceBusy(true);
    try {
      const updated = await api.assignVoice(selectedChannel.channel_id, voiceId);
      onChannelUpdated(updated);
      onNotice({
        tone: "good",
        message: voiceId ? "Voice assigned to channel" : "Channel reset to built-in voice",
      });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not assign voice" });
    } finally {
      setVoiceBusy(false);
    }
  };

  const createVoice = async (name: string, file: File, assignToChannel = false) => {
    if (file.size > 10 * 1024 * 1024) throw new Error("Voice reference must be 10 MB or smaller");
    const dataUrl = await readFileAsDataUrl(file);
    const voice = await api.createVoice(name, dataUrl.split(",")[1] ?? "");
    setVoices((current) => [voice, ...current]);
    if (assignToChannel && selectedChannel) {
      onChannelUpdated(await api.assignVoice(selectedChannel.channel_id, voice.voice_id));
    }
    return voice;
  };

  const addVoice = async (event: FormEvent) => {
    event.preventDefault();
    if (!voiceFile || !voiceName.trim()) return;
    setVoiceBusy(true);
    try {
      await createVoice(voiceName.trim(), voiceFile);
      setVoiceName("");
      setVoiceFile(null);
      onNotice({ tone: "good", message: "Voice added to the library" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not add voice" });
    } finally {
      setVoiceBusy(false);
    }
  };

  const uploadForChannel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedChannel) return;
    setVoiceBusy(true);
    try {
      await createVoice(`${selectedChannel.display_name} (uploaded)`, file, true);
      onNotice({ tone: "good", message: "Voice added and assigned to channel" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not upload voice" });
    } finally {
      setVoiceBusy(false);
      event.target.value = "";
    }
  };

  const deleteVoice = async (voice: VoiceProfile) => {
    if (!window.confirm(`Delete voice "${voice.name}" from the library?`)) return;
    setVoiceBusy(true);
    try {
      await api.deleteVoice(voice.voice_id);
      setVoices((current) => current.filter((item) => item.voice_id !== voice.voice_id));
      onNotice({ tone: "good", message: "Voice deleted" });
    } catch (error) {
      onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not delete voice" });
    } finally {
      setVoiceBusy(false);
    }
  };

  const maxDuration = appConfig?.video_generation.max_scene_duration_seconds ?? 8;
  const estimatedWpm = Math.round(narrationWordsPerSecond * 60);

  return (
    <section className="page-wrap">
      <PageTitle eyebrow="Workspace" title="Settings" />

      {/* 4-Category Structured Settings Navigation */}
      <div className="channel-group-tabs" role="tablist" aria-label="Settings categories" style={{ margin: "16px 0 24px" }}>
        <button
          type="button"
          role="tab"
          aria-selected={currentTab === "engines"}
          className={`channel-group-tab ${currentTab === "engines" ? "is-selected" : ""}`}
          onClick={() => switchTab("engines")}
        >
          <TerminalWindow size={18} weight={currentTab === "engines" ? "fill" : "regular"} />
          <span>AI Engines & Models</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={currentTab === "voice"}
          className={`channel-group-tab ${currentTab === "voice" ? "is-selected" : ""}`}
          onClick={() => switchTab("voice")}
        >
          <SpeakerHigh size={18} weight={currentTab === "voice" ? "fill" : "regular"} />
          <span>Voice & Speech</span>
          {voices.length > 0 ? <small>{voices.length} voices</small> : null}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={currentTab === "media"}
          className={`channel-group-tab ${currentTab === "media" ? "is-selected" : ""}`}
          onClick={() => switchTab("media")}
        >
          <VideoCamera size={18} weight={currentTab === "media" ? "fill" : "regular"} />
          <span>Media & Generation</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={currentTab === "system"}
          className={`channel-group-tab ${currentTab === "system" ? "is-selected" : ""}`}
          onClick={() => switchTab("system")}
        >
          <HardDrives size={18} weight={currentTab === "system" ? "fill" : "regular"} />
          <span>Storage & System</span>
        </button>
      </div>

      {/* Tab 1: AI Engines */}
      {currentTab === "engines" ? (
        <div className="settings-grid">
          <section className="panel codex-settings-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Language Model Provider</p>
                <h2>Codex (OpenAI Engine)</h2>
              </div>
              <TerminalWindow size={22} />
            </div>
            <StatusLine label="Status" value={codexStatus} />
            <StatusLine
              label="Transport"
              value={codex?.settings.transport === "openai_compatible" ? "Cockpit API" : "App Server"}
            />
            <StatusLine label="Selected model" value={codex?.settings.model || "Codex default"} />
            <StatusLine
              label="Sessions"
              value={
                autoDeleteThreads !== codexCleanupSaved
                  ? "Save to apply"
                  : codexCleanupSaved
                  ? "Cleanup enabled"
                  : "Cleanup disabled"
              }
            />
            <form className="codex-form" onSubmit={(event) => void saveCodex(event)}>
              <label>
                Transport
                <select
                  value={transport}
                  onChange={(event) => setTransport(event.target.value as "app_server" | "openai_compatible")}
                >
                  <option value="app_server">Local Codex App Server</option>
                  <option value="openai_compatible">Cockpit API Service</option>
                </select>
              </label>
              {transport === "openai_compatible" ? (
                <>
                  <label>
                    Base URL
                    <input
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="http://127.0.0.1:PORT/v1"
                    />
                  </label>
                  <label>
                    API key
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={codex?.settings.has_api_key ? "Saved locally - leave blank to keep" : "Paste Cockpit API key"}
                      autoComplete="off"
                    />
                  </label>
                </>
              ) : null}
              <SessionCleanupToggle
                engine="Codex"
                enabled={autoDeleteThreads}
                disabled={savingCodex}
                onChange={setAutoDeleteThreads}
              />
              {autoDeleteThreads ? (
                <label>
                  Failed/cancelled retention (days)
                  <input
                    type="number"
                    min="0"
                    max="3650"
                    step="1"
                    value={failedThreadRetentionDays}
                    onChange={(event) => setFailedThreadRetentionDays(Number(event.target.value))}
                  />
                </label>
              ) : null}
              <button className="primary-button" disabled={savingCodex}>
                {savingCodex ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}
                <span>Save Codex Settings</span>
              </button>
            </form>
            {codexCleanupSaved ? (
              <div className="codex-cleanup-action">
                <button className="quiet-button" disabled={cleaningThreads} onClick={() => void cleanupCodex()}>
                  {cleaningThreads ? <CircleNotch className="spin" size={15} /> : <Trash size={15} />}
                  <span>{cleaningThreads ? "Cleaning…" : "Clean up old Codex sessions"}</span>
                </button>
              </div>
            ) : null}
          </section>

          <section className="panel codex-settings-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Native Gemini Engine</p>
                <h2>Antigravity (Google)</h2>
              </div>
              <Sparkle size={22} />
            </div>
            <StatusLine label="Status" value={antigravityStatus ?? "Ready"} />
            <StatusLine
              label="Mode"
              value={antigravity?.settings.has_api_key ? "Google AI API (Custom Key)" : "Native AgentAPI (Zero API Key)"}
            />
            <StatusLine
              label="Selected model"
              value={antigravity?.settings.model || appConfig?.antigravity.model || "gemini-3.7-flash-high"}
            />
            <StatusLine
              label="Sessions"
              value={
                agyAutoDeleteThreads !== antigravityCleanupSaved
                  ? "Save to apply"
                  : antigravityCleanupSaved
                  ? "Cleanup enabled"
                  : "Cleanup disabled"
              }
            />
            <form className="codex-form" onSubmit={(event) => void saveAntigravity(event)}>
              <SessionCleanupToggle
                engine="Antigravity"
                enabled={agyAutoDeleteThreads}
                disabled={savingAntigravity}
                onChange={setAgyAutoDeleteThreads}
              />
              {agyAutoDeleteThreads ? (
                <label>
                  Failed/cancelled retention (days)
                  <input
                    type="number"
                    min="0"
                    max="3650"
                    step="1"
                    value={agyFailedThreadRetentionDays}
                    onChange={(event) => setAgyFailedThreadRetentionDays(Number(event.target.value))}
                  />
                </label>
              ) : null}
              <button className="primary-button" disabled={savingAntigravity}>
                {savingAntigravity ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}
                <span>Save Antigravity Settings</span>
              </button>
            </form>
            {antigravityCleanupSaved ? (
              <div className="codex-cleanup-action">
                <button className="quiet-button" disabled={cleaningAgyThreads} onClick={() => void cleanupAntigravity()}>
                  {cleaningAgyThreads ? <CircleNotch className="spin" size={15} /> : <Trash size={15} />}
                  <span>{cleaningAgyThreads ? "Cleaning…" : "Clean up old Antigravity sessions"}</span>
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {/* Tab 2: Voice & Speech */}
      {currentTab === "voice" ? (
        <div className="settings-grid">
          <section className="panel audio-settings-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Speech Synthesis Engine</p>
                <h2>Audio & Voice Tuning</h2>
              </div>
              <SpeakerHigh size={22} />
            </div>
            <StatusLine label="Provider" value="Chatterbox Local TTS" />
            <form className="codex-form" onSubmit={(event) => void saveAudio(event)}>
              <label>
                Service URL
                <input
                  value={audioUrl}
                  onChange={(event) => setAudioUrl(event.target.value)}
                  placeholder="http://127.0.0.1:8890"
                />
                <small className="field-help">Local Chatterbox Python TTS API server address.</small>
              </label>

              {/* Humanized Exaggeration Parameter */}
              <div className="setting-slider-group">
                <div className="setting-slider-header">
                  <label htmlFor="exaggeration-input">
                    Vocal Expressiveness (Exaggeration)
                  </label>
                  <span className="setting-slider-val">{exaggeration.toFixed(2)}</span>
                </div>
                <div className="setting-presets">
                  <button
                    type="button"
                    className={`preset-chip ${exaggeration === 0.3 ? "is-selected" : ""}`}
                    onClick={() => setExaggeration(0.3)}
                  >
                    Subtle (0.3)
                  </button>
                  <button
                    type="button"
                    className={`preset-chip ${exaggeration === 0.5 ? "is-selected" : ""}`}
                    onClick={() => setExaggeration(0.5)}
                  >
                    Natural (0.5)
                  </button>
                  <button
                    type="button"
                    className={`preset-chip ${exaggeration === 0.75 ? "is-selected" : ""}`}
                    onClick={() => setExaggeration(0.75)}
                  >
                    Dramatic (0.75)
                  </button>
                </div>
                <input
                  id="exaggeration-input"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={exaggeration}
                  onChange={(event) => setExaggeration(Number(event.target.value))}
                />
                <small className="field-help">
                  Controls vocal energy, emotion, and dynamic pitch variation. Higher values sound more animated; lower values are calm and steady.
                </small>
              </div>

              {/* Humanized CFG Weight Parameter */}
              <div className="setting-slider-group">
                <div className="setting-slider-header">
                  <label htmlFor="cfg-weight-input">
                    Voice Clarity & Reference Adherence (CFG)
                  </label>
                  <span className="setting-slider-val">{cfgWeight.toFixed(2)}</span>
                </div>
                <div className="setting-presets">
                  <button
                    type="button"
                    className={`preset-chip ${cfgWeight === 0.35 ? "is-selected" : ""}`}
                    onClick={() => setCfgWeight(0.35)}
                  >
                    Soft (0.35)
                  </button>
                  <button
                    type="button"
                    className={`preset-chip ${cfgWeight === 0.5 ? "is-selected" : ""}`}
                    onClick={() => setCfgWeight(0.5)}
                  >
                    Balanced (0.5)
                  </button>
                  <button
                    type="button"
                    className={`preset-chip ${cfgWeight === 0.75 ? "is-selected" : ""}`}
                    onClick={() => setCfgWeight(0.75)}
                  >
                    Crisp (0.75)
                  </button>
                </div>
                <input
                  id="cfg-weight-input"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={cfgWeight}
                  onChange={(event) => setCfgWeight(Number(event.target.value))}
                />
                <small className="field-help">
                  Classifier-Free Guidance weight. Higher values adhere strictly to the reference voice timbre and articulation clarity.
                </small>
              </div>

              {/* Humanized Merge Gap Parameter */}
              <label>
                Sentence Pause Threshold (Merge gap ms)
                <input
                  type="number"
                  min="0"
                  max="5000"
                  step="50"
                  value={mergeGapMs}
                  onChange={(event) => setMergeGapMs(Number(event.target.value))}
                />
                <small className="field-help">
                  Minimum silence duration (in ms) between sentence fragments before splitting into a separate narration track ({mergeGapMs}ms = {(mergeGapMs / 1000).toFixed(2)}s).
                </small>
              </label>

              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={matchTargetDuration}
                  onChange={(event) => setMatchTargetDuration(event.target.checked)}
                />
                <span>Match episode target duration (auto-calibrate narration pacing)</span>
              </label>

              <button className="primary-button" disabled={savingAudio}>
                {savingAudio ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}
                <span>Save Audio Settings</span>
              </button>
            </form>
          </section>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <section className="panel channel-voice-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Channel Assignment</p>
                  <h2>Assign Channel Voice</h2>
                </div>
                <Play size={22} />
              </div>
              <div className="voice-reference">
                <label>
                  Channel
                  <select
                    value={selectedChannelId}
                    onChange={(event) => setSelectedChannelId(event.target.value)}
                    disabled={channels.length === 0}
                  >
                    <option value="">Choose a channel</option>
                    {channels.map((channel) => (
                      <option key={channel.channel_id} value={channel.channel_id}>
                        {channel.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedChannel ? (
                  <>
                    <label>
                      Voice
                      <select
                        aria-label="Assigned channel voice"
                        value={selectedVoice?.voice_id ?? ""}
                        disabled={voiceBusy}
                        onChange={(event) => void assignVoice(event.target.value || null)}
                      >
                        <option value="">Default (built-in)</option>
                        {voices.map((voice) => (
                          <option key={voice.voice_id} value={voice.voice_id}>
                            {voice.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedVoice ? (
                      <audio
                        controls
                        preload="none"
                        aria-label={`Current voice preview for ${selectedChannel.display_name}`}
                        src={api.voiceSampleUrl(selectedVoice.voice_id)}
                      />
                    ) : (
                      <span className="storage-hint">Built-in default voice</span>
                    )}
                    <label className="file-picker">
                      <FileText size={15} />
                      Upload new voice for this channel
                      <input
                        type="file"
                        accept="audio/wav,.wav"
                        onChange={(event) => void uploadForChannel(event)}
                        disabled={voiceBusy}
                      />
                    </label>
                  </>
                ) : (
                  <p className="storage-hint">Create a channel before assigning a voice.</p>
                )}
              </div>
            </section>

            <section className="panel voices-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Voice Library ({voices.length})</p>
                  <h2>Custom Reference Voices</h2>
                </div>
                <SpeakerHigh size={22} />
              </div>
              <form className="voice-add-form" onSubmit={(event) => void addVoice(event)}>
                <input
                  aria-label="Voice name"
                  placeholder="Voice name (e.g. Master Narrator)"
                  value={voiceName}
                  onChange={(event) => setVoiceName(event.target.value)}
                />
                <label className="file-picker">
                  <FileText size={15} />
                  {voiceFile?.name ?? "Choose WAV reference (10-30s)"}
                  <input
                    type="file"
                    accept="audio/wav,.wav"
                    onChange={(event) => setVoiceFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  className="primary-button compact"
                  disabled={voiceBusy || !voiceName.trim() || !voiceFile}
                >
                  {voiceBusy ? <CircleNotch className="spin" size={15} /> : <Plus size={15} />}
                  <span>Add voice</span>
                </button>
              </form>
              <div className="voice-list">
                {voices.length === 0 ? (
                  <p className="storage-hint">No custom reference voices added yet.</p>
                ) : (
                  voices.map((voice) => (
                    <article className="voice-card" key={voice.voice_id}>
                      <div>
                        <strong>{voice.name}</strong>
                        <span>{new Date(voice.created_at).toLocaleDateString()}</span>
                      </div>
                      <audio
                        controls
                        preload="none"
                        aria-label={`Preview ${voice.name}`}
                        src={api.voiceSampleUrl(voice.voice_id)}
                      />
                      <button
                        className="icon-button danger"
                        title={`Delete ${voice.name}`}
                        aria-label={`Delete ${voice.name}`}
                        disabled={voiceBusy}
                        onClick={() => void deleteVoice(voice)}
                      >
                        <Trash size={15} />
                      </button>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {/* Tab 3: Media & Generation */}
      {currentTab === "media" ? (
        <div className="settings-grid">
          <section className="panel video-settings-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Video Timing & Pacing</p>
                <h2>Scene Duration & Speed</h2>
              </div>
              <VideoCamera size={22} />
            </div>
            <StatusLine label="Max scene duration" value={`${maxDuration}s`} />
            <StatusLine label="Estimated speaking pace" value={`~${estimatedWpm} words/min`} />
            <StatusLine label="Max concurrent episode builds" value={`${maxConcurrentVideoTasks} episodes`} />
            <form className="codex-form" onSubmit={(event) => void saveVideo(event)}>
              <label>
                Parallel Episode Builds (Queue Limit)
                <select
                  value={maxConcurrentVideoTasks}
                  onChange={(event) => setMaxConcurrentVideoTasks(Number(event.target.value))}
                >
                  <option value="1">1 episode (Sequential / Resource-saving)</option>
                  <option value="2">2 episodes (Default - Recommended for 32GB RAM)</option>
                  <option value="3">3 episodes</option>
                  <option value="4">4 episodes</option>
                </select>
                <small className="field-help">
                  Maximum number of concurrent episode video builds. Tasks exceeding this limit are queued automatically in the sidebar.
                </small>
              </label>
              <label>
                Max Scene Duration (seconds)
                <input
                  type="number"
                  min="1"
                  max="120"
                  step="0.5"
                  value={maxSceneDuration}
                  onChange={(event) => setMaxSceneDuration(Number(event.target.value))}
                />
                <small className="field-help">
                  Maximum length your video generation pipeline will produce per shot. The scene breakdown engine packs dialogue beats to fit within this duration.
                </small>
              </label>
              <label>
                Narration pace (words/sec)
                <input
                  type="number"
                  min="0.1"
                  max="20"
                  step="0.1"
                  value={narrationWordsPerSecond}
                  onChange={(event) => setNarrationWordsPerSecond(Number(event.target.value))}
                />
                <small className="field-help">
                  Standard spoken speed calibration ({narrationWordsPerSecond} words/sec ≈ {estimatedWpm} words/min).
                </small>
              </label>
              <button className="primary-button" disabled={savingVideo}>
                {savingVideo ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}
                <span>Save Video Settings</span>
              </button>
            </form>
          </section>

          <section className="panel image-settings-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Continuity Anchor Images</p>
                <h2>Image Provider (gpti2.store)</h2>
              </div>
              <FileText size={22} />
            </div>
            <StatusLine label="Provider" value="gpti2.store (API)" />
            <StatusLine label="API Key status" value={hasImageApiKey ? "Configured" : "Not configured"} />
            {imageBalanceInfo ? (
              <StatusLine
                label="Available balance"
                value={`${imageBalanceInfo.balance_vnd.toLocaleString("en-US")} VND${imageBalanceInfo.rpm ? ` (RPM: ${imageBalanceInfo.rpm})` : ""}`}
              />
            ) : null}
            <form className="codex-form" onSubmit={(event) => void saveImage(event)}>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={imageEnabled}
                  onChange={(event) => setImageEnabled(event.target.checked)}
                />
                <span>Enable continuity anchor images generation</span>
              </label>
              <label>
                gpti2.store API key
                <div style={{ display: "flex", gap: "6px", alignItems: "center", width: "100%" }}>
                  <input
                    type={showImageKey ? "text" : "password"}
                    value={imageApiKey}
                    onChange={(event) => setImageApiKey(event.target.value)}
                    placeholder="Paste gpti2.store API key (sk-...)"
                    autoComplete="off"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="quiet-button compact"
                    title={showImageKey ? "Hide key" : "Show key"}
                    onClick={() => setShowImageKey(!showImageKey)}
                    style={{ height: "35px", padding: "0 10px" }}
                  >
                    {showImageKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                  {hasImageApiKey || imageApiKey ? (
                    <button
                      type="button"
                      className="icon-button danger compact"
                      title="Remove this API Key"
                      disabled={savingImage}
                      onClick={() => void clearImageKey()}
                      style={{ height: "35px", width: "35px", minWidth: "35px", borderRadius: "6px" }}
                    >
                      <Trash size={16} />
                    </button>
                  ) : null}
                </div>
                <small className="field-help">
                  {hasImageApiKey
                    ? "Key stored securely in .documentary-studio/ (gitignored). You can edit directly to replace or click the trash icon to remove."
                    : "Get your API key from the Account tab at https://gpti2.store. Stored securely in .documentary-studio/ (gitignored)."}
                </small>
              </label>
              <label>
                Default Model
                <select value={imageModel} onChange={(event) => setImageModel(event.target.value)}>
                  <option value="gpt-image-2">gpt-image-2 (50 VND / image - Economy)</option>
                  <option value="nano-banana-2">nano-banana-2 (100 VND / image - 2K HD)</option>
                </select>
              </label>
              <label>
                Parallel Generation Workers
                <select
                  value={maxConcurrentImageTasks}
                  onChange={(event) => setMaxConcurrentImageTasks(Number(event.target.value))}
                >
                  <option value="1">1 worker</option>
                  <option value="2">2 workers</option>
                  <option value="3">3 workers (Recommended)</option>
                  <option value="4">4 workers</option>
                </select>
              </label>
              <label>
                Images per bundle
                <select
                  value={imagesPerBundle}
                  disabled={!imageEnabled}
                  onChange={(event) => setImagesPerBundle(Number(event.target.value))}
                >
                  <option value="1">1 anchor</option>
                  <option value="2">2 anchors</option>
                </select>
              </label>
              <small className="field-help">
                Idempotency protection and async queue support are active. Low-quality mode optimizes rendering speed and token cost.
              </small>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button className="primary-button" disabled={savingImage}>
                  {savingImage ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}
                  <span>Save Image Settings</span>
                </button>
                {hasImageApiKey ? (
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={checkingImageBalance}
                    onClick={() => void checkImageBalance()}
                  >
                    {checkingImageBalance ? <CircleNotch className="spin" size={15} /> : null}
                    <span>{checkingImageBalance ? "Checking…" : "Check Balance & Verify Key"}</span>
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          <section className="panel history-settings-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Content Quality & Anti-Duplicate</p>
                <h2>Question History & Duplicate Gate</h2>
              </div>
              <ArrowsClockwise size={22} />
            </div>
            <StatusLine label="History check" value={historyEnabled ? "Enabled" : "Disabled"} />
            <StatusLine label="Pass history threshold" value={`<= ${passThreshold} duplicate questions`} />
            <StatusLine label="Retention period (TTL)" value={`${ttlDays} days`} />
            <form className="codex-form" onSubmit={(event) => void saveHistory(event)}>
              <label className="checkbox-label" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={historyEnabled}
                  onChange={(event) => setHistoryEnabled(event.target.checked)}
                />
                <span>Enable Question History Duplicate Check</span>
              </label>

              <label>
                Pass History Threshold (Maximum allowed duplicates to auto-pass)
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="1"
                  value={passThreshold}
                  onChange={(event) => setPassThreshold(Number(event.target.value))}
                />
                <small className="field-help">
                  Example: 2 means if an episode has 2 or fewer duplicate questions, the pipeline continues building automatically without pausing.
                </small>
              </label>

              <label>
                History Retention Period (TTL in Days)
                <input
                  type="number"
                  min="1"
                  max="365"
                  step="1"
                  value={ttlDays}
                  onChange={(event) => setTtlDays(Number(event.target.value))}
                />
                <small className="field-help">
                  Default: 30 days. Questions older than this period are pruned automatically to optimize memory.
                </small>
              </label>

              <label className="checkbox-label" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={autoRemix}
                  onChange={(event) => setAutoRemix(event.target.checked)}
                />
                <span>Auto-remix duplicate questions with AI during generation</span>
              </label>

              <button className="primary-button" disabled={savingHistory}>
                {savingHistory ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}
                <span>Save History Settings</span>
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {/* Tab 4: Storage & System */}
      {currentTab === "system" ? (
        <div className="settings-grid">
          <section className="panel workspace-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Workspace Experience</p>
                <h2>Simplify</h2>
              </div>
              <SimplifyToggle
                enabled={simplifyMode}
                onChange={(enabled) => onSimplifyChange?.(enabled)}
              />
            </div>
          </section>

          <section className="panel storage-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Local Storage</p>
                <h2>Content Data Folder</h2>
              </div>
              <HardDrives size={22} />
            </div>
            <StatusLine label="Status" value={storage?.configured ? "Configured" : "Using project folder"} />
            <div className="storage-location">
              <span>Channel data folder</span>
              <code>{storage?.channel_path ?? "Loading..."}</code>
            </div>
            <form className="storage-form" onSubmit={(event) => void saveStorage(event)}>
              <label>
                Parent folder path
                <input
                  aria-label="Content storage folder"
                  value={storagePath}
                  onChange={(event) => setStoragePath(event.target.value)}
                  placeholder="D:\Documentary Studio Data"
                />
              </label>
              <button className="primary-button" disabled={savingStorage || !storagePath.trim()}>
                {savingStorage ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}
                <span>Save Storage Location</span>
              </button>
            </form>
            <p className="storage-hint">Channel and episode media files stay here and are excluded from Git repository.</p>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export function StorageSetupModal({
  storage,
  onSaved,
  onError,
}: {
  storage: StorageInfo;
  onSaved: (storage: StorageInfo) => void | Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [storagePath, setStoragePath] = useState(storage.default_path);
  const [busy, setBusy] = useState(false);
  const save = async (nextPath: string) => {
    setBusy(true);
    try {
      await onSaved(await api.setStorage(nextPath));
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal storage-setup-modal"
        onSubmit={(event) => {
          event.preventDefault();
          void save(storagePath);
        }}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">First launch</p>
            <h2>Choose storage</h2>
          </div>
        </div>
        <p className="modal-copy">Channel files stay here and out of Git.</p>
        <label>
          Parent folder
          <input
            aria-label="First launch storage folder"
            autoFocus
            value={storagePath}
            onChange={(event) => setStoragePath(event.target.value)}
            placeholder="D:\Documentary Studio Data"
          />
        </label>
        <p className="storage-hint">
          A <code>channels/</code> folder will be created here.
        </p>
        <div className="modal-actions">
          <button type="button" className="quiet-button" disabled={busy} onClick={() => void save(storage.default_path)}>
            Use project folder
          </button>
          <button className="primary-button" disabled={busy || !storagePath.trim()}>
            {busy ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}
            <span>Save folder</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read file")));
    reader.readAsDataURL(file);
  });
}
