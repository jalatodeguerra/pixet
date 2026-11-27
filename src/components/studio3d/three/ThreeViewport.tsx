import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { Maximize2, Magnet } from "lucide-react";
import { collectUniqueEdges, edgeKey, type ScreenRect } from "../../../engine/model3d/boxSelect";
import {
  EDGE_PICK_RADIUS_PX,
  VERTEX_PICK_RADIUS_PX,
  isDepthVisible,
  pickNearestSegment,
  pickNearestVertex,
  toggleInList,
  type MaybeScreenPoint,
} from "../../../engine/model3d/pickSubElements";
import { describeSelectionCount } from "../../../engine/model3d/editMode";
import { pixelEngine } from "../../../engine/document/PixelEngine";
import { syncHistoryAndCelState } from "../../../engine/document/historyActions";
import {
  createModelClip,
  evaluateScenePosesAtFrame,
  recordNodeTransformKeyframes,
  type EvaluatedNodePose,
} from "../../../engine/model3d/animEval";
import { mutateModel3D } from "../../../engine/model3d/model3dActions";
import { clonePolyMeshData } from "../../../engine/model3d/Model3DEngine";
import {
  collectAffectedVertexIndices,
  computeVerticesCentroid,
  selectEdgeLoop,
  transformMeshVertices,
} from "../../../engine/model3d/meshOps";
import { getEvaluatedMesh } from "../../../engine/model3d/modifiers";
import { snapToGrid } from "../../../engine/model3d/quatMath";
import {
  buildPaddedTilesetAtlas,
  getTileQuadPixelUvs,
} from "../../../engine/model3d/tilesetAtlas";
import {
  dragFillTilePlane,
  ensureStampTargetMeshNode,
  extrudeTileBlockOnMesh,
  getTileCursorQuadCorners,
  stampTileQuadOnMesh,
} from "../../../engine/model3d/tileStamp";
import type {
  ModelAnimationClip,
  ModelNode,
  PolyFace,
  PolyMeshData,
  Quat,
  TileCursor3D,
  Vec3,
} from "../../../engine/model3d/types";
import { useEditorStore } from "../../../store/editorStore";
import { ModalOperatorController } from "./modalController";
import { registerModalBridge } from "./modalBridge";
import { Paint3DStrokeController } from "./paintRaycaster";
import { RetroMaterialCache, type MaterialTextureInfo } from "./retroMaterials";
import {
  collectSelectedSubObjectPositions,
  collectWorldSnapVertices,
  disposeSyncedObjectTree,
  objectTransformToNodeTransform,
  syncModel3DScene,
  updateMeshNodeGeometryInPlace,
  CAGE_PICK_FLAG,
  type MeshLookupUserData,
} from "./sceneSync";
import { threeStudioRuntime } from "./ThreeStudioRuntime";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function buildPixelFloorGrid(ppu: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "__m3d_floor_grid__";

  const safePpu = Math.max(1, ppu);
  const subStepPx = Math.max(1, Math.round(safePpu / 4));
  const majorStepPx = safePpu;
  const extentUnits = 8; // -8m..+8m (16m x 16m floor)
  const extentPx = Math.round(extentUnits * safePpu);

  const subVerts: number[] = [];
  const majorVerts: number[] = [];
  const axisXVerts: number[] = [];
  const axisZVerts: number[] = [];

  for (let px = -extentPx; px <= extentPx; px += subStepPx) {
    const coord = px / safePpu;
    if (px === 0) {
      // Z axis along X=0, X axis along Z=0
      axisZVerts.push(0, 0.002, -extentUnits, 0, 0.002, extentUnits);
      axisXVerts.push(-extentUnits, 0.002, 0, extentUnits, 0.002, 0);
    } else if (px % majorStepPx === 0) {
      majorVerts.push(coord, 0.001, -extentUnits, coord, 0.001, extentUnits);
      majorVerts.push(-extentUnits, 0.001, coord, extentUnits, 0.001, coord);
    } else {
      subVerts.push(coord, 0, -extentUnits, coord, 0, extentUnits);
      subVerts.push(-extentUnits, 0, coord, extentUnits, 0, coord);
    }
  }

  const addLines = (verts: number[], color: number) => {
    if (verts.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({ color });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    group.add(lines);
  };

  addLines(subVerts, 0x242424);
  addLines(majorVerts, 0x383838);
  addLines(axisXVerts, 0xb84a4a);
  addLines(axisZVerts, 0x4c8bf5);

  return group;
}

function disposeGroupGeometriesAndMaterials(group: THREE.Object3D): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Points) {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) {
        for (const m of obj.material) m.dispose();
      } else if (obj.material) {
        obj.material.dispose();
      }
    }
  });
}

const EDIT_ORANGE = 0xf5a623;
const EDIT_WIRE = 0x000000;

function pushTriangles(
  out: number[],
  f: PolyFace,
  vertices: THREE.Vector3[]
): void {
  if (f.verts.length < 3) return;
  const v0 = vertices[f.verts[0]];
  const v1 = vertices[f.verts[1]];
  const v2 = vertices[f.verts[2]];
  if (!v0 || !v1 || !v2) return;
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) =>
    out.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  if (f.verts.length === 3) {
    tri(v0, v1, v2);
    return;
  }
  const v3 = vertices[f.verts[3]];
  if (!v3) return;
  if ((f.triSplit ?? "02") === "02") {
    tri(v0, v1, v2);
    tri(v0, v2, v3);
  } else {
    tri(v0, v1, v3);
    tri(v1, v2, v3);
  }
}

/**
 * Blender-style Edit Mode overlay for the active mesh node: full base-mesh wire,
 * every vertex as a dot, selection in orange, selected faces tinted. Depth-tested
 * (faces are polygon-offset back) so wire and dots hide behind the surface.
 */
function buildSubObjectOverlay(
  nodeObjectById: Map<string, THREE.Object3D>,
  ppu: number
): THREE.Group {
  const overlay = new THREE.Group();
  overlay.name = "__m3d_subobject_overlay__";
  const engine = pixelEngine.model3d;
  const granularity = engine.selectionGranularity;
  if (granularity === "object") return overlay;

  const node = engine.activeNodeId ? engine.getNode(engine.activeNodeId) : undefined;
  if (!node || !node.visible || node.kind !== "mesh" || !node.mesh) return overlay;
  const obj = nodeObjectById.get(node.id);
  if (!obj) return overlay;

  const { vertices, facesById } = collectSelectedSubObjectPositions(node, obj, ppu);
  if (vertices.length === 0) return overlay;

  const selVerts = new Set(engine.selectedVertices[node.id] ?? []);
  const selEdgeKeys = new Set(
    (engine.selectedEdges[node.id] ?? []).map(([a, b]) => edgeKey(a, b))
  );
  const selFaces = engine.selectedFaces[node.id] ?? [];

  // Derive highlighted edges / verts from the active granularity like Blender does.
  const faceVerts = new Set<number>();
  const faceEdgeKeys = new Set<string>();
  const faceTris: number[] = [];
  if (granularity === "face") {
    for (const fId of selFaces) {
      const f = facesById.get(fId);
      if (!f) continue;
      pushTriangles(faceTris, f, vertices);
      for (let i = 0; i < f.verts.length; i++) {
        faceVerts.add(f.verts[i]);
        faceEdgeKeys.add(edgeKey(f.verts[i], f.verts[(i + 1) % f.verts.length]));
      }
    }
  }
  const edgeVerts = new Set<number>();
  for (const [a, b] of engine.selectedEdges[node.id] ?? []) {
    edgeVerts.add(a);
    edgeVerts.add(b);
  }
  const isVertSel = (vi: number) =>
    granularity === "vertex"
      ? selVerts.has(vi)
      : granularity === "edge"
        ? edgeVerts.has(vi)
        : faceVerts.has(vi);
  const isEdgeSel = (a: number, b: number) => {
    const k = edgeKey(a, b);
    if (granularity === "vertex") return selVerts.has(a) && selVerts.has(b);
    if (granularity === "edge") return selEdgeKeys.has(k);
    return faceEdgeKeys.has(k);
  };

  const darkEdges: number[] = [];
  const hotEdges: number[] = [];
  for (const [a, b] of collectUniqueEdges(node.mesh)) {
    const va = vertices[a];
    const vb = vertices[b];
    if (!va || !vb) continue;
    (isEdgeSel(a, b) ? hotEdges : darkEdges).push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
  }
  const darkVerts: number[] = [];
  const hotVerts: number[] = [];
  for (let vi = 0; vi < vertices.length; vi++) {
    const v = vertices[vi];
    (isVertSel(vi) ? hotVerts : darkVerts).push(v.x, v.y, v.z);
  }

  const addLines = (positions: number[], color: number, order: number) => {
    if (positions.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color, depthTest: true })
    );
    lines.renderOrder = order;
    lines.frustumCulled = false;
    overlay.add(lines);
  };
  const addPoints = (positions: number[], color: number, size: number, order: number) => {
    if (positions.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: true })
    );
    pts.renderOrder = order;
    pts.frustumCulled = false;
    overlay.add(pts);
  };

  if (faceTris.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(faceTris, 3));
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: EDIT_ORANGE,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    overlay.add(mesh);
  }
  addLines(darkEdges, EDIT_WIRE, 11);
  addLines(hotEdges, EDIT_ORANGE, 12);
  // Sizes are CSS px (three multiplies by the renderer pixel ratio). A light halo under the
  // dark dots and a black ring under the orange ones keep them readable on any face shade.
  addPoints(darkVerts, 0xd8d8d8, 10, 13);
  addPoints(darkVerts, 0x000000, 7, 14);
  addPoints(hotVerts, 0x000000, 14, 15);
  addPoints(hotVerts, EDIT_ORANGE, 10, 16);

  return overlay;
}

function pointToSegmentDistSq(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3
): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ap = new THREE.Vector3().subVectors(p, a);
  const lenSq = ab.lengthSq();
  if (lenSq <= 1e-12) return ap.lengthSq();
  const t = Math.max(0, Math.min(1, ap.dot(ab) / lenSq));
  const closest = a.clone().addScaledVector(ab, t);
  return closest.distanceToSquared(p);
}

function buildTileCursorOverlay(cursor: TileCursor3D, ppu: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "__m3d_tile_cursor__";
  const safePpu = Math.max(1, ppu);
  const corners = getTileCursorQuadCorners(cursor);
  const pts = corners.map(
    (c) => new THREE.Vector3(c[0] / safePpu, c[1] / safePpu, c[2] / safePpu)
  );

  // Quad perimeter wireframe
  const quadVerts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    quadVerts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(quadVerts, 3)
  );
  const quadMat = new THREE.LineBasicMaterial({
    color: 0x4c8bf5,
    depthTest: false,
  });
  const quadLines = new THREE.LineSegments(quadGeo, quadMat);
  quadLines.renderOrder = 15;
  group.add(quadLines);

  // Diagonal orientation notch on corner 0 -> center to hint tile rotation
  const center = new THREE.Vector3()
    .add(pts[0])
    .add(pts[1])
    .add(pts[2])
    .add(pts[3])
    .multiplyScalar(0.25);

  const normalVec =
    cursor.plane === "xz"
      ? new THREE.Vector3(0, 1, 0)
      : cursor.plane === "xy"
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(1, 0, 0);
  const normalTip = center
    .clone()
    .addScaledVector(normalVec, Math.max(0.25, (cursor.stepPx * 0.5) / safePpu));

  const auxVerts = [
    center.x,
    center.y,
    center.z,
    normalTip.x,
    normalTip.y,
    normalTip.z,
    pts[0].x,
    pts[0].y,
    pts[0].z,
    pts[0].x + (center.x - pts[0].x) * 0.35,
    pts[0].y + (center.y - pts[0].y) * 0.35,
    pts[0].z + (center.z - pts[0].z) * 0.35,
  ];
  const auxGeo = new THREE.BufferGeometry();
  auxGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(auxVerts, 3)
  );
  const auxMat = new THREE.LineBasicMaterial({
    color: 0x4cc38a,
    depthTest: false,
  });
  const auxLines = new THREE.LineSegments(auxGeo, auxMat);
  auxLines.renderOrder = 16;
  group.add(auxLines);

  // Subtle translucent fill so cursor quad is readable at grazing angles
  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        pts[0].x, pts[0].y, pts[0].z,
        pts[1].x, pts[1].y, pts[1].z,
        pts[2].x, pts[2].y, pts[2].z,
        pts[0].x, pts[0].y, pts[0].z,
        pts[2].x, pts[2].y, pts[2].z,
        pts[3].x, pts[3].y, pts[3].z,
      ],
      3
    )
  );
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x4c8bf5,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const fillMesh = new THREE.Mesh(fillGeo, fillMat);
  fillMesh.renderOrder = 14;
  group.add(fillMesh);

  return group;
}

function buildOnionSkinGhostGroup(
  nodes: readonly ModelNode[],
  clip: ModelAnimationClip,
  frame: number,
  ppu: number,
  colorHex: number
): THREE.Group {
  const ghostRoot = new THREE.Group();
  ghostRoot.name = `__m3d_onion_${frame}__`;
  const poses = evaluateScenePosesAtFrame(nodes, clip, frame);
  const ghostMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    wireframe: true,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });

  const safePpu = Math.max(1, ppu);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const objById = new Map<string, THREE.Object3D>();

  for (const node of nodes) {
    if (!node.visible) continue;
    let geo: THREE.BufferGeometry | null = null;
    const pivot = node.transform.pivot;

    if (node.kind === "cuboid" && node.cuboid) {
      const c = node.cuboid;
      const minX = Math.min(c.from[0], c.to[0]) - c.inflate;
      const minY = Math.min(c.from[1], c.to[1]) - c.inflate;
      const minZ = Math.min(c.from[2], c.to[2]) - c.inflate;
      const maxX = Math.max(c.from[0], c.to[0]) + c.inflate;
      const maxY = Math.max(c.from[1], c.to[1]) + c.inflate;
      const maxZ = Math.max(c.from[2], c.to[2]) + c.inflate;
      const w = Math.max(1e-4, (maxX - minX) / safePpu);
      const h = Math.max(1e-4, (maxY - minY) / safePpu);
      const d = Math.max(1e-4, (maxZ - minZ) / safePpu);
      geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(
        ((minX + maxX) * 0.5 - pivot[0]) / safePpu,
        ((minY + maxY) * 0.5 - pivot[1]) / safePpu,
        ((minZ + maxZ) * 0.5 - pivot[2]) / safePpu
      );
    } else if (node.kind === "mesh" && node.mesh && node.mesh.faces.length > 0) {
      const em = getEvaluatedMesh(node, "viewport") ?? node.mesh;
      const pos: number[] = [];
      for (const f of em.faces) {
        if (f.verts.length < 3) continue;
        const v0 = em.vertices[f.verts[0]];
        const v1 = em.vertices[f.verts[1]];
        const v2 = em.vertices[f.verts[2]];
        if (!v0 || !v1 || !v2) continue;
        const pushV = (v: Vec3) => {
          pos.push(
            (v[0] - pivot[0]) / safePpu,
            (v[1] - pivot[1]) / safePpu,
            (v[2] - pivot[2]) / safePpu
          );
        };
        if (f.verts.length === 3) {
          pushV(v0);
          pushV(v1);
          pushV(v2);
        } else {
          const v3 = em.vertices[f.verts[3]];
          if (!v3) continue;
          if (f.triSplit === "13") {
            pushV(v0);
            pushV(v1);
            pushV(v3);
            pushV(v1);
            pushV(v2);
            pushV(v3);
          } else {
            pushV(v0);
            pushV(v1);
            pushV(v2);
            pushV(v0);
            pushV(v2);
            pushV(v3);
          }
        }
      }
      if (pos.length > 0) {
        geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      }
    }

    const obj = geo ? new THREE.Mesh(geo, ghostMat) : new THREE.Group();
    obj.renderOrder = 8;
    objById.set(node.id, obj);
  }

  for (const node of nodes) {
    const obj = objById.get(node.id);
    if (!obj) continue;
    const parentNode = node.parentId ? nodeById.get(node.parentId) : undefined;
    const parentObj = parentNode ? objById.get(parentNode.id) : undefined;
    const pose = poses.get(node.id);
    const parentPose = parentNode ? poses.get(parentNode.id) : undefined;
    const nodePivot = pose ? pose.pivot : node.transform.pivot;
    const parentPivot: Vec3 = parentPose
      ? parentPose.pivot
      : parentNode
        ? parentNode.transform.pivot
        : [0, 0, 0];
    const localPos = pose ? pose.position : node.transform.position;
    const localScale = pose ? pose.scale : node.transform.scale;

    obj.position.set(
      (nodePivot[0] - parentPivot[0] + localPos[0]) / safePpu,
      (nodePivot[1] - parentPivot[1] + localPos[1]) / safePpu,
      (nodePivot[2] - parentPivot[2] + localPos[2]) / safePpu
    );
    if (pose) {
      obj.quaternion.set(
        pose.quaternion[0],
        pose.quaternion[1],
        pose.quaternion[2],
        pose.quaternion[3]
      );
    }
    obj.scale.set(localScale[0], localScale[1], localScale[2]);

    if (parentObj) {
      parentObj.add(obj);
    } else {
      ghostRoot.add(obj);
    }
  }

  return ghostRoot;
}

function snapTileCursorFromRay(
  clientX: number,
  clientY: number,
  host: HTMLDivElement,
  camera: THREE.Camera,
  pickableMeshes: THREE.Object3D[]
): Vec3 | null {
  const rect = host.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const engine = pixelEngine.model3d;
  const ppu = Math.max(1, engine.pixelsPerUnit);
  const cursor = engine.tileCursor;
  const step = Math.max(1, cursor.stepPx || 16);

  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);

  const hits = raycaster.intersectObjects(pickableMeshes, false);
  let hitWorld: THREE.Vector3 | null = null;
  if (hits.length > 0) {
    hitWorld = hits[0].point.clone();
    if (hits[0].face) {
      const worldNormal = hits[0].face.normal
        .clone()
        .transformDirection(hits[0].object.matrixWorld);
      hitWorld.addScaledVector(worldNormal, 0.001);
    }
  } else {
    const [cx, cy, cz] = cursor.position;
    let plane: THREE.Plane;
    if (cursor.plane === "xz") {
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -cy / ppu);
    } else if (cursor.plane === "xy") {
      plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -cz / ppu);
    } else {
      plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -cx / ppu);
    }
    const target = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, target)) {
      hitWorld = target;
    }
  }

  if (!hitWorld) return null;

  const px = hitWorld.x * ppu;
  const py = hitWorld.y * ppu;
  const pz = hitWorld.z * ppu;

  if (cursor.plane === "xz") {
    return [
      Math.floor(px / step) * step,
      Math.round(py / step) * step,
      Math.floor(pz / step) * step,
    ];
  }
  if (cursor.plane === "xy") {
    return [
      Math.floor(px / step) * step,
      Math.floor(py / step) * step,
      Math.round(pz / step) * step,
    ];
  }
  return [
    Math.round(px / step) * step,
    Math.floor(py / step) * step,
    Math.floor(pz / step) * step,
  ];
}

export function ThreeViewport() {
  const studio3d = useEditorStore((s) => s.studio3d);
  const patchStudio3D = useEditorStore((s) => s.patchStudio3D);
  const bumpModel3DVersion = useEditorStore((s) => s.bumpModel3DVersion);
  const model3dVersion = useEditorStore((s) => s.model3dVersion);
  const layers = useEditorStore((s) => s.layers);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const onionSkin = useEditorStore((s) => s.onionSkin);
  const primaryColor = useEditorStore((s) => s.primaryColor);
  const primaryAlpha = useEditorStore((s) => s.primaryAlpha);
  const brushSize = useEditorStore((s) => s.brushSize);
  const brushShape = useEditorStore((s) => s.brushShape);
  const brushOpacity = useEditorStore((s) => s.brushOpacity);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);

  const stageRef = useRef<HTMLDivElement>(null);
  const [vKeyHeld, setVKeyHeld] = useState(false);
  const vKeyHeldRef = useRef(false);
  const [sceneStats, setSceneStats] = useState({ nodeCount: 0, triangleCount: 0 });
  const [viewportRevision, setViewportRevision] = useState(0);
  // Render-on-demand: the main effect installs the real scheduler here. Anything
  // that changes what the scene looks like calls bumpViewport() (re-render + draw).
  const requestRenderRef = useRef<() => void>(() => {});
  const bumpViewport = useCallback(() => {
    setViewportRevision((v) => v + 1);
    requestRenderRef.current();
  }, []);
  const [webglError, setWebglError] = useState<string | null>(null);
  // Modal operator hint line and box-select rectangle (DOM overlays)
  const [modalHud, setModalHud] = useState<string | null>(null);
  const [boxRect, setBoxRect] = useState<ScreenRect | null>(null);
  const modalControllerRef = useRef<ModalOperatorController | null>(null);

  // Three.js scene objects owned by this component
  const sceneRef = useRef<THREE.Scene | null>(null);
  const perspCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const activeCameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(
    null
  );
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const materialCacheRef = useRef<RetroMaterialCache | null>(null);
  const textureSizeByMatRef = useRef<Map<string, MaterialTextureInfo>>(new Map());
  const paintControllerRef = useRef<Paint3DStrokeController>(new Paint3DStrokeController());

  const modelRootRef = useRef<THREE.Group | null>(null);
  const gridGroupRef = useRef<THREE.Group | null>(null);
  const subObjectOverlayRef = useRef<THREE.Group | null>(null);
  const tileCursorGroupRef = useRef<THREE.Group | null>(null);
  const onionSkinGroupRef = useRef<THREE.Group | null>(null);
  const snapIndicatorRef = useRef<THREE.Mesh | null>(null);

  const nodeObjectByIdRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const pickableMeshesRef = useRef<THREE.Mesh[]>([]);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);

  const sizeRef = useRef({ width: 640, height: 480 });
  const lastAppliedCameraPresetRef = useRef<string>("");
  const cameraSyncLockRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const tileDragStartCursorRef = useRef<TileCursor3D | null>(null);
  const isGizmoDraggingRef = useRef(false);
  const dragBeforeSnapRef = useRef<string | null>(null);
  const snapTargetsRef = useRef<THREE.Vector3[]>([]);
  const subElemProxyRef = useRef<THREE.Object3D | null>(null);
  const subElemDragRef = useRef<{
    nodeId: string;
    vertexIndices: number[];
    baseMesh: PolyMeshData;
    centroidPx: Vec3;
    startProxyPos: THREE.Vector3;
    startProxyQuat: THREE.Quaternion;
    startProxyScale: THREE.Vector3;
    nodeObj: THREE.Object3D;
  } | null>(null);

  const isOrthoMode =
    studio3d.gridMode === "isometric" || studio3d.perspective <= 0.001;

  // Track Hold V key for magnetic vertex snap
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "v" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const subMode = useEditorStore.getState().studio3d.subMode;
        if (subMode === "paint") return;
        if (!vKeyHeldRef.current) {
          vKeyHeldRef.current = true;
          setVKeyHeld(true);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "v") {
        if (vKeyHeldRef.current) {
          vKeyHeldRef.current = false;
          setVKeyHeld(false);
        }
      }
    };
    const onBlur = () => {
      if (vKeyHeldRef.current) {
        vKeyHeldRef.current = false;
        setVKeyHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const syncOrthoFrustum = useCallback(
    (ortho: THREE.OrthographicCamera, persp: THREE.PerspectiveCamera, width: number, height: number) => {
      const aspect = Math.max(0.1, width / Math.max(1, height));
      const target = orbitRef.current?.target ?? new THREE.Vector3(0, 0.5, 0);
      const dist = Math.max(0.5, persp.position.distanceTo(target));
      const halfH = Math.tan((persp.fov * DEG_TO_RAD) * 0.5) * dist;
      const halfW = halfH * aspect;
      ortho.left = -halfW;
      ortho.right = halfW;
      ortho.top = halfH;
      ortho.bottom = -halfH;
      ortho.updateProjectionMatrix();
    },
    []
  );

  const frameSelectionOrScene = useCallback(() => {
    const cam = activeCameraRef.current;
    const orbit = orbitRef.current;
    const persp = perspCameraRef.current;
    const ortho = orthoCameraRef.current;
    if (!cam || !orbit || !persp || !ortho) return;

    const engine = pixelEngine.model3d;
    const box = new THREE.Box3();
    const targetIds =
      engine.selectedNodeIds.length > 0
        ? engine.selectedNodeIds
        : engine.nodes.map((n) => n.id);

    for (const id of targetIds) {
      const obj = nodeObjectByIdRef.current.get(id);
      if (obj) {
        box.expandByObject(obj);
      }
    }

    const center = new THREE.Vector3(0, 0.5, 0);
    let radius = 1.4;
    if (!box.isEmpty()) {
      box.getCenter(center);
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      radius = Math.max(0.6, sphere.radius);
    }

    const dir = new THREE.Vector3().subVectors(cam.position, orbit.target);
    if (dir.lengthSq() < 1e-6) {
      dir.set(1, 0.75, 1.4);
    }
    dir.normalize();
    const dist = radius * 2.6;
    const nextPos = center.clone().addScaledVector(dir, dist);

    persp.position.copy(nextPos);
    ortho.position.copy(nextPos);
    orbit.target.copy(center);
    syncOrthoFrustum(ortho, persp, sizeRef.current.width, sizeRef.current.height);
    orbit.update();
    bumpViewport();
  }, [syncOrthoFrustum]);

  // Listen for F key to frame selection/scene
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.tagName === "SELECT")
      ) {
        return;
      }
      if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const st = useEditorStore.getState();
        if (
          st.workspaceMode === "studio3d" &&
          st.studio3d.workspaceKind === "lowpoly3d" &&
          st.studio3d.subMode !== "tile"
        ) {
          e.preventDefault();
          frameSelectionOrScene();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [frameSelectionOrScene]);

  // Initialize singleton WebGL canvas, Scene, Cameras, OrbitControls, TransformControls
  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = threeStudioRuntime.getRenderer();
    } catch (err) {
      setWebglError(err instanceof Error ? err.message : String(err));
      return;
    }
    const canvas = threeStudioRuntime.attachCanvas(host);
    const rect = host.getBoundingClientRect();
    const initW = Math.max(1, Math.round(rect.width || 640));
    const initH = Math.max(1, Math.round(rect.height || 480));
    sizeRef.current = { width: initW, height: initH };
    threeStudioRuntime.setViewportSize(initW, initH);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x171717);
    sceneRef.current = scene;

    const aspect = initW / initH;
    const persp = new THREE.PerspectiveCamera(45, aspect, 0.05, 500);
    persp.position.set(2.4, 2.0, 3.2);
    perspCameraRef.current = persp;

    const ortho = new THREE.OrthographicCamera(
      -2 * aspect,
      2 * aspect,
      2,
      -2,
      -100,
      500
    );
    ortho.position.copy(persp.position);
    orthoCameraRef.current = ortho;

    const initialOrtho =
      useEditorStore.getState().studio3d.gridMode === "isometric" ||
      useEditorStore.getState().studio3d.perspective <= 0.001;
    const activeCam: THREE.PerspectiveCamera | THREE.OrthographicCamera = initialOrtho
      ? ortho
      : persp;
    activeCameraRef.current = activeCam;

    // Studio Lighting
    const ambient = new THREE.AmbientLight(0x8ca0c8, 0.75);
    scene.add(ambient);
    ambientLightRef.current = ambient;

    const hemi = new THREE.HemisphereLight(0xdbe7ff, 0x2a2d36, 0.45);
    scene.add(hemi);
    hemiLightRef.current = hemi;

    const dirLight = new THREE.DirectionalLight(0xfff4d6, 1.35);
    dirLight.position.set(-4, 6, 5);
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    // Snap indicator dot
    const snapGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const snapMat = new THREE.MeshBasicMaterial({
      color: 0x4cc38a,
      depthTest: false,
    });
    const snapMesh = new THREE.Mesh(snapGeo, snapMat);
    snapMesh.visible = false;
    snapMesh.renderOrder = 20;
    scene.add(snapMesh);
    snapIndicatorRef.current = snapMesh;

    const materialCache = new RetroMaterialCache();
    materialCacheRef.current = materialCache;

    const orbit = new OrbitControls(activeCam, canvas);
    orbit.enableDamping = false;
    orbit.screenSpacePanning = true;
    orbit.target.set(0, 0.4, 0);
    orbit.minDistance = 0.25;
    orbit.maxDistance = 120;
    orbit.update();
    orbitRef.current = orbit;

    const onOrbitChange = () => {
      requestRenderRef.current();
      if (cameraSyncLockRef.current) return;
      const c = activeCameraRef.current;
      if (!c) return;
      const offset = new THREE.Vector3().subVectors(c.position, orbit.target);
      const radius = offset.length();
      if (radius > 1e-5) {
        const yawRad = Math.atan2(offset.x, offset.z);
        const pitchRad = Math.asin(Math.max(-1, Math.min(1, offset.y / radius)));
        const yawDeg = Math.round(yawRad * RAD_TO_DEG);
        const pitchDeg = Math.round(pitchRad * RAD_TO_DEG);
        lastAppliedCameraPresetRef.current = `${yawDeg}:${pitchDeg}`;
        // Sync persp/ortho twin positions
        persp.position.copy(c.position);
        ortho.position.copy(c.position);
        persp.lookAt(orbit.target);
        ortho.lookAt(orbit.target);
        if (c === persp) {
          syncOrthoFrustum(ortho, persp, sizeRef.current.width, sizeRef.current.height);
        }
      }
      bumpViewport();
    };
    orbit.addEventListener("change", onOrbitChange);

    const transform = new TransformControls(activeCam, canvas);
    transform.setSpace("local");
    transform.setSize(0.85);
    const helper = transform.getHelper();
    scene.add(helper);
    transformRef.current = transform;

    const subElemProxy = new THREE.Object3D();
    subElemProxy.name = "__m3d_subelem_proxy__";
    scene.add(subElemProxy);
    subElemProxyRef.current = subElemProxy;

    const onDraggingChanged = (event: { value: unknown }) => {
      const dragging = Boolean(event.value);
      isGizmoDraggingRef.current = dragging;
      orbit.enabled = !dragging;

      const engine = pixelEngine.model3d;
      const activeId = engine.activeNodeId;
      if (dragging) {
        dragBeforeSnapRef.current =
          pixelEngine.model3dHistory.captureSnapshot(engine);
        snapTargetsRef.current = activeId
          ? collectWorldSnapVertices(engine, [activeId])
          : [];
        const attached = transform.object;
        if (attached?.userData?.isSubElemProxy) {
          const targetNodeId = attached.userData.nodeId as string | undefined;
          const targetNode = targetNodeId ? engine.getNode(targetNodeId) : undefined;
          const nodeObj = targetNodeId ? nodeObjectByIdRef.current.get(targetNodeId) : undefined;
          if (targetNode && targetNode.kind === "mesh" && targetNode.mesh && nodeObj) {
            const verts = collectAffectedVertexIndices(
              targetNode.mesh,
              engine.selectionGranularity,
              engine.selectedVertices[targetNode.id] ?? [],
              engine.selectedEdges[targetNode.id] ?? [],
              engine.selectedFaces[targetNode.id] ?? []
            );
            const centroidPx = computeVerticesCentroid(targetNode.mesh.vertices, verts);
            if (verts.length > 0 && centroidPx) {
              subElemDragRef.current = {
                nodeId: targetNode.id,
                vertexIndices: verts,
                baseMesh: clonePolyMeshData(targetNode.mesh),
                centroidPx,
                startProxyPos: attached.position.clone(),
                startProxyQuat: attached.quaternion.clone(),
                startProxyScale: attached.scale.clone(),
                nodeObj,
              };
            }
          }
        }
      } else {
        const wasSubElemDrag = subElemDragRef.current !== null;
        subElemDragRef.current = null;
        if (snapIndicatorRef.current) {
          snapIndicatorRef.current.visible = false;
        }
        if (dragBeforeSnapRef.current !== null) {
          const stNow = useEditorStore.getState();
          const st3d = stNow.studio3d;
          const draggedNode = activeId ? engine.getNode(activeId) : undefined;
          if (
            !wasSubElemDrag &&
            st3d.subMode === "animate" &&
            st3d.autoKey3D &&
            draggedNode &&
            !draggedNode.locked
          ) {
            let clip =
              engine.clips.find((c) => c.id === engine.activeClipId) ??
              engine.clips[0];
            if (!clip) {
              clip = createModelClip(
                "Clip 1",
                Math.max(1, stNow.frames.length),
                Math.max(1, stNow.fps),
                true
              );
              engine.clips.push(clip);
              engine.activeClipId = clip.id;
            }
            const updatedClip = recordNodeTransformKeyframes(
              clip,
              draggedNode,
              stNow.currentFrame
            );
            const idx = engine.clips.findIndex((c) => c.id === updatedClip.id);
            if (idx >= 0) {
              engine.clips[idx] = updatedClip;
            }
          }
          const afterSnap = pixelEngine.model3dHistory.captureSnapshot(engine);
          if (afterSnap !== dragBeforeSnapRef.current) {
            const actionLabel = wasSubElemDrag
              ? "Transform 3D Sub-Elements"
              : st3d.subMode === "animate" && st3d.autoKey3D
                ? "Transform & Auto-Key 3D Node"
                : "Transform 3D Node";
            pixelEngine.model3dHistory.pushUndo(
              dragBeforeSnapRef.current,
              actionLabel
            );
            pixelEngine.undoCoordinator.record("model3d", actionLabel);
            stNow.bumpModel3DVersion();
            pixelEngine.emitChange();
            syncHistoryAndCelState();
          }
          dragBeforeSnapRef.current = null;
        }
        snapTargetsRef.current = [];
      }
      bumpViewport();
    };

    const onObjectChange = () => {
      const attachedObj = transform.object;
      if (!attachedObj) return;

      if (attachedObj.userData?.isSubElemProxy) {
        const drag = subElemDragRef.current;
        if (!drag) return;
        const engine = pixelEngine.model3d;
        const node = engine.getNode(drag.nodeId);
        if (!node || node.locked || node.kind !== "mesh" || !node.mesh) return;

        const ppu = Math.max(1, engine.pixelsPerUnit);
        const stNow = useEditorStore.getState();
        const snapPx = Math.max(0.05, stNow.studio3d.snapPx || 1);

        drag.nodeObj.updateMatrixWorld(true);
        const worldQuat = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        drag.nodeObj.getWorldQuaternion(worldQuat);
        drag.nodeObj.getWorldScale(worldScale);

        const invNodeQuat = worldQuat.clone().invert();
        const worldDelta = attachedObj.position.clone().sub(drag.startProxyPos);
        const localDelta = worldDelta.clone().applyQuaternion(invNodeQuat);
        const sx = Math.abs(worldScale.x) > 1e-6 ? worldScale.x : 1;
        const sy = Math.abs(worldScale.y) > 1e-6 ? worldScale.y : 1;
        const sz = Math.abs(worldScale.z) > 1e-6 ? worldScale.z : 1;

        let tx = (localDelta.x / sx) * ppu;
        let ty = (localDelta.y / sy) * ppu;
        let tz = (localDelta.z / sz) * ppu;
        if (transform.mode === "translate" && !vKeyHeldRef.current) {
          tx = snapToGrid(tx, snapPx);
          ty = snapToGrid(ty, snapPx);
          tz = snapToGrid(tz, snapPx);
        }

        const deltaRotQ = drag.startProxyQuat
          .clone()
          .invert()
          .multiply(attachedObj.quaternion);
        const rotQuat: Quat = [deltaRotQ.x, deltaRotQ.y, deltaRotQ.z, deltaRotQ.w];

        const relScale: Vec3 = [
          Math.abs(drag.startProxyScale.x) > 1e-6
            ? attachedObj.scale.x / drag.startProxyScale.x
            : 1,
          Math.abs(drag.startProxyScale.y) > 1e-6
            ? attachedObj.scale.y / drag.startProxyScale.y
            : 1,
          Math.abs(drag.startProxyScale.z) > 1e-6
            ? attachedObj.scale.z / drag.startProxyScale.z
            : 1,
        ];

        node.mesh = transformMeshVertices(drag.baseMesh, drag.vertexIndices, {
          translation: [tx, ty, tz],
          rotationQuat: rotQuat,
          scale: relScale,
          pivot: drag.centroidPx,
        });

        updateMeshNodeGeometryInPlace(drag.nodeObj, node, ppu, {
          textureSizeByMaterialId: textureSizeByMatRef.current,
          defaultTextureWidth: Math.max(1, stNow.canvasWidth),
          defaultTextureHeight: Math.max(1, stNow.canvasHeight),
        });

        if (subObjectOverlayRef.current) {
          disposeGroupGeometriesAndMaterials(subObjectOverlayRef.current);
          scene.remove(subObjectOverlayRef.current);
          subObjectOverlayRef.current = null;
        }
        const nextOverlay = buildSubObjectOverlay(nodeObjectByIdRef.current, ppu);
        scene.add(nextOverlay);
        subObjectOverlayRef.current = nextOverlay;
        bumpViewport();
        return;
      }

      const nodeId = attachedObj.userData?.nodeId as string | undefined;
      if (!nodeId) return;

      const engine = pixelEngine.model3d;
      const node = engine.getNode(nodeId);
      if (!node || node.locked) return;

      const ppu = Math.max(1, engine.pixelsPerUnit);
      const parentNode = node.parentId ? engine.getNode(node.parentId) : undefined;
      const st = useEditorStore.getState().studio3d;
      const snapPx = Math.max(0.05, st.snapPx || 1);

      // Hold V magnetic vertex snapping during move drag
      if (
        transform.mode === "translate" &&
        vKeyHeldRef.current &&
        snapTargetsRef.current.length > 0
      ) {
        attachedObj.updateMatrixWorld(true);
        const worldPos = new THREE.Vector3();
        attachedObj.getWorldPosition(worldPos);
        let bestTarget: THREE.Vector3 | null = null;
        let bestDistSq = (12 / ppu) * (12 / ppu);
        for (const pt of snapTargetsRef.current) {
          const dSq = pt.distanceToSquared(worldPos);
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestTarget = pt;
          }
        }
        if (bestTarget) {
          const parentObj = attachedObj.parent;
          if (parentObj) {
            parentObj.updateMatrixWorld(true);
            const localPos = bestTarget.clone();
            parentObj.worldToLocal(localPos);
            attachedObj.position.copy(localPos);
          } else {
            attachedObj.position.copy(bestTarget);
          }
          if (snapIndicatorRef.current) {
            snapIndicatorRef.current.position.copy(bestTarget);
            snapIndicatorRef.current.visible = true;
          }
        } else if (snapIndicatorRef.current) {
          snapIndicatorRef.current.visible = false;
        }
      } else if (snapIndicatorRef.current) {
        snapIndicatorRef.current.visible = false;
      }

      const nextTr = objectTransformToNodeTransform(
        attachedObj,
        node,
        parentNode,
        ppu
      );

      if (transform.mode === "translate" && !vKeyHeldRef.current) {
        nextTr.position = [
          snapToGrid(nextTr.position[0], snapPx),
          snapToGrid(nextTr.position[1], snapPx),
          snapToGrid(nextTr.position[2], snapPx),
        ];
        // Re-align Three object to snapped pixel coordinates so gizmo stays locked
        const parentPivot: Vec3 = parentNode ? parentNode.transform.pivot : [0, 0, 0];
        attachedObj.position.set(
          (node.transform.pivot[0] - parentPivot[0] + nextTr.position[0]) / ppu,
          (node.transform.pivot[1] - parentPivot[1] + nextTr.position[1]) / ppu,
          (node.transform.pivot[2] - parentPivot[2] + nextTr.position[2]) / ppu
        );
      }

      // Mutate node transform directly at 60fps without rebuilding BufferGeometry mid-drag
      node.transform.position = nextTr.position;
      node.transform.rotation = nextTr.rotation;
      node.transform.scale = nextTr.scale;
      attachedObj.updateMatrixWorld(true);
      bumpViewport();
    };

    transform.addEventListener("dragging-changed", onDraggingChanged);
    transform.addEventListener("objectChange", onObjectChange);

    // ResizeObserver keeps singleton WebGLRenderer sized to host container
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(1, Math.round(entry.contentRect.width));
      const h = Math.max(1, Math.round(entry.contentRect.height));
      if (w === sizeRef.current.width && h === sizeRef.current.height) return;
      sizeRef.current = { width: w, height: h };
      threeStudioRuntime.setViewportSize(w, h);
      persp.aspect = w / h;
      persp.updateProjectionMatrix();
      syncOrthoFrustum(ortho, persp, w, h);
      bumpViewport();
    });
    ro.observe(host);

    // Render on demand: draw at most once per animation frame, and only after
    // something requested it. There is no continuous loop; playback and
    // animation advance through the store, which re-renders this component.
    let rafId = 0;
    let disposed = false;
    const renderFrame = () => {
      rafId = 0;
      const cam = activeCameraRef.current;
      if (disposed || !cam || threeStudioRuntime.isContextLost()) return;
      renderer.render(scene, cam);
      if (import.meta.env.DEV) {
        const w = window as unknown as { __pixetRenders?: number };
        w.__pixetRenders = (w.__pixetRenders ?? 0) + 1;
      }
    };
    const requestRender = () => {
      if (rafId !== 0 || disposed) return;
      rafId = requestAnimationFrame(renderFrame);
    };
    requestRenderRef.current = requestRender;
    transform.addEventListener("change", requestRender);
    canvas.addEventListener("webglcontextrestored", requestRender);
    requestRender();

    return () => {
      paintControllerRef.current.cancelStroke();
      disposed = true;
      requestRenderRef.current = () => {};
      if (rafId !== 0) cancelAnimationFrame(rafId);
      transform.removeEventListener("change", requestRender);
      canvas.removeEventListener("webglcontextrestored", requestRender);
      ro.disconnect();
      orbit.removeEventListener("change", onOrbitChange);
      transform.removeEventListener("dragging-changed", onDraggingChanged);
      transform.removeEventListener("objectChange", onObjectChange);
      transform.detach();
      transform.dispose();
      orbit.dispose();
      scene.remove(helper);
      if (subElemProxyRef.current) {
        scene.remove(subElemProxyRef.current);
        subElemProxyRef.current = null;
      }
      if (modelRootRef.current) {
        disposeSyncedObjectTree(modelRootRef.current);
        scene.remove(modelRootRef.current);
        modelRootRef.current = null;
      }
      if (gridGroupRef.current) {
        disposeGroupGeometriesAndMaterials(gridGroupRef.current);
        scene.remove(gridGroupRef.current);
        gridGroupRef.current = null;
      }
      if (subObjectOverlayRef.current) {
        disposeGroupGeometriesAndMaterials(subObjectOverlayRef.current);
        scene.remove(subObjectOverlayRef.current);
        subObjectOverlayRef.current = null;
      }
      if (tileCursorGroupRef.current) {
        disposeGroupGeometriesAndMaterials(tileCursorGroupRef.current);
        scene.remove(tileCursorGroupRef.current);
        tileCursorGroupRef.current = null;
      }
      if (onionSkinGroupRef.current) {
        disposeGroupGeometriesAndMaterials(onionSkinGroupRef.current);
        scene.remove(onionSkinGroupRef.current);
        onionSkinGroupRef.current = null;
      }
      if (snapIndicatorRef.current) {
        snapIndicatorRef.current.geometry.dispose();
        (snapIndicatorRef.current.material as THREE.Material).dispose();
        scene.remove(snapIndicatorRef.current);
        snapIndicatorRef.current = null;
      }
      materialCache.dispose();
      materialCacheRef.current = null;
      threeStudioRuntime.detachCanvas(host);
    };
  }, [syncOrthoFrustum]);

  const rebuildSubObjectOverlay = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (subObjectOverlayRef.current) {
      disposeGroupGeometriesAndMaterials(subObjectOverlayRef.current);
      scene.remove(subObjectOverlayRef.current);
      subObjectOverlayRef.current = null;
    }
    const next = buildSubObjectOverlay(
      nodeObjectByIdRef.current,
      Math.max(1, pixelEngine.model3d.pixelsPerUnit)
    );
    scene.add(next);
    subObjectOverlayRef.current = next;
  }, []);

  // Blender-style modal operators (G/R/S, E, I, Ctrl+B) and box select (B).
  // App.tsx requests them through the modal bridge; the controller owns the
  // keyboard/pointer while one is active.
  useEffect(() => {
    const controller = new ModalOperatorController({
      getHost: () => stageRef.current,
      getCamera: () => activeCameraRef.current,
      getOrbit: () => orbitRef.current,
      getTransform: () => transformRef.current,
      getScene: () => sceneRef.current,
      getNodeObjects: () => nodeObjectByIdRef.current,
      getTextureInfo: () => textureSizeByMatRef.current,
      rebuildOverlay: rebuildSubObjectOverlay,
      requestRender: () => requestRenderRef.current(),
      setHud: setModalHud,
      setBoxRect,
    });
    modalControllerRef.current = controller;
    const unregister = registerModalBridge(controller);
    return () => {
      unregister();
      controller.dispose();
      modalControllerRef.current = null;
    };
  }, [rebuildSubObjectOverlay]);

  // Adjust OrbitControls mouse button bindings so Paint/Tile left-drag doesn't rotate camera (Alt+Left, Middle, Right still work)
  useEffect(() => {
    const orbit = orbitRef.current;
    if (!orbit) return;
    if (studio3d.subMode === "paint" || studio3d.subMode === "tile") {
      orbit.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
    } else {
      orbit.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
    }
  }, [studio3d.subMode]);

  // Switch Perspective <-> Orthographic camera when gridMode / perspective changes
  useEffect(() => {
    const persp = perspCameraRef.current;
    const ortho = orthoCameraRef.current;
    const orbit = orbitRef.current;
    const transform = transformRef.current;
    if (!persp || !ortho || !orbit || !transform) return;

    const targetCam: THREE.PerspectiveCamera | THREE.OrthographicCamera = isOrthoMode
      ? ortho
      : persp;
    if (activeCameraRef.current !== targetCam) {
      const prevCam = activeCameraRef.current ?? persp;
      targetCam.position.copy(prevCam.position);
      targetCam.quaternion.copy(prevCam.quaternion);
      if (targetCam === ortho) {
        syncOrthoFrustum(ortho, persp, sizeRef.current.width, sizeRef.current.height);
      }
      activeCameraRef.current = targetCam;
      orbit.object = targetCam;
      transform.camera = targetCam;
      orbit.update();
      bumpViewport();
    }
  }, [isOrthoMode, syncOrthoFrustum]);

  // Sync camera presets (Front, Side, 3/4, Iso 2:1, Top) when yawDeg/pitchDeg change externally
  useEffect(() => {
    const presetKey = `${Math.round(studio3d.yawDeg)}:${Math.round(studio3d.pitchDeg)}`;
    if (lastAppliedCameraPresetRef.current === presetKey) return;
    lastAppliedCameraPresetRef.current = presetKey;

    const cam = activeCameraRef.current;
    const persp = perspCameraRef.current;
    const ortho = orthoCameraRef.current;
    const orbit = orbitRef.current;
    if (!cam || !persp || !ortho || !orbit) return;

    const dist = Math.max(0.5, cam.position.distanceTo(orbit.target));
    const yawRad = studio3d.yawDeg * DEG_TO_RAD;
    const pitchRad = Math.max(-89, Math.min(89, studio3d.pitchDeg)) * DEG_TO_RAD;

    const cosP = Math.cos(pitchRad);
    const nextPos = new THREE.Vector3(
      orbit.target.x + dist * cosP * Math.sin(yawRad),
      orbit.target.y + dist * Math.sin(pitchRad),
      orbit.target.z + dist * cosP * Math.cos(yawRad)
    );

    cameraSyncLockRef.current = true;
    persp.position.copy(nextPos);
    ortho.position.copy(nextPos);
    persp.lookAt(orbit.target);
    ortho.lookAt(orbit.target);
    syncOrthoFrustum(ortho, persp, sizeRef.current.width, sizeRef.current.height);
    orbit.update();
    cameraSyncLockRef.current = false;
    bumpViewport();
  }, [studio3d.yawDeg, studio3d.pitchDeg, syncOrthoFrustum]);

  // Sync studio lighting & floor grid
  useEffect(() => {
    const scene = sceneRef.current;
    const ambient = ambientLightRef.current;
    const hemi = hemiLightRef.current;
    const dirLight = dirLightRef.current;
    if (!scene || !ambient || !hemi || !dirLight) return;

    ambient.color.set(studio3d.ambientColor || "#8ca0c8");
    ambient.intensity = Math.max(0.1, studio3d.ambient * 1.4);
    dirLight.color.set(studio3d.lightColor || "#fff4d6");
    dirLight.intensity = studio3d.directionalLighting
      ? Math.max(0.2, studio3d.lightIntensity * 1.15)
      : 0.35;

    const az = studio3d.lightAzimuthDeg * DEG_TO_RAD;
    const el = studio3d.lightElevationDeg * DEG_TO_RAD;
    const r = 10;
    dirLight.position.set(
      r * Math.cos(el) * Math.sin(az),
      Math.max(1.5, r * Math.sin(el)),
      r * Math.cos(el) * Math.cos(az)
    );

    if (gridGroupRef.current) {
      disposeGroupGeometriesAndMaterials(gridGroupRef.current);
      scene.remove(gridGroupRef.current);
      gridGroupRef.current = null;
    }

    if (studio3d.gridMode !== "none") {
      const grid = buildPixelFloorGrid(pixelEngine.model3d.pixelsPerUnit);
      scene.add(grid);
      gridGroupRef.current = grid;
    }
    bumpViewport();
  }, [
    studio3d.ambient,
    studio3d.ambientColor,
    studio3d.lightColor,
    studio3d.lightIntensity,
    studio3d.directionalLighting,
    studio3d.lightAzimuthDeg,
    studio3d.lightElevationDeg,
    studio3d.gridMode,
    model3dVersion,
  ]);

  // Sync Model3DEngine nodes, materials, animation poses, onion-skin, tile cursor & gizmos
  useEffect(() => {
    const scene = sceneRef.current;
    const materialCache = materialCacheRef.current;
    const transform = transformRef.current;
    if (!scene || !materialCache || !transform) return;

    // Avoid rebuilding scene objects mid-gizmo-drag
    if (isGizmoDraggingRef.current) return;
    // Live modal operators (G/R/S, E, I, Ctrl+B, box select) edit geometry in place
    if (modalControllerRef.current?.isActive()) return;

    const engine = pixelEngine.model3d;
    // Edit Mode always shows solid faces: a textured preview whose sampled texels are
    // transparent (alpha test) would make the mesh vanish while editing it.
    const effectiveShading =
      engine.selectionGranularity !== "object" && studio3d.subMode === "model"
        ? "solid"
        : studio3d.shadingMode;
    const { materialById, textureSizeByMaterialId } = materialCache.sync({
      materials: engine.materials,
      shadingMode: effectiveShading,
      cullBackfacesInView: studio3d.cullBackfacesInView,
      layers,
      currentFrame,
      canvasWidth,
      canvasHeight,
      lightIntensity: studio3d.lightIntensity,
      tilesetVersion,
    });
    textureSizeByMatRef.current = textureSizeByMaterialId;

    transform.detach();

    if (modelRootRef.current) {
      disposeSyncedObjectTree(modelRootRef.current);
      scene.remove(modelRootRef.current);
      modelRootRef.current = null;
    }
    if (subObjectOverlayRef.current) {
      disposeGroupGeometriesAndMaterials(subObjectOverlayRef.current);
      scene.remove(subObjectOverlayRef.current);
      subObjectOverlayRef.current = null;
    }
    if (tileCursorGroupRef.current) {
      disposeGroupGeometriesAndMaterials(tileCursorGroupRef.current);
      scene.remove(tileCursorGroupRef.current);
      tileCursorGroupRef.current = null;
    }
    if (onionSkinGroupRef.current) {
      disposeGroupGeometriesAndMaterials(onionSkinGroupRef.current);
      scene.remove(onionSkinGroupRef.current);
      onionSkinGroupRef.current = null;
    }

    const activeClip =
      (engine.activeClipId
        ? engine.clips.find((c) => c.id === engine.activeClipId)
        : undefined) ?? engine.clips[0];

    let evaluatedPoses: ReadonlyMap<string, EvaluatedNodePose> | undefined;
    if (
      activeClip &&
      (studio3d.subMode === "animate" || isPlaying)
    ) {
      evaluatedPoses = evaluateScenePosesAtFrame(
        engine.nodes,
        activeClip,
        currentFrame
      );
    }

    const synced = syncModel3DScene(engine, {
      wireframeOverlay: studio3d.wireframeOverlay,
      materialById,
      textureSizeByMaterialId,
      defaultTextureWidth: Math.max(1, canvasWidth),
      defaultTextureHeight: Math.max(1, canvasHeight),
      poses: evaluatedPoses,
      tilesets: pixelEngine.tilesetRegistry.tilesets,
      activeTileset: pixelEngine.tileset,
      // Paint/UV/etc. address base faces: pick the base mesh behind modifier-evaluated geometry.
      pickBaseMesh: studio3d.subMode !== "model",
    });

    scene.add(synced.rootGroup);
    modelRootRef.current = synced.rootGroup;
    nodeObjectByIdRef.current = synced.nodeObjectById;
    pickableMeshesRef.current = synced.pickableMeshes;
    setSceneStats({
      nodeCount: synced.nodeCount,
      triangleCount: synced.triangleCount,
    });

    const overlay = buildSubObjectOverlay(
      synced.nodeObjectById,
      Math.max(1, engine.pixelsPerUnit)
    );
    scene.add(overlay);
    subObjectOverlayRef.current = overlay;

    // Onion-skin ghost overlays in Animate sub-mode
    const ppu = Math.max(1, engine.pixelsPerUnit);
    if (
      studio3d.subMode === "animate" &&
      onionSkin &&
      activeClip &&
      engine.nodes.length > 0
    ) {
      const onionRoot = new THREE.Group();
      onionRoot.name = "__m3d_onion_root__";
      const totalFrames = Math.max(1, activeClip.frameCount);
      if (currentFrame - 1 >= 0) {
        onionRoot.add(
          buildOnionSkinGhostGroup(
            engine.nodes,
            activeClip,
            currentFrame - 1,
            ppu,
            0x4c8bf5
          )
        );
      }
      if (currentFrame + 1 < totalFrames) {
        onionRoot.add(
          buildOnionSkinGhostGroup(
            engine.nodes,
            activeClip,
            currentFrame + 1,
            ppu,
            0x4db86a
          )
        );
      }
      scene.add(onionRoot);
      onionSkinGroupRef.current = onionRoot;
    }

    // 3D Tile Cursor preview in Tile sub-mode
    if (studio3d.subMode === "tile") {
      const cursorOverlay = buildTileCursorOverlay(engine.tileCursor, ppu);
      scene.add(cursorOverlay);
      tileCursorGroupRef.current = cursorOverlay;
    }

    // Attach TransformControls to unlocked activeNodeId (hidden in paint & tile modes)
    const activeNode = engine.activeNodeId
      ? engine.getNode(engine.activeNodeId)
      : undefined;
    const allowGizmo =
      studio3d.subMode !== "paint" &&
      studio3d.subMode !== "tile" &&
      (studio3d.gizmoMode === "move" ||
        studio3d.gizmoMode === "rotate" ||
        studio3d.gizmoMode === "scale");

    if (activeNode && !activeNode.locked && activeNode.visible && allowGizmo) {
      const targetObj = synced.nodeObjectById.get(activeNode.id);
      if (targetObj) {
        const modeMap = {
          move: "translate",
          rotate: "rotate",
          scale: "scale",
        } as const;
        transform.setMode(modeMap[studio3d.gizmoMode as "move" | "rotate" | "scale"]);
        transform.setTranslationSnap(
          vKeyHeld ? null : Math.max(0.05, studio3d.snapPx) / ppu
        );
        transform.setRotationSnap(Math.PI / 12); // 15 deg
        transform.setScaleSnap(0.125);

        if (
          engine.selectionGranularity !== "object" &&
          activeNode.kind === "mesh" &&
          activeNode.mesh &&
          subElemProxyRef.current
        ) {
          const verts = collectAffectedVertexIndices(
            activeNode.mesh,
            engine.selectionGranularity,
            engine.selectedVertices[activeNode.id] ?? [],
            engine.selectedEdges[activeNode.id] ?? [],
            engine.selectedFaces[activeNode.id] ?? []
          );
          const centroidPx = computeVerticesCentroid(activeNode.mesh.vertices, verts);
          if (verts.length > 0 && centroidPx) {
            targetObj.updateMatrixWorld(true);
            const localPos = new THREE.Vector3(
              (centroidPx[0] - activeNode.transform.pivot[0]) / ppu,
              (centroidPx[1] - activeNode.transform.pivot[1]) / ppu,
              (centroidPx[2] - activeNode.transform.pivot[2]) / ppu
            );
            const worldPos = localPos.applyMatrix4(targetObj.matrixWorld);
            const worldQuat = new THREE.Quaternion();
            targetObj.getWorldQuaternion(worldQuat);
            const proxy = subElemProxyRef.current;
            proxy.position.copy(worldPos);
            proxy.quaternion.copy(worldQuat);
            proxy.scale.set(1, 1, 1);
            proxy.userData = { isSubElemProxy: true, nodeId: activeNode.id };
            proxy.updateMatrixWorld(true);
            transform.attach(proxy);
          }
        } else {
          transform.attach(targetObj);
        }
      }
    }

    bumpViewport();
  }, [
    model3dVersion,
    studio3d.subMode,
    studio3d.shadingMode,
    studio3d.wireframeOverlay,
    studio3d.cullBackfacesInView,
    studio3d.gizmoMode,
    studio3d.snapPx,
    studio3d.lightIntensity,
    layers,
    currentFrame,
    isPlaying,
    onionSkin,
    canvasWidth,
    canvasHeight,
    tilesetVersion,
    vKeyHeld,
  ]);

  // Also re-sync materials when PixelEngine emits pixel edits in Draw
  useEffect(() => {
    const unsub = pixelEngine.subscribe(() => {
      bumpViewport();
      const materialCache = materialCacheRef.current;
      if (!materialCache) return;
      const st = useEditorStore.getState();
      const { textureSizeByMaterialId } = materialCache.sync({
        materials: pixelEngine.model3d.materials,
        shadingMode: st.studio3d.shadingMode,
        cullBackfacesInView: st.studio3d.cullBackfacesInView,
        layers: st.layers,
        currentFrame: st.currentFrame,
        canvasWidth: st.canvasWidth,
        canvasHeight: st.canvasHeight,
        lightIntensity: st.studio3d.lightIntensity,
        tilesetVersion: st.tilesetVersion,
      });
      textureSizeByMatRef.current = textureSizeByMaterialId;
    });
    return unsub;
  }, []);

  const refreshTexturesImmediate = useCallback(() => {
    const materialCache = materialCacheRef.current;
    if (!materialCache) return;
    const st = useEditorStore.getState();
    const { textureSizeByMaterialId } = materialCache.sync({
      materials: pixelEngine.model3d.materials,
      shadingMode: st.studio3d.shadingMode,
      cullBackfacesInView: st.studio3d.cullBackfacesInView,
      layers: st.layers,
      currentFrame: st.currentFrame,
      canvasWidth: st.canvasWidth,
      canvasHeight: st.canvasHeight,
      lightIntensity: st.studio3d.lightIntensity,
      tilesetVersion: st.tilesetVersion,
    });
    textureSizeByMatRef.current = textureSizeByMaterialId;
    bumpViewport();
  }, []);

  const executeTileStampAtCursor = useCallback(
    (
      cursorSnapshot: TileCursor3D,
      mode: "stamp" | "dragFill" | "extrudeBlock",
      endPos?: Vec3
    ) => {
      const st = useEditorStore.getState();
      const tileset = pixelEngine.tileset;
      const tileId = Math.max(
        1,
        Math.min(Math.max(1, tileset.count), st.activeTileId || cursorSnapshot.cachedTileId || 1)
      );
      const tileMeta = tileset.getMeta(tileId);
      const tileUid = tileMeta?.uid || cursorSnapshot.tileUid || `tile-${tileId}`;
      const boundCursor: TileCursor3D = {
        ...cursorSnapshot,
        tilesetId: tileset.id,
        tileUid,
        cachedTileId: tileId,
      };
      const atlas = buildPaddedTilesetAtlas(tileset);
      const uvs = getTileQuadPixelUvs(
        atlas,
        tileset,
        boundCursor.tileUid,
        boundCursor.cachedTileId,
        boundCursor.rotation,
        boundCursor.flipX,
        boundCursor.flipY
      );

      mutateModel3D(
        mode === "extrudeBlock"
          ? "Extrude Tile Block"
          : mode === "dragFill"
            ? "Drag-Fill Tiles"
            : "Stamp Tile",
        (eng) => {
          eng.patchTileCursor({
            tilesetId: boundCursor.tilesetId,
            tileUid: boundCursor.tileUid,
            cachedTileId: boundCursor.cachedTileId,
          });
          let mat = eng.materials.find(
            (m) =>
              m.source.kind === "tileset" && m.source.tilesetId === tileset.id
          );
          if (!mat) {
            mat = eng.addMaterial({
              name: `${tileset.name} Atlas`,
              source: { kind: "tileset", tilesetId: tileset.id },
              doubleSided: false,
              alphaTest: 0.5,
              usePbrMaps: false,
            });
          }
          const targetNode = ensureStampTargetMeshNode(
            eng,
            mat.id,
            eng.activeNodeId
          );
          if (!targetNode.mesh) return;

          if (mode === "dragFill" && endPos) {
            dragFillTilePlane(targetNode.mesh, boundCursor, endPos, {
              materialId: mat.id,
              uvs,
              tileWidthPx: tileset.tileWidth,
              tileHeightPx: tileset.tileHeight,
              autoWeld: true,
            });
          } else if (mode === "extrudeBlock") {
            extrudeTileBlockOnMesh(
              targetNode.mesh,
              boundCursor,
              st.studio3d.tileExtrudeDepthPx || 16,
              {
                materialId: mat.id,
                capUvs: uvs,
                sideUvs: uvs,
                tileWidthPx: tileset.tileWidth,
                tileHeightPx: tileset.tileHeight,
                autoWeld: true,
              }
            );
          } else {
            stampTileQuadOnMesh(targetNode.mesh, boundCursor, {
              materialId: mat.id,
              uvs,
              tileWidthPx: tileset.tileWidth,
              tileHeightPx: tileset.tileHeight,
              autoWeld: true,
            });
          }
        }
      );
    },
    []
  );

  // Pointer interactions: Paint strokes, Tile cursor snap & stamp, or Object/Sub-object picking
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    modalControllerRef.current?.trackPointer(e.clientX, e.clientY);
    const orbit = orbitRef.current;
    // Alt+Left-drag always orbits camera cleanly in Paint/Tile sub-modes
    if (
      e.button === 0 &&
      e.altKey &&
      (studio3d.subMode === "paint" || studio3d.subMode === "tile") &&
      orbit
    ) {
      orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      return;
    }

    if (e.button !== 0) return;

    const host = stageRef.current;
    const cam = activeCameraRef.current;

    if (studio3d.subMode === "paint") {
      if (!host || !cam) return;
      const rect = host.getBoundingClientRect();
      const started = paintControllerRef.current.beginStroke(
        e.clientX,
        e.clientY,
        {
          rect,
          camera: cam,
          pickableMeshes: pickableMeshesRef.current,
          engine: pixelEngine.model3d,
          textureSizeByMaterialId: textureSizeByMatRef.current,
          defaultTextureWidth: Math.max(1, canvasWidth),
          defaultTextureHeight: Math.max(1, canvasHeight),
        },
        {
          tool: studio3d.paint3dTool,
          brushSize,
          brushShape: brushShape === "square" ? "square" : "circle",
          brushOpacity,
          primaryColor,
          primaryAlpha,
          lockToInitialFace: studio3d.paint3dLockFace,
          shiftKey: e.shiftKey,
          textureSizeByMaterialId: textureSizeByMatRef.current,
          defaultTextureWidth: Math.max(1, canvasWidth),
          defaultTextureHeight: Math.max(1, canvasHeight),
          onTextureDirty: refreshTexturesImmediate,
          onModelDirty: bumpModel3DVersion,
        }
      );
      if (started) {
        host.setPointerCapture(e.pointerId);
      }
      return;
    }

    if (studio3d.subMode === "tile") {
      if (!host || !cam) return;
      const snapped = snapTileCursorFromRay(
        e.clientX,
        e.clientY,
        host,
        cam,
        pickableMeshesRef.current
      );
      if (snapped) {
        pixelEngine.model3d.patchTileCursor({ position: snapped });
        bumpModel3DVersion();
      }
      if (e.shiftKey) {
        return;
      }
      if (studio3d.tileStampMode === "dragFill") {
        tileDragStartCursorRef.current = {
          ...pixelEngine.model3d.tileCursor,
          position: [...pixelEngine.model3d.tileCursor.position],
        };
        host.setPointerCapture(e.pointerId);
      } else {
        executeTileStampAtCursor(
          pixelEngine.model3d.tileCursor,
          studio3d.tileStampMode
        );
      }
      return;
    }

    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    modalControllerRef.current?.trackPointer(e.clientX, e.clientY);
    const host = stageRef.current;
    const cam = activeCameraRef.current;
    if (!host || !cam) return;

    if (studio3d.subMode === "paint") {
      if (!paintControllerRef.current.isPainting()) return;
      const rect = host.getBoundingClientRect();
      paintControllerRef.current.continueStroke(e.clientX, e.clientY, {
        rect,
        camera: cam,
        pickableMeshes: pickableMeshesRef.current,
        engine: pixelEngine.model3d,
        textureSizeByMaterialId: textureSizeByMatRef.current,
        defaultTextureWidth: Math.max(1, canvasWidth),
        defaultTextureHeight: Math.max(1, canvasHeight),
      });
      return;
    }

    if (studio3d.subMode === "tile" && e.buttons === 0) {
      const snapped = snapTileCursorFromRay(
        e.clientX,
        e.clientY,
        host,
        cam,
        pickableMeshesRef.current
      );
      if (snapped) {
        const cur = pixelEngine.model3d.tileCursor.position;
        if (
          snapped[0] !== cur[0] ||
          snapped[1] !== cur[1] ||
          snapped[2] !== cur[2]
        ) {
          pixelEngine.model3d.patchTileCursor({ position: snapped });
          bumpModel3DVersion();
        }
      }
      return;
    }

    if (studio3d.subMode === "tile" && tileDragStartCursorRef.current) {
      const snapped = snapTileCursorFromRay(
        e.clientX,
        e.clientY,
        host,
        cam,
        pickableMeshesRef.current
      );
      if (snapped) {
        pixelEngine.model3d.patchTileCursor({ position: snapped });
        bumpModel3DVersion();
      }
    }
  };

  /**
   * Blender-style Edit Mode click on the active mesh: screen-space nearest vertex /
   * edge (occlusion-tested), face-ray for faces. Shift toggles, plain click replaces,
   * clicking empty space clears the element selection but keeps the node in Edit Mode.
   */
  const applyEditModeClick = (
    e: React.PointerEvent<HTMLDivElement>,
    node: ModelNode & { mesh: PolyMeshData },
    obj: THREE.Object3D,
    cam: THREE.Camera,
    rect: DOMRect,
    hits: THREE.Intersection[]
  ): boolean => {
    const engine = pixelEngine.model3d;
    const granularity = engine.selectionGranularity;
    const ppu = Math.max(1, engine.pixelsPerUnit);
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { vertices } = collectSelectedSubObjectPositions(node, obj, ppu);

    const clearAll = () => {
      engine.selectedVertices[node.id] = [];
      engine.selectedEdges[node.id] = [];
      engine.selectedFaces[node.id] = [];
    };

    if (granularity === "face") {
      const hit = hits[0];
      const ud = hit?.object.userData as MeshLookupUserData | undefined;
      const usable =
        hit &&
        ud?.nodeId === node.id &&
        (hit.object.userData?.[CAGE_PICK_FLAG] ||
          getEvaluatedMesh(node, "viewport") === node.mesh) &&
        hit.faceIndex != null &&
        hit.faceIndex >= 0 &&
        hit.faceIndex < ud.triToFaceIndex.length;
      const faceId = usable
        ? ud!.faceIds[ud!.triToFaceIndex[hit.faceIndex as number]]
        : undefined;
      if (faceId === undefined) {
        if (!e.shiftKey) clearAll();
        return true;
      }
      const prev = engine.selectedFaces[node.id] ?? [];
      engine.selectedFaces[node.id] = e.shiftKey ? toggleInList(prev, faceId) : [faceId];
      return true;
    }

    const projected: MaybeScreenPoint[] = vertices.map((v) => {
      const p = v.clone().project(cam);
      if (p.z < -1 || p.z > 1) return null;
      return {
        x: ((p.x + 1) / 2) * rect.width,
        y: ((1 - p.y) / 2) * rect.height,
        depth: p.z,
      };
    });

    const rc = new THREE.Raycaster();
    const pickables = pickableMeshesRef.current;
    const worldPointVisible = (w: THREE.Vector3): boolean => {
      const n = w.clone().project(cam);
      rc.setFromCamera(new THREE.Vector2(n.x, n.y), cam);
      const first = rc.intersectObjects(pickables, false)[0];
      return isDepthVisible(rc.ray.origin.distanceTo(w), first ? first.distance : null);
    };

    if (granularity === "vertex") {
      const idx = pickNearestVertex(
        projected,
        cx,
        cy,
        VERTEX_PICK_RADIUS_PX,
        (i) => worldPointVisible(vertices[i])
      );
      if (idx < 0) {
        if (!e.shiftKey) clearAll();
        return true;
      }
      const prev = engine.selectedVertices[node.id] ?? [];
      engine.selectedVertices[node.id] = e.shiftKey ? toggleInList(prev, idx) : [idx];
      return true;
    }

    // edge
    const edges = collectUniqueEdges(node.mesh);
    const idx = pickNearestSegment(
      projected,
      edges,
      cx,
      cy,
      EDGE_PICK_RADIUS_PX,
      (i) => {
        const [a, b] = edges[i];
        const mid = vertices[a].clone().add(vertices[b]).multiplyScalar(0.5);
        return worldPointVisible(mid);
      }
    );
    if (idx < 0) {
      if (!e.shiftKey) clearAll();
      return true;
    }
    const picked = edges[idx];
    const group: Array<[number, number]> = e.altKey
      ? selectEdgeLoop(node.mesh, picked)
      : [picked];
    const prev = engine.selectedEdges[node.id] ?? [];
    const has = (list: ReadonlyArray<readonly [number, number]>, ed: readonly [number, number]) =>
      list.some(([a, b]) => edgeKey(a, b) === edgeKey(ed[0], ed[1]));
    if (e.shiftKey) {
      const allIn = group.every((ed) => has(prev, ed));
      engine.selectedEdges[node.id] = allIn
        ? prev.filter((ed) => !has(group, ed))
        : [...prev, ...group.filter((ed) => !has(prev, ed))];
    } else {
      engine.selectedEdges[node.id] = group;
    }
    return true;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const orbit = orbitRef.current;
    if (
      orbit &&
      (studio3d.subMode === "paint" || studio3d.subMode === "tile") &&
      orbit.mouseButtons.LEFT !== null
    ) {
      orbit.mouseButtons.LEFT = null;
    }

    const host = stageRef.current;
    if (host && host.hasPointerCapture(e.pointerId)) {
      host.releasePointerCapture(e.pointerId);
    }

    if (studio3d.subMode === "paint") {
      if (paintControllerRef.current.isPainting()) {
        paintControllerRef.current.endStroke();
      }
      return;
    }

    if (studio3d.subMode === "tile") {
      const dragStart = tileDragStartCursorRef.current;
      tileDragStartCursorRef.current = null;
      if (dragStart && e.button === 0 && !e.shiftKey && !e.altKey) {
        const cam = activeCameraRef.current;
        const endPos =
          host && cam
            ? snapTileCursorFromRay(
                e.clientX,
                e.clientY,
                host,
                cam,
                pickableMeshesRef.current
              ) ?? pixelEngine.model3d.tileCursor.position
            : pixelEngine.model3d.tileCursor.position;
        executeTileStampAtCursor(dragStart, "dragFill", endPos);
      }
      return;
    }

    if (e.button !== 0) return;
    const down = pointerDownPosRef.current;
    pointerDownPosRef.current = null;
    if (!down || isGizmoDraggingRef.current) return;

    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved > 4) return;

    const cam = activeCameraRef.current;
    if (!host || !cam) return;

    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, cam);
    const hits = raycaster.intersectObjects(pickableMeshesRef.current, false);

    const engine = pixelEngine.model3d;

    // Edit Mode on a mesh: screen-space vertex / edge picking and face-ray picking
    // on the active node. A click on another object falls through to node selection.
    if (engine.selectionGranularity !== "object") {
      const editNode = engine.activeNodeId ? engine.getNode(engine.activeNodeId) : undefined;
      const editObj = editNode ? nodeObjectByIdRef.current.get(editNode.id) : undefined;
      if (editNode && editNode.kind === "mesh" && editNode.mesh && editObj && !editNode.locked) {
        const hitOther =
          hits.length > 0 &&
          (hits[0].object.userData as MeshLookupUserData | undefined)?.nodeId !== editNode.id;
        const handled = !hitOther && applyEditModeClick(
          e,
          editNode as ModelNode & { mesh: PolyMeshData },
          editObj,
          cam,
          rect,
          hits
        );
        if (handled) {
          bumpModel3DVersion();
          return;
        }
      }
    }

    if (hits.length === 0) {
      if (!e.shiftKey) {
        engine.clearSelection();
        bumpModel3DVersion();
      }
      return;
    }

    const hit = hits[0];
    const ud = hit.object.userData as MeshLookupUserData | undefined;
    if (!ud?.nodeId) return;

    const hitNodeId = ud.nodeId;
    if (e.shiftKey) {
      const existing = [...engine.selectedNodeIds];
      const idx = existing.indexOf(hitNodeId);
      if (idx >= 0) {
        existing.splice(idx, 1);
        engine.selectNodes(existing, existing[existing.length - 1] ?? null);
      } else {
        existing.push(hitNodeId);
        engine.selectNodes(existing, hitNodeId);
      }
    } else {
      engine.selectNodes([hitNodeId], hitNodeId);
    }

    // Sub-object selection on PolyMesh nodes
    const hitNode = engine.getNode(hitNodeId);
    if (
      hitNode &&
      hitNode.kind === "mesh" &&
      hitNode.mesh &&
      // An evaluated (modifier) mesh has no base-face mapping; only the cage proxy does.
      (hit.object.userData?.[CAGE_PICK_FLAG] ||
        getEvaluatedMesh(hitNode, "viewport") === hitNode.mesh) &&
      hit.faceIndex != null &&
      hit.faceIndex >= 0 &&
      hit.faceIndex < ud.triToFaceIndex.length
    ) {
      const polyFaceIndex = ud.triToFaceIndex[hit.faceIndex];
      const faceId = ud.faceIds[polyFaceIndex];
      const polyFace = hitNode.mesh.faces.find((f) => f.id === faceId);

      if (polyFace) {
        const ppu = Math.max(1, engine.pixelsPerUnit);
        const { vertices } = collectSelectedSubObjectPositions(
          hitNode,
          hit.object,
          ppu
        );

        if (engine.selectionGranularity === "face") {
          const prev = e.shiftKey ? [...(engine.selectedFaces[hitNodeId] ?? [])] : [];
          if (!prev.includes(polyFace.id)) prev.push(polyFace.id);
          engine.selectedFaces[hitNodeId] = prev;
        } else if (engine.selectionGranularity === "vertex") {
          let bestVert = polyFace.verts[0];
          let bestDistSq = Infinity;
          for (const vi of polyFace.verts) {
            const vp = vertices[vi];
            if (!vp) continue;
            const dSq = vp.distanceToSquared(hit.point);
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              bestVert = vi;
            }
          }
          const prev = e.shiftKey ? [...(engine.selectedVertices[hitNodeId] ?? [])] : [];
          if (bestVert !== undefined && !prev.includes(bestVert)) {
            prev.push(bestVert);
          }
          engine.selectedVertices[hitNodeId] = prev;
        } else if (engine.selectionGranularity === "edge") {
          let bestEdge: [number, number] | null = null;
          let bestDistSq = Infinity;
          const n = polyFace.verts.length;
          for (let i = 0; i < n; i++) {
            const a = polyFace.verts[i];
            const b = polyFace.verts[(i + 1) % n];
            const va = vertices[a];
            const vb = vertices[b];
            if (!va || !vb) continue;
            const dSq = pointToSegmentDistSq(hit.point, va, vb);
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              bestEdge = a < b ? [a, b] : [b, a];
            }
          }
          if (bestEdge) {
            const loopOrSingle = e.altKey
              ? selectEdgeLoop(hitNode.mesh, bestEdge)
              : [bestEdge];
            const prev = e.shiftKey ? [...(engine.selectedEdges[hitNodeId] ?? [])] : [];
            for (const ed of loopOrSingle) {
              if (!prev.some(([a, b]) => a === ed[0] && b === ed[1])) {
                prev.push(ed);
              }
            }
            engine.selectedEdges[hitNodeId] = prev;
          }
        }
      }
    }

    bumpModel3DVersion();
  };

  void viewportRevision;
  // Safety net: any React render of this component (store, props, state) may
  // have changed the scene, so schedule one draw. Coalesced to one per frame.
  useEffect(() => {
    requestRenderRef.current();
  });

  return (
    <div className="m3d-viewport-shell">
      <div
        ref={stageRef}
        className="m3d-three-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {webglError && (
        <div className="safe-gl-unavailable" role="alert">
          {webglError}
        </div>
      )}

      {/* Compact Top-Left HUD */}
      <div className="m3d-hud-overlay-tl">
        <span className="m3d-badge m3d-badge-mono">
          {sceneStats.nodeCount} Node{sceneStats.nodeCount === 1 ? "" : "s"}
        </span>
        <span className="m3d-badge m3d-badge-mono">
          {sceneStats.triangleCount} Tri{sceneStats.triangleCount === 1 ? "" : "s"}
        </span>
        {studio3d.subMode === "model" ? (
          <>
            <span className="m3d-badge" data-testid="m3d-mode-badge">
              {pixelEngine.model3d.selectionGranularity === "object"
                ? "Object Mode"
                : `Edit Mode · ${
                    pixelEngine.model3d.selectionGranularity.charAt(0).toUpperCase() +
                    pixelEngine.model3d.selectionGranularity.slice(1)
                  }`}
            </span>
            <span className="m3d-badge m3d-badge-mono" data-testid="m3d-selection-count">
              {describeSelectionCount()}
            </span>
          </>
        ) : (
          <span className="m3d-badge">
            {studio3d.subMode.toUpperCase()}
            {pixelEngine.model3d.selectionGranularity !== "object"
              ? ` / ${pixelEngine.model3d.selectionGranularity.toUpperCase()}`
              : ""}
          </span>
        )}
        {vKeyHeld && (
          <span className="m3d-badge m3d-badge-accent">
            <Magnet size={11} />
            <span>V: Vertex Snap</span>
          </span>
        )}
      </div>

      {modalHud && (
        <div className="m3d-modal-hint" role="status" data-testid="m3d-modal-hint">
          {modalHud}
        </div>
      )}
      {boxRect && (
        <div
          className="m3d-box-select"
          data-testid="m3d-box-select"
          style={{
            left: boxRect.x0,
            top: boxRect.y0,
            width: boxRect.x1 - boxRect.x0,
            height: boxRect.y1 - boxRect.y0,
          }}
        />
      )}

      {/* Compact Bottom-Left HUD */}
      <div
        className="m3d-hud-overlay-bl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="m3d-hud-btn"
          onClick={frameSelectionOrScene}
          title="Frame Selected Node or Scene (F)"
        >
          <Maximize2 size={11} />
          <span>Frame (F)</span>
        </button>
        <button
          type="button"
          className={`m3d-hud-btn ${isOrthoMode ? "active" : ""}`}
          onClick={() =>
            patchStudio3D(
              isOrthoMode
                ? { gridMode: "perspective", perspective: 0.35 }
                : { gridMode: "isometric", perspective: 0 }
            )
          }
          title="Toggle Perspective / Orthographic Camera"
        >
          <span>{isOrthoMode ? "Ortho" : "Persp"}</span>
        </button>
      </div>
    </div>
  );
}
