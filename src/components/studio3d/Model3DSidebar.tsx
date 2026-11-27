import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Film,
  FlipHorizontal2,
  FolderPlus,
  Grid,
  KeyRound,
  LayoutGrid,
  Lock,
  Package,
  Plus,
  RotateCw,
  Scissors,
  Sparkles,
  Trash2,
  Unlock,
} from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  createModelClip,
  mirrorClipPoseAtFrameLR,
  recordNodeTransformKeyframes,
} from "../../engine/model3d/animEval";
import {
  bevelEdges,
  bevelVertices,
  convertNodeCuboidToMesh,
  cullInternalCoplanarFaces,
  deleteSelectedElements,
  extrudeFaces,
  fillOrBridgeSelection,
  flipFaceNormals,
  flipQuadDiagonal,
  insetFaces,
  joinMeshNodes,
  mergeVertices,
  mirrorNode,
  recalculateOutwardNormals,
  selectEdgeLoop,
  separateSelectedFaces,
  subdivideFacesOrLoopCut,
  weldVerticesByDistance,
} from "../../engine/model3d/meshOps";
import {
  cloneCuboidData,
  clonePolyMeshData,
  DEFAULT_MODEL3D_MATERIAL_ID,
} from "../../engine/model3d/Model3DEngine";
import { mutateModel3D } from "../../engine/model3d/model3dActions";
import {
  createPrimitiveNode,
  instantiateStarterTemplate,
  PRIMITIVE_CATALOG,
  STARTER_TEMPLATE_CATALOG,
  type PrimitiveKind,
  type StarterTemplateKind,
} from "../../engine/model3d/primitives";
import {
  appendSubMesh,
  applyFloorContactAo,
  capturePrefabFromFaces,
  cycleTileCursorPlane,
  ensureStampTargetMeshNode,
  extrudeTileBlockOnMesh,
  flipTileCursor,
  paintFaceCornerColors,
  rotateTileCursorCW,
  stampPrefabOntoMesh,
  stampTileQuadOnMesh,
  buildTileSlopeMesh,
  type TileSlopeKind,
} from "../../engine/model3d/tileStamp";
import {
  buildPaddedTilesetAtlas,
  getTileQuadPixelUvs,
} from "../../engine/model3d/tilesetAtlas";
import type {
  ColliderKind,
  CuboidFaceName,
  ModelNode,
  TileCursorPlane,
  Vec3,
} from "../../engine/model3d/types";
import {
  autoPackModelUvs,
  CUBOID_FACE_NAMES,
  resizeCuboidWithUvLock,
} from "../../engine/model3d/uvOps";
import type { Tileset } from "../../engine/tiles/Tileset";
import { useEditorStore } from "../../store/editorStore";
import { ColorPalettePanel } from "../draw/ColorPalettePanel";
import { downloadExportedModelAction, type ExportScalePreset } from "./three/modelExporter";
import {
  bakeModel3DToCurrentFrameAction,
  bakeModel3DToTilesetAction,
  bakeModel3DTurntableAction,
  type Model3DBakeOutline,
  type Model3DBakePass,
  type Model3DBakeProjection,
} from "./three/modelSpriteBaker";

const FACE_SHORT: Record<CuboidFaceName, string> = {
  north: "N",
  south: "S",
  east: "E",
  west: "W",
  up: "U",
  down: "D",
};

interface OutlinerRowItem {
  node: ModelNode;
  depth: number;
  hasChildren: boolean;
}

function buildHierarchyRows(
  nodes: readonly ModelNode[],
  collapsedIds: ReadonlySet<string>
): OutlinerRowItem[] {
  const byId = new Map<string, ModelNode>(nodes.map((n) => [n.id, n]));
  const childrenByParent = new Map<string | null, ModelNode[]>();
  for (const node of nodes) {
    const pid =
      node.parentId && node.parentId !== node.id && byId.has(node.parentId)
        ? node.parentId
        : null;
    const list = childrenByParent.get(pid);
    if (list) list.push(node);
    else childrenByParent.set(pid, [node]);
  }

  const rows: OutlinerRowItem[] = [];
  const visited = new Set<string>();

  const visit = (node: ModelNode, depth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const children = childrenByParent.get(node.id) ?? [];
    rows.push({ node, depth, hasChildren: children.length > 0 });
    if (!collapsedIds.has(node.id)) {
      for (const child of children) {
        visit(child, depth + 1);
      }
    }
  };

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root, 0);
  }
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      visit(node, 0);
    }
  }
  return rows;
}

function TileThumbCanvas({
  tileset,
  tileId,
  tilesetVersion,
}: {
  tileset: Tileset;
  tileId: number;
  tilesetVersion: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const buf = tileset.getTile(tileId);
    ctx.clearRect(0, 0, tileset.tileWidth, tileset.tileHeight);
    if (!buf) return;
    const img = new ImageData(
      new Uint8ClampedArray(buf.data),
      buf.width,
      buf.height
    );
    ctx.putImageData(img, 0, 0);
  }, [tileset, tileId, tilesetVersion]);

  return (
    <canvas
      ref={canvasRef}
      width={tileset.tileWidth}
      height={tileset.tileHeight}
      className="m3d-tile-canvas"
    />
  );
}

function isDescendantOrSelf(
  nodes: readonly ModelNode[],
  candidateParentId: string,
  nodeId: string
): boolean {
  if (candidateParentId === nodeId) return true;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  let cur: string | null = candidateParentId;
  while (cur !== null && !visited.has(cur)) {
    if (cur === nodeId) return true;
    visited.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export function Model3DSidebar() {
  const studio3d = useEditorStore((s) => s.studio3d);
  const patchStudio3D = useEditorStore((s) => s.patchStudio3D);
  const model3dVersion = useEditorStore((s) => s.model3dVersion);
  const bumpModel3DVersion = useEditorStore((s) => s.bumpModel3DVersion);
  const layers = useEditorStore((s) => s.layers);
  const frames = useEditorStore((s) => s.frames);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const fps = useEditorStore((s) => s.fps);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const activeTilesetIndex = useEditorStore((s) => s.activeTilesetIndex);
  const setActiveTilesetIndex = useEditorStore((s) => s.setActiveTilesetIndex);
  const activeTileId = useEditorStore((s) => s.activeTileId);
  const setActiveTileId = useEditorStore((s) => s.setActiveTileId);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const brushShape = useEditorStore((s) => s.brushShape);
  const setBrushShape = useEditorStore((s) => s.setBrushShape);
  const brushOpacity = useEditorStore((s) => s.brushOpacity);
  const setBrushOpacity = useEditorStore((s) => s.setBrushOpacity);
  const primaryColor = useEditorStore((s) => s.primaryColor);
  const onionSkin = useEditorStore((s) => s.onionSkin);
  const toggleOnionSkin = useEditorStore((s) => s.toggleOnionSkin);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  void model3dVersion;
  void tilesetVersion;

  const engine = pixelEngine.model3d;
  const activeNode = engine.activeNodeId
    ? engine.getNode(engine.activeNodeId) ?? null
    : null;

  // Local inspector controls state
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [primitivePick, setPrimitivePick] = useState<PrimitiveKind>("cuboid");
  const [templatePick, setTemplatePick] = useState<StarterTemplateKind | "">("");

  // Model mesh-ops state
  const [extrudeDistPx, setExtrudeDistPx] = useState(4);
  const [bevelWidthPx, setBevelWidthPx] = useState(1);
  const [insetPx, setInsetPx] = useState(2);
  const [insetDepthPx, setInsetDepthPx] = useState(0);
  const [weldDistPx, setWeldDistPx] = useState(0.01);
  const [mirrorShareUv, setMirrorShareUv] = useState(true);

  // Tile sub-mode state
  const [prefabRotDeg, setPrefabRotDeg] = useState<0 | 90 | 180 | 270>(0);
  const [vertexTintHex, setVertexTintHex] = useState("#7a7a88");

  // UV / Material sub-mode state
  const [selectedMatId, setSelectedMatId] = useState<string>(
    engine.materials[0]?.id ?? DEFAULT_MODEL3D_MATERIAL_ID
  );

  // Bake / Export sub-mode state
  const [exportScale, setExportScale] = useState<ExportScalePreset>("16px_1m");
  const [includeGodotColliders, setIncludeGodotColliders] = useState(true);
  const [triangulateObj, setTriangulateObj] = useState(false);

  const [bakePass, setBakePass] = useState<Model3DBakePass>("lit");
  const [bakeProjection, setBakeProjection] =
    useState<Model3DBakeProjection>("ortho");
  const [bakeDirs, setBakeDirs] = useState<4 | 8 | 12 | 16>(8);
  const [bakePitchDeg, setBakePitchDeg] = useState(20);
  const [bakeAnimateClip, setBakeAnimateClip] = useState(false);
  const [bakeQuantize, setBakeQuantize] = useState(false);
  const [bakeDither, setBakeDither] = useState(false);
  const [bakeOutline, setBakeOutline] = useState<Model3DBakeOutline>("none");
  const [bakeTilesetRots, setBakeTilesetRots] = useState<1 | 4>(4);

  const hierarchyRows = useMemo(
    () => buildHierarchyRows(engine.nodes, collapsedIds),
    [engine.nodes, collapsedIds, model3dVersion]
  );

  const rasterLayers = useMemo(
    () => layers.filter((l) => l.kind === "raster"),
    [layers]
  );

  const tilesets = pixelEngine.tilesetRegistry.tilesets;
  const activeTileset =
    pixelEngine.tilesetRegistry.get(activeTilesetIndex) ?? pixelEngine.tileset;

  const activeMaterial =
    engine.materials.find((m) => m.id === selectedMatId) ??
    engine.materials[0] ??
    null;

  const activeClip =
    (engine.activeClipId
      ? engine.clips.find((c) => c.id === engine.activeClipId)
      : undefined) ??
    engine.clips[0] ??
    null;

  const toggleCollapse = (nodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const handleAddPrimitive = (kind: PrimitiveKind) => {
    mutateModel3D(`Add ${kind}`, (eng) => {
      const parentId = activeNode?.kind === "group" ? activeNode.id : null;
      const matId = eng.materials[0]?.id ?? DEFAULT_MODEL3D_MATERIAL_ID;
      const node = createPrimitiveNode(kind, {
        name: `${PRIMITIVE_CATALOG.find((p) => p.kind === kind)?.label ?? kind} ${eng.nodes.length + 1}`,
        materialId: matId,
        parentId,
      });
      eng.addNode(node);
    });
  };

  const handleInstantiateTemplate = (kind: StarterTemplateKind) => {
    const label =
      STARTER_TEMPLATE_CATALOG.find((t) => t.kind === kind)?.label ?? kind;
    mutateModel3D(`Instantiate ${label}`, (eng) => {
      instantiateStarterTemplate(eng, kind);
    });
    setStatusMessage(`Added starter template: ${label}`);
  };

  // Mesh Editing helper
  const runMeshOp = (
    label: string,
    op: (
      mesh: NonNullable<ModelNode["mesh"]>,
      selFaces: string[],
      selVerts: number[]
    ) => NonNullable<ModelNode["mesh"]> | null
  ) => {
    if (!activeNode || activeNode.kind !== "mesh" || !activeNode.mesh || activeNode.locked) {
      return;
    }
    const nodeId = activeNode.id;
    mutateModel3D(label, (eng) => {
      const n = eng.getNode(nodeId);
      if (!n || n.kind !== "mesh" || !n.mesh || n.locked) return;
      const selFaces = eng.selectedFaces[nodeId] ?? [];
      const selVerts = eng.selectedVertices[nodeId] ?? [];
      const nextMesh = op(n.mesh, selFaces, selVerts);
      if (nextMesh) {
        eng.updateNode(nodeId, { mesh: nextMesh });
      }
    });
  };

  const handleMirrorActiveNodes = (axis: "x" | "y" | "z") => {
    const ids = [...engine.selectedNodeIds];
    if (ids.length === 0) return;
    mutateModel3D(`Mirror ${axis.toUpperCase()}`, (eng) => {
      for (const id of ids) {
        const node = eng.getNode(id);
        if (!node || node.locked) continue;
        const mirrored = mirrorNode(node, axis, mirrorShareUv);
        eng.updateNode(id, {
          transform: mirrored.transform,
          cuboid: mirrored.cuboid,
          mesh: mirrored.mesh,
        });
      }
    });
    setStatusMessage(`Mirrored ${ids.length} node(s) on ${axis.toUpperCase()}`);
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

  // Tile helpers
  const ensureTilesetMaterialAndUvs = (eng: typeof engine, ts: Tileset) => {
    const safeTileId = Math.max(
      1,
      Math.min(Math.max(1, ts.count), activeTileId || eng.tileCursor.cachedTileId || 1)
    );
    const meta = ts.getMeta(safeTileId);
    const tileUid = meta?.uid || eng.tileCursor.tileUid || `tile-${safeTileId}`;
    eng.patchTileCursor({
      tilesetId: ts.id,
      tileUid,
      cachedTileId: safeTileId,
      stepPx: ts.tileWidth,
    });
    let mat = eng.materials.find(
      (m) => m.source.kind === "tileset" && m.source.tilesetId === ts.id
    );
    if (!mat) {
      mat = eng.addMaterial({
        name: `${ts.name} Atlas`,
        source: { kind: "tileset", tilesetId: ts.id },
        doubleSided: false,
        alphaTest: 0.5,
        usePbrMaps: false,
      });
    }
    const atlas = buildPaddedTilesetAtlas(ts);
    const uvs = getTileQuadPixelUvs(
      atlas,
      ts,
      tileUid,
      safeTileId,
      eng.tileCursor.rotation,
      eng.tileCursor.flipX,
      eng.tileCursor.flipY
    );
    return { mat, uvs };
  };

  const handleStampHere = () => {
    const ts = activeTileset;
    mutateModel3D(
      studio3d.tileStampMode === "extrudeBlock"
        ? "Extrude Tile Block"
        : "Stamp Tile",
      (eng) => {
        const { mat, uvs } = ensureTilesetMaterialAndUvs(eng, ts);
        const target = ensureStampTargetMeshNode(eng, mat.id, eng.activeNodeId);
        if (!target.mesh) return;
        if (studio3d.tileStampMode === "extrudeBlock") {
          extrudeTileBlockOnMesh(
            target.mesh,
            eng.tileCursor,
            studio3d.tileExtrudeDepthPx || ts.tileWidth,
            {
              materialId: mat.id,
              capUvs: uvs,
              sideUvs: uvs,
              tileWidthPx: ts.tileWidth,
              tileHeightPx: ts.tileHeight,
              autoWeld: true,
            }
          );
        } else {
          stampTileQuadOnMesh(target.mesh, eng.tileCursor, {
            materialId: mat.id,
            uvs,
            tileWidthPx: ts.tileWidth,
            tileHeightPx: ts.tileHeight,
            autoWeld: true,
          });
        }
      }
    );
  };

  const handleStampSlope = (kind: TileSlopeKind, label: string) => {
    const ts = activeTileset;
    mutateModel3D(`Stamp ${label}`, (eng) => {
      const { mat, uvs } = ensureTilesetMaterialAndUvs(eng, ts);
      const target = ensureStampTargetMeshNode(eng, mat.id, eng.activeNodeId);
      if (!target.mesh) return;
      const slopeMesh = buildTileSlopeMesh(eng.tileCursor, kind, {
        materialId: mat.id,
        uvs,
        sizePx: [ts.tileWidth, ts.tileHeight, ts.tileWidth],
      });
      appendSubMesh(target.mesh, slopeMesh, [0, 0, 0], true);
    });
    setStatusMessage(`Stamped ${label} at tile cursor`);
  };

  const handleCapturePrefab = () => {
    if (!activeNode || activeNode.kind !== "mesh" || !activeNode.mesh) {
      setStatusMessage("Select a mesh node with faces to capture a prefab");
      return;
    }
    const selFaces = engine.selectedFaces[activeNode.id] ?? [];
    const targetFaces =
      selFaces.length > 0
        ? selFaces
        : activeNode.mesh.faces.map((f) => f.id);
    const prefab = capturePrefabFromFaces(
      activeNode.mesh,
      targetFaces,
      `${activeNode.name} Prefab ${engine.prefabs.length + 1}`
    );
    if (!prefab) {
      setStatusMessage("No faces available to capture prefab");
      return;
    }
    mutateModel3D("Capture 3D Prefab", (eng) => {
      eng.prefabs.push(prefab);
    });
    setStatusMessage(`Captured prefab "${prefab.name}"`);
  };

  const handleAutoPackUvs = () => {
    if (engine.nodes.length === 0) return;
    let packedCount = 0;
    let overflowCount = 0;
    mutateModel3D("Auto-Pack 3D UVs", (eng) => {
      const res = autoPackModelUvs(
        eng.nodes,
        Math.max(1, canvasWidth),
        Math.max(1, canvasHeight),
        1
      );
      eng.nodes = res.nodes;
      packedCount = res.packedCount;
      overflowCount = res.overflowCount;
    });
    setStatusMessage(
      overflowCount > 0
        ? `Packed ${packedCount} UV island(s); ${overflowCount} overflowed`
        : `Packed ${packedCount} UV island(s) (1px gutter)`
    );
  };

  const handleAssignMaterialToSelected = (matId: string) => {
    const ids = [...engine.selectedNodeIds];
    if (ids.length === 0) return;
    mutateModel3D("Assign 3D Material", (eng) => {
      for (const id of ids) {
        const node = eng.getNode(id);
        if (!node || node.locked) continue;
        if (node.kind === "cuboid" && node.cuboid) {
          const next = cloneCuboidData(node.cuboid);
          for (const fn of CUBOID_FACE_NAMES) {
            next.faces[fn].materialId = matId;
          }
          eng.updateNode(id, { cuboid: next });
        } else if (node.kind === "mesh" && node.mesh) {
          const next = clonePolyMeshData(node.mesh);
          const selFaceSet = new Set(eng.selectedFaces[id] ?? []);
          for (const f of next.faces) {
            if (selFaceSet.size === 0 || selFaceSet.has(f.id)) {
              f.materialId = matId;
            }
          }
          eng.updateNode(id, { mesh: next });
        }
      }
    });
    setStatusMessage("Assigned material to selection");
  };

  const handleRecordKeyframe = () => {
    if (!activeNode) return;
    mutateModel3D("Record 3D Keyframe", (eng) => {
      const node = eng.getNode(activeNode.id);
      if (!node) return;
      let clip =
        eng.clips.find((c) => c.id === eng.activeClipId) ?? eng.clips[0];
      if (!clip) {
        clip = createModelClip(
          "Clip 1",
          Math.max(1, frames.length),
          Math.max(1, fps),
          true
        );
        eng.clips.push(clip);
        eng.activeClipId = clip.id;
      }
      const updated = recordNodeTransformKeyframes(clip, node, currentFrame);
      const idx = eng.clips.findIndex((c) => c.id === updated.id);
      if (idx >= 0) eng.clips[idx] = updated;
    });
    setStatusMessage(
      `Keyframed "${activeNode.name}" at frame ${currentFrame + 1}`
    );
  };

  const exportOpts = {
    scalePreset: exportScale,
    includeGodotColliders,
    triangulate: triangulateObj,
  };

  const bakePostOpts = {
    pass: bakePass,
    projection: bakeProjection,
    pitchDeg: bakePitchDeg,
    quantizeToPalette: bakeQuantize,
    ditherMode: (bakeDither ? "bayer4" : "none") as "bayer4" | "none",
    outline: bakeOutline,
  };

  return (
    <div className="m3d-sidebar">
      {/* SECTION 1: Scene Outliner + Add Primitives / Templates */}
      <div className="m3d-section">
        <div className="m3d-section-header">
          <span>Scene Outliner ({engine.nodes.length})</span>
          <div style={{ display: "flex", gap: 3 }}>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 20, height: 20 }}
              title="Add Cuboid"
              onClick={() => handleAddPrimitive("cuboid")}
            >
              <Box size={12} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 20, height: 20 }}
              title="Add Group"
              onClick={() =>
                mutateModel3D("Add Group", (eng) => {
                  eng.addGroup({ name: `Group ${eng.nodes.length + 1}` });
                })
              }
            >
              <FolderPlus size={12} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 20, height: 20 }}
              title="Duplicate Selected (Ctrl+D)"
              disabled={engine.selectedNodeIds.length === 0}
              onClick={() => {
                const ids = [...engine.selectedNodeIds];
                if (ids.length === 0) return;
                mutateModel3D("Duplicate Nodes", (eng) => {
                  eng.duplicateNodes(ids);
                });
              }}
            >
              <Copy size={12} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 20, height: 20 }}
              title="Delete Selected (Del)"
              disabled={engine.selectedNodeIds.length === 0}
              onClick={() => {
                const ids = [...engine.selectedNodeIds];
                if (ids.length === 0) return;
                mutateModel3D("Delete Nodes", (eng) => {
                  eng.deleteNodes(ids);
                });
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* Add Primitive + Starter Templates bar */}
        <div className="m3d-inline-pair">
          <div style={{ display: "flex", gap: 2 }}>
            <select
              className="m3d-select"
              style={{ flex: 1, minWidth: 0 }}
              aria-label="Primitive Kind"
              value={primitivePick}
              onChange={(e) => setPrimitivePick(e.target.value as PrimitiveKind)}
            >
              {PRIMITIVE_CATALOG.map((p) => (
                <option key={p.kind} value={p.kind}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="m3d-btn-compact"
              title="Add Selected Primitive"
              onClick={() => handleAddPrimitive(primitivePick)}
            >
              <Plus size={11} />
              <span>Add</span>
            </button>
          </div>

          <select
            className="m3d-select"
            aria-label="Starter Templates"
            value={templatePick}
            onChange={(e) => {
              const val = e.target.value as StarterTemplateKind | "";
              if (!val) return;
              handleInstantiateTemplate(val);
              setTemplatePick("");
            }}
          >
            <option value="">Templates...</option>
            {STARTER_TEMPLATE_CATALOG.map((t) => (
              <option key={t.kind} value={t.kind} title={t.description}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="m3d-outliner-list" role="listbox" aria-label="3D Scene Nodes">
          {hierarchyRows.length === 0 ? (
            <div className="m3d-empty-hint">
              No nodes yet. Add a Primitive or Template to start modeling.
            </div>
          ) : (
            hierarchyRows.map(({ node, depth, hasChildren }) => {
              const selected = engine.selectedNodeIds.includes(node.id);
              const collapsed = collapsedIds.has(node.id);
              return (
                <div
                  key={node.id}
                  role="option"
                  aria-selected={selected}
                  className={`m3d-outliner-row ${selected ? "selected" : ""}`}
                  style={{ paddingLeft: 4 + depth * 12 }}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      const prev = [...engine.selectedNodeIds];
                      const next = prev.includes(node.id)
                        ? prev.filter((id) => id !== node.id)
                        : [...prev, node.id];
                      engine.selectNodes(next, node.id);
                    } else {
                      engine.selectNodes([node.id], node.id);
                    }
                    bumpModel3DVersion();
                  }}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      className="m3d-tree-toggle"
                      title={collapsed ? "Expand Children" : "Collapse Children"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(node.id);
                      }}
                    >
                      {collapsed ? (
                        <ChevronRight size={11} />
                      ) : (
                        <ChevronDown size={11} />
                      )}
                    </button>
                  ) : (
                    <span className="m3d-tree-toggle" aria-hidden="true" />
                  )}
                  <span className="m3d-outliner-name">{node.name}</span>
                  {node.collider !== "none" && (
                    <span className="m3d-collider-badge">
                      {node.collider === "convex" ? "-convcol" : "-col"}
                    </span>
                  )}
                  <span className="m3d-outliner-kind">{node.kind}</span>
                  <button
                    type="button"
                    className="icon-action-btn"
                    style={{ width: 18, height: 18 }}
                    title={node.visible ? "Hide Node" : "Show Node"}
                    onClick={(e) => {
                      e.stopPropagation();
                      mutateModel3D("Toggle Node Visibility", (eng) => {
                        eng.updateNode(node.id, { visible: !node.visible });
                      });
                    }}
                  >
                    {node.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                  </button>
                  <button
                    type="button"
                    className="icon-action-btn"
                    style={{ width: 18, height: 18 }}
                    title={node.locked ? "Unlock Node" : "Lock Node"}
                    onClick={(e) => {
                      e.stopPropagation();
                      mutateModel3D("Toggle Node Lock", (eng) => {
                        eng.updateNode(node.id, { locked: !node.locked });
                      });
                    }}
                  >
                    {node.locked ? <Lock size={11} /> : <Unlock size={11} />}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* SECTION 2: Node Transform, Pivot & Cuboid Inspector */}
      <div className="m3d-section">
        <div className="m3d-section-header">
          <span>Node Inspector</span>
          <span className="m3d-badge-mono">
            {activeNode ? activeNode.kind : "none"}
          </span>
        </div>

        {activeNode ? (
          <>
            <div className="m3d-inline-pair">
              <label className="m3d-field-label">
                <span>Name</span>
                <input
                  type="text"
                  className="m3d-num-input"
                  value={activeNode.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    mutateModel3D("Rename Node", (eng) => {
                      eng.updateNode(activeNode.id, { name: val });
                    });
                  }}
                />
              </label>

              <label className="m3d-field-label">
                <span>Parent</span>
                <select
                  className="m3d-select"
                  value={activeNode.parentId ?? ""}
                  onChange={(e) => {
                    const nextParent = e.target.value || null;
                    mutateModel3D("Reparent Node", (eng) => {
                      eng.reparentNode(activeNode.id, nextParent);
                    });
                  }}
                >
                  <option value="">(Root)</option>
                  {engine.nodes
                    .filter(
                      (candidate) =>
                        !isDescendantOrSelf(
                          engine.nodes,
                          candidate.id,
                          activeNode.id
                        )
                    )
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <label className="m3d-field-label">
              <span>Collider (Godot / glTF)</span>
              <select
                className="m3d-select"
                value={activeNode.collider}
                onChange={(e) => {
                  const collider = e.target.value as ColliderKind;
                  mutateModel3D("Set Node Collider", (eng) => {
                    eng.updateNode(activeNode.id, { collider });
                  });
                }}
              >
                <option value="none">None</option>
                <option value="box">Box (-col)</option>
                <option value="convex">Convex (-convcol)</option>
                <option value="trimesh">Trimesh (-col)</option>
              </select>
            </label>

            <div className="m3d-field-label">
              <span>Position (px)</span>
              <div className="m3d-field-grid">
                {(["X", "Y", "Z"] as const).map((axis, idx) => (
                  <input
                    key={axis}
                    type="number"
                    step={studio3d.snapPx}
                    className="m3d-num-input"
                    aria-label={`Position ${axis}`}
                    value={activeNode.transform.position[idx]}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      const pos: Vec3 = [...activeNode.transform.position];
                      pos[idx] = val;
                      mutateModel3D(`Move Node ${axis}`, (eng) => {
                        eng.updateNode(activeNode.id, {
                          transform: { ...activeNode.transform, position: pos },
                        });
                      });
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="m3d-field-label">
              <span>Rotation (deg)</span>
              <div className="m3d-field-grid">
                {(["X", "Y", "Z"] as const).map((axis, idx) => (
                  <input
                    key={axis}
                    type="number"
                    step={5}
                    className="m3d-num-input"
                    aria-label={`Rotation ${axis}`}
                    value={activeNode.transform.rotation[idx]}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      const rot: Vec3 = [...activeNode.transform.rotation];
                      rot[idx] = val;
                      mutateModel3D(`Rotate Node ${axis}`, (eng) => {
                        eng.updateNode(activeNode.id, {
                          transform: { ...activeNode.transform, rotation: rot },
                        });
                      });
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="m3d-field-label">
              <span>Scale</span>
              <div className="m3d-field-grid">
                {(["X", "Y", "Z"] as const).map((axis, idx) => (
                  <input
                    key={axis}
                    type="number"
                    step={0.1}
                    className="m3d-num-input"
                    aria-label={`Scale ${axis}`}
                    value={activeNode.transform.scale[idx]}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const val = Number.isFinite(raw) ? raw : 1;
                      const scale: Vec3 = [...activeNode.transform.scale];
                      scale[idx] = val;
                      mutateModel3D(`Scale Node ${axis}`, (eng) => {
                        eng.updateNode(activeNode.id, {
                          transform: { ...activeNode.transform, scale },
                        });
                      });
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="m3d-field-label">
              <span>Pivot (px)</span>
              <div className="m3d-field-grid">
                {(["X", "Y", "Z"] as const).map((axis, idx) => (
                  <input
                    key={axis}
                    type="number"
                    step={studio3d.snapPx}
                    className="m3d-num-input"
                    aria-label={`Pivot ${axis}`}
                    value={activeNode.transform.pivot[idx]}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      const pivot: Vec3 = [...activeNode.transform.pivot];
                      pivot[idx] = val;
                      mutateModel3D(`Set Pivot ${axis}`, (eng) => {
                        eng.updateNode(activeNode.id, {
                          transform: { ...activeNode.transform, pivot },
                        });
                      });
                    }}
                  />
                ))}
              </div>
            </div>

            {activeNode.kind === "cuboid" && activeNode.cuboid && (
              <div className="m3d-sub-group">
                <div className="m3d-sub-title">Parametric Cuboid</div>

                <div className="m3d-field-label">
                  <span>From (px)</span>
                  <div className="m3d-field-grid">
                    {(["X", "Y", "Z"] as const).map((axis, idx) => (
                      <input
                        key={axis}
                        type="number"
                        step={studio3d.snapPx}
                        className="m3d-num-input"
                        aria-label={`Cuboid From ${axis}`}
                        value={activeNode.cuboid!.from[idx]}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          const nextFrom: Vec3 = [...activeNode.cuboid!.from];
                          nextFrom[idx] = val;
                          mutateModel3D(`Resize Cuboid From ${axis}`, (eng) => {
                            const n = eng.getNode(activeNode.id);
                            if (!n || !n.cuboid) return;
                            const resized = resizeCuboidWithUvLock(
                              n.cuboid,
                              nextFrom,
                              n.cuboid.to
                            );
                            eng.updateNode(n.id, { cuboid: resized });
                          });
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="m3d-field-label">
                  <span>To (px)</span>
                  <div className="m3d-field-grid">
                    {(["X", "Y", "Z"] as const).map((axis, idx) => (
                      <input
                        key={axis}
                        type="number"
                        step={studio3d.snapPx}
                        className="m3d-num-input"
                        aria-label={`Cuboid To ${axis}`}
                        value={activeNode.cuboid!.to[idx]}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          const nextTo: Vec3 = [...activeNode.cuboid!.to];
                          nextTo[idx] = val;
                          mutateModel3D(`Resize Cuboid To ${axis}`, (eng) => {
                            const n = eng.getNode(activeNode.id);
                            if (!n || !n.cuboid) return;
                            const resized = resizeCuboidWithUvLock(
                              n.cuboid,
                              n.cuboid.from,
                              nextTo
                            );
                            eng.updateNode(n.id, { cuboid: resized });
                          });
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="m3d-inline-pair" style={{ alignItems: "end" }}>
                  <label className="m3d-field-label">
                    <span>Inflate (px)</span>
                    <input
                      type="number"
                      step={0.25}
                      className="m3d-num-input"
                      aria-label="Cuboid Inflate"
                      value={activeNode.cuboid.inflate}
                      onChange={(e) => {
                        const inflate = Number(e.target.value) || 0;
                        mutateModel3D("Set Cuboid Inflate", (eng) => {
                          const n = eng.getNode(activeNode.id);
                          if (!n || !n.cuboid) return;
                          const next = cloneCuboidData(n.cuboid);
                          next.inflate = inflate;
                          eng.updateNode(n.id, { cuboid: next });
                        });
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    className="m3d-btn-compact"
                    style={{ height: 24 }}
                    onClick={() =>
                      mutateModel3D("Convert Cuboid to Mesh", (eng) => {
                        const n = eng.getNode(activeNode.id);
                        if (!n) return;
                        const converted = convertNodeCuboidToMesh(n);
                        const idx = eng.nodes.findIndex((x) => x.id === n.id);
                        if (idx >= 0) {
                          eng.nodes[idx] = converted;
                        }
                      })
                    }
                  >
                    Convert Cuboid → Mesh
                  </button>
                </div>

                <div className="m3d-inline-pair">
                  <label className="m3d-checkbox-row">
                    <input
                      type="checkbox"
                      checked={activeNode.cuboid.uvLock}
                      onChange={(e) => {
                        const uvLock = e.target.checked;
                        mutateModel3D("Toggle UV Lock", (eng) => {
                          const n = eng.getNode(activeNode.id);
                          if (!n || !n.cuboid) return;
                          const next = cloneCuboidData(n.cuboid);
                          next.uvLock = uvLock;
                          eng.updateNode(n.id, { cuboid: next });
                        });
                      }}
                    />
                    <span>UV Lock</span>
                  </label>

                  <label className="m3d-checkbox-row">
                    <input
                      type="checkbox"
                      checked={Boolean(activeNode.cuboid.mirrorUvX)}
                      onChange={(e) => {
                        const mirrorUvX = e.target.checked;
                        mutateModel3D("Toggle Mirror UV X", (eng) => {
                          const n = eng.getNode(activeNode.id);
                          if (!n || !n.cuboid) return;
                          const next = cloneCuboidData(n.cuboid);
                          next.mirrorUvX = mirrorUvX;
                          const resized = resizeCuboidWithUvLock(
                            next,
                            next.from,
                            next.to
                          );
                          eng.updateNode(n.id, { cuboid: resized });
                        });
                      }}
                    />
                    <span>Mirror UV X</span>
                  </label>
                </div>

                <div className="m3d-field-label">
                  <span>Face Visibility (Click to Cull/Show)</span>
                  <div className="m3d-face-chips">
                    {CUBOID_FACE_NAMES.map((fn) => {
                      const hidden = Boolean(activeNode.cuboid!.faces[fn].hidden);
                      return (
                        <button
                          key={fn}
                          type="button"
                          className={`m3d-face-chip ${hidden ? "hidden-face" : ""}`}
                          title={`${fn}: ${hidden ? "Hidden" : "Visible"}`}
                          onClick={() =>
                            mutateModel3D(`Toggle ${fn} Face`, (eng) => {
                              const n = eng.getNode(activeNode.id);
                              if (!n || !n.cuboid) return;
                              const next = cloneCuboidData(n.cuboid);
                              next.faces[fn].hidden = !next.faces[fn].hidden;
                              eng.updateNode(n.id, { cuboid: next });
                            })
                          }
                        >
                          {FACE_SHORT[fn]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="m3d-empty-hint">
            Select a node in the Outliner to inspect transform, pivot &amp; collider.
          </div>
        )}
      </div>

      {/* SECTION 3: Context Sub-Mode Panel */}
      {studio3d.subMode === "model" && (
        <div className="m3d-section">
          <div className="m3d-section-header">
            <span>Mesh Editing &amp; Symmetry</span>
            <span className="m3d-badge-mono">{engine.selectionGranularity}</span>
          </div>

          <span className="mode-hint">
            {engine.selectionGranularity === "object"
              ? "Object Mode — Tab enters Edit Mode. G / R / S grab, rotate, scale; B box select."
              : "Edit Mode — 1/2/3 vertex/edge/face · G/R/S transform · E extrude · I inset · Ctrl+B bevel · Ctrl+R loop cut · M merge · A all · X delete · Tab exits."}
          </span>

          {activeNode?.kind === "cuboid" && (
            <div className="m3d-list-card">
              <span className="mode-hint">
                Convert active cuboid to mesh to run extrude, inset, loop cut &amp; weld ops.
              </span>
              <button
                type="button"
                className="m3d-btn m3d-btn-primary"
                style={{ justifyContent: "center" }}
                onClick={() =>
                  mutateModel3D("Convert Cuboid to Mesh", (eng) => {
                    const n = eng.getNode(activeNode.id);
                    if (!n) return;
                    const converted = convertNodeCuboidToMesh(n);
                    const idx = eng.nodes.findIndex((x) => x.id === n.id);
                    if (idx >= 0) eng.nodes[idx] = converted;
                  })
                }
              >
                Convert Cuboid → Mesh
              </button>
            </div>
          )}

          {activeNode?.kind === "mesh" && activeNode.mesh && (
            <>
              <div className="m3d-inline-pair" style={{ alignItems: "end" }}>
                <label className="m3d-field-label">
                  <span>Extrude (px)</span>
                  <input
                    type="number"
                    step={1}
                    className="m3d-num-input"
                    value={extrudeDistPx}
                    onChange={(e) => setExtrudeDistPx(Number(e.target.value) || 0)}
                  />
                </label>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  style={{ height: 24 }}
                  onClick={() =>
                    runMeshOp("Extrude Faces", (mesh, selFaces) => {
                      const target =
                        selFaces.length > 0
                          ? selFaces
                          : mesh.faces.map((f) => f.id);
                      if (target.length === 0) return null;
                      return extrudeFaces(mesh, target, extrudeDistPx).mesh;
                    })
                  }
                >
                  Extrude Faces
                </button>
              </div>

              <div className="m3d-inline-pair" style={{ alignItems: "end" }}>
                <label className="m3d-field-label">
                  <span>Inset / Depth (px)</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      className="m3d-num-input"
                      aria-label="Inset Pixels"
                      value={insetPx}
                      onChange={(e) => setInsetPx(Math.max(0, Number(e.target.value) || 0))}
                    />
                    <input
                      type="number"
                      step={0.5}
                      className="m3d-num-input"
                      aria-label="Inset Depth Pixels"
                      value={insetDepthPx}
                      onChange={(e) => setInsetDepthPx(Number(e.target.value) || 0)}
                    />
                  </div>
                </label>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  style={{ height: 24 }}
                  onClick={() =>
                    runMeshOp("Inset Faces", (mesh, selFaces) => {
                      const target =
                        selFaces.length > 0
                          ? selFaces
                          : mesh.faces.map((f) => f.id);
                      if (target.length === 0) return null;
                      return insetFaces(mesh, target, insetPx, insetDepthPx).mesh;
                    })
                  }
                >
                  Inset Faces
                </button>
              </div>

              <div className="m3d-field-label">
                <span>Loop Cut / Subdivide Quads</span>
                <div className="m3d-btn-grid-3">
                  {(["u", "v", "both"] as const).map((axis) => (
                    <button
                      key={axis}
                      type="button"
                      className="m3d-btn-compact"
                      onClick={() =>
                        runMeshOp(`Subdivide (${axis.toUpperCase()})`, (mesh, selFaces) =>
                          subdivideFacesOrLoopCut(
                            mesh,
                            selFaces.length > 0 ? selFaces : undefined,
                            axis
                          )
                        )
                      }
                    >
                      Cut {axis === "both" ? "Both" : axis.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="m3d-inline-pair" style={{ alignItems: "end" }}>
                <label className="m3d-field-label">
                  <span>Weld Distance (px)</span>
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    className="m3d-num-input"
                    value={weldDistPx}
                    onChange={(e) => setWeldDistPx(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  style={{ height: 24 }}
                  onClick={() => {
                    let welded = 0;
                    runMeshOp("Weld Vertices", (mesh) => {
                      const res = weldVerticesByDistance(mesh, weldDistPx);
                      welded = res.weldedCount;
                      return res.mesh;
                    });
                    setStatusMessage(`Welded ${welded} duplicate vertex(es)`);
                  }}
                >
                  Weld by Dist
                </button>
              </div>

              <div className="m3d-btn-grid-2">
                <button
                  type="button"
                  className="m3d-btn-compact"
                  disabled={(engine.selectedVertices[activeNode.id]?.length ?? 0) < 2}
                  onClick={() =>
                    runMeshOp("Merge Selected Vertices", (mesh, _f, selVerts) =>
                      mergeVertices(mesh, selVerts, "center")
                    )
                  }
                >
                  Merge Selected Vtx
                </button>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  title="Ctrl+T"
                  onClick={() =>
                    runMeshOp("Flip Quad Diagonal", (mesh, selFaces) => {
                      const target =
                        selFaces.length > 0
                          ? selFaces
                          : mesh.faces
                              .filter((f) => f.verts.length === 4)
                              .map((f) => f.id);
                      return flipQuadDiagonal(mesh, target);
                    })
                  }
                >
                  Flip Quad (Ctrl+T)
                </button>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  onClick={() =>
                    runMeshOp("Flip Normals", (mesh, selFaces) =>
                      flipFaceNormals(
                        mesh,
                        selFaces.length > 0 ? selFaces : undefined
                      )
                    )
                  }
                >
                  Flip Normals
                </button>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  onClick={() =>
                    runMeshOp("Recalculate Outward Normals", (mesh) =>
                      recalculateOutwardNormals(mesh)
                    )
                  }
                >
                  Recalc Outward
                </button>
              </div>

              <div className="m3d-inline-pair" style={{ alignItems: "end" }}>
                <label className="m3d-field-label">
                  <span>Bevel (px)</span>
                  <input
                    type="number"
                    step={0.25}
                    min={0.1}
                    className="m3d-num-input"
                    value={bevelWidthPx}
                    onChange={(e) =>
                      setBevelWidthPx(Math.max(0.1, Number(e.target.value) || 0.5))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  style={{ height: 24 }}
                  disabled={
                    engine.selectionGranularity === "edge"
                      ? (engine.selectedEdges[activeNode.id]?.length ?? 0) === 0
                      : engine.selectionGranularity === "vertex"
                      ? (engine.selectedVertices[activeNode.id]?.length ?? 0) === 0
                      : true
                  }
                  title="Select edges (3) or vertices (2) to bevel"
                  onClick={() => {
                    const gran = engine.selectionGranularity;
                    const nodeId = activeNode.id;
                    if (gran === "edge") {
                      const selEdges = engine.selectedEdges[nodeId] ?? [];
                      if (selEdges.length === 0) return;
                      mutateModel3D("Bevel Edges", (eng) => {
                        const n = eng.getNode(nodeId);
                        if (!n || n.kind !== "mesh" || !n.mesh) return;
                        const res = bevelEdges(n.mesh, selEdges, bevelWidthPx);
                        eng.updateNode(nodeId, { mesh: res.mesh });
                        eng.selectedEdges[nodeId] = [];
                        eng.setSelectionGranularity("face");
                        eng.selectedFaces[nodeId] = res.bevelFaceIds;
                      });
                    } else if (gran === "vertex") {
                      const selVerts = engine.selectedVertices[nodeId] ?? [];
                      if (selVerts.length === 0) return;
                      mutateModel3D("Bevel Vertices", (eng) => {
                        const n = eng.getNode(nodeId);
                        if (!n || n.kind !== "mesh" || !n.mesh) return;
                        const res = bevelVertices(n.mesh, selVerts, bevelWidthPx);
                        eng.updateNode(nodeId, { mesh: res.mesh });
                        eng.selectedVertices[nodeId] = [];
                        eng.setSelectionGranularity("face");
                        eng.selectedFaces[nodeId] = res.bevelFaceIds;
                      });
                    }
                  }}
                >
                  Bevel
                </button>
              </div>

              <div className="m3d-btn-grid-2">
                <button
                  type="button"
                  className="m3d-btn-compact"
                  title="Extrude selected faces and switch gizmo to Move (Shift+E)"
                  disabled={(engine.selectedFaces[activeNode.id]?.length ?? 0) === 0}
                  onClick={() => {
                    const nodeId = activeNode.id;
                    const selFaces = engine.selectedFaces[nodeId] ?? [];
                    if (selFaces.length === 0) return;
                    const dist = Math.max(0.25, studio3d.snapPx || 1);
                    mutateModel3D("Quick Extrude Faces", (eng) => {
                      const n = eng.getNode(nodeId);
                      if (!n || n.kind !== "mesh" || !n.mesh) return;
                      const res = extrudeFaces(n.mesh, selFaces, dist);
                      eng.updateNode(nodeId, { mesh: res.mesh });
                      eng.setSelectionGranularity("face");
                      eng.selectedFaces[nodeId] = res.extrudedFaceIds;
                    });
                    patchStudio3D({ gizmoMode: "move" });
                  }}
                >
                  Quick Extrude (Shift+E)
                </button>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  title="Fill 3-4 vertices or bridge 2 edges (Shift+F)"
                  disabled={
                    engine.selectionGranularity === "vertex"
                      ? (engine.selectedVertices[activeNode.id]?.length ?? 0) < 3
                      : engine.selectionGranularity === "edge"
                      ? (engine.selectedEdges[activeNode.id]?.length ?? 0) !== 2
                      : true
                  }
                  onClick={() => {
                    const nodeId = activeNode.id;
                    const matId =
                      activeNode.mesh?.faces[0]?.materialId ??
                      engine.materials[0]?.id ??
                      DEFAULT_MODEL3D_MATERIAL_ID;
                    let created = 0;
                    mutateModel3D("Fill / Bridge Selection", (eng) => {
                      const n = eng.getNode(nodeId);
                      if (!n || n.kind !== "mesh" || !n.mesh) return;
                      const res = fillOrBridgeSelection(
                        n.mesh,
                        eng.selectionGranularity,
                        eng.selectedVertices[nodeId] ?? [],
                        eng.selectedEdges[nodeId] ?? [],
                        matId
                      );
                      created = res.createdFaceIds.length;
                      if (created > 0) {
                        eng.updateNode(nodeId, { mesh: res.mesh });
                        eng.setSelectionGranularity("face");
                        eng.selectedFaces[nodeId] = res.createdFaceIds;
                      }
                    });
                    setStatusMessage(
                      created > 0 ? "Created face from selection" : "Invalid fill/bridge selection"
                    );
                  }}
                >
                  Fill / Bridge (Shift+F)
                </button>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  title="Expand edge selection along quad loop (or Alt+Click edge)"
                  disabled={
                    engine.selectionGranularity !== "edge" ||
                    (engine.selectedEdges[activeNode.id]?.length ?? 0) === 0
                  }
                  onClick={() => {
                    const nodeId = activeNode.id;
                    const selEdges = engine.selectedEdges[nodeId] ?? [];
                    if (selEdges.length === 0 || !activeNode.mesh) return;
                    const loopSet = new Map<string, [number, number]>();
                    for (const ed of selEdges) {
                      for (const le of selectEdgeLoop(activeNode.mesh, ed)) {
                        loopSet.set(`${le[0]}:${le[1]}`, le);
                      }
                    }
                    engine.selectedEdges[nodeId] = Array.from(loopSet.values());
                    bumpModel3DVersion();
                  }}
                >
                  Edge Loop (Alt+Click)
                </button>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  title="Delete selected vertices, edges, or faces (Delete)"
                  disabled={
                    engine.selectionGranularity === "object" ||
                    (engine.selectionGranularity === "vertex" &&
                      (engine.selectedVertices[activeNode.id]?.length ?? 0) === 0) ||
                    (engine.selectionGranularity === "edge" &&
                      (engine.selectedEdges[activeNode.id]?.length ?? 0) === 0) ||
                    (engine.selectionGranularity === "face" &&
                      (engine.selectedFaces[activeNode.id]?.length ?? 0) === 0)
                  }
                  onClick={() => {
                    const nodeId = activeNode.id;
                    const gran = engine.selectionGranularity;
                    let deleted = 0;
                    mutateModel3D("Delete Mesh Elements", (eng) => {
                      const n = eng.getNode(nodeId);
                      if (!n || n.kind !== "mesh" || !n.mesh) return;
                      const res = deleteSelectedElements(
                        n.mesh,
                        gran,
                        eng.selectedVertices[nodeId] ?? [],
                        eng.selectedEdges[nodeId] ?? [],
                        eng.selectedFaces[nodeId] ?? []
                      );
                      deleted = res.deletedFaceCount;
                      eng.updateNode(nodeId, { mesh: res.mesh });
                      eng.selectedVertices[nodeId] = [];
                      eng.selectedEdges[nodeId] = [];
                      eng.selectedFaces[nodeId] = [];
                    });
                    setStatusMessage(`Deleted ${deleted} face(s)`);
                  }}
                >
                  Delete Elements
                </button>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  title="Separate selected faces into a new sibling mesh node"
                  disabled={(engine.selectedFaces[activeNode.id]?.length ?? 0) === 0}
                  onClick={() => {
                    const nodeId = activeNode.id;
                    const selFaces = engine.selectedFaces[nodeId] ?? [];
                    if (selFaces.length === 0) return;
                    let newId = "";
                    mutateModel3D("Separate Selected Faces", (eng) => {
                      const n = eng.getNode(nodeId);
                      if (!n || n.kind !== "mesh" || !n.mesh) return;
                      newId = `m3d-part-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                      const res = separateSelectedFaces(n, selFaces, newId);
                      if (!res.separated) return;
                      eng.updateNode(nodeId, { mesh: res.remaining.mesh });
                      eng.nodes.push(res.separated);
                      eng.selectedFaces[nodeId] = [];
                      eng.selectNodes([newId], newId);
                    });
                    if (newId) setStatusMessage("Separated faces into new mesh node");
                  }}
                >
                  Separate Faces
                </button>
                <button
                  type="button"
                  className="m3d-btn-compact"
                  title="Join 2+ selected mesh/cuboid nodes into active node"
                  disabled={engine.selectedNodeIds.length < 2}
                  onClick={() => {
                    const selIds = [...engine.selectedNodeIds];
                    const targetId = activeNode.id;
                    mutateModel3D("Join Selected Meshes", (eng) => {
                      const selectedNodes = selIds
                        .map((id) => eng.getNode(id))
                        .filter((n): n is ModelNode => Boolean(n && (n.kind === "mesh" || n.kind === "cuboid")));
                      if (selectedNodes.length < 2) return;
                      const joined = joinMeshNodes(selectedNodes, targetId);
                      if (!joined || !joined.mesh) return;
                      const idx = eng.nodes.findIndex((n) => n.id === targetId);
                      if (idx >= 0) eng.nodes[idx] = joined;
                      const removeIds = selectedNodes.filter((n) => n.id !== targetId).map((n) => n.id);
                      eng.deleteNodes(removeIds);
                      eng.selectNodes([targetId], targetId);
                    });
                    setStatusMessage(`Joined ${selIds.length} nodes into ${activeNode.name}`);
                  }}
                >
                  Join Selected
                </button>
              </div>
            </>
          )}

          <div className="m3d-sub-group">
            <div className="m3d-sub-title">Symmetry &amp; Scene Cleanup</div>
            <label className="m3d-checkbox-row">
              <input
                type="checkbox"
                checked={mirrorShareUv}
                onChange={(e) => setMirrorShareUv(e.target.checked)}
              />
              <span>Share Source UV on Mirror</span>
            </label>
            <div className="m3d-btn-grid-3">
              {(["x", "y", "z"] as const).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  className="m3d-btn-compact"
                  disabled={engine.selectedNodeIds.length === 0}
                  onClick={() => handleMirrorActiveNodes(axis)}
                >
                  <FlipHorizontal2 size={11} />
                  <span>Mirror {axis.toUpperCase()}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="m3d-btn"
              style={{ justifyContent: "center" }}
              disabled={engine.nodes.length === 0}
              onClick={handleCullInternalFaces}
            >
              <Scissors size={12} />
              <span>Cull Internal Coplanar Faces</span>
            </button>
          </div>
        </div>
      )}

      {studio3d.subMode === "tile" && (
        <div className="m3d-section">
          <div className="m3d-section-header">
            <span>Crocotile 3D Stamp</span>
            <span className="m3d-badge-mono">
              {engine.tileCursor.plane.toUpperCase()} · {engine.tileCursor.rotation}°
            </span>
          </div>

          <label className="m3d-field-label">
            <span>Active Tileset</span>
            <select
              className="m3d-select"
              value={activeTilesetIndex}
              onChange={(e) => {
                const idx = Number(e.target.value) || 0;
                setActiveTilesetIndex(idx);
                const ts = pixelEngine.tilesetRegistry.get(idx) ?? pixelEngine.tileset;
                const firstUid = ts.getMeta(1)?.uid ?? "tile-1";
                engine.patchTileCursor({
                  tilesetId: ts.id,
                  tileUid: firstUid,
                  cachedTileId: 1,
                  stepPx: ts.tileWidth,
                });
                setActiveTileId(1);
                bumpModel3DVersion();
              }}
            >
              {tilesets.map((ts, idx) => (
                <option key={ts.id} value={idx}>
                  {ts.name} ({ts.tileWidth}×{ts.tileHeight} · {ts.count} tiles)
                </option>
              ))}
            </select>
          </label>

          {/* Visual Tile Grid */}
          <div className="m3d-tile-grid" role="listbox" aria-label="Tileset Tiles">
            {Array.from({ length: activeTileset.count }, (_, idx) => {
              const tileId = idx + 1;
              const meta = activeTileset.getMeta(tileId);
              const uid = meta?.uid ?? `tile-${tileId}`;
              const isSelected =
                engine.tileCursor.tilesetId === activeTileset.id
                  ? engine.tileCursor.tileUid === uid
                  : activeTileId === tileId;
              return (
                <button
                  key={uid}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`m3d-tile-cell ${isSelected ? "active" : ""}`}
                  title={meta?.name ? `${meta.name} (#${tileId})` : `Tile #${tileId}`}
                  onClick={() => {
                    setActiveTileId(tileId);
                    engine.patchTileCursor({
                      tilesetId: activeTileset.id,
                      tileUid: uid,
                      cachedTileId: tileId,
                      stepPx: activeTileset.tileWidth,
                    });
                    bumpModel3DVersion();
                  }}
                >
                  <TileThumbCanvas
                    tileset={activeTileset}
                    tileId={tileId}
                    tilesetVersion={tilesetVersion}
                  />
                </button>
              );
            })}
          </div>

          {/* Cursor Plane & Position */}
          <div className="m3d-field-label">
            <span>Cursor Plane</span>
            <div className="m3d-btn-grid-3">
              {(
                [
                  { id: "xz", label: "Floor XZ" },
                  { id: "xy", label: "Wall XY" },
                  { id: "zy", label: "Wall ZY" },
                ] as const satisfies readonly { id: TileCursorPlane; label: string }[]
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`m3d-btn-compact ${engine.tileCursor.plane === p.id ? "active" : ""}`}
                  onClick={() => {
                    engine.patchTileCursor({ plane: p.id });
                    bumpModel3DVersion();
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="m3d-field-label">
            <span>Cursor Position [X, Y, Z] (px)</span>
            <div className="m3d-field-grid">
              {(["X", "Y", "Z"] as const).map((axis, idx) => (
                <input
                  key={axis}
                  type="number"
                  step={engine.tileCursor.stepPx || 16}
                  className="m3d-num-input"
                  aria-label={`Tile Cursor ${axis}`}
                  value={engine.tileCursor.position[idx]}
                  onChange={(e) => {
                    const nextPos: Vec3 = [...engine.tileCursor.position];
                    nextPos[idx] = Number(e.target.value) || 0;
                    engine.patchTileCursor({ position: nextPos });
                    bumpModel3DVersion();
                  }}
                />
              ))}
            </div>
          </div>

          <div className="m3d-btn-grid-4">
            <button
              type="button"
              className="m3d-btn-compact"
              onClick={() => {
                engine.patchTileCursor(cycleTileCursorPlane(engine.tileCursor));
                bumpModel3DVersion();
              }}
            >
              Plane
            </button>
            <button
              type="button"
              className="m3d-btn-compact"
              onClick={() => {
                engine.patchTileCursor(rotateTileCursorCW(engine.tileCursor));
                bumpModel3DVersion();
              }}
            >
              <RotateCw size={10} />
              <span>90°</span>
            </button>
            <button
              type="button"
              className={`m3d-btn-compact ${engine.tileCursor.flipX ? "active" : ""}`}
              onClick={() => {
                engine.patchTileCursor(flipTileCursor(engine.tileCursor, "x"));
                bumpModel3DVersion();
              }}
            >
              Flip X
            </button>
            <button
              type="button"
              className={`m3d-btn-compact ${engine.tileCursor.flipY ? "active" : ""}`}
              onClick={() => {
                engine.patchTileCursor(flipTileCursor(engine.tileCursor, "y"));
                bumpModel3DVersion();
              }}
            >
              Flip Y
            </button>
          </div>

          {/* Stamp Action & Depth */}
          <div className="m3d-field-label">
            <span>Stamp Action</span>
            <div className="m3d-btn-grid-3">
              <button
                type="button"
                className={`m3d-btn-compact ${studio3d.tileStampMode === "stamp" ? "active" : ""}`}
                onClick={() => patchStudio3D({ tileStampMode: "stamp" })}
              >
                Stamp Quad
              </button>
              <button
                type="button"
                className={`m3d-btn-compact ${studio3d.tileStampMode === "dragFill" ? "active" : ""}`}
                onClick={() => patchStudio3D({ tileStampMode: "dragFill" })}
              >
                Drag-Fill
              </button>
              <button
                type="button"
                className={`m3d-btn-compact ${studio3d.tileStampMode === "extrudeBlock" ? "active" : ""}`}
                onClick={() => patchStudio3D({ tileStampMode: "extrudeBlock" })}
              >
                Extrude
              </button>
            </div>
          </div>

          <div className="m3d-inline-pair" style={{ alignItems: "end" }}>
            <label className="m3d-field-label">
              <span>Depth (px)</span>
              <input
                type="number"
                step={4}
                className="m3d-num-input"
                value={studio3d.tileExtrudeDepthPx}
                onChange={(e) =>
                  patchStudio3D({
                    tileExtrudeDepthPx: Number(e.target.value) || 16,
                  })
                }
              />
            </label>
            <button
              type="button"
              className="m3d-btn m3d-btn-primary"
              style={{ justifyContent: "center", height: 24 }}
              onClick={handleStampHere}
            >
              Stamp Here
            </button>
          </div>

          {/* Architectural Shapers */}
          <div className="m3d-sub-group">
            <div className="m3d-sub-title">Architectural Shapers</div>
            <div className="m3d-btn-grid-2">
              <button
                type="button"
                className="m3d-btn-compact"
                onClick={() => handleStampSlope("slope45", "45° Slope")}
              >
                45° Slope
              </button>
              <button
                type="button"
                className="m3d-btn-compact"
                onClick={() => handleStampSlope("cornerInner", "Inner Corner")}
              >
                Inner Corner
              </button>
              <button
                type="button"
                className="m3d-btn-compact"
                onClick={() => handleStampSlope("cornerOuter", "Outer Corner")}
              >
                Outer Corner
              </button>
              <button
                type="button"
                className="m3d-btn-compact"
                onClick={() => handleStampSlope("stair2", "2-Step Stair")}
              >
                2-Step Stair
              </button>
            </div>
          </div>

          {/* 3D Prefab Stamps */}
          <div className="m3d-sub-group">
            <div className="m3d-list-card-row">
              <span className="m3d-sub-title">
                3D Prefabs ({engine.prefabs.length})
              </span>
              <select
                className="m3d-select"
                aria-label="Prefab Rotation"
                value={prefabRotDeg}
                onChange={(e) =>
                  setPrefabRotDeg(
                    (Number(e.target.value) as 0 | 90 | 180 | 270) || 0
                  )
                }
              >
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </div>
            <button
              type="button"
              className="m3d-btn-compact"
              onClick={handleCapturePrefab}
            >
              <Plus size={11} />
              <span>Capture Selected Faces as Prefab</span>
            </button>
            {engine.prefabs.length > 0 && (
              <div className="m3d-prefab-list">
                {engine.prefabs.map((pf) => (
                  <div key={pf.id} className="m3d-list-card">
                    <div className="m3d-list-card-row">
                      <span className="m3d-outliner-name">{pf.name}</span>
                      <div style={{ display: "flex", gap: 3 }}>
                        <button
                          type="button"
                          className="m3d-btn-compact"
                          onClick={() => {
                            mutateModel3D(`Stamp Prefab ${pf.name}`, (eng) => {
                              const matId =
                                eng.materials[0]?.id ?? DEFAULT_MODEL3D_MATERIAL_ID;
                              const target = ensureStampTargetMeshNode(
                                eng,
                                matId,
                                eng.activeNodeId
                              );
                              if (!target.mesh) return;
                              stampPrefabOntoMesh(
                                target.mesh,
                                pf,
                                eng.tileCursor.position,
                                prefabRotDeg,
                                true
                              );
                            });
                            setStatusMessage(
                              `Stamped prefab "${pf.name}" (${prefabRotDeg}°)`
                            );
                          }}
                        >
                          Stamp
                        </button>
                        <button
                          type="button"
                          className="icon-action-btn"
                          style={{ width: 20, height: 20 }}
                          title="Delete Prefab"
                          onClick={() =>
                            mutateModel3D(`Delete Prefab ${pf.name}`, (eng) => {
                              eng.prefabs = eng.prefabs.filter((x) => x.id !== pf.id);
                            })
                          }
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Retro Vertex Color / AO */}
          <div className="m3d-sub-group">
            <div className="m3d-sub-title">Retro Vertex Color / AO</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="color"
                className="m3d-color-input"
                aria-label="Vertex Tint Color"
                value={vertexTintHex}
                onChange={(e) => setVertexTintHex(e.target.value)}
              />
              <button
                type="button"
                className="m3d-btn-compact"
                style={{ flex: 1 }}
                disabled={!activeNode || activeNode.kind !== "mesh"}
                onClick={() => {
                  if (!activeNode || activeNode.kind !== "mesh" || !activeNode.mesh) {
                    return;
                  }
                  const nodeId = activeNode.id;
                  mutateModel3D("Tint Face Corners", (eng) => {
                    const n = eng.getNode(nodeId);
                    if (!n || !n.mesh) return;
                    const next = clonePolyMeshData(n.mesh);
                    const selFaces = eng.selectedFaces[nodeId] ?? [];
                    const targets =
                      selFaces.length > 0
                        ? selFaces
                        : next.faces.map((f) => f.id);
                    for (const fid of targets) {
                      paintFaceCornerColors(next, fid, vertexTintHex);
                    }
                    eng.updateNode(nodeId, { mesh: next });
                  });
                }}
              >
                Tint Selected Face Corners
              </button>
            </div>
            <button
              type="button"
              className="m3d-btn-compact"
              disabled={!activeNode || activeNode.kind !== "mesh"}
              onClick={() => {
                if (!activeNode || activeNode.kind !== "mesh" || !activeNode.mesh) {
                  return;
                }
                const nodeId = activeNode.id;
                let updatedFaces = 0;
                mutateModel3D("Apply Floor Contact AO", (eng) => {
                  const n = eng.getNode(nodeId);
                  if (!n || !n.mesh) return;
                  const next = clonePolyMeshData(n.mesh);
                  updatedFaces = applyFloorContactAo(next, 0, vertexTintHex, "#ffffff");
                  eng.updateNode(nodeId, { mesh: next });
                });
                setStatusMessage(`Applied Floor Contact AO to ${updatedFaces} face(s)`);
              }}
            >
              Apply Floor Contact AO
            </button>
          </div>
        </div>
      )}

      {studio3d.subMode === "uv" && (
        <div className="m3d-section">
          <div className="m3d-section-header">
            <span>Materials &amp; Pixel UVs</span>
            <span className="m3d-badge-mono">{engine.materials.length}</span>
          </div>

          <div className="m3d-btn-grid-2">
            <button
              type="button"
              className="m3d-btn-compact"
              onClick={() =>
                mutateModel3D("Add Draw Material", (eng) => {
                  const created = eng.addMaterial({
                    name: `Draw Mat ${eng.materials.length + 1}`,
                    source: { kind: "draw-canvas" },
                    doubleSided: false,
                    alphaTest: 0.5,
                    usePbrMaps: true,
                  });
                  setSelectedMatId(created.id);
                })
              }
            >
              <Plus size={11} />
              <span>+ Draw Material</span>
            </button>
            <button
              type="button"
              className="m3d-btn-compact"
              onClick={() =>
                mutateModel3D("Add Tileset Material", (eng) => {
                  const ts = activeTileset;
                  const created = eng.addMaterial({
                    name: `${ts.name} Mat`,
                    source: { kind: "tileset", tilesetId: ts.id },
                    doubleSided: false,
                    alphaTest: 0.5,
                    usePbrMaps: false,
                  });
                  setSelectedMatId(created.id);
                })
              }
            >
              <Grid size={11} />
              <span>+ Tileset Material</span>
            </button>
          </div>

          <div className="m3d-mat-list" role="listbox" aria-label="3D Materials">
            {engine.materials.map((mat) => {
              const selected = activeMaterial?.id === mat.id;
              return (
                <div
                  key={mat.id}
                  role="option"
                  aria-selected={selected}
                  className={`m3d-list-card ${selected ? "active" : ""}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedMatId(mat.id)}
                >
                  <div className="m3d-list-card-row">
                    <span className="m3d-outliner-name">{mat.name}</span>
                    <span className="m3d-outliner-kind">{mat.source.kind}</span>
                    {engine.materials.length > 1 && (
                      <button
                        type="button"
                        className="icon-action-btn"
                        style={{ width: 18, height: 18 }}
                        title="Delete Material"
                        onClick={(e) => {
                          e.stopPropagation();
                          mutateModel3D(`Delete Material ${mat.name}`, (eng) => {
                            eng.removeMaterial(mat.id);
                          });
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {activeMaterial && (
            <div className="m3d-sub-group">
              <label className="m3d-field-label">
                <span>Material Name</span>
                <input
                  type="text"
                  className="m3d-num-input"
                  value={activeMaterial.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    mutateModel3D("Rename Material", (eng) => {
                      eng.updateMaterial(activeMaterial.id, { name: val });
                    });
                  }}
                />
              </label>

              {activeMaterial.source.kind === "draw-canvas" && (
                <label className="m3d-field-label">
                  <span>Draw Layer Source</span>
                  <select
                    className="m3d-select"
                    value={activeMaterial.source.layerId ?? ""}
                    onChange={(e) => {
                      const layerId = e.target.value || undefined;
                      mutateModel3D("Set Material Draw Layer", (eng) => {
                        eng.updateMaterial(activeMaterial.id, {
                          source: { kind: "draw-canvas", layerId },
                        });
                      });
                    }}
                  >
                    <option value="">All Visible Albedo Layers</option>
                    {rasterLayers.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {activeMaterial.source.kind === "tileset" && (
                <label className="m3d-field-label">
                  <span>Tileset Source</span>
                  <select
                    className="m3d-select"
                    value={activeMaterial.source.tilesetId}
                    onChange={(e) => {
                      const tilesetId = e.target.value;
                      mutateModel3D("Set Material Tileset", (eng) => {
                        eng.updateMaterial(activeMaterial.id, {
                          source: { kind: "tileset", tilesetId },
                        });
                      });
                    }}
                  >
                    {tilesets.map((ts) => (
                      <option key={ts.id} value={ts.id}>
                        {ts.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {activeMaterial.source.kind === "node-graph" && (
                <label className="m3d-field-label">
                  <span>Node Graph Source</span>
                  <select
                    className="m3d-select"
                    value={activeMaterial.source.graphId}
                    onChange={(e) => {
                      const graphId = e.target.value;
                      mutateModel3D("Set Material Node Graph", (eng) => {
                        eng.updateMaterial(activeMaterial.id, {
                          source: { kind: "node-graph", graphId },
                        });
                      });
                    }}
                  >
                    {pixelEngine.nodes.graphs.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="m3d-inline-pair">
                <label className="m3d-checkbox-row">
                  <input
                    type="checkbox"
                    checked={activeMaterial.doubleSided}
                    onChange={(e) => {
                      const doubleSided = e.target.checked;
                      mutateModel3D("Toggle Double-Sided", (eng) => {
                        eng.updateMaterial(activeMaterial.id, { doubleSided });
                      });
                    }}
                  />
                  <span>Double-Sided</span>
                </label>

                <label className="m3d-checkbox-row">
                  <input
                    type="checkbox"
                    checked={activeMaterial.usePbrMaps}
                    onChange={(e) => {
                      const usePbrMaps = e.target.checked;
                      mutateModel3D("Toggle PBR Maps", (eng) => {
                        eng.updateMaterial(activeMaterial.id, { usePbrMaps });
                      });
                    }}
                  />
                  <span>PBR Maps</span>
                </label>
              </div>

              <label className="m3d-field-label">
                <span>Alpha Test Cutoff (0..1)</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  className="m3d-num-input"
                  value={activeMaterial.alphaTest}
                  onChange={(e) => {
                    const alphaTest = Math.max(
                      0,
                      Math.min(1, Number(e.target.value) || 0)
                    );
                    mutateModel3D("Set Material Alpha Test", (eng) => {
                      eng.updateMaterial(activeMaterial.id, { alphaTest });
                    });
                  }}
                />
              </label>

              <button
                type="button"
                className="m3d-btn m3d-btn-primary"
                style={{ justifyContent: "center" }}
                disabled={engine.selectedNodeIds.length === 0}
                onClick={() => handleAssignMaterialToSelected(activeMaterial.id)}
              >
                Assign Material to Selected Node / Faces
              </button>
            </div>
          )}

          <div className="m3d-sub-group">
            <div className="m3d-btn-grid-2">
              <button
                type="button"
                className="m3d-btn-compact"
                disabled={engine.nodes.length === 0}
                onClick={handleAutoPackUvs}
              >
                <Package size={11} />
                <span>Auto-Pack UVs (1px)</span>
              </button>
              <button
                type="button"
                className={`m3d-btn-compact ${studio3d.uvDrawerOpen ? "active" : ""}`}
                onClick={() =>
                  patchStudio3D({ uvDrawerOpen: !studio3d.uvDrawerOpen })
                }
              >
                <LayoutGrid size={11} />
                <span>Toggle 2D UV Drawer</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {studio3d.subMode === "paint" && (
        <>
          <div className="m3d-section">
            <div className="m3d-section-header">
              <span>3D Viewport Paint</span>
              <span className="m3d-badge-mono">{studio3d.paint3dTool}</span>
            </div>

            <div className="m3d-btn-grid-3">
              {(
                [
                  { id: "brush", label: "Brush" },
                  { id: "eraser", label: "Eraser" },
                  { id: "fillFace", label: "Fill Face" },
                  { id: "eyedropper", label: "Eyedropper" },
                  { id: "vertexColor", label: "Vertex Color" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`m3d-btn-compact ${studio3d.paint3dTool === t.id ? "active" : ""}`}
                  onClick={() => patchStudio3D({ paint3dTool: t.id })}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <label className="m3d-checkbox-row">
              <input
                type="checkbox"
                checked={studio3d.paint3dLockFace}
                onChange={(e) =>
                  patchStudio3D({ paint3dLockFace: e.target.checked })
                }
              />
              <span>Lock Stroke to Initial Face</span>
            </label>

            <label className="m3d-field-label">
              <span>Brush Size: {brushSize} px</span>
              <input
                type="range"
                min={1}
                max={8}
                step={1}
                value={Math.max(1, Math.min(8, brushSize))}
                onChange={(e) => setBrushSize(Number(e.target.value) || 1)}
              />
            </label>

            <div className="m3d-inline-pair">
              <label className="m3d-field-label">
                <span>Brush Shape</span>
                <div className="m3d-btn-grid-2">
                  <button
                    type="button"
                    className={`m3d-btn-compact ${brushShape === "square" ? "active" : ""}`}
                    onClick={() => setBrushShape("square")}
                  >
                    Square
                  </button>
                  <button
                    type="button"
                    className={`m3d-btn-compact ${brushShape === "circle" ? "active" : ""}`}
                    onClick={() => setBrushShape("circle")}
                  >
                    Circle
                  </button>
                </div>
              </label>

              <label className="m3d-field-label">
                <span>Opacity ({Math.round(brushOpacity)}%)</span>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={brushOpacity}
                  onChange={(e) => setBrushOpacity(Number(e.target.value) || 100)}
                />
              </label>
            </div>

            <div className="mode-hint">
              Active FG: <span className="m3d-badge-mono">{primaryColor}</span> · Alt+Drag to orbit
            </div>
          </div>

          <ColorPalettePanel />
        </>
      )}

      {studio3d.subMode === "animate" && (
        <div className="m3d-section">
          <div className="m3d-section-header">
            <span>Pivot Animation Clips</span>
            <span className="m3d-badge-mono">{engine.clips.length}</span>
          </div>

          <div className="m3d-btn-grid-2">
            <button
              type="button"
              className="m3d-btn-compact"
              onClick={() =>
                mutateModel3D("Create 3D Clip", (eng) => {
                  const clip = createModelClip(
                    `Clip ${eng.clips.length + 1}`,
                    Math.max(1, frames.length),
                    Math.max(1, fps),
                    true
                  );
                  eng.clips.push(clip);
                  eng.activeClipId = clip.id;
                })
              }
            >
              <Plus size={11} />
              <span>+ New Clip</span>
            </button>
            <button
              type="button"
              className="m3d-btn-compact"
              disabled={!activeClip}
              onClick={() => {
                if (!activeClip) return;
                mutateModel3D("Delete 3D Clip", (eng) => {
                  eng.clips = eng.clips.filter((c) => c.id !== activeClip.id);
                  if (eng.activeClipId === activeClip.id) {
                    eng.activeClipId = eng.clips[0]?.id ?? null;
                  }
                });
              }}
            >
              <Trash2 size={11} />
              <span>Delete Clip</span>
            </button>
          </div>

          {engine.clips.length > 0 && (
            <div className="m3d-clip-list" role="listbox" aria-label="3D Animation Clips">
              {engine.clips.map((clip) => {
                const isSel = activeClip?.id === clip.id;
                return (
                  <div
                    key={clip.id}
                    role="option"
                    aria-selected={isSel}
                    className={`m3d-list-card ${isSel ? "active" : ""}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      engine.activeClipId = clip.id;
                      bumpModel3DVersion();
                    }}
                  >
                    <div className="m3d-list-card-row">
                      <span className="m3d-outliner-name">{clip.name}</span>
                      <span className="m3d-badge-mono">
                        {clip.frameCount}f @ {clip.fps}fps
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeClip && (
            <div className="m3d-sub-group">
              <label className="m3d-field-label">
                <span>Clip Name</span>
                <input
                  type="text"
                  className="m3d-num-input"
                  value={activeClip.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    mutateModel3D("Rename 3D Clip", (eng) => {
                      const target = eng.clips.find((c) => c.id === activeClip.id);
                      if (target && name.trim()) target.name = name;
                    });
                  }}
                />
              </label>

              <div className="m3d-inline-pair">
                <label className="m3d-field-label">
                  <span>Frame Count</span>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    className="m3d-num-input"
                    value={activeClip.frameCount}
                    onChange={(e) => {
                      const frameCount = Math.max(1, Math.round(Number(e.target.value) || 1));
                      mutateModel3D("Set Clip Frame Count", (eng) => {
                        const target = eng.clips.find((c) => c.id === activeClip.id);
                        if (target) target.frameCount = frameCount;
                      });
                    }}
                  />
                </label>

                <label className="m3d-field-label">
                  <span>FPS</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className="m3d-num-input"
                    value={activeClip.fps}
                    onChange={(e) => {
                      const nextFps = Math.max(1, Math.round(Number(e.target.value) || 12));
                      mutateModel3D("Set Clip FPS", (eng) => {
                        const target = eng.clips.find((c) => c.id === activeClip.id);
                        if (target) target.fps = nextFps;
                      });
                    }}
                  />
                </label>
              </div>

              <label className="m3d-checkbox-row">
                <input
                  type="checkbox"
                  checked={activeClip.loop}
                  onChange={(e) => {
                    const loop = e.target.checked;
                    mutateModel3D("Toggle Clip Loop", (eng) => {
                      const target = eng.clips.find((c) => c.id === activeClip.id);
                      if (target) target.loop = loop;
                    });
                  }}
                />
                <span>Loop Clip</span>
              </label>
            </div>
          )}

          <div className="m3d-sub-group">
            <div className="m3d-btn-grid-2">
              <button
                type="button"
                className="m3d-btn m3d-btn-primary"
                style={{ justifyContent: "center" }}
                disabled={!activeNode}
                onClick={handleRecordKeyframe}
              >
                <KeyRound size={11} />
                <span>+ Keyframe (K)</span>
              </button>
              <button
                type="button"
                className="m3d-btn-compact"
                disabled={!activeClip}
                onClick={() => {
                  if (!activeClip) return;
                  mutateModel3D("Mirror Pose L↔R", (eng) => {
                    const idx = eng.clips.findIndex((c) => c.id === activeClip.id);
                    if (idx < 0) return;
                    eng.clips[idx] = mirrorClipPoseAtFrameLR(
                      eng.clips[idx],
                      eng.nodes,
                      currentFrame
                    );
                  });
                  setStatusMessage(
                    `Mirrored pose L↔R at frame ${currentFrame + 1}`
                  );
                }}
              >
                <FlipHorizontal2 size={11} />
                <span>Mirror Pose L↔R</span>
              </button>
            </div>

            <div className="m3d-inline-pair">
              <label className="m3d-checkbox-row">
                <input
                  type="checkbox"
                  checked={studio3d.autoKey3D}
                  onChange={(e) =>
                    patchStudio3D({ autoKey3D: e.target.checked })
                  }
                />
                <span>Auto-Key</span>
              </label>
              <label className="m3d-checkbox-row">
                <input
                  type="checkbox"
                  checked={onionSkin}
                  onChange={toggleOnionSkin}
                />
                <span>Onion Skin</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {studio3d.subMode === "bake" && (
        <div className="m3d-section">
          <div className="m3d-section-header">
            <span>3D Export &amp; 2D Baker</span>
          </div>

          <div className="m3d-sub-title">3D Game Export</div>
          <label className="m3d-field-label">
            <span>Scale Preset</span>
            <select
              className="m3d-select"
              value={exportScale}
              onChange={(e) =>
                setExportScale(e.target.value as ExportScalePreset)
              }
            >
              <option value="16px_1m">16 px = 1m (Godot / Unity)</option>
              <option value="1px_1m">1 px = 1m</option>
            </select>
          </label>

          <div className="m3d-inline-pair">
            <label className="m3d-checkbox-row">
              <input
                type="checkbox"
                checked={includeGodotColliders}
                onChange={(e) => setIncludeGodotColliders(e.target.checked)}
              />
              <span>Godot -col</span>
            </label>
            <label className="m3d-checkbox-row">
              <input
                type="checkbox"
                checked={triangulateObj}
                onChange={(e) => setTriangulateObj(e.target.checked)}
              />
              <span>Triangulate OBJ</span>
            </label>
          </div>

          <div className="m3d-btn-grid-3">
            <button
              type="button"
              className="m3d-btn m3d-btn-primary"
              style={{ justifyContent: "center" }}
              onClick={() => void downloadExportedModelAction("glb", exportOpts)}
            >
              <Download size={11} />
              <span>.GLB</span>
            </button>
            <button
              type="button"
              className="m3d-btn-compact"
              onClick={() => void downloadExportedModelAction("gltf", exportOpts)}
            >
              <span>.GLTF</span>
            </button>
            <button
              type="button"
              className="m3d-btn-compact"
              onClick={() => void downloadExportedModelAction("obj", exportOpts)}
            >
              <span>.OBJ + .MTL</span>
            </button>
          </div>

          <div className="m3d-sub-group">
            <div className="m3d-sub-title">3D → 2D Sprite &amp; Turntable Baker</div>

            <div className="m3d-inline-pair">
              <label className="m3d-field-label">
                <span>Render Pass</span>
                <select
                  className="m3d-select"
                  value={bakePass}
                  onChange={(e) => setBakePass(e.target.value as Model3DBakePass)}
                >
                  <option value="lit">Lit</option>
                  <option value="unlit">Unlit</option>
                  <option value="ps1">PS1</option>
                  <option value="normal">Normal</option>
                  <option value="depth">Depth</option>
                </select>
              </label>

              <label className="m3d-field-label">
                <span>Projection</span>
                <select
                  className="m3d-select"
                  value={bakeProjection}
                  onChange={(e) =>
                    setBakeProjection(e.target.value as Model3DBakeProjection)
                  }
                >
                  <option value="ortho">Ortho (Anti-Swim)</option>
                  <option value="persp">Perspective</option>
                </select>
              </label>
            </div>

            <div className="m3d-inline-pair">
              <label className="m3d-field-label">
                <span>Directions</span>
                <select
                  className="m3d-select"
                  value={bakeDirs}
                  onChange={(e) =>
                    setBakeDirs((Number(e.target.value) as 4 | 8 | 12 | 16) || 8)
                  }
                >
                  <option value={4}>4 Directions</option>
                  <option value={8}>8 Directions</option>
                  <option value={12}>12 Directions</option>
                  <option value={16}>16 Directions</option>
                </select>
              </label>

              <label className="m3d-field-label">
                <span>Pitch (deg)</span>
                <input
                  type="number"
                  min={-85}
                  max={85}
                  step={5}
                  className="m3d-num-input"
                  value={bakePitchDeg}
                  onChange={(e) => setBakePitchDeg(Number(e.target.value) || 0)}
                />
              </label>
            </div>

            <div className="m3d-inline-pair">
              <label className="m3d-field-label">
                <span>1px Outline</span>
                <select
                  className="m3d-select"
                  value={bakeOutline}
                  onChange={(e) =>
                    setBakeOutline(e.target.value as Model3DBakeOutline)
                  }
                >
                  <option value="none">None</option>
                  <option value="outside">Outside</option>
                  <option value="inside">Inside</option>
                </select>
              </label>

              <label className="m3d-field-label">
                <span>Tileset Rotations</span>
                <select
                  className="m3d-select"
                  value={bakeTilesetRots}
                  onChange={(e) =>
                    setBakeTilesetRots(Number(e.target.value) === 1 ? 1 : 4)
                  }
                >
                  <option value={1}>1 Rotation</option>
                  <option value={4}>4 Rotations</option>
                </select>
              </label>
            </div>

            <label className="m3d-checkbox-row">
              <input
                type="checkbox"
                checked={bakeAnimateClip}
                onChange={(e) => setBakeAnimateClip(e.target.checked)}
              />
              <span>Animate Active Clip</span>
            </label>

            <div className="m3d-inline-pair">
              <label className="m3d-checkbox-row">
                <input
                  type="checkbox"
                  checked={bakeQuantize}
                  onChange={(e) => setBakeQuantize(e.target.checked)}
                />
                <span>Quantize Palette</span>
              </label>
              <label className="m3d-checkbox-row">
                <input
                  type="checkbox"
                  checked={bakeDither}
                  onChange={(e) => setBakeDither(e.target.checked)}
                />
                <span>Bayer Dither</span>
              </label>
            </div>

            <button
              type="button"
              className="m3d-btn"
              style={{ justifyContent: "center" }}
              onClick={() => bakeModel3DToCurrentFrameAction(bakePostOpts)}
            >
              <Sparkles size={12} />
              <span>Bake View to Current Frame</span>
            </button>

            <button
              type="button"
              className="m3d-btn m3d-btn-primary"
              style={{ justifyContent: "center" }}
              onClick={() =>
                bakeModel3DTurntableAction({
                  ...bakePostOpts,
                  directions: bakeDirs,
                  animateActiveClip: bakeAnimateClip,
                })
              }
            >
              <Film size={12} />
              <span>Bake Multi-Dir Turntable</span>
            </button>

            <button
              type="button"
              className="m3d-btn"
              style={{ justifyContent: "center" }}
              onClick={() =>
                bakeModel3DToTilesetAction({
                  ...bakePostOpts,
                  rotations: bakeTilesetRots,
                })
              }
            >
              <Grid size={12} />
              <span>Bake 3D Chunk to Tileset ({bakeTilesetRots}×)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
