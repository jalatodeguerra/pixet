import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { PixelBuffer } from "../../../engine/document/PixelBuffer";
import { pixelEngine, type LayerCompositingInfo } from "../../../engine/document/PixelEngine";
import {
  evaluateNodePoseAtFrame,
  evaluateWorldNodeTransforms,
} from "../../../engine/model3d/animEval";
import {
  DEFAULT_MODEL3D_MATERIAL_ID,
  type Model3DEngine,
} from "../../../engine/model3d/Model3DEngine";
import type {
  ColliderKind,
  CuboidData,
  CuboidFaceName,
  CuboidFaceUV,
  ModelMaterial,
  ModelNode,
  PolyMeshData,
  Vec2,
  Vec3,
} from "../../../engine/model3d/types";
import { useEditorStore, type LayerItem } from "../../../store/editorStore";
import {
  resolveModelMaterialBuffer,
  type MaterialTextureInfo,
} from "./retroMaterials";
import { getEvaluatedMesh } from "../../../engine/model3d/modifiers";
import { disposeSyncedObjectTree, syncModel3DScene } from "./sceneSync";

export type ExportScalePreset = "16px_1m" | "1px_1m" | "custom";

export interface ModelExportOptions {
  scalePreset?: ExportScalePreset;
  /** Custom scale in meters per pixel when `scalePreset === "custom"`. */
  metersPerPixel?: number;
  includeGodotColliders?: boolean;
  includeAnimations?: boolean;
  includePbrMaps?: boolean;
  triangulate?: boolean;
  layers?: readonly LayerItem[];
  currentFrame?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  tilesetVersion?: number;
}

export interface ExportedObjResult {
  objText: string;
  mtlText: string;
  textures: Array<{
    filename: string;
    pngBlob?: Blob;
    buffer: PixelBuffer;
  }>;
}

interface ResolvedExportContext {
  ppu: number;
  includeGodotColliders: boolean;
  includeAnimations: boolean;
  includePbrMaps: boolean;
  triangulate: boolean;
  layers: readonly LayerItem[];
  currentFrame: number;
  canvasWidth: number;
  canvasHeight: number;
  tilesetVersion?: number;
}

const GLB_HEADER_BYTES = 12;
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_CHUNK_JSON = 0x4e4f534a;
const GLB_CHUNK_BIN = 0x004e4942;
const GLTF_FILTER_NEAREST = 9728;
const GLTF_CLAMP_TO_EDGE = 33071;

function resolveExportContext(
  engine: Model3DEngine,
  options?: ModelExportOptions
): ResolvedExportContext {
  const st = useEditorStore.getState();
  const preset = options?.scalePreset ?? "16px_1m";
  let ppu: number;
  if (preset === "1px_1m") {
    ppu = 1;
  } else if (preset === "custom") {
    const mpp = options?.metersPerPixel;
    if (mpp !== undefined && Number.isFinite(mpp) && mpp > 0) {
      ppu = 1 / mpp;
    } else {
      ppu = Math.max(1, engine.pixelsPerUnit);
    }
  } else {
    ppu = Math.max(1, engine.pixelsPerUnit);
  }

  return {
    ppu,
    includeGodotColliders: options?.includeGodotColliders ?? true,
    includeAnimations: options?.includeAnimations ?? true,
    includePbrMaps: options?.includePbrMaps ?? true,
    triangulate: options?.triangulate ?? false,
    layers: options?.layers ?? st.layers,
    currentFrame: options?.currentFrame ?? st.currentFrame,
    canvasWidth: options?.canvasWidth ?? st.canvasWidth,
    canvasHeight: options?.canvasHeight ?? st.canvasHeight,
    tilesetVersion: options?.tilesetVersion ?? st.tilesetVersion,
  };
}

function sanitizeFilenameBase(name: string): string {
  const stripped = name.replace(/\.pixet$/i, "").trim();
  const safe = stripped.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "model";
}

function sanitizeNodeName(raw: string, fallback: string): string {
  const cleaned = THREE.PropertyBinding.sanitizeNodeName(raw.trim());
  return cleaned.length > 0 ? cleaned : fallback;
}

function applyGodotColliderSuffix(name: string, collider: ColliderKind): string {
  if (collider === "none") return name;
  if (collider === "convex") {
    return name.endsWith("-convcol") ? name : `${name}-convcol`;
  }
  return name.endsWith("-col") ? name : `${name}-col`;
}

function pixelBufferToCanvas(buffer: PixelBuffer): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, buffer.width);
  canvas.height = Math.max(1, buffer.height);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const imgData = new ImageData(
      new Uint8ClampedArray(buffer.data),
      buffer.width,
      buffer.height
    );
    ctx.putImageData(imgData, 0, 0);
  }
  return canvas;
}

function createExportTextureFromBuffer(
  buffer: PixelBuffer,
  colorSpace: THREE.ColorSpace,
  name: string
): THREE.CanvasTexture {
  const canvas = pixelBufferToCanvas(buffer);
  const tex = new THREE.CanvasTexture(canvas);
  tex.name = name;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = true;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

function decodeEmbeddedPngToBuffer(
  pngBase64: string,
  width: number,
  height: number
): Promise<PixelBuffer> {
  return new Promise((resolve) => {
    const safeW = Math.max(1, width);
    const safeH = Math.max(1, height);
    if (typeof Image === "undefined" || !pngBase64) {
      resolve(new PixelBuffer(safeW, safeH));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const w = Math.max(1, img.naturalWidth || safeW);
      const h = Math.max(1, img.naturalHeight || safeH);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(new PixelBuffer(w, h));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      resolve(new PixelBuffer(w, h, data));
    };
    img.onerror = () => {
      resolve(new PixelBuffer(safeW, safeH));
    };
    img.src = pngBase64.startsWith("data:")
      ? pngBase64
      : `data:image/png;base64,${pngBase64}`;
  });
}

async function resolveExportMaterialBuffer(
  matDef: ModelMaterial,
  ctx: ResolvedExportContext
): Promise<PixelBuffer> {
  if (matDef.source.kind === "embedded") {
    return decodeEmbeddedPngToBuffer(
      matDef.source.pngBase64,
      matDef.source.width,
      matDef.source.height
    );
  }
  return resolveModelMaterialBuffer(matDef, {
    layers: ctx.layers,
    currentFrame: ctx.currentFrame,
    canvasWidth: ctx.canvasWidth,
    canvasHeight: ctx.canvasHeight,
    tilesetVersion: ctx.tilesetVersion,
  });
}

function collectRoleLayers(
  layers: readonly LayerItem[],
  role: "normal" | "emission"
): LayerCompositingInfo[] {
  return layers.filter((l) => {
    if (l.kind === "group") return true;
    return (l.mapRole ?? "albedo") === role;
  });
}

function hasRolePixels(
  layers: readonly LayerItem[],
  role: "normal" | "emission",
  frameIndex: number
): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]));
  for (const l of layers) {
    if (l.kind === "group") continue;
    if ((l.mapRole ?? "albedo") !== role) continue;
    let cur: LayerItem | undefined = l;
    let visible = true;
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur.id)) break;
      visited.add(cur.id);
      if (!cur.visible) {
        visible = false;
        break;
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    if (!visible) continue;
    const cel = pixelEngine.getCel(l.id, frameIndex);
    if (cel && !cel.isEmpty()) return true;
  }
  return false;
}

function buildThreeAnimationClips(
  engine: Model3DEngine,
  nodeObjectById: Map<string, THREE.Object3D>,
  ppu: number
): THREE.AnimationClip[] {
  const nodeById = new Map<string, ModelNode>();
  for (const n of engine.nodes) nodeById.set(n.id, n);

  const clips: THREE.AnimationClip[] = [];
  for (const clip of engine.clips) {
    const frameCount = Math.max(1, clip.frameCount);
    const fps = Math.max(1, clip.fps);
    const times = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      times[f] = f / fps;
    }

    const tracks: THREE.KeyframeTrack[] = [];

    for (const node of engine.nodes) {
      const obj = nodeObjectById.get(node.id);
      if (!obj) continue;

      const parentNode = node.parentId ? nodeById.get(node.parentId) : undefined;
      const parentPivot: Vec3 = parentNode ? parentNode.transform.pivot : [0, 0, 0];

      const posValues = new Float32Array(frameCount * 3);
      const quatValues = new Float32Array(frameCount * 4);
      const scaleValues = new Float32Array(frameCount * 3);

      let hasAnimatedPos = false;
      let hasAnimatedRot = false;
      let hasAnimatedScale = false;

      for (const kf of clip.keyframes) {
        if (kf.nodeId !== node.id) continue;
        if (kf.property.startsWith("pos")) hasAnimatedPos = true;
        else if (kf.property.startsWith("rot")) hasAnimatedRot = true;
        else if (kf.property.startsWith("scale")) hasAnimatedScale = true;
      }

      if (!hasAnimatedPos && !hasAnimatedRot && !hasAnimatedScale) {
        continue;
      }

      for (let f = 0; f < frameCount; f++) {
        const pose = evaluateNodePoseAtFrame(node, clip, f);
        const pOff = f * 3;
        const qOff = f * 4;
        posValues[pOff] =
          (pose.pivot[0] - parentPivot[0] + pose.position[0]) / ppu;
        posValues[pOff + 1] =
          (pose.pivot[1] - parentPivot[1] + pose.position[1]) / ppu;
        posValues[pOff + 2] =
          (pose.pivot[2] - parentPivot[2] + pose.position[2]) / ppu;

        quatValues[qOff] = pose.quaternion[0];
        quatValues[qOff + 1] = pose.quaternion[1];
        quatValues[qOff + 2] = pose.quaternion[2];
        quatValues[qOff + 3] = pose.quaternion[3];

        scaleValues[pOff] = pose.scale[0];
        scaleValues[pOff + 1] = pose.scale[1];
        scaleValues[pOff + 2] = pose.scale[2];
      }

      // Target by object name (unique sanitized) so GLTFExporter PropertyBinding resolves cleanly
      const targetName = obj.name;
      if (hasAnimatedPos) {
        tracks.push(
          new THREE.VectorKeyframeTrack(`${targetName}.position`, times, posValues)
        );
      }
      if (hasAnimatedRot) {
        tracks.push(
          new THREE.QuaternionKeyframeTrack(
            `${targetName}.quaternion`,
            times,
            quatValues
          )
        );
      }
      if (hasAnimatedScale) {
        tracks.push(
          new THREE.VectorKeyframeTrack(`${targetName}.scale`, times, scaleValues)
        );
      }
    }

    if (tracks.length > 0) {
      const duration = Math.max(0, (frameCount - 1) / fps);
      clips.push(new THREE.AnimationClip(clip.name, duration, tracks));
    }
  }

  return clips;
}

interface GltfJsonShape {
  samplers?: Array<Record<string, unknown>>;
  textures?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

function patchGltfJsonNearestSamplers(gltfJson: Record<string, unknown>): void {
  const doc = gltfJson as GltfJsonShape;
  const textures = Array.isArray(doc.textures) ? doc.textures : [];

  if (Array.isArray(doc.samplers) && doc.samplers.length > 0) {
    for (const sampler of doc.samplers) {
      if (sampler && typeof sampler === "object") {
        sampler.magFilter = GLTF_FILTER_NEAREST;
        sampler.minFilter = GLTF_FILTER_NEAREST;
      }
    }
  } else if (textures.length > 0) {
    doc.samplers = [
      {
        magFilter: GLTF_FILTER_NEAREST,
        minFilter: GLTF_FILTER_NEAREST,
        wrapS: GLTF_CLAMP_TO_EDGE,
        wrapT: GLTF_CLAMP_TO_EDGE,
      },
    ];
  }

  for (const tex of textures) {
    if (tex && typeof tex === "object" && tex.sampler === undefined) {
      tex.sampler = 0;
    }
  }
}

/**
 * Patches Chunk 0 (`0x4E4F534A` JSON) of a GLB 2.0 `ArrayBuffer` so all texture
 * samplers enforce `magFilter: 9728` (`NEAREST`) and `minFilter: 9728` (`NEAREST`),
 * padding JSON bytes with `0x20` spaces to 4-byte alignment and preserving Chunk 1 BIN.
 */
export function patchGlbNearestSamplers(glb: ArrayBuffer): ArrayBuffer {
  if (glb.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) {
    throw new Error("Invalid GLB buffer: too small");
  }
  const view = new DataView(glb);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  if (magic !== GLB_MAGIC || version !== GLB_VERSION) {
    throw new Error("Invalid GLB header");
  }

  const chunk0Len = view.getUint32(GLB_HEADER_BYTES, true);
  const chunk0Type = view.getUint32(GLB_HEADER_BYTES + 4, true);
  if (chunk0Type !== GLB_CHUNK_JSON) {
    throw new Error("Invalid GLB: first chunk is not JSON");
  }

  const jsonStart = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES;
  const jsonEnd = jsonStart + chunk0Len;
  if (jsonEnd > glb.byteLength) {
    throw new Error("Invalid GLB: JSON chunk exceeds buffer length");
  }

  const jsonBytes = new Uint8Array(glb, jsonStart, chunk0Len);
  const jsonStr = new TextDecoder().decode(jsonBytes);
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  patchGltfJsonNearestSamplers(parsed);

  const rawUpdatedBytes = new TextEncoder().encode(JSON.stringify(parsed));
  const paddedJsonLen = Math.ceil(rawUpdatedBytes.byteLength / 4) * 4;
  const paddedJsonBytes = new Uint8Array(paddedJsonLen);
  paddedJsonBytes.set(rawUpdatedBytes);
  for (let i = rawUpdatedBytes.byteLength; i < paddedJsonLen; i++) {
    paddedJsonBytes[i] = 0x20;
  }

  const remainingBytes = glb.byteLength - jsonEnd;
  const hasBinChunk = remainingBytes >= GLB_CHUNK_HEADER_BYTES;
  let binChunkBytes = 0;
  if (hasBinChunk) {
    const binType = view.getUint32(jsonEnd + 4, true);
    if (binType === GLB_CHUNK_BIN) {
      binChunkBytes = remainingBytes;
    } else {
      binChunkBytes = remainingBytes;
    }
  }

  const totalByteLength =
    GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + paddedJsonLen + binChunkBytes;
  const out = new ArrayBuffer(totalByteLength);
  const outView = new DataView(out);
  const outBytes = new Uint8Array(out);

  // Header
  outView.setUint32(0, GLB_MAGIC, true);
  outView.setUint32(4, GLB_VERSION, true);
  outView.setUint32(8, totalByteLength, true);

  // Chunk 0 (JSON)
  outView.setUint32(GLB_HEADER_BYTES, paddedJsonLen, true);
  outView.setUint32(GLB_HEADER_BYTES + 4, GLB_CHUNK_JSON, true);
  outBytes.set(paddedJsonBytes, jsonStart);

  // Chunk 1+ (BIN intact)
  if (binChunkBytes > 0) {
    const srcBin = new Uint8Array(glb, jsonEnd, binChunkBytes);
    outBytes.set(srcBin, jsonStart + paddedJsonLen);
  }

  return out;
}

/**
 * Exports `Model3DEngine` scene to glTF 2.0 (`.glb` binary `ArrayBuffer` or `.gltf` JSON string)
 * with nearest-neighbor samplers (`9728`), embedded right-side-up PNGs, 1:1 pivot hierarchy,
 * `COLOR_0` vertex colors, Godot 4 `-col`/`-convcol` suffixes, and quaternion animation clips.
 */
export async function exportModelToGltf(
  engine: Model3DEngine,
  format: "glb" | "gltf",
  options?: ModelExportOptions
): Promise<ArrayBuffer | string> {
  const ctx = resolveExportContext(engine, options);
  const materialById = new Map<string, THREE.Material>();
  const textureSizeByMaterialId = new Map<string, MaterialTextureInfo>();
  const createdTextures: THREE.Texture[] = [];
  const createdMaterials: THREE.Material[] = [];

  let normalTex: THREE.CanvasTexture | null = null;
  let emissionTex: THREE.CanvasTexture | null = null;

  if (ctx.includePbrMaps) {
    if (hasRolePixels(ctx.layers, "normal", ctx.currentFrame)) {
      const normData = pixelEngine.compositeFrame(
        collectRoleLayers(ctx.layers, "normal"),
        ctx.currentFrame
      );
      const normBuf = new PixelBuffer(ctx.canvasWidth, ctx.canvasHeight, normData);
      normalTex = createExportTextureFromBuffer(
        normBuf,
        THREE.NoColorSpace,
        "pixet_normal"
      );
      createdTextures.push(normalTex);
    }
    if (hasRolePixels(ctx.layers, "emission", ctx.currentFrame)) {
      const emData = pixelEngine.compositeFrame(
        collectRoleLayers(ctx.layers, "emission"),
        ctx.currentFrame
      );
      const emBuf = new PixelBuffer(ctx.canvasWidth, ctx.canvasHeight, emData);
      emissionTex = createExportTextureFromBuffer(
        emBuf,
        THREE.SRGBColorSpace,
        "pixet_emission"
      );
      createdTextures.push(emissionTex);
    }
  }

  for (const matDef of engine.materials) {
    const buffer = await resolveExportMaterialBuffer(matDef, ctx);
    textureSizeByMaterialId.set(matDef.id, {
      width: buffer.width,
      height: buffer.height,
    });
    const tex = createExportTextureFromBuffer(
      buffer,
      THREE.SRGBColorSpace,
      matDef.name || matDef.id
    );
    createdTextures.push(tex);

    const stdMat = new THREE.MeshStandardMaterial({
      name: matDef.name || matDef.id,
      map: tex,
      roughness: 1.0,
      metalness: 0.0,
      vertexColors: true,
      side: matDef.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: matDef.alphaTest > 0 ? matDef.alphaTest : 0,
      transparent: false,
    });

    if (ctx.includePbrMaps && matDef.usePbrMaps) {
      if (normalTex) stdMat.normalMap = normalTex;
      if (emissionTex) {
        stdMat.emissiveMap = emissionTex;
        stdMat.emissive.setHex(0xffffff);
        stdMat.emissiveIntensity = 1.0;
      }
    }

    createdMaterials.push(stdMat);
    materialById.set(matDef.id, stdMat);
  }

  // Temporarily sync with export PPU without mutating engine state permanently
  const originalPpu = engine.pixelsPerUnit;
  const originalSelectedIds = [...engine.selectedNodeIds];
  const originalActiveId = engine.activeNodeId;
  let synced: ReturnType<typeof syncModel3DScene> | null = null;

  try {
    engine.pixelsPerUnit = ctx.ppu;
    engine.selectedNodeIds = [];
    engine.activeNodeId = null;

    synced = syncModel3DScene(engine, {
      wireframeOverlay: false,
      materialById,
      textureSizeByMaterialId,
      defaultTextureWidth: Math.max(1, ctx.canvasWidth),
      defaultTextureHeight: Math.max(1, ctx.canvasHeight),
      // Modifiers with "enabled" (render/export) on are baked into the exported geometry.
      modifierContext: "export",
    });
  } finally {
    engine.pixelsPerUnit = originalPpu;
    engine.selectedNodeIds = originalSelectedIds;
    engine.activeNodeId = originalActiveId;
  }

  try {
    // Strip any stray overlay helpers and enforce unique sanitized node names + Godot collider suffixes
    const usedNames = new Set<string>();
    const nodeById = new Map<string, ModelNode>();
    for (const n of engine.nodes) nodeById.set(n.id, n);

    for (const node of engine.nodes) {
      const obj = synced.nodeObjectById.get(node.id);
      if (!obj) continue;

      const toRemove: THREE.Object3D[] = [];
      for (const child of obj.children) {
        if (
          child.userData?.isOverlayHelper ||
          child.name === "__m3d_pivot_marker__"
        ) {
          toRemove.push(child);
        }
      }
      for (const helper of toRemove) {
        obj.remove(helper);
      }

      let baseName = sanitizeNodeName(node.name, node.id);
      if (ctx.includeGodotColliders && node.collider !== "none") {
        baseName = applyGodotColliderSuffix(baseName, node.collider);
        obj.userData = {
          ...obj.userData,
          pixetCollider: node.collider,
        };
      }

      let uniqueName = baseName;
      let suffixIdx = 2;
      while (usedNames.has(uniqueName)) {
        if (ctx.includeGodotColliders && node.collider === "convex") {
          uniqueName = `${baseName.replace(/-convcol$/, "")}_${suffixIdx++}-convcol`;
        } else if (ctx.includeGodotColliders && node.collider !== "none") {
          uniqueName = `${baseName.replace(/-col$/, "")}_${suffixIdx++}-col`;
        } else {
          uniqueName = `${baseName}_${suffixIdx++}`;
        }
      }
      usedNames.add(uniqueName);
      obj.name = uniqueName;
    }

    const exportScene = new THREE.Scene();
    exportScene.name = "PixetScene";
    const rootChildren = [...synced.rootGroup.children];
    for (const child of rootChildren) {
      exportScene.add(child);
    }

    try {
      const animations: THREE.AnimationClip[] = ctx.includeAnimations
        ? buildThreeAnimationClips(engine, synced.nodeObjectById, ctx.ppu)
        : [];

      const exporter = new GLTFExporter();
      const isBinary = format === "glb";
      const raw = await exporter.parseAsync(exportScene, {
        binary: isBinary,
        onlyVisible: true,
        trs: true,
        animations,
      });

      if (isBinary) {
        if (!(raw instanceof ArrayBuffer)) {
          throw new Error("GLTFExporter did not return ArrayBuffer for binary export");
        }
        return patchGlbNearestSamplers(raw);
      }

      const jsonObj = raw as Record<string, unknown>;
      patchGltfJsonNearestSamplers(jsonObj);
      return JSON.stringify(jsonObj, null, 2);
    } finally {
      disposeSyncedObjectTree(exportScene);
    }
  } finally {
    if (synced) {
      disposeSyncedObjectTree(synced.rootGroup);
      for (const obj of synced.nodeObjectById.values()) {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
        }
      }
    }
    for (const m of createdMaterials) m.dispose();
    for (const t of createdTextures) t.dispose();
  }
}

function formatObjNum(n: number): string {
  const clean = Math.abs(n) < 1e-7 ? 0 : n;
  return Number(clean.toFixed(6)).toString();
}

function computeCuboidCornerUvs(face: CuboidFaceUV): [Vec2, Vec2, Vec2, Vec2] {
  const [u0, v0, u1, v1] = face.uv;
  let corners: [Vec2, Vec2, Vec2, Vec2] = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  if (face.flipX) {
    corners = [corners[1], corners[0], corners[3], corners[2]];
  }
  if (face.flipY) {
    corners = [corners[3], corners[2], corners[1], corners[0]];
  }
  const steps = ((face.rotation / 90) % 4 + 4) % 4;
  for (let i = 0; i < steps; i++) {
    corners = [corners[3], corners[0], corners[1], corners[2]];
  }
  return corners;
}

function computePolyNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-12) return [0, 1, 0];
  return [nx / len, ny / len, nz / len];
}

function distSq3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function buildObjCuboidFaces(
  cuboid: CuboidData
): Array<{
  corners: [Vec3, Vec3, Vec3, Vec3];
  pxUvs: [Vec2, Vec2, Vec2, Vec2];
  materialId: string;
}> {
  const minX = Math.min(cuboid.from[0], cuboid.to[0]) - cuboid.inflate;
  const minY = Math.min(cuboid.from[1], cuboid.to[1]) - cuboid.inflate;
  const minZ = Math.min(cuboid.from[2], cuboid.to[2]) - cuboid.inflate;
  const maxX = Math.max(cuboid.from[0], cuboid.to[0]) + cuboid.inflate;
  const maxY = Math.max(cuboid.from[1], cuboid.to[1]) + cuboid.inflate;
  const maxZ = Math.max(cuboid.from[2], cuboid.to[2]) + cuboid.inflate;

  const specs: Array<{ name: CuboidFaceName; corners: [Vec3, Vec3, Vec3, Vec3] }> = [
    {
      name: "north",
      corners: [
        [maxX, maxY, minZ],
        [minX, maxY, minZ],
        [minX, minY, minZ],
        [maxX, minY, minZ],
      ],
    },
    {
      name: "south",
      corners: [
        [minX, maxY, maxZ],
        [maxX, maxY, maxZ],
        [maxX, minY, maxZ],
        [minX, minY, maxZ],
      ],
    },
    {
      name: "east",
      corners: [
        [maxX, maxY, maxZ],
        [maxX, maxY, minZ],
        [maxX, minY, minZ],
        [maxX, minY, maxZ],
      ],
    },
    {
      name: "west",
      corners: [
        [minX, maxY, minZ],
        [minX, maxY, maxZ],
        [minX, minY, maxZ],
        [minX, minY, minZ],
      ],
    },
    {
      name: "up",
      corners: [
        [minX, maxY, minZ],
        [maxX, maxY, minZ],
        [maxX, maxY, maxZ],
        [minX, maxY, maxZ],
      ],
    },
    {
      name: "down",
      corners: [
        [minX, minY, maxZ],
        [maxX, minY, maxZ],
        [maxX, minY, minZ],
        [minX, minY, minZ],
      ],
    },
  ];

  const out: Array<{
    corners: [Vec3, Vec3, Vec3, Vec3];
    pxUvs: [Vec2, Vec2, Vec2, Vec2];
    materialId: string;
  }> = [];

  for (const spec of specs) {
    const f = cuboid.faces[spec.name];
    if (!f || f.hidden) continue;
    // Match sceneSync winding: [p0, p3, p2, p1] vs CCW [p0, p3, p2, p1]:
    // Notice sceneSync emits tris [p0, p2, p1] & [p0, p3, p2], which is CCW quad [p0, p3, p2, p1].
    const [p0, p1, p2, p3] = spec.corners;
    const [u0, u1, u2, u3] = computeCuboidCornerUvs(f);
    out.push({
      corners: [p0, p3, p2, p1],
      pxUvs: [u0, u3, u2, u1],
      materialId: f.materialId || DEFAULT_MODEL3D_MATERIAL_ID,
    });
  }

  return out;
}

function buildObjMeshFaces(
  mesh: PolyMeshData
): Array<{
  corners: Vec3[];
  pxUvs: Vec2[];
  triSplit?: "02" | "13";
  materialId: string;
}> {
  const out: Array<{
    corners: Vec3[];
    pxUvs: Vec2[];
    triSplit?: "02" | "13";
    materialId: string;
  }> = [];

  for (const face of mesh.faces) {
    if (face.verts.length < 3) continue;
    const corners: Vec3[] = [];
    const pxUvs: Vec2[] = [];
    for (let i = 0; i < face.verts.length; i++) {
      corners.push(mesh.vertices[face.verts[i]] ?? [0, 0, 0]);
      pxUvs.push(face.uvs[i] ?? [0, 0]);
    }
    out.push({
      corners,
      pxUvs,
      triSplit: face.triSplit,
      materialId: face.materialId || DEFAULT_MODEL3D_MATERIAL_ID,
    });
  }
  return out;
}

function isNodeHierarchyVisible(
  node: ModelNode,
  byId: Map<string, ModelNode>
): boolean {
  let cur: ModelNode | undefined = node;
  const visited = new Set<string>();
  while (cur) {
    if (visited.has(cur.id)) break;
    visited.add(cur.id);
    if (!cur.visible) return false;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return true;
}

async function encodePixelBufferToPngBlob(buffer: PixelBuffer): Promise<Blob | undefined> {
  if (typeof document === "undefined") return undefined;
  const canvas = pixelBufferToCanvas(buffer);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? undefined), "image/png");
  });
}

/**
 * Exports `Model3DEngine` scene to quad-preserving Wavefront `.obj` + `.mtl` + PNG texture buffers.
 * Preserves 4-vertex quads (`f v1/vt1/vn1 v2/vt2/vn2 v3/vt3/vn3 v4/vt4/vn4`) unless `triangulate: true`.
 */
export async function exportModelToObj(
  engine: Model3DEngine,
  options?: ModelExportOptions,
  docBaseName = "model"
): Promise<ExportedObjResult> {
  const ctx = resolveExportContext(engine, options);
  const safeBase = sanitizeFilenameBase(docBaseName);

  const textures: ExportedObjResult["textures"] = [];
  const matInfoById = new Map<
    string,
    { mtlName: string; texFilename: string; width: number; height: number }
  >();

  const usedMtlNames = new Set<string>();
  for (let i = 0; i < engine.materials.length; i++) {
    const matDef = engine.materials[i];
    const buffer = await resolveExportMaterialBuffer(matDef, ctx);
    let mtlName = sanitizeNodeName(matDef.name || matDef.id, `mat_${i}`);
    while (usedMtlNames.has(mtlName)) {
      mtlName = `${mtlName}_${i}`;
    }
    usedMtlNames.add(mtlName);

    const texFilename = `${safeBase}_${mtlName}.png`;
    const pngBlob = await encodePixelBufferToPngBlob(buffer);
    textures.push({
      filename: texFilename,
      pngBlob,
      buffer,
    });
    matInfoById.set(matDef.id, {
      mtlName,
      texFilename,
      width: Math.max(1, buffer.width),
      height: Math.max(1, buffer.height),
    });
  }

  const mtlLines: string[] = [
    `# Exported by Pixet Low-Poly 3D`,
    `# Materials: ${matInfoById.size}`,
    "",
  ];
  for (const info of matInfoById.values()) {
    mtlLines.push(`newmtl ${info.mtlName}`);
    mtlLines.push("Ka 1.000000 1.000000 1.000000");
    mtlLines.push("Kd 1.000000 1.000000 1.000000");
    mtlLines.push("Ks 0.000000 0.000000 0.000000");
    mtlLines.push("d 1.000000");
    mtlLines.push("illum 1");
    mtlLines.push(`map_Kd ${info.texFilename}`);
    mtlLines.push("");
  }

  const objLines: string[] = [
    `# Exported by Pixet Low-Poly 3D`,
    `# Scale: 1m = ${formatObjNum(ctx.ppu)} px`,
    `mtllib ${safeBase}.mtl`,
    "",
  ];

  const worldTransforms = evaluateWorldNodeTransforms(engine.nodes);
  const nodeById = new Map<string, ModelNode>();
  for (const n of engine.nodes) nodeById.set(n.id, n);

  let vCounter = 0;
  let vtCounter = 0;
  let vnCounter = 0;
  let currentMtl = "";

  const fallbackMatInfo =
    matInfoById.values().next().value ?? {
      mtlName: "default",
      texFilename: `${safeBase}_default.png`,
      width: Math.max(1, ctx.canvasWidth),
      height: Math.max(1, ctx.canvasHeight),
    };

  for (const node of engine.nodes) {
    if (!isNodeHierarchyVisible(node, nodeById)) continue;
    if (node.kind === "group") continue;

    const worldTr = worldTransforms.get(node.id);
    if (!worldTr) continue;

    const rawFaces: Array<{
      corners: Vec3[];
      pxUvs: Vec2[];
      triSplit?: "02" | "13";
      materialId: string;
    }> = [];

    if (node.kind === "cuboid" && node.cuboid) {
      for (const cf of buildObjCuboidFaces(node.cuboid)) {
        rawFaces.push(cf);
      }
    } else if (node.kind === "mesh" && node.mesh) {
      for (const mf of buildObjMeshFaces(getEvaluatedMesh(node, "export") ?? node.mesh)) {
        rawFaces.push(mf);
      }
    }

    if (rawFaces.length === 0) continue;

    let objName = sanitizeNodeName(node.name, node.id);
    if (ctx.includeGodotColliders && node.collider !== "none") {
      objName = applyGodotColliderSuffix(objName, node.collider);
    }
    objLines.push(`o ${objName}`);

    for (const face of rawFaces) {
      if (face.corners.length < 3) continue;
      const matInfo = matInfoById.get(face.materialId) ?? fallbackMatInfo;
      const worldCorners: Vec3[] = face.corners.map((c) => {
        const wp = worldTr.transformPoint(c);
        return [wp[0] / ctx.ppu, wp[1] / ctx.ppu, wp[2] / ctx.ppu];
      });

      const vIndices: number[] = [];
      const vtIndices: number[] = [];
      for (let i = 0; i < worldCorners.length; i++) {
        const p = worldCorners[i];
        objLines.push(
          `v ${formatObjNum(p[0])} ${formatObjNum(p[1])} ${formatObjNum(p[2])}`
        );
        vIndices.push(++vCounter);

        const uv = face.pxUvs[i] ?? [0, 0];
        const u = uv[0] / matInfo.width;
        const v = 1 - uv[1] / matInfo.height;
        objLines.push(`vt ${formatObjNum(u)} ${formatObjNum(v)}`);
        vtIndices.push(++vtCounter);
      }

      if (currentMtl !== matInfo.mtlName) {
        objLines.push(`usemtl ${matInfo.mtlName}`);
        currentMtl = matInfo.mtlName;
      }

      if (worldCorners.length === 4 && !ctx.triangulate) {
        const n = computePolyNormal(
          worldCorners[0],
          worldCorners[1],
          worldCorners[2]
        );
        objLines.push(
          `vn ${formatObjNum(n[0])} ${formatObjNum(n[1])} ${formatObjNum(n[2])}`
        );
        const vnIdx = ++vnCounter;
        const fTokens = [0, 1, 2, 3].map(
          (i) => `${vIndices[i]}/${vtIndices[i]}/${vnIdx}`
        );
        objLines.push(`f ${fTokens.join(" ")}`);
      } else if (worldCorners.length === 4 && ctx.triangulate) {
        const split: "02" | "13" =
          face.triSplit === "02" || face.triSplit === "13"
            ? face.triSplit
            : distSq3(worldCorners[0], worldCorners[2]) <=
                distSq3(worldCorners[1], worldCorners[3])
              ? "02"
              : "13";

        const triPairs: Array<[number, number, number]> =
          split === "02"
            ? [
                [0, 1, 2],
                [0, 2, 3],
              ]
            : [
                [0, 1, 3],
                [1, 2, 3],
              ];

        for (const [ia, ib, ic] of triPairs) {
          const n = computePolyNormal(
            worldCorners[ia],
            worldCorners[ib],
            worldCorners[ic]
          );
          objLines.push(
            `vn ${formatObjNum(n[0])} ${formatObjNum(n[1])} ${formatObjNum(n[2])}`
          );
          const vnIdx = ++vnCounter;
          objLines.push(
            `f ${vIndices[ia]}/${vtIndices[ia]}/${vnIdx} ${vIndices[ib]}/${vtIndices[ib]}/${vnIdx} ${vIndices[ic]}/${vtIndices[ic]}/${vnIdx}`
          );
        }
      } else {
        const n = computePolyNormal(
          worldCorners[0],
          worldCorners[1],
          worldCorners[2]
        );
        objLines.push(
          `vn ${formatObjNum(n[0])} ${formatObjNum(n[1])} ${formatObjNum(n[2])}`
        );
        const vnIdx = ++vnCounter;
        const fTokens = worldCorners.map(
          (_, i) => `${vIndices[i]}/${vtIndices[i]}/${vnIdx}`
        );
        objLines.push(`f ${fTokens.join(" ")}`);
      }
    }

    objLines.push("");
  }

  return {
    objText: objLines.join("\n"),
    mtlText: mtlLines.join("\n"),
    textures,
  };
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Convenience browser download action exporting the active `Model3DEngine` scene
 * as `.glb`, `.gltf`, or `.obj` (+ `.mtl` + `.png` textures) and updating editor status.
 */
export async function downloadExportedModelAction(
  format: "glb" | "gltf" | "obj",
  options?: ModelExportOptions
): Promise<void> {
  const st = useEditorStore.getState();
  const baseName = sanitizeFilenameBase(st.documentName);
  const engine = pixelEngine.model3d;

  try {
    if (format === "glb") {
      const glb = (await exportModelToGltf(engine, "glb", options)) as ArrayBuffer;
      triggerBrowserDownload(
        new Blob([glb], { type: "model/gltf-binary" }),
        `${baseName}.glb`
      );
      st.setStatusMessage(`Exported ${baseName}.glb`);
      return;
    }

    if (format === "gltf") {
      const gltfText = (await exportModelToGltf(engine, "gltf", options)) as string;
      triggerBrowserDownload(
        new Blob([gltfText], { type: "model/gltf+json" }),
        `${baseName}.gltf`
      );
      st.setStatusMessage(`Exported ${baseName}.gltf`);
      return;
    }

    const res = await exportModelToObj(engine, options, baseName);
    triggerBrowserDownload(
      new Blob([res.objText], { type: "text/plain;charset=utf-8" }),
      `${baseName}.obj`
    );
    triggerBrowserDownload(
      new Blob([res.mtlText], { type: "text/plain;charset=utf-8" }),
      `${baseName}.mtl`
    );
    for (const tex of res.textures) {
      if (tex.pngBlob) {
        triggerBrowserDownload(tex.pngBlob, tex.filename);
      }
    }
    st.setStatusMessage(
      `Exported ${baseName}.obj + ${baseName}.mtl (${res.textures.length} texture${res.textures.length === 1 ? "" : "s"})`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    st.setStatusMessage(`3D Export failed: ${message}`);
    throw err;
  }
}
