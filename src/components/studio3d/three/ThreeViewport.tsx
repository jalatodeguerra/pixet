import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { Maximize2, Magnet } from "lucide-react";
import { pixelEngine } from "../../../engine/document/PixelEngine";
import { syncHistoryAndCelState } from "../../../engine/document/historyActions";
import {
  createModelClip,
  evaluateScenePosesAtFrame,
  recordNodeTransformKeyframes,
  type EvaluatedNodePose,
} from "../../../engine/model3d/animEval";
import { mutateModel3D } from "../../../engine/model3d/model3dActions";
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
  TileCursor3D,
  Vec3,
} from "../../../engine/model3d/types";
import { useEditorStore } from "../../../store/editorStore";
import { Paint3DStrokeController } from "./paintRaycaster";
import { RetroMaterialCache, type MaterialTextureInfo } from "./retroMaterials";
import {
  collectSelectedSubObjectPositions,
  collectWorldSnapVertices,
  disposeSyncedObjectTree,
  objectTransformToNodeTransform,
  syncModel3DScene,
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

function buildSubObjectOverlay(
  nodeObjectById: Map<string, THREE.Object3D>,
  ppu: number
): THREE.Group {
  const overlay = new THREE.Group();
  overlay.name = "__m3d_subobject_overlay__";
  const engine = pixelEngine.model3d;
  if (engine.selectionGranularity === "object") return overlay;

  const vertPositions: number[] = [];
  const edgePositions: number[] = [];
  const faceTriPositions: number[] = [];

  for (const node of engine.nodes) {
    if (!node.visible || node.kind !== "mesh" || !node.mesh) continue;
    const obj = nodeObjectById.get(node.id);
    if (!obj) continue;

    const { vertices, facesById } = collectSelectedSubObjectPositions(
      node,
      obj,
      ppu
    );
    if (vertices.length === 0) continue;

    if (engine.selectionGranularity === "vertex") {
      const selVerts = engine.selectedVertices[node.id] ?? [];
      for (const vi of selVerts) {
        const v = vertices[vi];
        if (v) vertPositions.push(v.x, v.y, v.z);
      }
    } else if (engine.selectionGranularity === "edge") {
      const selEdges = engine.selectedEdges[node.id] ?? [];
      for (const [a, b] of selEdges) {
        const va = vertices[a];
        const vb = vertices[b];
        if (va && vb) {
          edgePositions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
        }
      }
    } else if (engine.selectionGranularity === "face") {
      const selFaces = engine.selectedFaces[node.id] ?? [];
      for (const fId of selFaces) {
        const f = facesById.get(fId);
        if (!f || f.verts.length < 3) continue;
        const v0 = vertices[f.verts[0]];
        const v1 = vertices[f.verts[1]];
        const v2 = vertices[f.verts[2]];
        if (!v0 || !v1 || !v2) continue;
        if (f.verts.length === 3) {
          faceTriPositions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
        } else {
          const v3 = vertices[f.verts[3]];
          if (!v3) continue;
          const split = f.triSplit ?? "02";
          if (split === "02") {
            faceTriPositions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
            faceTriPositions.push(v0.x, v0.y, v0.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z);
          } else {
            faceTriPositions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v3.x, v3.y, v3.z);
            faceTriPositions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z);
          }
        }
      }
    }
  }

  if (vertPositions.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertPositions, 3)
    );
    const mat = new THREE.PointsMaterial({
      color: 0xf5b041,
      size: 7,
      sizeAttenuation: false,
      depthTest: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 12;
    overlay.add(pts);
  }

  if (edgePositions.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(edgePositions, 3)
    );
    const mat = new THREE.LineBasicMaterial({
      color: 0xf5b041,
      depthTest: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 12;
    overlay.add(lines);
  }

  if (faceTriPositions.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(faceTriPositions, 3)
    );
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4c8bf5,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 11;
    overlay.add(mesh);
  }

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
      const pos: number[] = [];
      for (const f of node.mesh.faces) {
        if (f.verts.length < 3) continue;
        const v0 = node.mesh.vertices[f.verts[0]];
        const v1 = node.mesh.vertices[f.verts[1]];
        const v2 = node.mesh.vertices[f.verts[2]];
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
          const v3 = node.mesh.vertices[f.verts[3]];
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
    setViewportRevision((v) => v + 1);
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

    const renderer = threeStudioRuntime.getRenderer();
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
      setViewportRevision((v) => v + 1);
    };
    orbit.addEventListener("change", onOrbitChange);

    const transform = new TransformControls(activeCam, canvas);
    transform.setSpace("local");
    transform.setSize(0.85);
    const helper = transform.getHelper();
    scene.add(helper);
    transformRef.current = transform;

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
      } else {
        if (snapIndicatorRef.current) {
          snapIndicatorRef.current.visible = false;
        }
        if (dragBeforeSnapRef.current !== null) {
          const stNow = useEditorStore.getState();
          const st3d = stNow.studio3d;
          const draggedNode = activeId ? engine.getNode(activeId) : undefined;
          if (
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
            pixelEngine.model3dHistory.pushUndo(
              dragBeforeSnapRef.current,
              st3d.subMode === "animate" && st3d.autoKey3D
                ? "Transform & Auto-Key 3D Node"
                : "Transform 3D Node"
            );
            pixelEngine.undoCoordinator.record(
              "model3d",
              st3d.subMode === "animate" && st3d.autoKey3D
                ? "Transform & Auto-Key 3D Node"
                : "Transform 3D Node"
            );
            stNow.bumpModel3DVersion();
            pixelEngine.emitChange();
            syncHistoryAndCelState();
          }
          dragBeforeSnapRef.current = null;
        }
        snapTargetsRef.current = [];
      }
      setViewportRevision((v) => v + 1);
    };

    const onObjectChange = () => {
      const attachedObj = transform.object;
      if (!attachedObj) return;
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
      setViewportRevision((v) => v + 1);
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
      setViewportRevision((v) => v + 1);
    });
    ro.observe(host);

    // Animation frame loop (renders on demand when viewportRevision changes or during drag/animate)
    let rafId = 0;
    let lastRenderedVersion = -1;
    const renderLoop = () => {
      rafId = requestAnimationFrame(renderLoop);
      const cam = activeCameraRef.current;
      if (!cam) return;
      renderer.render(scene, cam);
      void lastRenderedVersion;
    };
    rafId = requestAnimationFrame(renderLoop);

    return () => {
      paintControllerRef.current.cancelStroke();
      cancelAnimationFrame(rafId);
      ro.disconnect();
      orbit.removeEventListener("change", onOrbitChange);
      transform.removeEventListener("dragging-changed", onDraggingChanged);
      transform.removeEventListener("objectChange", onObjectChange);
      transform.detach();
      transform.dispose();
      orbit.dispose();
      scene.remove(helper);
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
      setViewportRevision((v) => v + 1);
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
    setViewportRevision((v) => v + 1);
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
    setViewportRevision((v) => v + 1);
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

    const engine = pixelEngine.model3d;
    const { materialById, textureSizeByMaterialId } = materialCache.sync({
      materials: engine.materials,
      shadingMode: studio3d.shadingMode,
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
        transform.attach(targetObj);
      }
    }

    setViewportRevision((v) => v + 1);
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
      setViewportRevision((v) => v + 1);
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
    setViewportRevision((v) => v + 1);
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
            const prev = e.shiftKey ? [...(engine.selectedEdges[hitNodeId] ?? [])] : [];
            if (!prev.some(([a, b]) => a === bestEdge![0] && b === bestEdge![1])) {
              prev.push(bestEdge);
            }
            engine.selectedEdges[hitNodeId] = prev;
          }
        }
      }
    }

    bumpModel3DVersion();
  };

  void viewportRevision;

  return (
    <div className="m3d-viewport-shell">
      <div
        ref={stageRef}
        className="m3d-three-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      {/* Compact Top-Left HUD */}
      <div className="m3d-hud-overlay-tl">
        <span className="m3d-badge m3d-badge-mono">
          {sceneStats.nodeCount} Node{sceneStats.nodeCount === 1 ? "" : "s"}
        </span>
        <span className="m3d-badge m3d-badge-mono">
          {sceneStats.triangleCount} Tri{sceneStats.triangleCount === 1 ? "" : "s"}
        </span>
        <span className="m3d-badge">
          {studio3d.subMode.toUpperCase()} / {pixelEngine.model3d.selectionGranularity.toUpperCase()}
        </span>
        {vKeyHeld && (
          <span className="m3d-badge m3d-badge-accent">
            <Magnet size={11} />
            <span>V: Vertex Snap</span>
          </span>
        )}
      </div>

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
