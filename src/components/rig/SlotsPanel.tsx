import { Layers } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

/**
 * Slot/attachment summary stub. Creation and thumbnails land with R5.
 */
export function SlotsPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  void rigVersion;

  const slots = pixelEngine.rig.slots;

  return (
    <RigPanelSection
      title="Slots & Attachments"
      icon={<Layers size={12} />}
      actions={
        <span className="mono-value" style={{ fontSize: 10 }}>
          {slots.length}
        </span>
      }
    >
      {slots.length === 0 ? (
        <div className="rig-empty-note">
          No slots yet. Sprite slots and per-key attachment swaps arrive in R5.
        </div>
      ) : (
        <div className="rig-stub-list">
          {slots.map((slot) => (
            <div className="rig-stub-row" key={slot.id}>
              <span className="rig-stub-dot" />
              <span className="rig-stub-name">{slot.name}</span>
              <span className="mono-value rig-stub-meta">
                {Object.keys(slot.attachments).length} att.
              </span>
            </div>
          ))}
        </div>
      )}
    </RigPanelSection>
  );
}
