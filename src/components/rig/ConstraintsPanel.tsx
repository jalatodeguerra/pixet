import { Link2 } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

/**
 * Read-only constraint summary for R1. The full editor (add/reorder/property
 * controls) lands with R3.
 */
export function ConstraintsPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  void rigVersion;

  const constraints = pixelEngine.rig.constraints;
  const activeCount = constraints.filter(
    (constraint) => constraint.enabled !== false && constraint.mix > 0
  ).length;

  return (
    <RigPanelSection
      title="Constraints"
      icon={<Link2 size={12} />}
      actions={
        <span className="mono-value" style={{ fontSize: 10 }}>
          {activeCount} active
        </span>
      }
    >
      {constraints.length === 0 ? (
        <div className="rig-empty-note">
          No constraints. IK, aim, copy and spring constraints arrive in R3.
          The IK Target tool still poses 2-bone chains directly.
        </div>
      ) : (
        <div className="rig-stub-list">
          {constraints.map((constraint) => (
            <div className="rig-stub-row" key={constraint.id}>
              <span className="rig-stub-dot" />
              <span className="rig-stub-name">{constraint.name}</span>
              <span className="mono-value rig-stub-meta">
                {constraint.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </RigPanelSection>
  );
}
