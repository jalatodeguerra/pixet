import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { pixelEngine } from "../../../engine/document/PixelEngine";
import {
  boxSelectMode,
  collectUniqueEdges,
  combineSelection,
  normalizeRect,
  selectEdgesInRect,
  selectFacesInRect,
  selectNodesInRect,
  selectVerticesInRect,
  type ProjectedPoint,
  type ScreenRect,
} from "../../../engine/model3d/boxSelect";
import { clonePolyMeshData } from "../../../engine/model3d/Model3DEngine";
import {
  bevelEdges,
  bevelVertices,
  collectAffectedVertexIndices,
  computeFaceNormal,
  computeVerticesCentroid,
  extrudeFaces,
  insetFaces,
} from "../../../engine/model3d/meshOps";
import {
  commitModel3DUndoStep,
  restoreModel3DSnapshot,
} from "../../../engine/model3d/model3dActions";
import {
  appendTypedChar,
  formatModalHud,
  MODAL_AXIS_COLORS,
  MODAL_AXIS_VECTORS,
  modalLabel,
  resolveDistanceValue,
  resolveModalOp,
  safeNormalize,
  transformMeshVerticesByOp,
  type MeshWorldSpace,
  type ModalAxis,
  type ModalHudKind,
  type ModalViewBasis,
  type ResolvedModalOp,
} from "../../../engine/model3d/modalTransform";
import type {
  ModelNode,
  PolyMeshData,
  SelectionGranularity,
  Transform3D,
  Vec2,
  Vec3,
} from "../../../engine/model3d/types";
import { useEditorStore } from "../../../store/editorStore";
import type { ModalBridgeHandlers, ModalRequestKind } from "./modalBridge";
import type { MaterialTextureInfo } from "./retroMaterials";
import {
  collectSelectedSubObjectPositions,
  objectTransformToNodeTransform,
  updateMeshNodeGeometryInPlace,
} from "./sceneSync";

/** Everything the controller needs from the viewport component, read lazily. */
export interface ModalContext {
  getHost(): HTMLDivElement | null;
  getCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
  getOrbit(): OrbitControls | null;
  getTransform(): TransformControls | null;
  getScene(): THREE.Scene | null;
  getNodeObjects(): Map<string, THREE.Object3D>;
  getTextureInfo(): Map<string, MaterialTextureInfo>;
  /** Rebuilds the vertex/edge/face selection overlay from engine state. */
  rebuildOverlay(): void;
  requestRender(): void;
  setHud(text: string | null): void;
  setBoxRect(rect: ScreenRect | null): void;
}

interface EditTarget {
  nodeId: string;
  nodeObj: THREE.Object3D;
  baseMesh: PolyMeshData;
  vertexIndices: number[];
  space: MeshWorldSpace;
}

interface ScalarTarget {
  nodeId: string;
  nodeObj: THREE.Object3D;
  baseMesh: PolyMeshData;
  baseGranularity: SelectionGranularity;
  baseVertices: number[];
  baseEdges: Array<[number, number]>;
  baseFaces: string[];
  /** Applies the value, mutating the engine's node mesh + selection. */
  apply(value: number): void;
}

interface ObjectTarget {
  node: ModelNode;
  obj: THREE.Object3D;
  parentNode: ModelNode | undefined;
  baseTransform: Transform3D;
  baseWorld: THREE.Matrix4;
}

interface ModalSession {
  kind: ModalHudKind;
  beforeSnap: string;
  startPointer: Vec2;
  pointer: Vec2;
  pivotWorld: THREE.Vector3;
  pivotScreen: Vec2;
  axis: ModalAxis | null;
  /** Axis used when no X/Y/Z key is active (extrude normal). */
  customAxis: Vec3 | null;
  typed: string;
  snap: boolean;
  edit?: EditTarget;
  scalar?: ScalarTarget;
  objects?: ObjectTarget[];
  axisLine: THREE.Line | null;
}

interface BoxSession {
  start: Vec2 | null;
  current: Vec2 | null;
  shift: boolean;
  ctrl: boolean;
}

const HUD_BOX = "Box Select — drag a rectangle (Shift adds, Ctrl subtracts), Esc/right-click cancel";
const MIN_BOX_PX = 3;

function toVec3(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

/**
 * Owns the Blender-style modal operators and box select for the Model sub-mode.
 *
 * While a session is active, keydown and pointerdown are consumed in the capture
 * phase on `window` so neither App.tsx's shortcuts nor OrbitControls /
 * TransformControls ever see them; OrbitControls is additionally disabled.
 * Live edits mutate the engine directly (like the gizmo drag) and one undo step
 * is committed on confirm; cancel restores the pre-session snapshot exactly.
 */
export class ModalOperatorController implements ModalBridgeHandlers {
  private session: ModalSession | null = null;
  private box: BoxSession | null = null;
  private lastClient: Vec2 | null = null;
  private orbitWasEnabled = true;

  constructor(private readonly ctx: ModalContext) {}

  isActive(): boolean {
    return this.session !== null || this.box !== null;
  }

  trackPointer(clientX: number, clientY: number): void {
    this.lastClient = [clientX, clientY];
  }

  dispose(): void {
    if (this.session) this.cancelSession();
    if (this.box) this.endBox();
  }

  // -------------------------------------------------------------------------
  // Geometry helpers
  // -------------------------------------------------------------------------

  private hostRect(): DOMRect | null {
    return this.ctx.getHost()?.getBoundingClientRect() ?? null;
  }

  private pointerInHost(): Vec2 {
    const rect = this.hostRect();
    if (!rect) return [0, 0];
    const c = this.lastClient;
    if (!c) return [rect.width / 2, rect.height / 2];
    return [c[0] - rect.left, c[1] - rect.top];
  }

  /** World position -> viewport pixels (null behind a perspective camera). */
  private project(world: THREE.Vector3): ProjectedPoint {
    const cam = this.ctx.getCamera();
    const rect = this.hostRect();
    if (!cam || !rect) return null;
    cam.updateMatrixWorld();
    if (cam instanceof THREE.PerspectiveCamera) {
      const viewZ = world.clone().applyMatrix4(cam.matrixWorldInverse).z;
      if (viewZ >= -cam.near) return null;
    }
    const ndc = world.clone().project(cam);
    return [((ndc.x + 1) / 2) * rect.width, ((1 - ndc.y) / 2) * rect.height];
  }

  private viewBasis(pivot: THREE.Vector3): ModalViewBasis {
    const cam = this.ctx.getCamera();
    if (!cam) {
      return { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], worldPerPixel: 0.01 };
    }
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const right: Vec3 = [e[0], e[1], e[2]];
    const up: Vec3 = [e[4], e[5], e[6]];
    const forward: Vec3 = [-e[8], -e[9], -e[10]];
    const p0 = this.project(pivot);
    const p1 = this.project(pivot.clone().add(new THREE.Vector3(...right)));
    let worldPerPixel = 0.01;
    if (p0 && p1) {
      const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (d > 1e-6) worldPerPixel = 1 / d;
    }
    return { right, up, forward, worldPerPixel };
  }

  private ppu(): number {
    return Math.max(1, pixelEngine.model3d.pixelsPerUnit);
  }

  private snapPx(): number {
    return Math.max(0.05, useEditorStore.getState().studio3d.snapPx || 1);
  }

  private meshSpace(obj: THREE.Object3D, node: ModelNode): MeshWorldSpace {
    obj.updateMatrixWorld(true);
    return {
      worldMatrix: Array.from(obj.matrixWorld.elements),
      inverseWorldMatrix: Array.from(obj.matrixWorld.clone().invert().elements),
      ppu: this.ppu(),
      nodePivot: node.transform.pivot,
    };
  }

  private refreshGeometry(nodeObj: THREE.Object3D, node: ModelNode): void {
    const st = useEditorStore.getState();
    updateMeshNodeGeometryInPlace(nodeObj, node, this.ppu(), {
      textureSizeByMaterialId: this.ctx.getTextureInfo(),
      defaultTextureWidth: Math.max(1, st.canvasWidth),
      defaultTextureHeight: Math.max(1, st.canvasHeight),
    });
    this.ctx.rebuildOverlay();
    this.ctx.requestRender();
  }

  // -------------------------------------------------------------------------
  // Starting modal operators
  // -------------------------------------------------------------------------

  startModal(kind: ModalRequestKind): string | null {
    if (this.isActive()) return null;
    const st = useEditorStore.getState();
    if (st.workspaceMode !== "studio3d" || st.studio3d.subMode !== "model") {
      return "Modal tools are available in the Model sub-mode";
    }
    if (!this.ctx.getCamera() || !this.ctx.getHost()) return "3D viewport is not ready";
    const engine = pixelEngine.model3d;
    const beforeSnap = pixelEngine.model3dHistory.captureSnapshot(engine);

    if (kind === "grab" || kind === "rotate" || kind === "scale") {
      return engine.selectionGranularity === "object"
        ? this.beginObjectTransform(kind, beforeSnap)
        : this.beginEditTransform(kind, beforeSnap);
    }
    if (engine.selectionGranularity === "object") {
      return "Press Tab to enter Edit Mode first";
    }
    if (kind === "extrude") return this.beginExtrude(beforeSnap);
    if (kind === "inset") return this.beginInset(beforeSnap);
    return this.beginBevel(beforeSnap);
  }

  private makeSession(
    kind: ModalHudKind,
    beforeSnap: string,
    pivotWorld: THREE.Vector3,
    customAxis: Vec3 | null
  ): ModalSession {
    const pointer = this.pointerInHost();
    return {
      kind,
      beforeSnap,
      startPointer: pointer,
      pointer,
      pivotWorld,
      pivotScreen: this.project(pivotWorld) ?? pointer,
      axis: null,
      customAxis,
      typed: "",
      snap: false,
      axisLine: null,
    };
  }

  private activeEditableMesh():
    | { node: ModelNode; obj: THREE.Object3D; error: null }
    | { error: string } {
    const engine = pixelEngine.model3d;
    const node = engine.activeNodeId ? engine.getNode(engine.activeNodeId) : undefined;
    if (!node) return { error: "Select a mesh node first" };
    if (node.locked) return { error: `"${node.name}" is locked` };
    if (node.kind !== "mesh" || !node.mesh) {
      return { error: "The active node is not a mesh — press Tab to leave Edit Mode, then Tab again to convert it" };
    }
    const obj = this.ctx.getNodeObjects().get(node.id);
    if (!obj) return { error: "The active node is hidden" };
    return { node, obj, error: null };
  }

  private affectedVertices(node: ModelNode): number[] {
    const engine = pixelEngine.model3d;
    if (!node.mesh) return [];
    return collectAffectedVertexIndices(
      node.mesh,
      engine.selectionGranularity,
      engine.selectedVertices[node.id] ?? [],
      engine.selectedEdges[node.id] ?? [],
      engine.selectedFaces[node.id] ?? []
    );
  }

  private pivotOfVertices(node: ModelNode, obj: THREE.Object3D, verts: number[]): THREE.Vector3 | null {
    if (!node.mesh) return null;
    const c = computeVerticesCentroid(node.mesh.vertices, verts);
    if (!c) return null;
    const space = this.meshSpace(obj, node);
    const piv = c;
    const ppu = space.ppu;
    return new THREE.Vector3(
      (piv[0] - node.transform.pivot[0]) / ppu,
      (piv[1] - node.transform.pivot[1]) / ppu,
      (piv[2] - node.transform.pivot[2]) / ppu
    ).applyMatrix4(obj.matrixWorld);
  }

  private beginEditTransform(kind: "grab" | "rotate" | "scale", beforeSnap: string): string | null {
    const target = this.activeEditableMesh();
    if (target.error !== null) return target.error;
    const { node, obj } = target;
    const verts = this.affectedVertices(node);
    if (verts.length === 0) return "Nothing selected — click elements or press A to select all";
    const pivot = this.pivotOfVertices(node, obj, verts);
    if (!pivot || !node.mesh) return "Nothing selected";
    const session = this.makeSession(kind, beforeSnap, pivot, null);
    session.edit = {
      nodeId: node.id,
      nodeObj: obj,
      baseMesh: clonePolyMeshData(node.mesh),
      vertexIndices: verts,
      space: this.meshSpace(obj, node),
    };
    this.begin(session);
    return null;
  }

  private beginObjectTransform(kind: "grab" | "rotate" | "scale", beforeSnap: string): string | null {
    const engine = pixelEngine.model3d;
    const selected = new Set(engine.selectedNodeIds);
    const objects: ObjectTarget[] = [];
    const objMap = this.ctx.getNodeObjects();
    for (const id of engine.selectedNodeIds) {
      const node = engine.getNode(id);
      if (!node || node.locked) continue;
      // A child of another selected node moves with it; transforming both would double-apply.
      let ancestorSelected = false;
      for (let p = node.parentId ? engine.getNode(node.parentId) : undefined; p; p = p.parentId ? engine.getNode(p.parentId) : undefined) {
        if (selected.has(p.id)) {
          ancestorSelected = true;
          break;
        }
      }
      if (ancestorSelected) continue;
      const obj = objMap.get(id);
      if (!obj) continue;
      obj.updateMatrixWorld(true);
      objects.push({
        node,
        obj,
        parentNode: node.parentId ? engine.getNode(node.parentId) : undefined,
        baseTransform: {
          position: [...node.transform.position],
          rotation: [...node.transform.rotation],
          scale: [...node.transform.scale],
          pivot: [...node.transform.pivot],
        },
        baseWorld: obj.matrixWorld.clone(),
      });
    }
    if (objects.length === 0) return "Select an unlocked node first";
    const pivot = new THREE.Vector3();
    for (const o of objects) pivot.add(new THREE.Vector3().setFromMatrixPosition(o.baseWorld));
    pivot.multiplyScalar(1 / objects.length);
    const session = this.makeSession(kind, beforeSnap, pivot, null);
    session.objects = objects;
    this.begin(session);
    return null;
  }

  private beginExtrude(beforeSnap: string): string | null {
    const engine = pixelEngine.model3d;
    if (engine.selectionGranularity !== "face") {
      return "Extrude works on faces — press 3 for face select";
    }
    const target = this.activeEditableMesh();
    if (target.error !== null) return target.error;
    const { node, obj } = target;
    const faceIds = engine.selectedFaces[node.id] ?? [];
    if (faceIds.length === 0 || !node.mesh) return "Select one or more faces to extrude";

    const res = extrudeFaces(node.mesh, faceIds, 0);
    if (res.extrudedFaceIds.length === 0) return "Select one or more faces to extrude";
    engine.updateNode(node.id, { mesh: res.mesh });
    engine.selectedFaces[node.id] = res.extrudedFaceIds;
    const edited = engine.getNode(node.id);
    if (!edited || !edited.mesh) return "Extrude failed";
    this.refreshGeometry(obj, edited);

    // Average face normal (local -> world with the normal matrix) is the grab axis.
    let sum: Vec3 = [0, 0, 0];
    const idSet = new Set(res.extrudedFaceIds);
    for (const f of edited.mesh.faces) {
      if (!idSet.has(f.id)) continue;
      const n = computeFaceNormal(edited.mesh.vertices, f);
      sum = [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2]];
    }
    obj.updateMatrixWorld(true);
    const nm = new THREE.Matrix3().getNormalMatrix(obj.matrixWorld);
    const worldNormal = safeNormalize(
      toVec3(new THREE.Vector3(...sum).applyMatrix3(nm))
    ) ?? [0, 1, 0];

    const verts = this.affectedVertices(edited);
    const pivot = this.pivotOfVertices(edited, obj, verts);
    if (!pivot) return "Extrude failed";
    const session = this.makeSession("extrude", beforeSnap, pivot, worldNormal);
    session.edit = {
      nodeId: node.id,
      nodeObj: obj,
      baseMesh: clonePolyMeshData(edited.mesh),
      vertexIndices: verts,
      space: this.meshSpace(obj, edited),
    };
    this.begin(session);
    return null;
  }

  private captureScalarBase(node: ModelNode, obj: THREE.Object3D, apply: ScalarTarget["apply"]): ScalarTarget | null {
    const engine = pixelEngine.model3d;
    if (!node.mesh) return null;
    return {
      nodeId: node.id,
      nodeObj: obj,
      baseMesh: clonePolyMeshData(node.mesh),
      baseGranularity: engine.selectionGranularity,
      baseVertices: [...(engine.selectedVertices[node.id] ?? [])],
      baseEdges: (engine.selectedEdges[node.id] ?? []).map(([a, b]) => [a, b] as [number, number]),
      baseFaces: [...(engine.selectedFaces[node.id] ?? [])],
      apply,
    };
  }

  private beginInset(beforeSnap: string): string | null {
    const engine = pixelEngine.model3d;
    if (engine.selectionGranularity !== "face") {
      return "Inset works on faces — press 3 for face select";
    }
    const target = this.activeEditableMesh();
    if (target.error !== null) return target.error;
    const { node, obj } = target;
    const faceIds = [...(engine.selectedFaces[node.id] ?? [])];
    if (faceIds.length === 0) return "Select one or more faces to inset";
    const verts = this.affectedVertices(node);
    const pivot = this.pivotOfVertices(node, obj, verts);
    if (!pivot) return "Nothing selected";
    const scalar = this.captureScalarBase(node, obj, (value) => {
      const n = engine.getNode(node.id);
      if (!n) return;
      const base = scalar!.baseMesh;
      if (value <= 1e-6) {
        n.mesh = clonePolyMeshData(base);
        engine.selectedFaces[node.id] = [...scalar!.baseFaces];
        return;
      }
      const res = insetFaces(base, faceIds, value);
      n.mesh = res.mesh;
      engine.selectedFaces[node.id] = res.innerFaceIds.length > 0 ? res.innerFaceIds : [...faceIds];
    });
    if (!scalar) return "Inset failed";
    const session = this.makeSession("inset", beforeSnap, pivot, null);
    session.scalar = scalar;
    this.begin(session);
    return null;
  }

  private beginBevel(beforeSnap: string): string | null {
    const engine = pixelEngine.model3d;
    const gran = engine.selectionGranularity;
    if (gran === "face") return "Bevel works on edges or vertices — press 2 for edge select";
    const target = this.activeEditableMesh();
    if (target.error !== null) return target.error;
    const { node, obj } = target;
    const edges = (engine.selectedEdges[node.id] ?? []).map(([a, b]) => [a, b] as [number, number]);
    const verts = [...(engine.selectedVertices[node.id] ?? [])];
    if (gran === "edge" && edges.length === 0) return "Select one or more edges to bevel";
    if (gran === "vertex" && verts.length === 0) return "Select one or more vertices to bevel";
    const pivotVerts = this.affectedVertices(node);
    const pivot = this.pivotOfVertices(node, obj, pivotVerts);
    if (!pivot) return "Nothing selected";
    const scalar = this.captureScalarBase(node, obj, (value) => {
      const n = engine.getNode(node.id);
      const s = scalar!;
      if (!n) return;
      if (value <= 1e-6) {
        n.mesh = clonePolyMeshData(s.baseMesh);
        engine.setSelectionGranularity(s.baseGranularity);
        engine.selectedVertices[node.id] = [...s.baseVertices];
        engine.selectedEdges[node.id] = s.baseEdges.map(([a, b]) => [a, b] as [number, number]);
        engine.selectedFaces[node.id] = [...s.baseFaces];
        return;
      }
      const res = gran === "edge" ? bevelEdges(s.baseMesh, edges, value) : bevelVertices(s.baseMesh, verts, value);
      n.mesh = res.mesh;
      engine.selectedVertices[node.id] = [];
      engine.selectedEdges[node.id] = [];
      engine.setSelectionGranularity("face");
      engine.selectedFaces[node.id] = res.bevelFaceIds;
    });
    if (!scalar) return "Bevel failed";
    const session = this.makeSession("bevel", beforeSnap, pivot, null);
    session.scalar = scalar;
    this.begin(session);
    return null;
  }

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  private begin(session: ModalSession): void {
    this.session = session;
    this.lockInput();
    window.addEventListener("keydown", this.onSessionKeyDown, true);
    window.addEventListener("keyup", this.onSessionKeyUp, true);
    window.addEventListener("pointerdown", this.onSessionPointerDown, true);
    window.addEventListener("pointermove", this.onSessionPointerMove, true);
    window.addEventListener("contextmenu", this.onContextMenu, true);
    this.syncAxisLine();
    this.update();
  }

  private lockInput(): void {
    const orbit = this.ctx.getOrbit();
    this.orbitWasEnabled = orbit?.enabled ?? true;
    if (orbit) orbit.enabled = false;
    const transform = this.ctx.getTransform();
    if (transform) {
      transform.enabled = false;
      transform.getHelper().visible = false;
    }
  }

  private unlockInput(): void {
    const orbit = this.ctx.getOrbit();
    if (orbit) orbit.enabled = this.orbitWasEnabled;
    const transform = this.ctx.getTransform();
    if (transform) {
      transform.enabled = true;
      transform.getHelper().visible = true;
    }
  }

  private endSession(): void {
    const s = this.session;
    this.session = null;
    window.removeEventListener("keydown", this.onSessionKeyDown, true);
    window.removeEventListener("keyup", this.onSessionKeyUp, true);
    window.removeEventListener("pointerdown", this.onSessionPointerDown, true);
    window.removeEventListener("pointermove", this.onSessionPointerMove, true);
    // The right-click that cancels is followed by a contextmenu event: keep suppressing it briefly.
    window.setTimeout(() => window.removeEventListener("contextmenu", this.onContextMenu, true), 300);
    if (s?.axisLine) this.removeAxisLine(s.axisLine);
    this.unlockInput();
    this.ctx.setHud(null);
    this.ctx.requestRender();
  }

  confirmSession(): void {
    const s = this.session;
    if (!s) return;
    this.endSession();
    const label = modalLabel(s.kind);
    commitModel3DUndoStep(s.beforeSnap, label);
  }

  cancelSession(): void {
    const s = this.session;
    if (!s) return;
    this.endSession();
    restoreModel3DSnapshot(s.beforeSnap);
  }

  private readonly onContextMenu = (e: Event) => {
    e.preventDefault();
  };

  // -------------------------------------------------------------------------
  // Applying
  // -------------------------------------------------------------------------

  private resolveOp(s: ModalSession): ResolvedModalOp {
    const kind = s.kind === "extrude" ? "grab" : (s.kind as "grab" | "rotate" | "scale");
    const axisName = s.axis;
    const axisVec: Vec3 | null = axisName ? MODAL_AXIS_VECTORS[axisName] : s.customAxis;
    return resolveModalOp({
      kind,
      pivotScreen: s.pivotScreen,
      startPointer: s.startPointer,
      pointer: s.pointer,
      axis: axisVec,
      typed: s.typed,
      snap: s.snap,
      snapPx: this.snapPx(),
      ppu: this.ppu(),
      view: this.viewBasis(s.pivotWorld),
    });
  }

  private update(): void {
    const s = this.session;
    if (!s) return;
    const engine = pixelEngine.model3d;

    if (s.scalar) {
      const sc = s.scalar;
      const value = resolveDistanceValue({
        pivotScreen: s.pivotScreen,
        startPointer: s.startPointer,
        pointer: s.pointer,
        typed: s.typed,
        snap: s.snap,
        snapPx: this.snapPx(),
        ppu: this.ppu(),
        worldPerPixel: this.viewBasis(s.pivotWorld).worldPerPixel,
      });
      sc.apply(value);
      const node = engine.getNode(sc.nodeId);
      if (node) this.refreshGeometry(sc.nodeObj, node);
      this.ctx.setHud(
        formatModalHud({ kind: s.kind, axis: null, typed: s.typed, value, snap: s.snap })
      );
      return;
    }

    const op = this.resolveOp(s);
    if (s.edit) {
      const node = engine.getNode(s.edit.nodeId);
      if (node) {
        node.mesh = transformMeshVerticesByOp(
          s.edit.baseMesh,
          s.edit.vertexIndices,
          s.edit.space,
          op,
          toVec3(s.pivotWorld)
        );
        this.refreshGeometry(s.edit.nodeObj, node);
      }
    } else if (s.objects) {
      this.applyToObjects(s.objects, op, s.pivotWorld);
    }
    this.ctx.setHud(
      formatModalHud({
        kind: s.kind,
        axis: s.axis,
        normalAxis: s.axis === null && s.customAxis !== null,
        typed: s.typed,
        op,
        snap: s.snap,
      })
    );
    this.ctx.requestRender();
  }

  private applyToObjects(objects: ObjectTarget[], op: ResolvedModalOp, pivot: THREE.Vector3): void {
    const ppu = this.ppu();
    const opMatrix = new THREE.Matrix4();
    if (op.kind === "grab") {
      opMatrix.makeTranslation(op.translation[0], op.translation[1], op.translation[2]);
    } else {
      const about = new THREE.Matrix4();
      if (op.kind === "rotate") {
        about.makeRotationAxis(new THREE.Vector3(...op.axis).normalize(), op.angleRad);
      } else if (op.axis) {
        const k = new THREE.Vector3(...op.axis).normalize();
        const f = op.factor - 1;
        about.set(
          1 + f * k.x * k.x, f * k.x * k.y, f * k.x * k.z, 0,
          f * k.y * k.x, 1 + f * k.y * k.y, f * k.y * k.z, 0,
          f * k.z * k.x, f * k.z * k.y, 1 + f * k.z * k.z, 0,
          0, 0, 0, 1
        );
      } else {
        about.makeScale(op.factor, op.factor, op.factor);
      }
      opMatrix
        .makeTranslation(pivot.x, pivot.y, pivot.z)
        .multiply(about)
        .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    }

    for (const t of objects) {
      const newWorld = opMatrix.clone().multiply(t.baseWorld);
      const parent = t.obj.parent;
      if (parent) parent.updateMatrixWorld(true);
      const local = parent
        ? parent.matrixWorld.clone().invert().multiply(newWorld)
        : newWorld;
      local.decompose(t.obj.position, t.obj.quaternion, t.obj.scale);
      t.obj.updateMatrixWorld(true);
      const next = objectTransformToNodeTransform(t.obj, t.node, t.parentNode, ppu);
      t.node.transform.position = next.position;
      t.node.transform.rotation = next.rotation;
      t.node.transform.scale = next.scale;
    }
  }

  // -------------------------------------------------------------------------
  // Axis line
  // -------------------------------------------------------------------------

  private removeAxisLine(line: THREE.Line): void {
    line.parent?.remove(line);
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
  }

  private syncAxisLine(): void {
    const s = this.session;
    const scene = this.ctx.getScene();
    if (!s || !scene) return;
    if (s.axisLine) {
      this.removeAxisLine(s.axisLine);
      s.axisLine = null;
    }
    if (s.scalar) return;
    let dir: Vec3 | null = null;
    let color = 0xf5b041;
    if (s.axis) {
      dir = MODAL_AXIS_VECTORS[s.axis];
      color = MODAL_AXIS_COLORS[s.axis];
    } else if (s.customAxis) {
      dir = s.customAxis;
    }
    if (!dir) return;
    const p = s.pivotWorld;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p.x - dir[0] * 500, p.y - dir[1] * 500, p.z - dir[2] * 500),
      new THREE.Vector3(p.x + dir[0] * 500, p.y + dir[1] * 500, p.z + dir[2] * 500),
    ]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 })
    );
    line.renderOrder = 30;
    line.frustumCulled = false;
    scene.add(line);
    s.axisLine = line;
  }

  // -------------------------------------------------------------------------
  // Session event handlers
  // -------------------------------------------------------------------------

  private readonly onSessionKeyDown = (e: KeyboardEvent) => {
    const s = this.session;
    if (!s) return;
    // Leave function keys (reload, devtools) to the browser.
    if (/^F\d+$/.test(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (e.key === "Escape") {
      this.cancelSession();
      return;
    }
    if (e.key === "Enter") {
      this.confirmSession();
      return;
    }
    if (e.key === "Control" || e.key === "Meta") {
      s.snap = true;
      this.update();
      return;
    }
    if (e.key === "Shift" || e.key === "Alt") return;

    const lower = e.key.toLowerCase();
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !s.scalar && (lower === "x" || lower === "y" || lower === "z")) {
      s.axis = s.axis === lower ? null : lower;
      this.syncAxisLine();
      this.update();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const next = appendTypedChar(s.typed, e.key);
    if (next !== null) {
      s.typed = next;
      this.update();
    }
  };

  private readonly onSessionKeyUp = (e: KeyboardEvent) => {
    const s = this.session;
    if (!s) return;
    if (/^F\d+$/.test(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Control" || e.key === "Meta") {
      s.snap = false;
      this.update();
    }
  };

  private readonly onSessionPointerDown = (e: PointerEvent) => {
    if (!this.session) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.button === 0) this.confirmSession();
    else if (e.button === 2) this.cancelSession();
  };

  private readonly onSessionPointerMove = (e: PointerEvent) => {
    const s = this.session;
    if (!s) return;
    const rect = this.hostRect();
    if (!rect) return;
    this.lastClient = [e.clientX, e.clientY];
    s.pointer = [e.clientX - rect.left, e.clientY - rect.top];
    s.snap = e.ctrlKey || e.metaKey;
    this.update();
  };

  // -------------------------------------------------------------------------
  // Box select
  // -------------------------------------------------------------------------

  startBoxSelect(): string | null {
    if (this.isActive()) return null;
    const st = useEditorStore.getState();
    if (st.workspaceMode !== "studio3d" || st.studio3d.subMode !== "model") {
      return "Box select is available in the Model sub-mode";
    }
    if (!this.ctx.getCamera() || !this.ctx.getHost()) return "3D viewport is not ready";
    const engine = pixelEngine.model3d;
    if (engine.selectionGranularity !== "object") {
      const target = this.activeEditableMesh();
      if (target.error !== null) return target.error;
    }
    this.box = { start: null, current: null, shift: false, ctrl: false };
    this.lockInput();
    window.addEventListener("keydown", this.onBoxKeyDown, true);
    window.addEventListener("keyup", this.onBoxKeyUp, true);
    window.addEventListener("pointerdown", this.onBoxPointerDown, true);
    window.addEventListener("pointermove", this.onBoxPointerMove, true);
    window.addEventListener("pointerup", this.onBoxPointerUp, true);
    window.addEventListener("contextmenu", this.onContextMenu, true);
    this.ctx.setHud(HUD_BOX);
    return null;
  }

  private endBox(): void {
    this.box = null;
    window.removeEventListener("keydown", this.onBoxKeyDown, true);
    window.removeEventListener("keyup", this.onBoxKeyUp, true);
    window.removeEventListener("pointerdown", this.onBoxPointerDown, true);
    window.removeEventListener("pointermove", this.onBoxPointerMove, true);
    window.removeEventListener("pointerup", this.onBoxPointerUp, true);
    window.setTimeout(() => window.removeEventListener("contextmenu", this.onContextMenu, true), 300);
    this.unlockInput();
    this.ctx.setBoxRect(null);
    this.ctx.setHud(null);
    this.ctx.requestRender();
  }

  private readonly onBoxKeyDown = (e: KeyboardEvent) => {
    const b = this.box;
    if (!b) return;
    if (/^F\d+$/.test(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.key === "Escape") {
      this.endBox();
      return;
    }
    if (e.key === "Shift") b.shift = true;
    if (e.key === "Control" || e.key === "Meta") b.ctrl = true;
  };

  private readonly onBoxKeyUp = (e: KeyboardEvent) => {
    const b = this.box;
    if (!b) return;
    if (/^F\d+$/.test(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Shift") b.shift = false;
    if (e.key === "Control" || e.key === "Meta") b.ctrl = false;
  };

  private readonly onBoxPointerDown = (e: PointerEvent) => {
    const b = this.box;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.button === 2) {
      this.endBox();
      return;
    }
    if (e.button !== 0) return;
    const rect = this.hostRect();
    if (!rect) return;
    const p: Vec2 = [e.clientX - rect.left, e.clientY - rect.top];
    if (p[0] < 0 || p[1] < 0 || p[0] > rect.width || p[1] > rect.height) {
      this.endBox();
      return;
    }
    b.start = p;
    b.current = p;
    b.shift = e.shiftKey;
    b.ctrl = e.ctrlKey || e.metaKey;
  };

  private readonly onBoxPointerMove = (e: PointerEvent) => {
    const b = this.box;
    if (!b) return;
    const rect = this.hostRect();
    if (!rect) return;
    this.lastClient = [e.clientX, e.clientY];
    if (!b.start) return;
    b.current = [e.clientX - rect.left, e.clientY - rect.top];
    b.shift = e.shiftKey;
    b.ctrl = e.ctrlKey || e.metaKey;
    const r = normalizeRect(b.start[0], b.start[1], b.current[0], b.current[1]);
    this.ctx.setBoxRect(r);
  };

  private readonly onBoxPointerUp = (e: PointerEvent) => {
    const b = this.box;
    if (!b || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!b.start) return;
    const rect = this.hostRect();
    if (!rect) {
      this.endBox();
      return;
    }
    const end: Vec2 = [e.clientX - rect.left, e.clientY - rect.top];
    const r = normalizeRect(b.start[0], b.start[1], end[0], end[1]);
    const mode = boxSelectMode(b.shift || e.shiftKey, b.ctrl || e.ctrlKey || e.metaKey);
    this.endBox();
    if (r.x1 - r.x0 < MIN_BOX_PX && r.y1 - r.y0 < MIN_BOX_PX) return;
    this.applyBoxSelection(r, mode);
  };

  private applyBoxSelection(rect: ScreenRect, mode: ReturnType<typeof boxSelectMode>): void {
    const engine = pixelEngine.model3d;
    const gran = engine.selectionGranularity;

    if (gran === "object") {
      const anchors: Array<{ id: string; point: ProjectedPoint }> = [];
      for (const node of engine.nodes) {
        if (!node.visible) continue;
        const obj = this.ctx.getNodeObjects().get(node.id);
        if (!obj) continue;
        obj.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(obj);
        const center = box.isEmpty()
          ? new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld)
          : box.getCenter(new THREE.Vector3());
        anchors.push({ id: node.id, point: this.project(center) });
      }
      const hits = selectNodesInRect(anchors, rect);
      const next = combineSelection(engine.selectedNodeIds, hits, mode);
      const active =
        engine.activeNodeId && next.includes(engine.activeNodeId)
          ? engine.activeNodeId
          : (next[next.length - 1] ?? null);
      engine.selectNodes(next, active);
      useEditorStore.getState().bumpModel3DVersion();
      useEditorStore.getState().setStatusMessage(`Box selected ${hits.length} node(s)`);
      return;
    }

    const target = this.activeEditableMesh();
    if (target.error !== null) {
      useEditorStore.getState().setStatusMessage(target.error);
      return;
    }
    const { node } = target;
    if (!node.mesh) return;
    const { vertices } = collectSelectedSubObjectPositions(node, target.obj, this.ppu());
    const projected = vertices.map((v) => this.project(v));
    let count = 0;
    if (gran === "vertex") {
      const hits = selectVerticesInRect(projected, rect);
      engine.selectedVertices[node.id] = combineSelection(engine.selectedVertices[node.id] ?? [], hits, mode);
      count = hits.length;
    } else if (gran === "edge") {
      const hits = selectEdgesInRect(projected, collectUniqueEdges(node.mesh), rect);
      engine.selectedEdges[node.id] = combineSelection(
        engine.selectedEdges[node.id] ?? [],
        hits,
        mode,
        (ed) => `${Math.min(ed[0], ed[1])}:${Math.max(ed[0], ed[1])}`
      );
      count = hits.length;
    } else {
      const hits = selectFacesInRect(projected, node.mesh.faces, rect);
      engine.selectedFaces[node.id] = combineSelection(engine.selectedFaces[node.id] ?? [], hits, mode);
      count = hits.length;
    }
    useEditorStore.getState().bumpModel3DVersion();
    useEditorStore.getState().setStatusMessage(`Box ${mode === "subtract" ? "deselected" : "selected"} ${count} ${gran}(s)`);
  }
}
