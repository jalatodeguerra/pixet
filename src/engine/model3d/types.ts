import type { ModelModifier } from "./modifierTypes.ts";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // [x, y, z, w]

export type Studio3DWorkspaceKind = "sprite25d" | "lowpoly3d";
export type Model3DSubMode = "model" | "tile" | "uv" | "paint" | "animate" | "bake";
export type SelectionGranularity = "object" | "vertex" | "edge" | "face";
export type ShadingMode = "unlit" | "flat" | "ps1" | "pbr";
export type ColliderKind = "none" | "box" | "convex" | "trimesh";
export type GizmoMode = "select" | "move" | "rotate" | "scale";

export interface Transform3D {
  position: Vec3; // translation offset in pixel units
  rotation: Vec3; // Euler XYZ in degrees (interpolated via Quaternion SLERP in animEval)
  scale: Vec3;
  pivot: Vec3; // node origin in scene pixel units (exported as clean 1:1 Object3D origin)
}

export type CuboidFaceName = "north" | "south" | "east" | "west" | "up" | "down";

export interface CuboidFaceUV {
  uv: [number, number, number, number]; // [u0, v0, u1, v1] in integer pixels
  rotation: 0 | 90 | 180 | 270;
  flipX?: boolean;
  flipY?: boolean;
  materialId: string;
  hidden?: boolean; // culls unseen interior faces & frees UV budget
}

export interface CuboidData {
  from: Vec3; // min corner in pixel units
  to: Vec3; // max corner in pixel units
  inflate: number; // uniform expansion in pixel units (armor/clothing shells)
  uvMode: "box" | "per-face";
  uvLock: boolean; // preserves UV placement vs auto-resizing Box-UV when scaling from/to
  mirrorUvX?: boolean;
  boxUvOrigin: Vec2;
  faces: Record<CuboidFaceName, CuboidFaceUV>;
}

export interface PolyFace {
  id: string;
  verts: number[]; // 3 (tri) or 4 (quad) indices into PolyMeshData.vertices
  uvs: Vec2[]; // per-corner pixel coordinates [px, py]
  colors?: string[]; // optional per-corner hex/rgba vertex colors (PS1/DS shading & AO)
  triSplit?: "02" | "13"; // deterministic quad diagonal split (flippable via Ctrl+T)
  flatShading?: boolean; // default true (hard low-poly normals)
  materialId: string;
  tileSource?: {
    // metadata when stamped via Crocotile mode
    tilesetId: string;
    tileUid: string; // stable across tile deletion/reordering in Tileset.ts
    cachedTileId: number;
    rotation: 0 | 90 | 180 | 270;
    flipX: boolean;
    flipY: boolean;
  };
}

export interface PolyMeshData {
  vertices: Vec3[]; // topological vertices in pixel units
  faces: PolyFace[];
}

export interface ModelNode {
  id: string;
  name: string;
  kind: "group" | "cuboid" | "mesh";
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  colorTag?: string;
  collider: ColliderKind; // emits Godot -col / -convcol suffixes or glTF collider extras
  transform: Transform3D;
  cuboid?: CuboidData;
  mesh?: PolyMeshData;
  /** Non-destructive modifier stack (mesh nodes only). Evaluate via getEvaluatedMesh(). */
  modifiers?: ModelModifier[];
}

export type ModelMaterialSource =
  | { kind: "draw-canvas"; layerId?: string }
  | { kind: "tileset"; tilesetId: string }
  | { kind: "node-graph"; graphId: string }
  | { kind: "embedded"; width: number; height: number; pngBase64: string };

export interface ModelMaterial {
  id: string;
  name: string;
  source: ModelMaterialSource;
  doubleSided: boolean; // note: viewport also has an editor-only "See-Through Room Walls" override
  alphaTest: number; // default 0.5 for crisp pixel cutouts
  usePbrMaps: boolean; // auto-bind Draw normal/height/emission map_roles
}

export type TileCursorPlane = "xz" | "xy" | "zy";

export interface TileCursor3D {
  position: Vec3; // cursor origin in pixel units
  plane: TileCursorPlane;
  stepPx: number;
  rotation: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
  tilesetId: string;
  tileUid: string;
  cachedTileId: number;
}

export interface TilePrefab3D {
  id: string;
  name: string;
  mesh: PolyMeshData; // reusable stamped structure (pillar, arch, stair, crate)
  sizePx: Vec3;
}

export type ModelKeyframeProperty =
  | "posX"
  | "posY"
  | "posZ"
  | "rotX"
  | "rotY"
  | "rotZ"
  | "scaleX"
  | "scaleY"
  | "scaleZ";

export type ModelKeyframeEasing = "linear" | "step" | "easeIn" | "easeOut" | "easeInOut";

export interface ModelKeyframe {
  frame: number;
  nodeId: string;
  property: ModelKeyframeProperty;
  value: number;
  easing: ModelKeyframeEasing;
}

export interface ModelAnimationClip {
  id: string;
  name: string;
  frameCount: number;
  fps: number;
  loop: boolean;
  keyframes: ModelKeyframe[];
}

export interface Model3DSceneSnapshot {
  version: 1;
  pixelsPerUnit: number;
  nodes: ModelNode[];
  materials: ModelMaterial[];
  prefabs: TilePrefab3D[];
  clips: ModelAnimationClip[];
  activeClipId: string | null;
  tileCursor: TileCursor3D;
  selectedNodeIds: string[];
  activeNodeId: string | null;
  selectionGranularity: SelectionGranularity;
  selectedVertices: Record<string, number[]>;
  selectedEdges: Record<string, Array<[number, number]>>;
  selectedFaces: Record<string, string[]>;
}
