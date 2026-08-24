import { ArrowsInSimple, Check, Copy, DownloadSimple, FloppyDisk, Image, Sparkle, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Scene } from "@studio/shared";
import { api } from "../api";

export function PromptFocusModal({
  scene,
  channelId,
  episodeId,
  onSave,
  onClose,
}: {
  scene: Scene;
  channelId: string;
  episodeId: string;
  onSave: (updatedPrompt: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(scene.visual_prompt);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        onSave(draft);
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draft, onSave, onClose]);

  const referenceAsset = scene.reference_asset_ids.find((asset) => /(?:CB-\d{2,})(?:-alt)?\.png$/i.test(asset));
  const referenceFilename = referenceAsset?.split("/").pop() ?? null;
  const referenceImageUrl = referenceFilename ? api.bundleImageUrl(channelId, episodeId, referenceFilename) : null;

  const insertText = (text: string) => {
    setDraft((prev) => {
      const trimmed = prev.trimEnd();
      return `${trimmed}\n\n${text}\n\n`;
    });
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const wordCount = draft.trim().split(/\s+/).filter(Boolean).length;
  const cutCount = draft.trim() ? draft.split(/^\s*(?:CUT|HARD CUT)\s*$/m).length : 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal prompt-focus-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span className="scene-number">Shot {String(scene.scene_number).padStart(2, "0")}</span>
              <span className="shot-sequence">{scene.sequence_title}</span>
              {scene.continuity_bundle_id ? <span className="continuity-badge">{scene.continuity_bundle_id}</span> : null}
            </div>
            <h2 id="prompt-modal-title" style={{ marginTop: "4px" }}>
              Prompt Focus Editor
            </h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close modal" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="prompt-modal-body">
          {scene.dialogue ? (
            <div className="prompt-modal-narration-preview">
              <span className="field-hint">🎙️ Narration context:</span>
              <p>"{scene.dialogue}"</p>
            </div>
          ) : null}

          <div className="prompt-modal-grid">
            <div className="prompt-modal-editor-col">
              <div className="prompt-modal-toolbar">
                <div className="prompt-quick-tags">
                  <span className="field-hint">Quick inserts:</span>
                  <button
                    type="button"
                    className="quiet-button compact tag-btn"
                    onClick={() => insertText("CUT")}
                    title="Insert dynamic cut marker"
                  >
                    + CUT
                  </button>
                  <button
                    type="button"
                    className="quiet-button compact tag-btn"
                    onClick={() => insertText("HARD CUT")}
                    title="Insert dramatic hard cut marker"
                  >
                    + HARD CUT
                  </button>
                </div>
                <div className="prompt-stats">
                  <span>{draft.length} chars</span>
                  <span>·</span>
                  <span>{wordCount} words</span>
                  {cutCount > 1 ? (
                    <>
                      <span>·</span>
                      <span className="scene-cut-badge" style={{ fontSize: "11px" }}>{cutCount} cuts</span>
                    </>
                  ) : null}
                </div>
              </div>

              <label htmlFor="prompt-modal-textarea" className="visually-hidden">
                Visual prompt text
              </label>
              <textarea
                id="prompt-modal-textarea"
                autoFocus
                className="prompt-modal-textarea"
                rows={10}
                value={draft}
                placeholder="Describe the visual camera motion, lighting, subjects, and cinematic atmosphere..."
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>

            {referenceImageUrl ? (
              <div className="prompt-modal-ref-col">
                <div className="prompt-modal-ref-card">
                  <span className="field-hint">
                    <Image size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                    Visual Reference Anchor
                  </span>
                  <div className="prompt-modal-ref-img-wrap">
                    <img src={referenceImageUrl} alt={`Anchor reference ${scene.continuity_bundle_id}`} />
                    <span className="ref-badge">{scene.continuity_bundle_id}</span>
                  </div>
                  <a
                    className="quiet-button compact"
                    href={referenceImageUrl}
                    download={referenceFilename || "reference.png"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <DownloadSimple size={14} />
                    <span>Download Reference</span>
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="modal-actions" style={{ justifyContent: "space-between" }}>
          <button type="button" className="quiet-button" onClick={handleCopy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            <span>{copied ? "Copied" : "Copy Prompt"}</span>
          </button>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="quiet-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                onSave(draft);
                onClose();
              }}
            >
              <FloppyDisk size={16} />
              <span>Save & Apply (Ctrl+Enter)</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
