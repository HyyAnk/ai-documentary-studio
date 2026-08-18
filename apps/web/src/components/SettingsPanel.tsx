import { CircleNotch, FileText, FloppyDisk, GitBranch, Play, Plus, SpeakerHigh, TerminalWindow, Trash, VideoCamera } from "@phosphor-icons/react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { AppConfig, Channel, CodexSettingsResponse, StorageInfo, VoiceProfile } from "@studio/shared";
import { api } from "../api";
import { PageTitle, StatusLine } from "./AppChrome";
import type { Notice } from "./types";

type SettingsViewProps = {
  channels: Channel[];
  appConfig: AppConfig | null;
  codex: CodexSettingsResponse | null;
  codexStatus: string;
  git: { branch: string | null; dirty: boolean; changed_files: number };
  storage: StorageInfo | null;
  onStorageSaved: (storage: StorageInfo) => void | Promise<void>;
  onCodexSaved: (response: CodexSettingsResponse) => void;
  onAudioSaved: (audio: AppConfig["audio_generation"]) => void | Promise<void>;
  onVideoSaved: (video: AppConfig["video_generation"]) => void | Promise<void>;
  onImageSaved: (image: AppConfig["image_generation"]) => void | Promise<void>;
  onChannelUpdated: (channel: Channel) => void;
  onNotice: (notice: NonNullable<Notice>) => void;
};

export function SettingsView({ channels, appConfig, codex, codexStatus, git, storage, onStorageSaved, onCodexSaved, onAudioSaved, onVideoSaved, onImageSaved, onChannelUpdated, onNotice }: SettingsViewProps) {
  const [storagePath, setStoragePath] = useState(storage?.path ?? "");
  const [transport, setTransport] = useState(codex?.settings.transport ?? "app_server");
  const [baseUrl, setBaseUrl] = useState(codex?.settings.api_base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [autoDeleteThreads, setAutoDeleteThreads] = useState(appConfig?.codex.auto_delete_threads ?? true);
  const [failedThreadRetentionDays, setFailedThreadRetentionDays] = useState(appConfig?.codex.failed_thread_retention_days ?? 7);
  const [audioUrl, setAudioUrl] = useState(appConfig?.audio_generation.service_url ?? "http://127.0.0.1:8890");
  const [exaggeration, setExaggeration] = useState(appConfig?.audio_generation.exaggeration ?? 0.5);
  const [cfgWeight, setCfgWeight] = useState(appConfig?.audio_generation.cfg_weight ?? 0.5);
  const [mergeGapMs, setMergeGapMs] = useState(appConfig?.audio_generation.merge_gap_ms ?? 300);
  const [matchTargetDuration, setMatchTargetDuration] = useState(appConfig?.audio_generation.match_target_duration ?? true);
  const [maxSceneDuration, setMaxSceneDuration] = useState(appConfig?.video_generation.max_scene_duration_seconds ?? 8);
  const [narrationWordsPerSecond, setNarrationWordsPerSecond] = useState(appConfig?.video_generation.narration_words_per_second ?? 2.3);
  const [imageEnabled, setImageEnabled] = useState(appConfig?.image_generation?.enabled ?? true);
  const [imagesPerBundle, setImagesPerBundle] = useState(appConfig?.image_generation?.images_per_bundle ?? 1);
  const [selectedChannelId, setSelectedChannelId] = useState(channels[0]?.channel_id ?? "");
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [savingStorage, setSavingStorage] = useState(false);
  const [savingCodex, setSavingCodex] = useState(false);
  const [savingAudio, setSavingAudio] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [cleaningThreads, setCleaningThreads] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const selectedChannel = channels.find((channel) => channel.channel_id === selectedChannelId) ?? null;
  const selectedVoice = voices.find((voice) => voice.reference_path === selectedChannel?.voice_reference_path) ?? null;

  useEffect(() => { setStoragePath(storage?.path ?? ""); }, [storage?.path]);
  useEffect(() => {
    setTransport(codex?.settings.transport ?? "app_server");
    setBaseUrl(codex?.settings.api_base_url ?? "");
    setAutoDeleteThreads(codex?.settings.auto_delete_threads ?? appConfig?.codex.auto_delete_threads ?? true);
    setFailedThreadRetentionDays(codex?.settings.failed_thread_retention_days ?? appConfig?.codex.failed_thread_retention_days ?? 7);
  }, [codex, appConfig?.codex.auto_delete_threads, appConfig?.codex.failed_thread_retention_days]);
  useEffect(() => { if (!selectedChannelId && channels[0]) setSelectedChannelId(channels[0].channel_id); }, [channels, selectedChannelId]);
  useEffect(() => { void api.voices().then((response) => setVoices(response.voices)).catch((error: Error) => onNotice({ tone: "bad", message: error.message })); }, [onNotice]);
  useEffect(() => {
    const audio = appConfig?.audio_generation;
    const video = appConfig?.video_generation;
    if (audio) { setAudioUrl(audio.service_url); setExaggeration(audio.exaggeration); setCfgWeight(audio.cfg_weight); setMergeGapMs(audio.merge_gap_ms); setMatchTargetDuration(audio.match_target_duration); }
    if (video) { setMaxSceneDuration(video.max_scene_duration_seconds ?? 8); setNarrationWordsPerSecond(video.narration_words_per_second ?? 2.3); }
    if (appConfig?.image_generation) { setImageEnabled(appConfig.image_generation.enabled); setImagesPerBundle(appConfig.image_generation.images_per_bundle); }
  }, [appConfig]);

  const saveStorage = async (event: FormEvent) => {
    event.preventDefault();
    if (!storagePath.trim()) return;
    setSavingStorage(true);
    try { const next = await api.setStorage(storagePath); await onStorageSaved(next); onNotice({ tone: "good", message: "Storage folder saved" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not update storage" }); }
    finally { setSavingStorage(false); }
  };

  const saveCodex = async (event: FormEvent) => {
    event.preventDefault();
    setSavingCodex(true);
    try {
      const next = await api.saveCodexSettings({ transport, api_base_url: baseUrl, auto_delete_threads: autoDeleteThreads, failed_thread_retention_days: failedThreadRetentionDays, ...(apiKey ? { api_key: apiKey } : {}) });
      onCodexSaved(next); setApiKey(""); onNotice({ tone: "good", message: "Codex settings saved locally" });
    } catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save Codex settings" }); }
    finally { setSavingCodex(false); }
  };

  const cleanupCodex = async () => {
    setCleaningThreads(true);
    try { const result = await api.cleanupCodex(); onNotice({ tone: "good", message: result.removed ? `${result.removed} old Codex session${result.removed === 1 ? "" : "s"} cleaned up` : "No old Codex sessions needed cleanup" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not clean up Codex sessions" }); }
    finally { setCleaningThreads(false); }
  };

  const saveAudio = async (event: FormEvent) => {
    event.preventDefault(); setSavingAudio(true);
    try { const next = await api.saveAudioSettings({ provider: "chatterbox", service_url: audioUrl, exaggeration, cfg_weight: cfgWeight, max_concurrent_tasks: appConfig?.audio_generation.max_concurrent_tasks ?? 2, merge_gap_ms: mergeGapMs, match_target_duration: matchTargetDuration }); await onAudioSaved(next.audio_generation); onNotice({ tone: "good", message: "Audio settings saved locally" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save audio settings" }); }
    finally { setSavingAudio(false); }
  };

  const saveVideo = async (event: FormEvent) => {
    event.preventDefault(); setSavingVideo(true);
    try { const next = await api.saveVideoSettings({ max_scene_duration_seconds: maxSceneDuration, narration_words_per_second: narrationWordsPerSecond }); await onVideoSaved(next.video_generation); onNotice({ tone: "good", message: "Video timing settings saved locally" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save video settings" }); }
    finally { setSavingVideo(false); }
  };

  const saveImage = async (event: FormEvent) => {
    event.preventDefault(); setSavingImage(true);
    try { const next = await api.saveImageSettings({ enabled: imageEnabled, images_per_bundle: imagesPerBundle }); await onImageSaved(next.image_generation); onNotice({ tone: "good", message: "Image settings saved locally" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not save image settings" }); }
    finally { setSavingImage(false); }
  };

  const assignVoice = async (voiceId: string | null) => {
    if (!selectedChannel) return;
    setVoiceBusy(true);
    try { const updated = await api.assignVoice(selectedChannel.channel_id, voiceId); onChannelUpdated(updated); onNotice({ tone: "good", message: voiceId ? "Voice assigned to channel" : "Channel reset to built-in voice" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not assign voice" }); }
    finally { setVoiceBusy(false); }
  };

  const createVoice = async (name: string, file: File, assignToChannel = false) => {
    if (file.size > 10 * 1024 * 1024) throw new Error("Voice reference must be 10 MB or smaller");
    const dataUrl = await readFileAsDataUrl(file);
    const voice = await api.createVoice(name, dataUrl.split(",")[1] ?? "");
    setVoices((current) => [voice, ...current]);
    if (assignToChannel && selectedChannel) onChannelUpdated(await api.assignVoice(selectedChannel.channel_id, voice.voice_id));
    return voice;
  };

  const addVoice = async (event: FormEvent) => {
    event.preventDefault();
    if (!voiceFile || !voiceName.trim()) return;
    setVoiceBusy(true);
    try { await createVoice(voiceName.trim(), voiceFile); setVoiceName(""); setVoiceFile(null); onNotice({ tone: "good", message: "Voice added to the library" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not add voice" }); }
    finally { setVoiceBusy(false); }
  };

  const uploadForChannel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedChannel) return;
    setVoiceBusy(true);
    try { await createVoice(`${selectedChannel.display_name} (uploaded)`, file, true); onNotice({ tone: "good", message: "Voice added and assigned to channel" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not upload voice" }); }
    finally { setVoiceBusy(false); event.target.value = ""; }
  };

  const deleteVoice = async (voice: VoiceProfile) => {
    if (!window.confirm(`Delete voice \"${voice.name}\" from the library?`)) return;
    setVoiceBusy(true);
    try { await api.deleteVoice(voice.voice_id); setVoices((current) => current.filter((item) => item.voice_id !== voice.voice_id)); onNotice({ tone: "good", message: "Voice deleted" }); }
    catch (error) { onNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not delete voice" }); }
    finally { setVoiceBusy(false); }
  };

  const maxDuration = appConfig?.video_generation.max_scene_duration_seconds ?? 8;
  return <section className="page-wrap"><PageTitle eyebrow="Workspace" title="Settings" /><div className="settings-grid">
    <section className="panel codex-settings-panel"><div className="panel-heading"><div><p className="eyebrow">Connection</p><h2>Codex</h2></div><TerminalWindow size={22} /></div><StatusLine label="Status" value={codexStatus} /><StatusLine label="Transport" value={codex?.settings.transport === "openai_compatible" ? "Cockpit API" : "App Server"} /><StatusLine label="Selected model" value={codex?.settings.model || "Codex default"} /><form className="codex-form" onSubmit={(event) => void saveCodex(event)}><label>Transport<select value={transport} onChange={(event) => setTransport(event.target.value as "app_server" | "openai_compatible")}><option value="app_server">Local Codex App Server</option><option value="openai_compatible">Cockpit API Service</option></select></label>{transport === "openai_compatible" ? <><label>Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:PORT/v1" /></label><label>API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={codex?.settings.has_api_key ? "Saved locally - leave blank to keep" : "Paste Cockpit API key"} autoComplete="off" /></label></> : null}<label className="toggle-field"><input type="checkbox" checked={autoDeleteThreads} onChange={(event) => setAutoDeleteThreads(event.target.checked)} />Auto-delete completed Codex sessions</label><label>Failed/cancelled retention (days)<input type="number" min="0" max="3650" step="1" value={failedThreadRetentionDays} onChange={(event) => setFailedThreadRetentionDays(Number(event.target.value))} /></label><button className="primary-button" disabled={savingCodex}>{savingCodex ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}Save Codex</button></form><div className="codex-cleanup-action"><button className="quiet-button" disabled={cleaningThreads} onClick={() => void cleanupCodex()}>{cleaningThreads ? <CircleNotch className="spin" size={15} /> : <Trash size={15} />}{cleaningThreads ? "Cleaning…" : "Clean up old Codex sessions"}</button></div></section>
    <section className="panel video-settings-panel"><div className="panel-heading"><div><p className="eyebrow">Video generation</p><h2>Scene packing</h2></div><VideoCamera size={22} /></div><StatusLine label="Current limit" value={`${maxDuration}s`} /><form className="codex-form" onSubmit={(event) => void saveVideo(event)}><label>Scene duration (seconds)<input type="number" min="1" max="120" step="0.5" value={maxSceneDuration} onChange={(event) => setMaxSceneDuration(Number(event.target.value))} /><small className="field-help">The maximum length your video generation tool can produce per call. Scene breakdown packs narration beats to fill this duration automatically.</small></label><label>Narration pace (words/sec)<input type="number" min="0.1" max="20" step="0.1" value={narrationWordsPerSecond} onChange={(event) => setNarrationWordsPerSecond(Number(event.target.value))} /><small className="field-help">Used to estimate spoken length when packing beats into scenes.</small></label><button className="primary-button" disabled={savingVideo}>{savingVideo ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}Save video</button></form></section>
    <section className="panel image-settings-panel"><div className="panel-heading"><div><p className="eyebrow">Reference assets</p><h2>Images</h2></div><FileText size={22} /></div><form className="codex-form" onSubmit={(event) => void saveImage(event)}><label className="toggle-field"><input type="checkbox" checked={imageEnabled} onChange={(event) => setImageEnabled(event.target.checked)} />Enable continuity anchor images</label><label>Images per bundle<select value={imagesPerBundle} disabled={!imageEnabled} onChange={(event) => setImagesPerBundle(Number(event.target.value))}><option value="1">1 anchor</option><option value="2">2 anchors</option></select></label><small className="field-help">Runs automatically after the Visual Bible. Requires an image-capable Codex or Cockpit provider.</small><button className="primary-button" disabled={savingImage}>{savingImage ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}Save images</button></form></section>
    <section className="panel audio-settings-panel"><div className="panel-heading"><div><p className="eyebrow">Local speech</p><h2>Audio</h2></div><SpeakerHigh size={22} /></div><StatusLine label="Provider" value="Chatterbox" /><form className="codex-form" onSubmit={(event) => void saveAudio(event)}><label>Service URL<input value={audioUrl} onChange={(event) => setAudioUrl(event.target.value)} placeholder="http://127.0.0.1:8890" /></label><label>Exaggeration<input type="number" min="0" max="1" step="0.05" value={exaggeration} onChange={(event) => setExaggeration(Number(event.target.value))} /></label><label>CFG weight<input type="number" min="0" max="1" step="0.05" value={cfgWeight} onChange={(event) => setCfgWeight(Number(event.target.value))} /></label><label>Merge gap (ms)<input type="number" min="0" max="10000" step="50" value={mergeGapMs} onChange={(event) => setMergeGapMs(Number(event.target.value))} /></label><label className="toggle-field"><input type="checkbox" checked={matchTargetDuration} onChange={(event) => setMatchTargetDuration(event.target.checked)} />Match episode target duration</label><button className="primary-button" disabled={savingAudio}>{savingAudio ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}Save audio</button></form></section>
    <section className="panel voices-panel"><div className="panel-heading"><div><p className="eyebrow">Voice library</p><h2>Voices</h2></div><SpeakerHigh size={22} /></div><form className="voice-add-form" onSubmit={(event) => void addVoice(event)}><input aria-label="Voice name" placeholder="Voice name" value={voiceName} onChange={(event) => setVoiceName(event.target.value)} /><label className="file-picker"><FileText size={15} />{voiceFile?.name ?? "Choose WAV"}<input type="file" accept="audio/wav,.wav" onChange={(event) => setVoiceFile(event.target.files?.[0] ?? null)} /></label><button className="primary-button compact" disabled={voiceBusy || !voiceName.trim() || !voiceFile}>{voiceBusy ? <CircleNotch className="spin" size={15} /> : <Plus size={15} />}Add voice</button></form><div className="voice-list">{voices.length === 0 ? <p className="storage-hint">No voices yet.</p> : voices.map((voice) => <article className="voice-card" key={voice.voice_id}><div><strong>{voice.name}</strong><span>{new Date(voice.created_at).toLocaleDateString()}</span></div><audio controls preload="none" aria-label={`Preview ${voice.name}`} src={api.voiceSampleUrl(voice.voice_id)} /><button className="icon-button danger" title={`Delete ${voice.name}`} aria-label={`Delete ${voice.name}`} disabled={voiceBusy} onClick={() => void deleteVoice(voice)}><Trash size={15} /></button></article>)}</div></section>
    <section className="panel channel-voice-panel"><div className="panel-heading"><div><p className="eyebrow">Channel voice</p><h2>Assignment</h2></div><Play size={22} /></div><div className="voice-reference"><label>Channel<select value={selectedChannelId} onChange={(event) => setSelectedChannelId(event.target.value)} disabled={channels.length === 0}><option value="">Choose a channel</option>{channels.map((channel) => <option key={channel.channel_id} value={channel.channel_id}>{channel.display_name}</option>)}</select></label>{selectedChannel ? <><label>Voice<select aria-label="Assigned channel voice" value={selectedVoice?.voice_id ?? ""} disabled={voiceBusy} onChange={(event) => void assignVoice(event.target.value || null)}><option value="">Default (built-in)</option>{voices.map((voice) => <option key={voice.voice_id} value={voice.voice_id}>{voice.name}</option>)}</select></label>{selectedVoice ? <audio controls preload="none" aria-label={`Current voice preview for ${selectedChannel.display_name}`} src={api.voiceSampleUrl(selectedVoice.voice_id)} /> : <span className="storage-hint">Built-in default voice</span>}<label className="file-picker"><FileText size={15} />Upload new voice for this channel<input type="file" accept="audio/wav,.wav" onChange={(event) => void uploadForChannel(event)} disabled={voiceBusy} /></label></> : <p className="storage-hint">Create a channel before assigning a voice.</p>}</div></section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Git</p><h2>Repository</h2></div><GitBranch size={22} /></div><StatusLine label="Branch" value={git.branch ?? "Not a Git repository"} /><StatusLine label="Working tree" value={git.dirty ? `${git.changed_files} changed files` : "Clean"} /></section>
    <section className="panel storage-panel"><div className="panel-heading"><div><p className="eyebrow">Local content</p><h2>Storage folder</h2></div><FileText size={22} /></div><StatusLine label="Status" value={storage?.configured ? "Configured" : "Using project folder"} /><div className="storage-location"><span>Channel data folder</span><code>{storage?.channel_path ?? "Loading..."}</code></div><form className="storage-form" onSubmit={(event) => void saveStorage(event)}><label>Parent folder<input aria-label="Content storage folder" value={storagePath} onChange={(event) => setStoragePath(event.target.value)} placeholder="D:\\Documentary Studio Data" /></label><button className="primary-button" disabled={savingStorage || !storagePath.trim()}>{savingStorage ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}Save folder</button></form><p className="storage-hint">Channel and episode files stay here and are excluded from Git.</p></section>
  </div></section>;
}

export function StorageSetupModal({ storage, onSaved, onError }: { storage: StorageInfo; onSaved: (storage: StorageInfo) => void | Promise<void>; onError: (error: unknown) => void }) {
  const [storagePath, setStoragePath] = useState(storage.default_path);
  const [busy, setBusy] = useState(false);
  const save = async (nextPath: string) => { setBusy(true); try { await onSaved(await api.setStorage(nextPath)); } catch (error) { onError(error); } finally { setBusy(false); } };
  return <div className="modal-backdrop" role="presentation"><form className="modal storage-setup-modal" onSubmit={(event) => { event.preventDefault(); void save(storagePath); }}><div className="modal-heading"><div><p className="eyebrow">First launch</p><h2>Choose storage</h2></div></div><p className="modal-copy">Channel files stay here and out of Git.</p><label>Parent folder<input aria-label="First launch storage folder" autoFocus value={storagePath} onChange={(event) => setStoragePath(event.target.value)} placeholder="D:\\Documentary Studio Data" /></label><p className="storage-hint">A <code>channels/</code> folder will be created here.</p><div className="modal-actions"><button type="button" className="quiet-button" disabled={busy} onClick={() => void save(storage.default_path)}>Use project folder</button><button className="primary-button" disabled={busy || !storagePath.trim()}>{busy ? <CircleNotch className="spin" size={16} /> : <FloppyDisk size={16} />}Save folder</button></div></form></div>;
}

function readFileAsDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.addEventListener("load", () => resolve(String(reader.result ?? ""))); reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read file"))); reader.readAsDataURL(file); }); }
