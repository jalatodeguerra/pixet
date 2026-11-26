import { PixelBuffer } from "../document/PixelBuffer.ts";
import { pixelEngine } from "../document/PixelEngine.ts";
import { useEditorStore } from "../../store/editorStore.ts";
import type { Bone } from "./RigEngine.ts";
import { mutateRig } from "./rigActions.ts";

/**
 * Rig actions shared by the rig panels and the command registry (palette and
 * keybindings). Each one reports problems through the status line.
 */

export function createStarterRigAction(): void {
  const st = useEditorStore.getState();
  if (st.rigMode !== "setup") {
    st.setStatusMessage("Starter rig is only available in Setup mode");
    return;
  }
  let rootId: string | null = null;
  const rasterIds = st.layers.filter((l) => l.kind === "raster").map((l) => l.id);
  mutateRig("Create starter rig", () => {
    rootId = pixelEngine.rig.seedStarterRig(
      st.canvasWidth,
      st.canvasHeight,
      rasterIds
    ).id;
  });
  if (rootId) st.setSelectedBoneId(rootId);
  st.setStatusMessage("Created starter 2-bone idle rig");
}

/** Adds a bone under `parentOverride` (or the selected bone / canvas centre). */
export function addRigBoneAction(parentOverride?: Bone | null): Bone | null {
  const st = useEditorStore.getState();
  if (st.rigMode !== "setup") {
    st.setStatusMessage("Add Bone is only available in Setup mode");
    return null;
  }
  const bones = pixelEngine.rig.bones;
  const selected =
    bones.find((b) => b.id === st.selectedBoneId) ?? bones[0] ?? null;
  const parent = parentOverride !== undefined ? parentOverride : selected;
  const bone = mutateRig("Add bone", () =>
    pixelEngine.rig.addBone({
      parentId: parent ? parent.id : null,
      localX: parent ? parent.length : Math.round(st.canvasWidth / 2),
      localY: parent ? 0 : Math.round(st.canvasHeight / 2),
      length: Math.max(4, Math.round(st.canvasHeight * 0.2)),
      rotationDeg: parent ? 0 : -90,
      boundLayerId: null,
    })
  );
  st.setSelectedBoneId(bone.id);
  return bone;
}

export function autoWeightRigAction(): void {
  const st = useEditorStore.getState();
  const bones = pixelEngine.rig.bones;
  if (bones.length === 0) {
    st.setStatusMessage("Add bones before auto-weighting");
    return;
  }
  const selectedBone =
    bones.find((b) => b.id === st.selectedBoneId) ?? bones[0] ?? null;
  const targetBoneIds = st.rigAutoWeightSelectedOnly
    ? st.selectedBoneIds.length > 0
      ? st.selectedBoneIds
      : selectedBone
        ? [selectedBone.id]
        : undefined
    : undefined;
  if (
    st.rigAutoWeightSelectedOnly &&
    (!targetBoneIds || targetBoneIds.length === 0)
  ) {
    st.setStatusMessage("Select at least one bone for Selected-Only auto-weight");
    return;
  }
  const selectionMask =
    st.rigAutoWeightRespectSelection && pixelEngine.selection
      ? pixelEngine.selection.mask
      : null;

  mutateRig(`Auto-weight (${st.rigAutoWeightMethod})`, () => {
    const composited = pixelEngine.compositeFrame(st.layers, st.currentFrame);
    const buf = new PixelBuffer(st.canvasWidth, st.canvasHeight, composited);
    pixelEngine.rig.autoAssignBoneWeights(buf, st.currentFrame, {
      method: st.rigAutoWeightMethod,
      power: st.rigAutoWeightPower,
      colorPenalty: st.rigAutoWeightColorPenalty,
      selectionMask,
      targetBoneIds,
      respectLockedBones: true,
    });
  });
  st.setStatusMessage(`Auto-weighted pixels (${st.rigAutoWeightMethod})`);
}

/** Keys the selected bone's current pose on the current frame (Animate mode). */
export function keyRigPoseAction(): void {
  const st = useEditorStore.getState();
  if (st.rigMode === "setup") {
    st.setStatusMessage("Key Pose is only available in Animate mode");
    return;
  }
  const bones = pixelEngine.rig.bones;
  const bone = bones.find((b) => b.id === st.selectedBoneId) ?? bones[0] ?? null;
  if (!bone) return;
  mutateRig("Set keyframe", () =>
    pixelEngine.rig.setKeyframe(bone.id, st.currentFrame, "easeInOut")
  );
  st.setStatusMessage(`Keyframed "${bone.name}" on frame ${st.currentFrame + 1}`);
}
