import {
  Box,
  Cuboid,
  Eraser,
  Expand,
  EyeOff,
  FlipHorizontal2,
  FolderPlus,
  Ghost,
  Grid2x2,
  Grid3x3,
  KeyRound,
  Lock,
  MousePointer,
  Move,
  PaintBucket,
  Paintbrush,
  Palette,
  Pause,
  Pipette,
  Play,
  RefreshCw,
  RotateCw,
  Scissors,
  Trash2,
  Unlock,
} from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  createModelClip,
  recordNodeTransformKeyframes,
} from "../../engine/model3d/animEval";
import {
  cullInternalCoplanarFaces,
  deleteSelectedElements,
  mirrorNode,
} from "../../engine/model3d/meshOps";
import { mutateModel3D } from "../../engine/model3d/model3dActions";
import {
  cycleTileCursorPlane,
  flipTileCursor,
  rotateTileCursorCW,
} from "../../engine/model3d/tileStamp";
import type { GizmoMode, SelectionGranularity } from "../../engine/model3d/types";
import { useEditorStore } from "../../store/editorStore";

const GIZMO_TOOLS: readonly {
  id: GizmoMode;
  label: string;
  shortcut: string;
  icon: typeof MousePointer;
}[] = [
  { id: "select", label: "Select", shortcut: "Q", icon: MousePointer },
  { id: "move", label: "Move", shortcut: "W", icon: Move },
  { id: "rotate", label: "Rotate", shortcut: "E", icon: RotateCw },
  { id: "scale", label: "Scale", shortcut: "R", icon: Expand },
];

const GRANULARITY_MODES: readonly {
  id: SelectionGranularity;
  label: string;
  shortcut: string;
}[] = [
  { id: "object", label: "Obj", shortcut: "1" },
  { id: "vertex", label: "Vtx", shortcut: "2" },
  { id: "edge", label: "Edg", shortcut: "3" },
  { id: "face", label: "Fac", shortcut: "4" },
];

const PAINT_TOOLS: readonly {
  id: "brush" | "eraser" | "fillFace" | "eyedropper" | "vertexColor";
  label: string;
  shortcut: string;
  icon: typeof Paintbrush;
}[] = [
  { id: "brush", label: "Brush", shortcut: "B", icon: Paintbrush },
  { id: "eraser", label: "Eraser", shortcut: "E", icon: Eraser },
  { id: "fillFace", label: "Fill Face", shortcut: "G", icon: PaintBucket },
  { id: "eyedropper", label: "Eyedropper", shortcut: "I", icon: Pipette },
  { id: "vertexColor", label: "Vertex Color", shortcut: "V", icon: Palette },
];

export function Model3DToolRail() {
  const studio3d = useEditorStore((s) => s.studio3d);
  const patchStudio3D = useEditorStore((s) => s.patchStudio3D);
  const model3dVersion = useEditorStore((s) => s.model3dVersion);
  const onionSkin = useEditorStore((s) => s.onionSkin);
  const toggleOnionSkin = useEditorStore((s) => s.toggleOnionSkin);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const togglePlaying = useEditorStore((s) => s.togglePlaying);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  void model3dVersion;

  const engine = pixelEngine.model3d;
  const granularity = engine.selectionGranularity;
  const hasSelected = engine.selectedNodeIds.length > 0;
  const activeNode = engine.activeNodeId
    ? engine.getNode(engine.activeNodeId) ?? null
    : null;

  const handleMirrorX = () => {
    const ids = [...engine.selectedNodeIds];
    if (ids.length === 0) return;
    mutateModel3D("Mirror 3D Node X", (eng) => {
      for (const id of ids) {
        const node = eng.getNode(id);
        if (!node || node.locked) continue;
        const mirrored = mirrorNode(node, "x", true);
        eng.updateNode(id, {
          transform: mirrored.transform,
          cuboid: mirrored.cuboid,
          mesh: mirrored.mesh,
        });
      }
    });
    setStatusMessage(`Mirrored ${ids.length} node(s) across X`);
  };

  const handleCullInternalFaces = () => {
    let culled = 0;
    mutateModel3D("Cull Internal Coplanar Faces", (eng) => {
      const res = cullInternalCoplanarFaces(eng.nodes);
      culled = res.culledCount;
      eng.nodes = res.nodes;
    });
    setStatusMessage(
      culled > 0
        ? `Culled ${culled} internal coplanar face(s)`
        : "No internal coplanar faces found"
    );
  };

  const handleRecordKeyframe = () => {
    if (!activeNode) {
      setStatusMessage("Select a node to record a keyframe");
      return;
    }
    const frame = useEditorStore.getState().currentFrame;
    const totalFrames = Math.max(1, useEditorStore.getState().frames.length);
    const fps = Math.max(1, useEditorStore.getState().fps);
    mutateModel3D("Record 3D Keyframe", (eng) => {
      const node = eng.getNode(activeNode.id);
      if (!node) return;
      let clip =
        eng.clips.find((c) => c.id === eng.activeClipId) ?? eng.clips[0];
      if (!clip) {
        clip = createModelClip("Clip 1", totalFrames, fps, true);
        eng.clips.push(clip);
        eng.activeClipId = clip.id;
      }
      const updated = recordNodeTransformKeyframes(clip, node, frame);
      const idx = eng.clips.findIndex((c) => c.id === updated.id);
      if (idx >= 0) eng.clips[idx] = updated;
    });
    setStatusMessage(`Keyframed "${activeNode.name}" at frame ${frame + 1}`);
  };

  return (
    <aside className="tool-rail" aria-label="Low-Poly 3D Tools">
      {GIZMO_TOOLS.map((tool) => {
        const Icon = tool.icon;
        const active = studio3d.gizmoMode === tool.id;
        return (
          <button
            key={tool.id}
            type="button"
            className={`tool-btn ${active ? "active" : ""}`}
            title={`${tool.label} (${tool.shortcut})`}
            aria-label={`${tool.label} (${tool.shortcut})`}
            aria-pressed={active}
            onClick={() => patchStudio3D({ gizmoMode: tool.id })}
          >
            <Icon size={16} />
          </button>
        );
      })}

      <div className="tool-rail-sep" />

      {studio3d.subMode === "model" && (
        <>
          {GRANULARITY_MODES.map((g) => {
            const active = granularity === g.id;
            return (
              <button
                key={g.id}
                type="button"
                className={`tool-btn ${active ? "active" : ""}`}
                title={`${g.label} Selection (${g.shortcut})`}
                aria-pressed={active}
                style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}
                onClick={() => {
                  pixelEngine.model3d.setSelectionGranularity(g.id);
                  useEditorStore.getState().bumpModel3DVersion();
                }}
              >
                {g.label}
              </button>
            );
          })}
          <div className="tool-rail-sep" />
          <button
            type="button"
            className="tool-btn"
            title="Quick Add Cuboid"
            onClick={() =>
              mutateModel3D("Add Cuboid", (eng) => {
                eng.addNode({
                  kind: "cuboid",
                  name: `Cuboid ${eng.nodes.length + 1}`,
                  parentId:
                    activeNode?.kind === "group" ? activeNode.id : null,
                });
              })
            }
          >
            <Box size={16} />
          </button>
          <button
            type="button"
            className="tool-btn"
            title="Quick Add Group"
            onClick={() =>
              mutateModel3D("Add Group", (eng) => {
                eng.addGroup({ name: `Group ${eng.nodes.length + 1}` });
              })
            }
          >
            <FolderPlus size={16} />
          </button>
          <button
            type="button"
            className="tool-btn"
            title="Mirror Selected X (Ctrl+M)"
            disabled={!hasSelected}
            onClick={handleMirrorX}
          >
            <FlipHorizontal2 size={16} />
          </button>
          <button
            type="button"
            className="tool-btn"
            title="Cull Hidden Internal Faces"
            disabled={engine.nodes.length === 0}
            onClick={handleCullInternalFaces}
          >
            <Scissors size={16} />
          </button>
        </>
      )}

      {studio3d.subMode === "tile" && (
        <>
          <button
            type="button"
            className={`tool-btn ${studio3d.tileStampMode === "stamp" ? "active" : ""}`}
            title="Stamp Quad"
            aria-pressed={studio3d.tileStampMode === "stamp"}
            onClick={() => patchStudio3D({ tileStampMode: "stamp" })}
          >
            <Grid2x2 size={16} />
          </button>
          <button
            type="button"
            className={`tool-btn ${studio3d.tileStampMode === "dragFill" ? "active" : ""}`}
            title="Drag-Fill Plane"
            aria-pressed={studio3d.tileStampMode === "dragFill"}
            onClick={() => patchStudio3D({ tileStampMode: "dragFill" })}
          >
            <Grid3x3 size={16} />
          </button>
          <button
            type="button"
            className={`tool-btn ${studio3d.tileStampMode === "extrudeBlock" ? "active" : ""}`}
            title="Extrude Block"
            aria-pressed={studio3d.tileStampMode === "extrudeBlock"}
            onClick={() => patchStudio3D({ tileStampMode: "extrudeBlock" })}
          >
            <Cuboid size={16} />
          </button>
          <div className="tool-rail-sep" />
          <button
            type="button"
            className="tool-btn"
            title={`Cycle Plane (${engine.tileCursor.plane.toUpperCase()}) [Space]`}
            style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}
            onClick={() => {
              engine.patchTileCursor(cycleTileCursorPlane(engine.tileCursor));
              useEditorStore.getState().bumpModel3DVersion();
            }}
          >
            {engine.tileCursor.plane.toUpperCase()}
          </button>
          <button
            type="button"
            className="tool-btn"
            title="Rotate Tile 90° (R)"
            onClick={() => {
              engine.patchTileCursor(rotateTileCursorCW(engine.tileCursor));
              useEditorStore.getState().bumpModel3DVersion();
            }}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            className={`tool-btn ${engine.tileCursor.flipX ? "active" : ""}`}
            title="Flip Tile Horizontal (F)"
            onClick={() => {
              engine.patchTileCursor(flipTileCursor(engine.tileCursor, "x"));
              useEditorStore.getState().bumpModel3DVersion();
            }}
          >
            <FlipHorizontal2 size={15} />
          </button>
        </>
      )}

      {studio3d.subMode === "paint" && (
        <>
          {PAINT_TOOLS.map((tool) => {
            const Icon = tool.icon;
            const active = studio3d.paint3dTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                className={`tool-btn ${active ? "active" : ""}`}
                title={`${tool.label} (${tool.shortcut})`}
                aria-pressed={active}
                onClick={() => patchStudio3D({ paint3dTool: tool.id })}
              >
                <Icon size={16} />
              </button>
            );
          })}
          <div className="tool-rail-sep" />
          <button
            type="button"
            className={`tool-btn ${studio3d.paint3dLockFace ? "active" : ""}`}
            title="Lock Stroke to Initial Face"
            aria-pressed={studio3d.paint3dLockFace}
            onClick={() =>
              patchStudio3D({ paint3dLockFace: !studio3d.paint3dLockFace })
            }
          >
            {studio3d.paint3dLockFace ? <Lock size={15} /> : <Unlock size={15} />}
          </button>
        </>
      )}

      {studio3d.subMode === "animate" && (
        <>
          <button
            type="button"
            className="tool-btn"
            title="Record Keyframe (K)"
            disabled={!activeNode}
            onClick={handleRecordKeyframe}
          >
            <KeyRound size={16} />
          </button>
          <button
            type="button"
            className={`tool-btn ${studio3d.autoKey3D ? "active" : ""}`}
            title="Auto-Key Transform Changes"
            aria-pressed={studio3d.autoKey3D}
            style={{ fontSize: 9, fontFamily: "var(--font-mono)" }}
            onClick={() => patchStudio3D({ autoKey3D: !studio3d.autoKey3D })}
          >
            AUTO
          </button>
          <button
            type="button"
            className={`tool-btn ${onionSkin ? "active" : ""}`}
            title="Toggle Onion Skin Ghost Wireframe"
            aria-pressed={onionSkin}
            onClick={toggleOnionSkin}
          >
            <Ghost size={16} />
          </button>
          <button
            type="button"
            className={`tool-btn ${isPlaying ? "active" : ""}`}
            title={isPlaying ? "Pause Animation (Enter)" : "Play Animation (Enter)"}
            aria-pressed={isPlaying}
            onClick={togglePlaying}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
        </>
      )}

      {(studio3d.subMode === "uv" || studio3d.subMode === "bake") && (
        <button
          type="button"
          className={`tool-btn ${studio3d.cullBackfacesInView ? "active" : ""}`}
          title="See-Through Room Walls"
          onClick={() =>
            patchStudio3D({
              cullBackfacesInView: !studio3d.cullBackfacesInView,
            })
          }
        >
          <EyeOff size={15} />
        </button>
      )}

      <div className="tool-rail-sep" style={{ marginTop: "auto" }} />

      <button
        type="button"
        className="tool-btn"
        title={
          granularity !== "object" && activeNode?.kind === "mesh"
            ? "Delete Selected Elements (Delete)"
            : "Delete Selected Nodes (Delete)"
        }
        disabled={!hasSelected}
        onClick={() => {
          const engNow = pixelEngine.model3d;
          const gran = engNow.selectionGranularity;
          const curNode = engNow.activeNodeId ? engNow.getNode(engNow.activeNodeId) : undefined;
          if (
            gran !== "object" &&
            curNode &&
            !curNode.locked &&
            curNode.kind === "mesh" &&
            curNode.mesh
          ) {
            const selVerts = engNow.selectedVertices[curNode.id] ?? [];
            const selEdges = engNow.selectedEdges[curNode.id] ?? [];
            const selFaces = engNow.selectedFaces[curNode.id] ?? [];
            const hasSubSel =
              (gran === "vertex" && selVerts.length > 0) ||
              (gran === "edge" && selEdges.length > 0) ||
              (gran === "face" && selFaces.length > 0);
            if (hasSubSel) {
              let deletedCount = 0;
              mutateModel3D("Delete Mesh Elements", (eng) => {
                const n = eng.getNode(curNode.id);
                if (!n || n.kind !== "mesh" || !n.mesh) return;
                const res = deleteSelectedElements(n.mesh, gran, selVerts, selEdges, selFaces);
                deletedCount = res.deletedFaceCount;
                eng.updateNode(curNode.id, { mesh: res.mesh });
                eng.selectedVertices[curNode.id] = [];
                eng.selectedEdges[curNode.id] = [];
                eng.selectedFaces[curNode.id] = [];
              });
              setStatusMessage(`Deleted ${deletedCount} face(s)`);
              return;
            }
          }
          const ids = [...engNow.selectedNodeIds];
          if (ids.length === 0) return;
          mutateModel3D("Delete Selected Nodes", (eng) => {
            eng.deleteNodes(ids);
          });
          setStatusMessage(`Deleted ${ids.length} node(s)`);
        }}
      >
        <Trash2 size={16} />
      </button>
    </aside>
  );
}
