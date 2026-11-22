import type { Bone, RigState } from "../RigEngine.ts";

export interface GodotSpriteRef {
  filename: string;
  layerId: string;
  frame: number;
}

export interface GodotExportResult {
  tscn: string;
  sprites: GodotSpriteRef[];
  warnings: string[];
}

function sanitizeNodeName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  return cleaned.length > 0 ? cleaned : "Node";
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function buildBonePath(
  bone: Bone,
  byId: ReadonlyMap<string, Bone>
): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur: Bone | undefined = bone;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(sanitizeNodeName(cur.name));
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join("/");
}

/**
 * Exports a `RigState` to a Godot 4 `.tscn` scene with `Skeleton2D`,
 * `Bone2D` hierarchy, `Sprite2D` attachments, and an `AnimationPlayer`
 * + `AnimationLibrary`.
 */
export function exportRigToGodot(
  rig: RigState,
  sceneName: string,
  _canvasW: number,
  _canvasH: number,
  fps = 12
): GodotExportResult {
  const safeFps = Math.max(1, fps);
  const safeScene = sanitizeNodeName(sceneName);
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const warnings: string[] = [];

  if (rig.meshes.length > 0) {
    warnings.push(
      `${rig.meshes.length} FFD mesh(es) skipped (Godot export uses Sprite2D nodes).`
    );
  }
  if (rig.constraints.some((c) => c.type === "spring")) {
    warnings.push("Spring constraints are not exported to Godot .tscn.");
  }

  const sprites: GodotSpriteRef[] = [];
  const spriteExtId = new Map<string, string>();
  let extCounter = 1;

  const ensureSpriteExt = (
    key: string,
    filename: string,
    layerId: string,
    frame: number
  ): string => {
    const existing = spriteExtId.get(key);
    if (existing) return existing;
    const id = `ExtResource_${extCounter++}`;
    spriteExtId.set(key, id);
    sprites.push({ filename, layerId, frame });
    return id;
  };

  interface SpriteNodeSpec {
    name: string;
    parentPath: string;
    extId: string;
    visible: boolean;
    slotId?: string;
    attachmentName?: string;
  }
  const spriteNodes: SpriteNodeSpec[] = [];

  for (const slot of rig.slots) {
    const bone = byId.get(slot.boneId);
    if (!bone) continue;
    const bonePath = `Skeleton2D/${buildBonePath(bone, byId)}`;
    for (const [attName, att] of Object.entries(slot.attachments)) {
      const filename = `${sanitizeNodeName(slot.name)}_${sanitizeNodeName(attName)}.png`;
      const extId = ensureSpriteExt(
        `${slot.id}:${attName}`,
        filename,
        att.layerId,
        att.frame
      );
      spriteNodes.push({
        name: sanitizeNodeName(`${slot.name}_${attName}`),
        parentPath: bonePath,
        extId,
        visible: slot.defaultAttachment === attName,
        slotId: slot.id,
        attachmentName: attName,
      });
    }
  }

  const slottedLayerIds = rig.getSlotLayerIds();
  for (const bone of rig.bones) {
    if (!bone.boundLayerId || slottedLayerIds.has(bone.boundLayerId)) continue;
    const bonePath = `Skeleton2D/${buildBonePath(bone, byId)}`;
    const filename = `${sanitizeNodeName(bone.name)}.png`;
    const extId = ensureSpriteExt(
      `bound:${bone.id}`,
      filename,
      bone.boundLayerId,
      0
    );
    spriteNodes.push({
      name: sanitizeNodeName(`${bone.name}_Sprite`),
      parentPath: bonePath,
      extId,
      visible: true,
    });
  }

  const animSubResources: string[] = [];
  const animLibraryEntries: string[] = [];

  for (const clip of rig.clips) {
    const animId = `Animation_${sanitizeNodeName(clip.name)}`;
    const lines: string[] = [];
    lines.push(`[sub_resource type="Animation" id="${animId}"]`);
    lines.push(`resource_name = "${clip.name}"`);
    lines.push(`length = ${round4(Math.max(1, clip.frameCount) / safeFps)}`);
    if (clip.loop !== false) {
      lines.push("loop_mode = 1");
    }

    let trackIdx = 0;
    for (const [boneId, track] of Object.entries(clip.tracks)) {
      const bone = byId.get(boneId);
      if (!bone || track.length === 0) continue;
      const bonePath = `Skeleton2D/${buildBonePath(bone, byId)}`;

      // Rotation track
      const rotTimes = track.map((k) => round4(k.frame / safeFps)).join(", ");
      const rotVals = track
        .map((k) => round4(degToRad(k.rotationDeg)))
        .join(", ");
      const rotTransitions = track.map(() => "1").join(", ");
      lines.push(`tracks/${trackIdx}/type = "value"`);
      lines.push(`tracks/${trackIdx}/imported = false`);
      lines.push(`tracks/${trackIdx}/enabled = true`);
      lines.push(`tracks/${trackIdx}/path = NodePath("${bonePath}:rotation")`);
      lines.push(`tracks/${trackIdx}/interp = 1`);
      lines.push(`tracks/${trackIdx}/loop_wrap = true`);
      lines.push(
        `tracks/${trackIdx}/keys = { "times": PackedFloat32Array(${rotTimes}), "transitions": PackedFloat32Array(${rotTransitions}), "update": 0, "values": [${rotVals}] }`
      );
      trackIdx++;

      // Position track if any key translates
      if (track.some((k) => k.localX !== undefined || k.localY !== undefined)) {
        const posVals = track
          .map(
            (k) =>
              `Vector2(${round4(k.localX ?? bone.localX)}, ${round4(k.localY ?? bone.localY)})`
          )
          .join(", ");
        lines.push(`tracks/${trackIdx}/type = "value"`);
        lines.push(`tracks/${trackIdx}/imported = false`);
        lines.push(`tracks/${trackIdx}/enabled = true`);
        lines.push(
          `tracks/${trackIdx}/path = NodePath("${bonePath}:position")`
        );
        lines.push(`tracks/${trackIdx}/interp = 1`);
        lines.push(`tracks/${trackIdx}/loop_wrap = true`);
        lines.push(
          `tracks/${trackIdx}/keys = { "times": PackedFloat32Array(${rotTimes}), "transitions": PackedFloat32Array(${rotTransitions}), "update": 0, "values": [${posVals}] }`
        );
        trackIdx++;
      }

      // Slot attachment visibility tracks
      const attKeys = track.filter((k) => k.attachment !== undefined);
      if (attKeys.length > 0) {
        const boneSpriteNodes = spriteNodes.filter(
          (sn) =>
            sn.slotId &&
            rig.slots.some(
              (s) => s.id === sn.slotId && s.boneId === boneId
            )
        );
        for (const sn of boneSpriteNodes) {
          const times = attKeys
            .map((k) => round4(k.frame / safeFps))
            .join(", ");
          const trans = attKeys.map(() => "1").join(", ");
          const vals = attKeys
            .map((k) => (k.attachment === sn.attachmentName ? "true" : "false"))
            .join(", ");
          lines.push(`tracks/${trackIdx}/type = "value"`);
          lines.push(`tracks/${trackIdx}/imported = false`);
          lines.push(`tracks/${trackIdx}/enabled = true`);
          lines.push(
            `tracks/${trackIdx}/path = NodePath("${sn.parentPath}/${sn.name}:visible")`
          );
          lines.push(`tracks/${trackIdx}/interp = 1`);
          lines.push(`tracks/${trackIdx}/loop_wrap = true`);
          lines.push(
            `tracks/${trackIdx}/keys = { "times": PackedFloat32Array(${times}), "transitions": PackedFloat32Array(${trans}), "update": 1, "values": [${vals}] }`
          );
          trackIdx++;
        }
      }
    }

    animSubResources.push(lines.join("\n"));
    animLibraryEntries.push(`"${clip.name}": SubResource("${animId}")`);
  }

  const loadSteps =
    1 + sprites.length + animSubResources.length + 1;

  const out: string[] = [];
  out.push(`[gd_scene load_steps=${loadSteps} format=3]`);
  out.push("");

  for (const [key, extId] of spriteExtId) {
    const idx = Number(extId.replace("ExtResource_", "")) - 1;
    const sp = sprites[idx];
    void key;
    if (!sp) continue;
    out.push(
      `[ext_resource type="Texture2D" path="res://${sp.filename}" id="${extId}"]`
    );
  }
  if (sprites.length > 0) out.push("");

  for (const block of animSubResources) {
    out.push(block, "");
  }

  out.push('[sub_resource type="AnimationLibrary" id="AnimationLibrary_1"]');
  out.push(`_data = { ${animLibraryEntries.join(", ")} }`);
  out.push("");

  out.push(`[node name="${safeScene}" type="Node2D"]`);
  out.push("");
  out.push('[node name="Skeleton2D" type="Skeleton2D" parent="."]');
  out.push("");

  for (const bone of rig.bones) {
    const parentBone = bone.parentId ? byId.get(bone.parentId) : undefined;
    const parentPath = parentBone
      ? `Skeleton2D/${buildBonePath(parentBone, byId)}`
      : "Skeleton2D";
    const rad = round4(degToRad(bone.rotationDeg));
    const cos = round4(Math.cos(rad));
    const sin = round4(Math.sin(rad));
    out.push(
      `[node name="${sanitizeNodeName(bone.name)}" type="Bone2D" parent="${parentPath}"]`
    );
    out.push(
      `position = Vector2(${round4(bone.localX)}, ${round4(bone.localY)})`
    );
    if (Math.abs(rad) > 1e-5) out.push(`rotation = ${rad}`);
    if (
      (bone.scaleX !== undefined && Math.abs(bone.scaleX - 1) > 1e-4) ||
      (bone.scaleY !== undefined && Math.abs(bone.scaleY - 1) > 1e-4)
    ) {
      out.push(
        `scale = Vector2(${round4(bone.scaleX ?? 1)}, ${round4(bone.scaleY ?? 1)})`
      );
    }
    out.push(
      `rest = Transform2D(${cos}, ${sin}, ${-sin}, ${cos}, ${round4(bone.localX)}, ${round4(bone.localY)})`
    );
    out.push(`auto_calculate_length_and_angle = false`);
    out.push(`length = ${round4(bone.length)}`);
    out.push("");
  }

  for (const sn of spriteNodes) {
    out.push(
      `[node name="${sn.name}" type="Sprite2D" parent="${sn.parentPath}"]`
    );
    out.push(`texture = ExtResource("${sn.extId}")`);
    if (!sn.visible) out.push("visible = false");
    out.push("");
  }

  out.push('[node name="AnimationPlayer" type="AnimationPlayer" parent="."]');
  out.push('libraries = { "": SubResource("AnimationLibrary_1") }');
  out.push("");

  return {
    tscn: out.join("\n"),
    sprites,
    warnings,
  };
}
