import type { BoneKeyframe, RigState } from "../RigEngine.ts";

export interface SpineRegionRef {
  name: string;
  layerId: string;
  frame: number;
  width: number;
  height: number;
}

export interface SpineExportResult {
  json: string;
  atlas: string;
  regions: SpineRegionRef[];
  warnings: string[];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function spineCurveForKey(
  kf: BoneKeyframe
): "stepped" | [number, number, number, number] | undefined {
  if (kf.easing === "step") return "stepped";
  if (kf.easing === "bezier" && kf.curve) {
    return [kf.curve[0], kf.curve[1], kf.curve[2], kf.curve[3]];
  }
  return undefined;
}

function sanitizeRegionName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Exports a `RigState` to Spine 4.x JSON + `.atlas` text + region PNG manifest.
 * Converts Pixet Y-down coordinates into Spine Y-up coordinates.
 */
export function exportRigToSpine(
  rig: RigState,
  canvasW: number,
  canvasH: number,
  fps = 12,
  layerNames?: ReadonlyMap<string, string>
): SpineExportResult {
  const safeFps = Math.max(1, fps);
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const warnings: string[] = [];

  if (rig.meshes.length > 0) {
    warnings.push(
      `${rig.meshes.length} FFD mesh(es) skipped (Spine FFD export not supported).`
    );
  }
  if (rig.constraints.some((c) => c.type === "spring")) {
    warnings.push(
      "Spring constraints are not supported in Spine JSON and were skipped."
    );
  }

  const bones = rig.bones.map((bone) => {
    const parent = bone.parentId ? byId.get(bone.parentId) : undefined;
    const entry: Record<string, unknown> = {
      name: bone.name,
      x: round3(bone.localX),
      y: round3(parent ? -bone.localY : canvasH - bone.localY),
      rotation: round3(-bone.rotationDeg),
      length: round3(bone.length),
    };
    if (parent) entry.parent = parent.name;
    if (bone.scaleX !== undefined && Math.abs(bone.scaleX - 1) > 1e-4) {
      entry.scaleX = round3(bone.scaleX);
    }
    if (bone.scaleY !== undefined && Math.abs(bone.scaleY - 1) > 1e-4) {
      entry.scaleY = round3(bone.scaleY);
    }
    return entry;
  });

  const slotsOut: Array<{
    name: string;
    bone: string;
    attachment?: string;
  }> = [];
  const skinSlots: Record<string, Record<string, unknown>> = {};
  const regions: SpineRegionRef[] = [];
  const seenRegions = new Set<string>();

  const registerRegion = (
    regionName: string,
    layerId: string,
    frame: number
  ) => {
    if (seenRegions.has(regionName)) return;
    seenRegions.add(regionName);
    regions.push({
      name: regionName,
      layerId,
      frame,
      width: canvasW,
      height: canvasH,
    });
  };

  for (const slot of rig.slots) {
    const bone = byId.get(slot.boneId);
    if (!bone) continue;
    const slotEntry: { name: string; bone: string; attachment?: string } = {
      name: slot.name,
      bone: bone.name,
    };
    if (slot.defaultAttachment) {
      slotEntry.attachment = slot.defaultAttachment;
    }
    slotsOut.push(slotEntry);

    const attMap: Record<string, unknown> = {};
    for (const [attName, att] of Object.entries(slot.attachments)) {
      const regionName = sanitizeRegionName(`${slot.name}_${attName}`);
      attMap[attName] = {
        type: "region",
        name: regionName,
        x: 0,
        y: 0,
        width: canvasW,
        height: canvasH,
      };
      registerRegion(regionName, att.layerId, att.frame);
    }
    skinSlots[slot.name] = attMap;
  }

  // Also emit synthetic slots for bones with boundLayerId not already in a slot.
  const slottedLayerIds = rig.getSlotLayerIds();
  for (const bone of rig.bones) {
    if (!bone.boundLayerId || slottedLayerIds.has(bone.boundLayerId)) continue;
    const layerLabel =
      layerNames?.get(bone.boundLayerId) ?? bone.boundLayerId;
    const slotName = sanitizeRegionName(`${bone.name}_${layerLabel}`);
    const regionName = slotName;
    slotsOut.push({
      name: slotName,
      bone: bone.name,
      attachment: regionName,
    });
    skinSlots[slotName] = {
      [regionName]: {
        type: "region",
        name: regionName,
        x: 0,
        y: 0,
        width: canvasW,
        height: canvasH,
      },
    };
    registerRegion(regionName, bone.boundLayerId, 0);
  }

  const animations: Record<string, unknown> = {};
  for (const clip of rig.clips) {
    const boneAnims: Record<string, unknown> = {};
    const slotAnims: Record<string, unknown> = {};

    for (const [boneId, track] of Object.entries(clip.tracks)) {
      const bone = byId.get(boneId);
      if (!bone || track.length === 0) continue;

      const rotate: Array<Record<string, unknown>> = [];
      const translate: Array<Record<string, unknown>> = [];
      const scale: Array<Record<string, unknown>> = [];

      for (const kf of track) {
        const time = round3(kf.frame / safeFps);
        const curve = spineCurveForKey(kf);

        const rotEntry: Record<string, unknown> = {
          time,
          value: round3(-(kf.rotationDeg - bone.rotationDeg)),
        };
        if (curve) rotEntry.curve = curve;
        rotate.push(rotEntry);

        if (kf.localX !== undefined || kf.localY !== undefined) {
          const dx = (kf.localX ?? bone.localX) - bone.localX;
          const dy = (kf.localY ?? bone.localY) - bone.localY;
          const trEntry: Record<string, unknown> = {
            time,
            x: round3(dx),
            y: round3(-dy),
          };
          if (curve) trEntry.curve = curve;
          translate.push(trEntry);
        }

        if (kf.scaleX !== undefined || kf.scaleY !== undefined) {
          const scEntry: Record<string, unknown> = {
            time,
            x: round3(kf.scaleX ?? bone.scaleX ?? 1),
            y: round3(kf.scaleY ?? bone.scaleY ?? 1),
          };
          if (curve) scEntry.curve = curve;
          scale.push(scEntry);
        }
      }

      const boneAnim: Record<string, unknown> = {};
      if (rotate.length > 0) boneAnim.rotate = rotate;
      if (translate.length > 0) boneAnim.translate = translate;
      if (scale.length > 0) boneAnim.scale = scale;
      if (Object.keys(boneAnim).length > 0) {
        boneAnims[bone.name] = boneAnim;
      }

      // Slot attachment timelines for slots bound to this bone
      const boneSlots = rig.slots.filter((s) => s.boneId === boneId);
      for (const slot of boneSlots) {
        const attKeys = track
          .filter((kf) => kf.attachment !== undefined)
          .map((kf) => ({
            time: round3(kf.frame / safeFps),
            name: kf.attachment ?? null,
          }));
        if (attKeys.length > 0) {
          slotAnims[slot.name] = { attachment: attKeys };
        }
      }
    }

    const animObj: Record<string, unknown> = {};
    if (Object.keys(boneAnims).length > 0) animObj.bones = boneAnims;
    if (Object.keys(slotAnims).length > 0) animObj.slots = slotAnims;
    animations[clip.name] = animObj;
  }

  const spineDoc = {
    skeleton: {
      spine: "4.1.0",
      width: canvasW,
      height: canvasH,
      fps: safeFps,
    },
    bones,
    slots: slotsOut,
    skins: [
      {
        name: "default",
        attachments: skinSlots,
      },
    ],
    animations,
  };

  const atlasLines: string[] = [];
  for (const r of regions) {
    atlasLines.push(
      `${r.name}.png`,
      `size: ${r.width},${r.height}`,
      "format: RGBA8888",
      "filter: Nearest,Nearest",
      "repeat: none",
      r.name,
      "  rotate: false",
      "  xy: 0, 0",
      `  size: ${r.width}, ${r.height}`,
      `  orig: ${r.width}, ${r.height}`,
      "  offset: 0, 0",
      "  index: -1",
      ""
    );
  }

  return {
    json: JSON.stringify(spineDoc, null, 2),
    atlas: atlasLines.join("\n"),
    regions,
    warnings,
  };
}
