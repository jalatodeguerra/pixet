import { useEffect, useMemo, useState } from "react";
import {
  Bone as BoneIcon,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Lock,
  Plus,
  Shield,
  ShieldOff,
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
import {
  getBoneSubtreeIds,
  isDescendantBone,
  mirrorBones,
  reparentBonePreserveWorld,
} from "../../engine/rig/skeletonTools";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

interface TreeNode {
  bone: Bone;
  depth: number;
  hasChildren: boolean;
  boneIndex: number;
}

function buildVisibleTree(
  bones: readonly Bone[],
  collapsedIds: ReadonlySet<string>,
  searchQuery: string
): TreeNode[] {
  const byId = new Map(bones.map((b) => [b.id, b]));
  const indexById = new Map(bones.map((b, i) => [b.id, i]));
  const childrenByParent = new Map<string | null, Bone[]>();
  for (const bone of bones) {
    const pid = bone.parentId && byId.has(bone.parentId) ? bone.parentId : null;
    const list = childrenByParent.get(pid);
    if (list) list.push(bone);
    else childrenByParent.set(pid, [bone]);
  }

  const query = searchQuery.trim().toLowerCase();
  let allowedIds: Set<string> | null = null;
  if (query.length > 0) {
    allowedIds = new Set<string>();
    for (const bone of bones) {
      if (!bone.name.toLowerCase().includes(query)) continue;
      let cur: Bone | undefined = bone;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        allowedIds.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
  }

  const result: TreeNode[] = [];
  const visited = new Set<string>();
  const visit = (bone: Bone, depth: number) => {
    if (visited.has(bone.id)) return;
    if (allowedIds && !allowedIds.has(bone.id)) return;
    visited.add(bone.id);
    const children = (childrenByParent.get(bone.id) ?? []).filter(
      (c) => !allowedIds || allowedIds.has(c.id)
    );
    result.push({
      bone,
      depth,
      hasChildren: (childrenByParent.get(bone.id)?.length ?? 0) > 0,
      boneIndex: indexById.get(bone.id) ?? 0,
    });
    if (!query && collapsedIds.has(bone.id)) return;
    for (const child of children) {
      visit(child, depth + 1);
    }
  };

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root, 0);
  }
  for (const bone of bones) {
    if (!visited.has(bone.id)) visit(bone, 0);
  }
  return result;
}

export function BoneTreePanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigMode = useEditorStore((s) => s.rigMode);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const selectedBoneIds = useEditorStore((s) => s.selectedBoneIds);
  const setSelectedBoneId = useEditorStore((s) => s.setSelectedBoneId);
  const setSelectedBoneIds = useEditorStore((s) => s.setSelectedBoneIds);
  const toggleBoneSelection = useEditorStore((s) => s.toggleBoneSelection);
  const rigShowBones = useEditorStore((s) => s.rigShowBones);
  const toggleRigShowBones = useEditorStore((s) => s.toggleRigShowBones);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const layers = useEditorStore((s) => s.layers);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  const openContextMenu = useEditorStore((s) => s.openContextMenu);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [dragBoneId, setDragBoneId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{
    id: string;
    pos: "before" | "after" | "inside";
  } | null>(null);
  const [mirrorAxisX, setMirrorAxisX] = useState(() => canvasWidth / 2);
  const [mirrorKeyframes, setMirrorKeyframes] = useState(true);

  useEffect(() => {
    setMirrorAxisX(canvasWidth / 2);
  }, [canvasWidth]);

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

  const treeNodes = useMemo(
    () => buildVisibleTree(bones, collapsedIds, searchQuery),
    [bones, collapsedIds, searchQuery, rigVersion]
  );

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

  const handleAddBone = (parentOverride?: Bone | null) => {
    if (!setupMode) {
      setStatusMessage("Add Bone is only available in Setup mode");
      return;
    }
    const parent = parentOverride !== undefined ? parentOverride : selectedBone;
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
    if (selectedBoneId === boneId || selectedBoneIds.includes(boneId)) {
      setSelectedBoneId(pixelEngine.rig.bones[0]?.id ?? null);
    }
  };

  const handleToggleFlags = (
    bone: Bone,
    patch: { hidden?: boolean; locked?: boolean; weightLocked?: boolean },
    label: string
  ) => {
    mutateRig(label, () => pixelEngine.rig.updateBone(bone.id, patch));
  };

  const handleMirrorSelected = (overrideRoots?: string[]) => {
    if (!setupMode) {
      setStatusMessage("Mirror Bones is only available in Setup mode");
      return;
    }
    const roots =
      overrideRoots ??
      (selectedBoneIds.length > 0
        ? selectedBoneIds
        : selectedBone
          ? [selectedBone.id]
          : []);
    if (roots.length === 0) {
      setStatusMessage("Select one or more bones to mirror");
      return;
    }
    const result = mutateRig("Mirror bones", () =>
      mirrorBones(pixelEngine.rig, roots, mirrorAxisX, {
        mirrorKeyframes,
      })
    );
    if (result.createdIds.length > 0) {
      setSelectedBoneIds(result.createdIds, result.createdIds[0]);
      setStatusMessage(`Mirrored ${result.createdIds.length} bone(s)`);
    }
  };

  const startRename = (bone: Bone) => {
    setRenamingId(bone.id);
    setRenameDraft(bone.name);
  };

  const commitRename = (boneId: string) => {
    const trimmed = renameDraft.trim();
    if (trimmed) {
      mutateRig("Rename bone", () =>
        pixelEngine.rig.updateBone(boneId, { name: trimmed })
      );
    }
    setRenamingId(null);
  };

  const toggleCollapse = (boneId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(boneId)) next.delete(boneId);
      else next.add(boneId);
      return next;
    });
  };

  const handleRowClick = (
    e: React.MouseEvent,
    boneId: string
  ) => {
    if (e.ctrlKey || e.metaKey) {
      toggleBoneSelection(boneId);
      return;
    }
    if (e.shiftKey && selectedBoneId) {
      const visibleIds = treeNodes.map((n) => n.bone.id);
      const a = visibleIds.indexOf(selectedBoneId);
      const b = visibleIds.indexOf(boneId);
      if (a !== -1 && b !== -1) {
        const [start, end] = a <= b ? [a, b] : [b, a];
        setSelectedBoneIds(visibleIds.slice(start, end + 1), boneId);
        return;
      }
    }
    setSelectedBoneId(boneId);
  };

  const handleDropOnBone = (targetBone: Bone, pos: "before" | "after" | "inside") => {
    if (!dragBoneId || dragBoneId === targetBone.id || !setupMode) {
      setDragBoneId(null);
      setDragOver(null);
      return;
    }
    if (isDescendantBone(bones, dragBoneId, targetBone.id)) {
      setStatusMessage("Cannot reparent a bone into its own descendant");
      setDragBoneId(null);
      setDragOver(null);
      return;
    }
    const targetIdx = bones.findIndex((b) => b.id === targetBone.id);
    const newParentId = pos === "inside" ? targetBone.id : targetBone.parentId;
    const insertIndex =
      pos === "before"
        ? targetIdx
        : pos === "after"
          ? targetIdx + 1
          : undefined;
    mutateRig("Reparent bone", () =>
      reparentBonePreserveWorld(
        pixelEngine.rig,
        dragBoneId,
        newParentId,
        insertIndex
      )
    );
    setDragBoneId(null);
    setDragOver(null);
  };

  const handleBoneContextMenu = (e: React.MouseEvent, bone: Bone) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedBoneIds.includes(bone.id)) {
      setSelectedBoneId(bone.id);
    }
    openContextMenu(e.clientX, e.clientY, [
      {
        kind: "item",
        label: "Rename",
        action: () => startRename(bone),
      },
      {
        kind: "item",
        label: "Add Child Bone",
        disabled: !setupMode,
        action: () => handleAddBone(bone),
      },
      {
        kind: "item",
        label: "Mirror Subtree",
        disabled: !setupMode,
        action: () => handleMirrorSelected([bone.id]),
      },
      {
        kind: "item",
        label: "Select Children",
        action: () => {
          const ids = getBoneSubtreeIds(pixelEngine.rig.bones, bone.id);
          setSelectedBoneIds(ids, bone.id);
        },
      },
      {
        kind: "item",
        label: "Reset Pose",
        disabled: setupMode,
        action: () => {
          mutateRig("Reset bone pose", () => {
            pixelEngine.rig.setPoseOverride(
              bone.id,
              {
                rotationDeg: bone.rotationDeg,
                localX: bone.localX,
                localY: bone.localY,
                scaleX: bone.scaleX ?? 1,
                scaleY: bone.scaleY ?? 1,
              },
              currentFrame
            );
          });
        },
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Delete Bone",
        danger: true,
        action: () => handleDeleteBone(bone.id),
      },
    ]);
  };

  return (
    <RigPanelSection
      id="rig-bone-tree"
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
        <span>
          Bones ({bones.length}
          {selectedBoneIds.length > 1 ? ` · ${selectedBoneIds.length} sel` : ""})
        </span>
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
          onClick={() => handleAddBone()}
        >
          <Plus size={12} />
        </button>
      </div>

      {bones.length > 0 && (
        <input
          type="text"
          className="rig-tree-search"
          placeholder="Filter bones..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      )}

      {bones.length === 0 ? (
        <div className="rig-empty-note">
          Click <strong>Starter</strong> or select <strong>Add Bone</strong>{" "}
          (B) or <strong>Chain</strong> (C) in Setup mode.
        </div>
      ) : (
        <div className="rig-bone-list" style={{ maxHeight: 170 }}>
          {treeNodes.map(({ bone, depth, hasChildren, boneIndex }) => {
            const active =
              selectedBone?.id === bone.id || selectedBoneIds.includes(bone.id);
            const keyed =
              rigMode === "animate" &&
              pixelEngine.rig.hasKeyframe(bone.id, currentFrame);
            const infColor = getBoneInfluenceColor(boneIndex);
            const swatchHex =
              bone.color ?? rgbaToHex(infColor[0], infColor[1], infColor[2]);
            const isCollapsed = collapsedIds.has(bone.id);
            const dropPos =
              dragOver && dragOver.id === bone.id ? dragOver.pos : null;
            const dropClass = dropPos ? `drag-over-${dropPos}` : "";

            return (
              <div
                key={bone.id}
                className={`rig-bone-row ${active ? "active" : ""} ${bone.hidden ? "is-hidden" : ""} ${dropClass}`}
                style={{ paddingLeft: 4 + depth * 12 }}
                title={bone.name}
                draggable={setupMode && renamingId !== bone.id}
                onClick={(e) => handleRowClick(e, bone.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startRename(bone);
                }}
                onContextMenu={(e) => handleBoneContextMenu(e, bone)}
                onDragStart={(e) => {
                  if (!setupMode) return;
                  setDragBoneId(bone.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", bone.id);
                }}
                onDragOver={(e) => {
                  if (!setupMode || !dragBoneId || dragBoneId === bone.id) {
                    return;
                  }
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const relY = (e.clientY - rect.top) / Math.max(1, rect.height);
                  const pos: "before" | "after" | "inside" =
                    relY < 0.25 ? "before" : relY > 0.75 ? "after" : "inside";
                  setDragOver({ id: bone.id, pos });
                }}
                onDragLeave={() => {
                  if (dragOver?.id === bone.id) setDragOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const pos =
                    dragOver?.id === bone.id ? dragOver.pos : "inside";
                  handleDropOnBone(bone, pos);
                }}
                onDragEnd={() => {
                  setDragBoneId(null);
                  setDragOver(null);
                }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className="rig-tree-chevron"
                    title={isCollapsed ? "Expand" : "Collapse"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(bone.id);
                    }}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={10} />
                    ) : (
                      <ChevronDown size={10} />
                    )}
                  </button>
                ) : (
                  <span style={{ width: 14, flexShrink: 0 }} />
                )}
                <span
                  className="rig-influence-swatch"
                  style={{ backgroundColor: swatchHex }}
                  title="Bone color"
                />
                {renamingId === bone.id ? (
                  <input
                    className="rig-text-input"
                    style={{ height: 18, flex: 1, fontSize: 11 }}
                    autoFocus
                    value={renameDraft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(bone.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(bone.id);
                      else if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <span className="rig-bone-name">{bone.name}</span>
                )}
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
                  className={`icon-action-btn ${bone.weightLocked ? "active" : ""}`}
                  style={{ width: 18, height: 18 }}
                  title={bone.weightLocked ? "Unlock Weights" : "Lock Weights"}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFlags(
                      bone,
                      { weightLocked: !bone.weightLocked },
                      "Toggle bone weight lock"
                    );
                  }}
                >
                  {bone.weightLocked ? (
                    <Shield size={11} />
                  ) : (
                    <ShieldOff size={11} />
                  )}
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

      {bones.length > 0 && (
        <div className="rig-mirror-bar">
          <button
            type="button"
            className="mini-btn"
            title={
              setupMode
                ? "Mirror selected bone subtree across Axis X"
                : "Mirror Bones is only available in Setup mode"
            }
            aria-disabled={!setupMode || undefined}
            onClick={() => handleMirrorSelected()}
          >
            <FlipHorizontal2 size={11} />
            <span>Mirror</span>
          </button>
          <label className="rig-num-field" style={{ width: 64 }}>
            <span>X</span>
            <input
              type="number"
              className="rig-num-input"
              step={0.5}
              value={mirrorAxisX}
              onChange={(e) => setMirrorAxisX(Number(e.target.value) || 0)}
            />
          </label>
          <label className="modal-checkbox" style={{ fontSize: 10 }}>
            <input
              type="checkbox"
              checked={mirrorKeyframes}
              onChange={(e) => setMirrorKeyframes(e.target.checked)}
            />
            <span>Keys</span>
          </label>
        </div>
      )}
    </RigPanelSection>
  );
}
