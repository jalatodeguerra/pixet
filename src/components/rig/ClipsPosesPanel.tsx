import { useState } from "react";
import {
  BookmarkPlus,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Film,
  FlipHorizontal2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import type { RigPose } from "../../engine/rig/RigEngine";
import {
  applyPose,
  capturePose,
  pasteMirroredPose,
} from "../../engine/rig/animationTools";
import {
  beginRigGesture,
  endRigGesture,
  mutateRig,
} from "../../engine/rig/rigActions";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

export function ClipsPosesPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigMode = useEditorStore((s) => s.rigMode);
  const rigAutoKey = useEditorStore((s) => s.rigAutoKey);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const selectedBoneIds = useEditorStore((s) => s.selectedBoneIds);
  const tags = useEditorStore((s) => s.tags);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  void rigVersion;

  const rig = pixelEngine.rig;
  const activeClip = rig.getActiveClip();
  const [poseName, setPoseName] = useState("");
  const [poseBlend, setPoseBlend] = useState(1);
  const [copiedPose, setCopiedPose] = useState<RigPose | null>(null);

  const animateMode = rigMode === "animate";

  const handleSyncTag = () => {
    const match = tags.find(
      (t) => t.name.toLowerCase() === activeClip.name.toLowerCase()
    );
    if (!match) {
      setStatusMessage(`No timeline tag named "${activeClip.name}"`);
      return;
    }
    const len = Math.max(1, match.toFrame - match.fromFrame + 1);
    mutateRig("Sync clip to tag", () =>
      rig.updateClip(activeClip.id, { frameCount: len })
    );
    setStatusMessage(`Synced "${activeClip.name}" to tag (${len}f)`);
  };

  const handleSavePose = () => {
    if (rig.bones.length === 0) {
      setStatusMessage("Add bones before saving a pose");
      return;
    }
    const label = poseName.trim() || `Pose ${rig.poses.length + 1}`;
    const captured = capturePose(
      rig,
      label,
      currentFrame,
      selectedBoneIds.length > 0 ? selectedBoneIds : undefined,
      `pose-${Date.now().toString(36)}`
    );
    mutateRig("Save pose", () => rig.addPose(captured));
    setPoseName("");
    setStatusMessage(`Saved pose "${captured.name}"`);
  };

  const handleCopyPose = () => {
    if (rig.bones.length === 0) return;
    const pose = capturePose(
      rig,
      "Clipboard",
      currentFrame,
      selectedBoneIds.length > 0 ? selectedBoneIds : undefined,
      "clipboard"
    );
    setCopiedPose(pose);
    setStatusMessage("Copied current pose");
  };

  const handlePastePose = (mirrored: boolean) => {
    if (!copiedPose) {
      setStatusMessage("Copy a pose first");
      return;
    }
    const updated = mutateRig(
      mirrored ? "Paste mirrored pose" : "Paste pose",
      () =>
        mirrored
          ? pasteMirroredPose(
              rig,
              copiedPose,
              currentFrame,
              animateMode && rigAutoKey
            )
          : applyPose(
              rig,
              copiedPose,
              currentFrame,
              poseBlend,
              animateMode && rigAutoKey
            )
    );
    setStatusMessage(
      `${mirrored ? "Mirrored" : "Applied"} pose to ${updated} bone(s)`
    );
  };

  return (
    <RigPanelSection
      title="Clips & Poses"
      icon={<Film size={12} />}
      actions={
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className="mini-btn"
            title="New Clip"
            onClick={() =>
              mutateRig("Add clip", () =>
                rig.addClip(`clip-${rig.clips.length + 1}`, 4, true)
              )
            }
          >
            <Plus size={10} />
            <span>Clip</span>
          </button>
          <button
            type="button"
            className="mini-btn"
            title="Duplicate Active Clip"
            onClick={() =>
              mutateRig("Duplicate clip", () => rig.duplicateClip(activeClip.id))
            }
          >
            <Copy size={10} />
          </button>
        </div>
      }
    >
      {/* Clips list */}
      <div className="rig-bone-list" style={{ maxHeight: 96, marginBottom: 6 }}>
        {rig.clips.map((clip) => {
          const active = clip.id === activeClip.id;
          const keys = Object.values(clip.tracks).reduce(
            (s, t) => s + t.length,
            0
          );
          return (
            <div
              key={clip.id}
              className={`rig-constraint-row ${active ? "active" : ""}`}
              onClick={() =>
                mutateRig("Switch clip", () => rig.setActiveClip(clip.id))
              }
            >
              <span className="rig-bone-name">{clip.name}</span>
              <span className="mono-value" style={{ fontSize: 10 }}>
                {clip.frameCount}f · {keys}k
              </span>
              {rig.clips.length > 1 && (
                <button
                  type="button"
                  className="icon-action-btn"
                  style={{ width: 16, height: 16 }}
                  title="Delete Clip"
                  onClick={(e) => {
                    e.stopPropagation();
                    mutateRig("Delete clip", () => rig.removeClip(clip.id));
                  }}
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Active clip properties */}
      <div className="rig-inspector" style={{ marginBottom: 8 }}>
        <div className="rig-inspector-row">
          <span>Clip</span>
          <input
            className="rig-text-input"
            value={activeClip.name}
            onFocus={() => beginRigGesture("Rename clip")}
            onBlur={endRigGesture}
            onChange={(e) =>
              mutateRig("Rename clip", () =>
                rig.updateClip(activeClip.id, { name: e.target.value })
              )
            }
          />
        </div>
        <div className="rig-inspector-row">
          <span>Frames</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="number"
              min={1}
              className="rig-num-input"
              style={{ width: 52 }}
              value={activeClip.frameCount}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 1) {
                  mutateRig("Set clip frames", () =>
                    rig.updateClip(activeClip.id, { frameCount: v })
                  );
                }
              }}
            />
            <label className="modal-checkbox" style={{ fontSize: 10 }}>
              <input
                type="checkbox"
                checked={activeClip.loop !== false}
                onChange={(e) =>
                  mutateRig("Toggle clip loop", () =>
                    rig.updateClip(activeClip.id, { loop: e.target.checked })
                  )
                }
              />
              <span>Loop</span>
            </label>
            <button
              type="button"
              className="mini-btn"
              title="Sync clip length to timeline tag with same name"
              onClick={handleSyncTag}
            >
              <RefreshCw size={10} />
              <span>Tag</span>
            </button>
          </div>
        </div>
      </div>

      {/* Pose library */}
      <div className="rig-inspector">
        <div style={{ display: "flex", gap: 4 }}>
          <input
            className="rig-text-input"
            style={{ flex: 1 }}
            placeholder="Pose name..."
            value={poseName}
            onChange={(e) => setPoseName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSavePose();
            }}
          />
          <button
            type="button"
            className="mini-btn"
            title="Save current pose (selected bones or all)"
            onClick={handleSavePose}
          >
            <BookmarkPlus size={11} />
            <span>Save</span>
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <button
            type="button"
            className="mini-btn"
            title="Copy current pose"
            onClick={handleCopyPose}
          >
            <ClipboardCopy size={10} />
            <span>Copy</span>
          </button>
          <button
            type="button"
            className="mini-btn"
            disabled={!copiedPose}
            title="Paste pose"
            onClick={() => handlePastePose(false)}
          >
            <ClipboardPaste size={10} />
            <span>Paste</span>
          </button>
          <button
            type="button"
            className="mini-btn"
            disabled={!copiedPose}
            title="Paste mirrored L/R pose"
            onClick={() => handlePastePose(true)}
          >
            <FlipHorizontal2 size={10} />
            <span>Mirror</span>
          </button>
        </div>

        <label className="rig-slider-row">
          <span>Blend</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={poseBlend}
            onChange={(e) => setPoseBlend(Number(e.target.value))}
          />
          <span className="mono-value">{Math.round(poseBlend * 100)}%</span>
        </label>

        {rig.poses.length === 0 ? (
          <span className="rotate3d-hint">
            No saved poses. Save a pose above to reuse or blend it later.
          </span>
        ) : (
          <div className="rig-bone-list" style={{ maxHeight: 84 }}>
            {rig.poses.map((pose) => (
              <div key={pose.id} className="rig-constraint-row">
                <span className="rig-bone-name">{pose.name}</span>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => {
                    const count = mutateRig("Apply pose", () =>
                      applyPose(
                        rig,
                        pose,
                        currentFrame,
                        poseBlend,
                        animateMode && rigAutoKey
                      )
                    );
                    setStatusMessage(
                      `Applied "${pose.name}" to ${count} bone(s)`
                    );
                  }}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="icon-action-btn"
                  style={{ width: 16, height: 16 }}
                  title="Delete Pose"
                  onClick={() =>
                    mutateRig("Delete pose", () => rig.removePose(pose.id))
                  }
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </RigPanelSection>
  );
}
