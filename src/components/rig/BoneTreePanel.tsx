import { useEffect, useMemo } from "react";
import {
  Bone as BoneIcon,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Sparkles,
  Trash2,
  Unlock,
} from "lucide-react";
import { rgbaToHex } from "../../engine/document/PixelBuffer";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  type Bone,
  getBoneInfluenceColor,
} from "../../engine/rig/RigEngine";
import { mutateRig } from "../../engine/rig/rigActions";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

function getBoneDepth(bones: readonly Bone[], bone: Bone): number {
  const byId = new Map(bones.map((b) => [b.id, b]));
  let depth = 0;
  let parentId = bone.parentId;
  const visited = new Set<string>([bone.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    depth++;
    parentId = parent.parentId;
  }
  return depth;
}

export function BoneTreePanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigMode = useEditorStore((s) => s.rigMode);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const setSelectedBoneId = useEditorStore((s) => s.setSelectedBoneId);
  const rigShowBones = useEditorStore((s) => s.rigShowBones);
  const toggleRigShowBones = useEditorStore((s) => s.toggleRigShowBones);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const layers = useEditorStore((s) => s.layers);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  void rigVersion;
  const setupMode = rigMode === "setup";
  const bones = pixelEngine.rig.bones;
  const selectedBone =
    bones.find((b) => b.id === selectedBoneId) ?? bones[0] ?? null;

  useEffect(() => {
    if (!selectedBoneId && bones.length > 0) {
      setSelectedBoneId(bones[0].id);
    }
  }, [selectedBoneId, bones.length, setSelectedBoneId]);

  const rasterLayers = useMemo(
    () => layers.filter((l) => l.kind === "raster"),
    [layers]
  );

  const handleStarterRig = () => {
    if (!setupMode) {
      setStatusMessage("Starter rig is only available in Setup mode");
      return;
    }
    let rootId: string | null = null;
    mutateRig("Create starter rig", () => {
      rootId = pixelEngine.rig.seedStarterRig(
        canvasWidth,
        canvasHeight,
        rasterLayers.map((l) => l.id)
      ).id;
    });
    if (rootId) setSelectedBoneId(rootId);
    setStatusMessage("Created starter 2-bone idle rig");
  };

  const handleAddBone = () => {
    if (!setupMode) {
      setStatusMessage("Add Bone is only available in Setup mode");
      return;
    }
    const parent = selectedBone;
    const bone = mutateRig("Add bone", () =>
      pixelEngine.rig.addBone({
        parentId: parent ? parent.id : null,
        localX: parent ? parent.length : Math.round(canvasWidth / 2),
        localY: parent ? 0 : Math.round(canvasHeight / 2),
        length: Math.max(4, Math.round(canvasHeight * 0.2)),
        rotationDeg: parent ? 0 : -90,
        boundLayerId: null,
      })
    );
    setSelectedBoneId(bone.id);
  };

  const handleDeleteBone = (boneId: string) => {
    mutateRig("Delete bone", () => pixelEngine.rig.removeBone(boneId));
    if (selectedBoneId === boneId) {
      setSelectedBoneId(pixelEngine.rig.bones[0]?.id ?? null);
    }
  };

  const handleToggleFlags = (
    bone: Bone,
    patch: { hidden?: boolean; locked?: boolean },
    label: string
  ) => {
    mutateRig(label, () => pixelEngine.rig.updateBone(bone.id, patch));
  };

  return (
    <RigPanelSection
      title="Bone Tree"
      icon={<BoneIcon size={12} />}
      actions={
        <>
          <button
            type="button"
            className="mini-btn"
            title={rigShowBones ? "Hide Bone Overlay" : "Show Bone Overlay"}
            onClick={toggleRigShowBones}
          >
            {rigShowBones ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
          <button
            type="button"
            className="mini-btn"
            title={
              setupMode
                ? "Create Starter 2-Bone Idle Rig"
                : "Starter rig is only available in Setup mode"
            }
            aria-disabled={!setupMode || undefined}
            onClick={handleStarterRig}
          >
            <Sparkles size={11} />
            <span>Starter</span>
          </button>
        </>
      }
    >
      <div className="rig-hierarchy-head">
        <span>Bones ({bones.length})</span>
        <button
          type="button"
          className="icon-action-btn"
          style={{ width: 20, height: 20 }}
          title={
            setupMode
              ? "Add Child/Root Bone"
              : "Add Bone is only available in Setup mode"
          }
          aria-disabled={!setupMode || undefined}
          onClick={handleAddBone}
        >
          <Plus size={12} />
        </button>
      </div>

      {bones.length === 0 ? (
        <div className="rig-empty-note">
          Click <strong>Starter</strong> or select <strong>Add Bone</strong>{" "}
          (B) and drag on the canvas to build a skeleton in Setup mode.
        </div>
      ) : (
        <div className="rig-bone-list">
          {bones.map((bone, boneIndex) => {
            const depth = getBoneDepth(bones, bone);
            const active = selectedBone?.id === bone.id;
            const keyed =
              rigMode === "animate" &&
              pixelEngine.rig.hasKeyframe(bone.id, currentFrame);
            const infColor = getBoneInfluenceColor(boneIndex);
            const infHex = rgbaToHex(infColor[0], infColor[1], infColor[2]);
            return (
              <div
                key={bone.id}
                className={`rig-bone-row ${active ? "active" : ""} ${bone.hidden ? "is-hidden" : ""}`}
                style={{ paddingLeft: 8 + depth * 12 }}
                title={bone.name}
                onClick={() => setSelectedBoneId(bone.id)}
              >
                <span
                  className="rig-influence-swatch"
                  style={{ backgroundColor: infHex }}
                  title="Bone influence color"
                />
                <BoneIcon size={11} />
                <span className="rig-bone-name">{bone.name}</span>
                {keyed && (
                  <span
                    className="rig-key-dot"
                    title={`Keyframed on F${currentFrame + 1}`}
                  />
                )}
                <button
                  type="button"
                  className="icon-action-btn"
                  style={{ width: 18, height: 18 }}
                  title={bone.hidden ? "Show Bone" : "Hide Bone"}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFlags(
                      bone,
                      { hidden: !bone.hidden },
                      "Toggle bone visibility"
                    );
                  }}
                >
                  {bone.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
                <button
                  type="button"
                  className={`icon-action-btn ${bone.locked ? "active" : ""}`}
                  style={{ width: 18, height: 18 }}
                  title={bone.locked ? "Unlock Bone" : "Lock Bone"}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFlags(
                      bone,
                      { locked: !bone.locked },
                      "Toggle bone lock"
                    );
                  }}
                >
                  {bone.locked ? <Lock size={11} /> : <Unlock size={11} />}
                </button>
                <button
                  type="button"
                  className="icon-action-btn"
                  style={{ width: 18, height: 18 }}
                  title="Delete Bone"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteBone(bone.id);
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </RigPanelSection>
  );
}
