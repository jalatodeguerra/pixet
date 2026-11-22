import { Film } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

/**
 * Clip/pose summary. Full clip management, auto-key and the pose library are
 * implemented in R4.
 */
export function ClipsPosesPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigMode = useEditorStore((s) => s.rigMode);
  void rigVersion;

  const clip = pixelEngine.rig.getActiveClip();
  const keyCount = Object.values(clip.tracks).reduce(
    (sum, track) => sum + track.length,
    0
  );

  return (
    <RigPanelSection title="Clips & Poses" icon={<Film size={12} />}>
      <div className="rig-stub-list">
        <div className="rig-stub-row">
          <span className="rig-stub-dot" />
          <span className="rig-stub-name">{clip.name}</span>
          <span className="mono-value rig-stub-meta">
            {clip.frameCount}f · {keyCount} keys
          </span>
        </div>
      </div>
      <span className="rotate3d-hint">
        {rigMode === "setup"
          ? "Setup mode hides timeline keys. Switch to Animate to key poses."
          : "Clip management, auto-key and the pose library arrive in R4."}
      </span>
    </RigPanelSection>
  );
}
