import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  KeyRound,
  Link2,
  Plus,
  Trash2,
} from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import type { RigConstraint } from "../../engine/rig/RigEngine";
import { detectIkChainForBone } from "../../engine/rig/constraints";
import {
  beginRigGesture,
  endRigGesture,
  mutateRig,
} from "../../engine/rig/rigActions";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

const TYPE_LABEL: Record<RigConstraint["type"], string> = {
  ik: "IK",
  aim: "AIM",
  copyRotation: "ROT",
  copyTransform: "XFM",
  spring: "SPR",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ConstraintsPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigMode = useEditorStore((s) => s.rigMode);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  void rigVersion;

  const rig = pixelEngine.rig;
  const bones = rig.bones;
  const constraints = rig.constraints;
  const [selectedConstraintId, setSelectedConstraintId] = useState<
    string | null
  >(() => constraints[0]?.id ?? null);

  useEffect(() => {
    if (
      selectedConstraintId &&
      !constraints.some((c) => c.id === selectedConstraintId)
    ) {
      setSelectedConstraintId(constraints[0]?.id ?? null);
    } else if (!selectedConstraintId && constraints.length > 0) {
      setSelectedConstraintId(constraints[0].id);
    }
  }, [constraints, selectedConstraintId]);

  const selectedConstraint =
    constraints.find((c) => c.id === selectedConstraintId) ?? null;

  const activeCount = constraints.filter(
    (constraint) => constraint.enabled !== false && constraint.mix > 0
  ).length;

  const defaultBone =
    bones.find((b) => b.id === selectedBoneId) ?? bones[0] ?? null;

  const handleAdd = (type: RigConstraint["type"]) => {
    if (!defaultBone) {
      setStatusMessage("Add bones before creating constraints");
      return;
    }
    const transforms = rig.computeWorldTransforms(
      currentFrame,
      rigMode === "setup" ? "rest" : "pose",
      true
    );
    const t = transforms.get(defaultBone.id);
    const secondBone =
      bones.find((b) => b.id !== defaultBone.id) ?? defaultBone;

    const created = mutateRig(`Add ${type} constraint`, () => {
      switch (type) {
        case "ik": {
          const chain = detectIkChainForBone(bones, defaultBone.id, 3);
          return rig.addConstraint({
            type: "ik",
            name: `IK ${defaultBone.name}`,
            enabled: true,
            mix: 1,
            boneIds: chain,
            targetX: t ? round2(t.tipX) : 0,
            targetY: t ? round2(t.tipY) : 0,
            bendSign: 1,
          });
        }
        case "aim":
          return rig.addConstraint({
            type: "aim",
            name: `Aim ${defaultBone.name}`,
            enabled: true,
            mix: 1,
            boneId: defaultBone.id,
            targetX: t ? round2(t.tipX + 8) : 10,
            targetY: t ? round2(t.tipY) : 0,
            offsetDeg: 0,
          });
        case "copyRotation":
          return rig.addConstraint({
            type: "copyRotation",
            name: `CopyRot ${defaultBone.name}`,
            enabled: true,
            mix: 1,
            boneId: defaultBone.id,
            sourceBoneId: secondBone.id,
          });
        case "copyTransform":
          return rig.addConstraint({
            type: "copyTransform",
            name: `CopyXform ${defaultBone.name}`,
            enabled: true,
            mix: 1,
            boneId: defaultBone.id,
            sourceBoneId: secondBone.id,
          });
        case "spring":
          return rig.addConstraint({
            type: "spring",
            name: `Spring ${defaultBone.name}`,
            enabled: true,
            mix: 1,
            boneId: defaultBone.id,
            stiffness: 0.28,
            damping: 0.18,
            gravity: 0,
          });
      }
    });
    setSelectedConstraintId(created.id);
  };

  const animateMode = rigMode === "animate";
  const isTargetKeyed =
    animateMode &&
    selectedConstraint &&
    (selectedConstraint.type === "ik" || selectedConstraint.type === "aim")
      ? rig.hasConstraintTargetKeyframe(selectedConstraint.id, currentFrame)
      : false;

  return (
    <RigPanelSection
      id="rig-constraints"
      title="Constraints"
      icon={<Link2 size={12} />}
      actions={
        <span className="mono-value" style={{ fontSize: 10 }}>
          {activeCount} active
        </span>
      }
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
        <button
          type="button"
          className="mini-btn"
          title="Add IK Constraint"
          onClick={() => handleAdd("ik")}
        >
          <Plus size={10} />
          <span>IK</span>
        </button>
        <button
          type="button"
          className="mini-btn"
          title="Add Aim Constraint"
          onClick={() => handleAdd("aim")}
        >
          <Plus size={10} />
          <span>Aim</span>
        </button>
        <button
          type="button"
          className="mini-btn"
          title="Add Copy Rotation Constraint"
          onClick={() => handleAdd("copyRotation")}
        >
          <Plus size={10} />
          <span>Rot</span>
        </button>
        <button
          type="button"
          className="mini-btn"
          title="Add Copy Transform Constraint"
          onClick={() => handleAdd("copyTransform")}
        >
          <Plus size={10} />
          <span>Xform</span>
        </button>
        <button
          type="button"
          className="mini-btn"
          title="Add Spring Constraint"
          onClick={() => handleAdd("spring")}
        >
          <Plus size={10} />
          <span>Spring</span>
        </button>
      </div>

      {constraints.length === 0 ? (
        <div className="rig-empty-note">
          No constraints. Use the buttons above or the <strong>Pin</strong> (P)
          tool to pin a bone chain.
        </div>
      ) : (
        <div className="rig-bone-list" style={{ maxHeight: 120, marginBottom: 6 }}>
          {constraints.map((c, idx) => (
            <div
              key={c.id}
              className={`rig-constraint-row ${selectedConstraint?.id === c.id ? "active" : ""}`}
              onClick={() => setSelectedConstraintId(c.id)}
            >
              <input
                type="checkbox"
                checked={c.enabled !== false}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  mutateRig("Toggle constraint", () =>
                    rig.updateConstraint(c.id, { enabled: e.target.checked })
                  )
                }
              />
              <span
                className="mono-value"
                style={{ fontSize: 9, color: "var(--accent)", width: 24 }}
              >
                {TYPE_LABEL[c.type]}
              </span>
              <span className="rig-bone-name">{c.name}</span>
              <button
                type="button"
                className="icon-action-btn"
                style={{ width: 16, height: 16 }}
                disabled={idx === 0}
                title="Move Up"
                onClick={(e) => {
                  e.stopPropagation();
                  mutateRig("Reorder constraint", () =>
                    rig.moveConstraint(c.id, -1)
                  );
                }}
              >
                <ArrowUp size={10} />
              </button>
              <button
                type="button"
                className="icon-action-btn"
                style={{ width: 16, height: 16 }}
                disabled={idx === constraints.length - 1}
                title="Move Down"
                onClick={(e) => {
                  e.stopPropagation();
                  mutateRig("Reorder constraint", () =>
                    rig.moveConstraint(c.id, 1)
                  );
                }}
              >
                <ArrowDown size={10} />
              </button>
              <button
                type="button"
                className="icon-action-btn"
                style={{ width: 16, height: 16 }}
                title="Delete Constraint"
                onClick={(e) => {
                  e.stopPropagation();
                  mutateRig("Delete constraint", () =>
                    rig.removeConstraint(c.id)
                  );
                }}
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedConstraint && (
        <div className="rig-inspector">
          <div className="rig-inspector-row">
            <span>Name</span>
            <input
              className="rig-text-input"
              value={selectedConstraint.name}
              onFocus={() => beginRigGesture("Rename constraint")}
              onBlur={endRigGesture}
              onChange={(e) =>
                mutateRig("Rename constraint", () =>
                  rig.updateConstraint(selectedConstraint.id, {
                    name: e.target.value,
                  })
                )
              }
            />
          </div>

          <label className="rig-slider-row">
            <span>Mix</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={selectedConstraint.mix}
              onPointerDown={() => beginRigGesture("Adjust constraint mix")}
              onPointerUp={endRigGesture}
              onPointerCancel={endRigGesture}
              onChange={(e) =>
                mutateRig("Adjust constraint mix", () =>
                  rig.updateConstraint(selectedConstraint.id, {
                    mix: Number(e.target.value),
                  })
                )
              }
            />
            <span className="mono-value">
              {Math.round(selectedConstraint.mix * 100)}%
            </span>
          </label>

          {selectedConstraint.type === "ik" && (
            <>
              <div className="rig-inspector-row">
                <span>Tip Bone</span>
                <select
                  className="palette-select"
                  value={
                    selectedConstraint.boneIds[
                      selectedConstraint.boneIds.length - 1
                    ] ?? ""
                  }
                  onChange={(e) => {
                    const chain = detectIkChainForBone(
                      bones,
                      e.target.value,
                      Math.max(1, selectedConstraint.boneIds.length)
                    );
                    mutateRig("Change IK tip", () =>
                      rig.updateConstraint(selectedConstraint.id, {
                        boneIds: chain,
                      })
                    );
                  }}
                >
                  {bones.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rig-inspector-row">
                <span>Chain Len</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    className="rig-num-input"
                    style={{ width: 48 }}
                    value={selectedConstraint.boneIds.length}
                    onChange={(e) => {
                      const len = Math.max(
                        1,
                        Math.min(6, Math.round(Number(e.target.value) || 1))
                      );
                      const tipId =
                        selectedConstraint.boneIds[
                          selectedConstraint.boneIds.length - 1
                        ] ?? defaultBone?.id;
                      if (!tipId) return;
                      const chain = detectIkChainForBone(bones, tipId, len);
                      mutateRig("Change IK chain length", () =>
                        rig.updateConstraint(selectedConstraint.id, {
                          boneIds: chain,
                        })
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="mini-btn"
                    title="Flip IK bend direction"
                    onClick={() =>
                      mutateRig("Flip IK bend", () =>
                        rig.updateConstraint(selectedConstraint.id, {
                          bendSign:
                            selectedConstraint.bendSign === 1 ? -1 : 1,
                        })
                      )
                    }
                  >
                    Bend {selectedConstraint.bendSign === 1 ? "+1" : "-1"}
                  </button>
                </div>
              </div>
            </>
          )}

          {selectedConstraint.type !== "ik" && (
            <div className="rig-inspector-row">
              <span>Bone</span>
              <select
                className="palette-select"
                value={selectedConstraint.boneId}
                onChange={(e) =>
                  mutateRig("Change constraint bone", () =>
                    rig.updateConstraint(selectedConstraint.id, {
                      boneId: e.target.value,
                    })
                  )
                }
              >
                {bones.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(selectedConstraint.type === "copyRotation" ||
            selectedConstraint.type === "copyTransform") && (
            <div className="rig-inspector-row">
              <span>Source</span>
              <select
                className="palette-select"
                value={selectedConstraint.sourceBoneId}
                onChange={(e) =>
                  mutateRig("Change source bone", () =>
                    rig.updateConstraint(selectedConstraint.id, {
                      sourceBoneId: e.target.value,
                    })
                  )
                }
              >
                {bones.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedConstraint.type === "aim" && (
            <div className="rig-inspector-row">
              <span>Offset°</span>
              <input
                type="number"
                className="rig-num-input"
                value={round2(selectedConstraint.offsetDeg)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    mutateRig("Set aim offset", () =>
                      rig.updateConstraint(selectedConstraint.id, {
                        offsetDeg: v,
                      })
                    );
                  }
                }}
              />
            </div>
          )}

          {(selectedConstraint.type === "ik" ||
            selectedConstraint.type === "aim") && (
            <>
              <div className="rig-inspector-row">
                <span>Target</span>
                <div className="rig-num-grid">
                  <label className="rig-num-field">
                    <span>X</span>
                    <input
                      type="number"
                      step={0.5}
                      className="rig-num-input"
                      value={round2(selectedConstraint.targetX)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          mutateRig("Set target X", () =>
                            rig.updateConstraint(selectedConstraint.id, {
                              targetX: v,
                            })
                          );
                        }
                      }}
                    />
                  </label>
                  <label className="rig-num-field">
                    <span>Y</span>
                    <input
                      type="number"
                      step={0.5}
                      className="rig-num-input"
                      value={round2(selectedConstraint.targetY)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          mutateRig("Set target Y", () =>
                            rig.updateConstraint(selectedConstraint.id, {
                              targetY: v,
                            })
                          );
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              {animateMode && (
                <div className="rig-key-actions">
                  <button
                    type="button"
                    className={`mini-btn ${isTargetKeyed ? "active" : ""}`}
                    onClick={() =>
                      mutateRig("Key constraint target", () =>
                        rig.setConstraintTargetKeyframe(
                          selectedConstraint.id,
                          currentFrame,
                          selectedConstraint.targetX,
                          selectedConstraint.targetY
                        )
                      )
                    }
                  >
                    <KeyRound size={11} />
                    <span>Key Target (F{currentFrame + 1})</span>
                  </button>
                  {isTargetKeyed && (
                    <button
                      type="button"
                      className="mini-btn"
                      title="Delete Target Keyframe"
                      onClick={() =>
                        mutateRig("Delete target keyframe", () =>
                          rig.deleteConstraintTargetKeyframe(
                            selectedConstraint.id,
                            currentFrame
                          )
                        )
                      }
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {selectedConstraint.type === "spring" && (
            <div className="rig-inspector-row">
              <span>Physics</span>
              <div className="rig-num-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                <label className="rig-num-field">
                  <span>K</span>
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    className="rig-num-input"
                    value={round2(selectedConstraint.stiffness)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 0) {
                        mutateRig("Set spring stiffness", () =>
                          rig.updateConstraint(selectedConstraint.id, {
                            stiffness: v,
                          })
                        );
                      }
                    }}
                  />
                </label>
                <label className="rig-num-field">
                  <span>D</span>
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    className="rig-num-input"
                    value={round2(selectedConstraint.damping)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 0) {
                        mutateRig("Set spring damping", () =>
                          rig.updateConstraint(selectedConstraint.id, {
                            damping: v,
                          })
                        );
                      }
                    }}
                  />
                </label>
                <label className="rig-num-field">
                  <span>G</span>
                  <input
                    type="number"
                    step={0.1}
                    className="rig-num-input"
                    value={round2(selectedConstraint.gravity)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) {
                        mutateRig("Set spring gravity", () =>
                          rig.updateConstraint(selectedConstraint.id, {
                            gravity: v,
                          })
                        );
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </RigPanelSection>
  );
}
