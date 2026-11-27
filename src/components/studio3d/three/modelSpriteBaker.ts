import * as THREE from "three";
import { PixelBuffer, type RGBA } from "../../../engine/document/PixelBuffer";
import { pixelEngine } from "../../../engine/document/PixelEngine";
import { syncHistoryAndCelState } from "../../../engine/document/historyActions";
import { commitFloatingSelection } from "../../../engine/document/selectionActions";
import { syncTimelineCels } from "../../../engine/document/timelineActions";
import { evaluateScenePosesAtFrame } from "../../../engine/model3d/animEval";
import type { Model3DEngine } from "../../../engine/model3d/Model3DEngine";
import type { ModelNode, ShadingMode } from "../../../engine/model3d/types";
import { captureTilemapHistorySnapshot } from "../../../engine/tiles/TilemapHistory";
import {
  applyOutlineFilter,
  applyQuantizeToPalette,
} from "../../../engine/tools/filters";
import {
  isLayerEffectivelyLocked,
  useEditorStore,
} from "../../../store/editorStore";
import { RetroMaterialCache } from "./retroMaterials";
import { disposeSyncedObjectTree, syncModel3DScene } from "./sceneSync";
import { threeStudioRuntime } from "./ThreeStudioRuntime";

const DEG_TO_RAD = Math.PI / 180;

const BAKE_TAG_COLORS = [
  "#4c8bf5",
  "#eab308",
  "#2dd4bf",
  "#f43f5e",
  "#a855f7",
  "#22c55e",
] as const;

const DIR_LABELS_4 = ["S", "E", "N", "W"] as const;
const DIR_LABELS_8 = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"] as const;

function getTurntableDirectionLabel(index: number, total: number): string {
  if (total === 4) return DIR_LABELS_4[index] ?? `Dir_${index}`;
  if (total === 8) return DIR_LABELS_8[index] ?? `Dir_${index}`;
  return `Dir_${index}`;
}

export type Model3DBakePass = "lit" | "unlit" | "ps1" | "normal" | "depth";
export type Model3DBakeProjection = "ortho" | "persp";
export type Model3DBakeOutline = "none" | "outside" | "inside";
export type Model3DBakeDither = "none" | "bayer4";

export interface Model3DSpritePostOptions {
  alphaCutoff?: number;
  quantizeToPalette?: boolean;
  ditherMode?: Model3DBakeDither;
  paletteRgba?: readonly RGBA[];
  outline?: Model3DBakeOutline;
  outlineColor?: RGBA;
}

export interface RenderModel3DSpriteOptions extends Model3DSpritePostOptions {
  width?: number;
  height?: number;
  yawDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  projection?: Model3DBakeProjection;
  fovDeg?: number;
  autoFit?: boolean;
  marginPx?: number;
  pixelsPerUnit?: number;
  pass?: Model3DBakePass;
  frame?: number;
  clipId?: string | null;
  cullBackfaces?: boolean;
  applyPostProcess?: boolean;
}

export interface BakeModel3DTurntableOptions extends Model3DSpritePostOptions {
  directions: 4 | 8 | 12 | 16;
  pitchDeg?: number;
  baseYawDeg?: number;
  rollDeg?: number;
  sweepDeg?: number;
  projection?: Model3DBakeProjection;
  fovDeg?: number;
  autoFit?: boolean;
  marginPx?: number;
  pass?: Model3DBakePass;
  animateActiveClip?: boolean;
  clipId?: string | null;
  cullBackfaces?: boolean;
  layerName?: string;
}

export interface BakeModel3DToTilesetOptions extends Model3DSpritePostOptions {
  rotations?: 1 | 4;
  pitchDeg?: number;
  baseYawDeg?: number;
  rollDeg?: number;
  projection?: Model3DBakeProjection;
  fovDeg?: number;
  autoFit?: boolean;
  marginPx?: number;
  pass?: Model3DBakePass;
  frame?: number;
  clipId?: string | null;
  cullBackfaces?: boolean;
  tilesetIndex?: number;
  tileNamePrefix?: string;
}

function parseHexToRgba(hex: string, alpha = 255): RGBA {
  const clean = hex.trim().replace("#", "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r, g, b, alpha];
    }
  } else if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r, g, b, alpha];
    }
  }
  return [20, 20, 20, alpha];
}

function paletteHexListToRgba(palette: readonly string[]): RGBA[] {
  return palette.map((hex) => parseHexToRgba(hex, 255));
}

function linearFloatToSrgbByte(linearByte: number): number {
  const c = Math.max(0, Math.min(1, linearByte / 255));
  const srgb =
    c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(srgb * 255)));
}

/**
 * Pure post-process pipeline for baked 3D sprites:
 * 1. Binary alpha cutoff (clears RGB to 0 on transparent pixels to prevent fringe).
 * 2. Optional palette quantization (with optional ordered Bayer 4x4 dithering).
 * 3. Optional 1px outside or inside pixel outline.
 */
export function postProcessBakedSpriteBuffer(
  raw: PixelBuffer,
  opts: Model3DSpritePostOptions
): PixelBuffer {
  const cutoff = Math.max(
    0,
    Math.min(255, Math.round(opts.alphaCutoff ?? 128))
  );
  const thresholded = new PixelBuffer(raw.width, raw.height);
  const src = raw.data;
  const dst = thresholded.data;

  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    if (a >= cutoff) {
      dst[i] = src[i];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i + 2];
      dst[i + 3] = 255;
    } else {
      dst[i] = 0;
      dst[i + 1] = 0;
      dst[i + 2] = 0;
      dst[i + 3] = 0;
    }
  }
  thresholded.markAllDirty();

  let current = thresholded;

  if (
    opts.quantizeToPalette === true &&
    opts.paletteRgba &&
    opts.paletteRgba.length > 0
  ) {
    current = applyQuantizeToPalette(current, {
      palette: opts.paletteRgba,
      dither: opts.ditherMode === "bayer4" ? "bayer4" : "none",
    });
  }

  if (opts.outline === "outside" || opts.outline === "inside") {
    current = applyOutlineFilter(current, {
      thickness: 1,
      connectivity: 4,
      placement: opts.outline,
      mode: "solid",
      color: opts.outlineColor ?? [20, 20, 20, 255],
    });
  }

  return current;
}

interface PosedEngineProxy {
  pixelsPerUnit: number;
  nodes: ModelNode[];
  selectedNodeIds: string[];
  activeNodeId: string | null;
}

function buildPosedNodes(
  engine: Model3DEngine,
  clipId: string | null | undefined,
  frame: number | undefined
): ModelNode[] {
  const clip =
    (clipId ? engine.clips.find((c) => c.id === clipId) : undefined) ??
    (engine.activeClipId
      ? engine.clips.find((c) => c.id === engine.activeClipId)
      : undefined);

  if (!clip || frame === undefined) {
    return engine.nodes;
  }

  const poses = evaluateScenePosesAtFrame(engine.nodes, clip, frame);
  return engine.nodes.map((node) => {
    const pose = poses.get(node.id);
    if (!pose) return node;
    return {
      ...node,
      transform: {
        position: [pose.position[0], pose.position[1], pose.position[2]],
        rotation: [pose.rotation[0], pose.rotation[1], pose.rotation[2]],
        scale: [pose.scale[0], pose.scale[1], pose.scale[2]],
        pivot: [pose.pivot[0], pose.pivot[1], pose.pivot[2]],
      },
    };
  });
}

function passToShadingMode(pass: Model3DBakePass): ShadingMode {
  switch (pass) {
    case "unlit":
      return "unlit";
    case "ps1":
      return "ps1";
    case "lit":
    case "normal":
    case "depth":
    default:
      return "flat";
  }
}

function buildBakeSceneAndLighting(
  rootGroup: THREE.Group,
  pass: Model3DBakePass
): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(rootGroup);

  if (pass === "lit" || pass === "ps1") {
    const s3d = useEditorStore.getState().studio3d;
    const ambient = new THREE.AmbientLight(
      s3d.ambientColor || "#8ca0c8",
      Math.max(0.1, s3d.ambient * 1.4)
    );
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xdbe7ff, 0x2a2d36, 0.45);
    scene.add(hemi);

    const dirLight = new THREE.DirectionalLight(
      s3d.lightColor || "#fff4d6",
      s3d.directionalLighting ? Math.max(0.2, s3d.lightIntensity * 1.15) : 0.35
    );
    const az = s3d.lightAzimuthDeg * DEG_TO_RAD;
    const el = s3d.lightElevationDeg * DEG_TO_RAD;
    const r = 10;
    dirLight.position.set(
      r * Math.cos(el) * Math.sin(az),
      Math.max(1.5, r * Math.sin(el)),
      r * Math.cos(el) * Math.cos(az)
    );
    scene.add(dirLight);
  }

  scene.updateMatrixWorld(true);
  return scene;
}

interface BakeCameraResult {
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  viewNear: number;
  viewFar: number;
  boundsMinZView: number;
  boundsMaxZView: number;
}

function computeSceneBoundingBox(rootGroup: THREE.Group): THREE.Box3 {
  rootGroup.updateMatrixWorld(true);
  const box = new THREE.Box3();
  rootGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.visible) {
      if (!obj.geometry.boundingBox) {
        obj.geometry.computeBoundingBox();
      }
      if (obj.geometry.boundingBox && !obj.geometry.boundingBox.isEmpty()) {
        const meshBox = obj.geometry.boundingBox
          .clone()
          .applyMatrix4(obj.matrixWorld);
        box.union(meshBox);
      }
    }
  });
  return box;
}

/**
 * Configures either a texel-snapped orthographic camera (eliminating 1px pixel
 * swimming during turntables/animations) or a perspective camera aimed at the
 * scene center.
 */
function configureBakeCamera(
  box: THREE.Box3,
  width: number,
  height: number,
  ppu: number,
  opts: {
    projection: Model3DBakeProjection;
    yawDeg: number;
    pitchDeg: number;
    rollDeg: number;
    fovDeg: number;
    autoFit: boolean;
    marginPx: number;
  }
): BakeCameraResult {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const safePpu = Math.max(1, ppu);

  const center = new THREE.Vector3(0, 0.5, 0);
  const size = new THREE.Vector3(1, 1, 1);
  if (!box.isEmpty()) {
    box.getCenter(center);
    box.getSize(size);
  }

  const yawRad = opts.yawDeg * DEG_TO_RAD;
  const pitchRad = Math.max(-89, Math.min(89, opts.pitchDeg)) * DEG_TO_RAD;
  const rollRad = opts.rollDeg * DEG_TO_RAD;

  const cosP = Math.cos(pitchRad);
  const viewDirFromTarget = new THREE.Vector3(
    cosP * Math.sin(yawRad),
    Math.sin(pitchRad),
    cosP * Math.cos(yawRad)
  ).normalize();

  // Compute camera basis vectors (right, up, forward) so we can project the AABB
  // into camera view space and snap the ortho target to exact output texel increments.
  const probeCam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  probeCam.position.copy(center).addScaledVector(viewDirFromTarget, 10);
  probeCam.up.set(0, 1, 0);
  probeCam.lookAt(center);
  if (Math.abs(rollRad) > 1e-6) {
    const forward = new THREE.Vector3()
      .subVectors(center, probeCam.position)
      .normalize();
    probeCam.up.applyAxisAngle(forward, rollRad);
    probeCam.lookAt(center);
  }
  probeCam.updateMatrixWorld(true);

  const camRight = new THREE.Vector3(1, 0, 0)
    .applyQuaternion(probeCam.quaternion)
    .normalize();
  const camUp = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(probeCam.quaternion)
    .normalize();
  const camBack = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(probeCam.quaternion)
    .normalize();

  // Measure tight projected extent of the 8 AABB corners in camera basis
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;

  const bMin = box.isEmpty() ? new THREE.Vector3(-0.5, 0, -0.5) : box.min;
  const bMax = box.isEmpty() ? new THREE.Vector3(0.5, 1, 0.5) : box.max;

  const corner = new THREE.Vector3();
  for (let ix = 0; ix < 2; ix++) {
    for (let iy = 0; iy < 2; iy++) {
      for (let iz = 0; iz < 2; iz++) {
        corner.set(
          ix === 0 ? bMin.x : bMax.x,
          iy === 0 ? bMin.y : bMax.y,
          iz === 0 ? bMin.z : bMax.z
        );
        const rel = corner.sub(center);
        const u = rel.dot(camRight);
        const v = rel.dot(camUp);
        const n = rel.dot(camBack);
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
        if (n < minN) minN = n;
        if (n > maxN) maxN = n;
      }
    }
  }

  const projWidth = Math.max(1 / safePpu, maxU - minU);
  const projHeight = Math.max(1 / safePpu, maxV - minV);
  const projDepth = Math.max(1 / safePpu, maxN - minN);
  const radius = Math.max(0.25, size.length() * 0.5);

  if (opts.projection === "persp") {
    const fov = Math.max(10, Math.min(120, opts.fovDeg));
    const fovRad = fov * DEG_TO_RAD;
    const aspect = safeW / safeH;
    const marginPx = Math.max(0, opts.marginPx);
    const usableFracX = Math.max(0.2, (safeW - marginPx * 2) / safeW);
    const usableFracY = Math.max(0.2, (safeH - marginPx * 2) / safeH);

    let dist: number;
    if (opts.autoFit) {
      const halfTanV = Math.tan(fovRad * 0.5);
      const halfTanH = halfTanV * aspect;
      const distV = (projHeight * 0.5) / (halfTanV * usableFracY);
      const distH = (projWidth * 0.5) / (halfTanH * usableFracX);
      dist = Math.max(distV, distH) + projDepth * 0.5;
    } else {
      const halfHWorld = (safeH / safePpu) * 0.5;
      dist = halfHWorld / Math.tan(fovRad * 0.5);
    }
    dist = Math.max(0.5, dist);

    const near = Math.max(0.05, dist - projDepth - radius);
    const far = dist + projDepth + radius + 4;

    const persp = new THREE.PerspectiveCamera(fov, aspect, near, far);
    persp.position.copy(center).addScaledVector(camBack, dist);
    persp.up.copy(camUp);
    persp.lookAt(center);
    persp.updateMatrixWorld(true);

    return {
      camera: persp,
      viewNear: near,
      viewFar: far,
      boundsMinZView: dist - maxN,
      boundsMaxZView: dist - minN,
    };
  }

  // Orthographic projection with Anti-Swim texel-snapped target
  let frustumWidth: number;
  let frustumHeight: number;
  const aspect = safeW / safeH;

  if (opts.autoFit) {
    const marginPx = Math.max(0, opts.marginPx);
    const usableW = Math.max(1, safeW - marginPx * 2);
    const usableH = Math.max(1, safeH - marginPx * 2);
    const unitsPerPxX = projWidth / usableW;
    const unitsPerPxY = projHeight / usableH;
    const unitsPerPx = Math.max(unitsPerPxX, unitsPerPxY, 1e-4);
    frustumWidth = unitsPerPx * safeW;
    frustumHeight = unitsPerPx * safeH;
  } else {
    // Exact 1:1 pixel-unit scale: `pixelsPerUnit` world units = `pixelsPerUnit` output pixels
    frustumWidth = safeW / safePpu;
    frustumHeight = safeH / safePpu;
    if (Math.abs(frustumWidth / frustumHeight - aspect) > 1e-6) {
      frustumWidth = frustumHeight * aspect;
    }
  }

  const viewUnitsPerPixelX = frustumWidth / safeW;
  const viewUnitsPerPixelY = frustumHeight / safeH;

  // Anti-Swim Quantization: project target into camera right/up basis and snap to
  // exact texel increments so rotating turntables or animated frames keep rock-solid edges.
  const targetProjRight = center.dot(camRight);
  const targetProjUp = center.dot(camUp);
  const targetProjBack = center.dot(camBack);

  const snappedRight =
    Math.round(targetProjRight / viewUnitsPerPixelX) * viewUnitsPerPixelX;
  const snappedUp =
    Math.round(targetProjUp / viewUnitsPerPixelY) * viewUnitsPerPixelY;

  const snappedTarget = new THREE.Vector3()
    .addScaledVector(camRight, snappedRight)
    .addScaledVector(camUp, snappedUp)
    .addScaledVector(camBack, targetProjBack);

  const dist = Math.max(2, projDepth + radius + 4);
  const near = 0.05;
  const far = dist + projDepth + radius + 8;

  const halfW = frustumWidth * 0.5;
  const halfH = frustumHeight * 0.5;
  const ortho = new THREE.OrthographicCamera(
    -halfW,
    halfW,
    halfH,
    -halfH,
    near,
    far
  );
  ortho.position.copy(snappedTarget).addScaledVector(camBack, dist);
  ortho.up.copy(camUp);
  ortho.lookAt(snappedTarget);
  ortho.updateMatrixWorld(true);

  return {
    camera: ortho,
    viewNear: near,
    viewFar: far,
    boundsMinZView: Math.max(near, dist - maxN),
    boundsMaxZView: Math.max(near + 0.01, dist - minN),
  };
}

function readRenderTargetToPixelBuffer(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  width: number,
  height: number,
  convertLinearToSrgb: boolean
): PixelBuffer {
  const raw = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, raw);

  const out = new PixelBuffer(width, height);
  const dst = out.data;

  // Flip Y because WebGL readPixels origin is bottom-left while PixelBuffer is top-left
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const sIdx = (srcY * width + x) * 4;
      const dIdx = (y * width + x) * 4;
      const a = raw[sIdx + 3];
      if (!convertLinearToSrgb) {
        dst[dIdx] = raw[sIdx];
        dst[dIdx + 1] = raw[sIdx + 1];
        dst[dIdx + 2] = raw[sIdx + 2];
        dst[dIdx + 3] = a;
      } else if (a === 0) {
        dst[dIdx] = 0;
        dst[dIdx + 1] = 0;
        dst[dIdx + 2] = 0;
        dst[dIdx + 3] = 0;
      } else {
        dst[dIdx] = linearFloatToSrgbByte(raw[sIdx]);
        dst[dIdx + 1] = linearFloatToSrgbByte(raw[sIdx + 1]);
        dst[dIdx + 2] = linearFloatToSrgbByte(raw[sIdx + 2]);
        dst[dIdx + 3] = a;
      }
    }
  }
  out.markAllDirty();
  return out;
}

function collectMeshList(root: THREE.Group): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      meshes.push(obj);
    }
  });
  return meshes;
}

function buildAlphaClippedOverrideMaterial(
  baseMat: THREE.Material | undefined,
  kind: "normal" | "depth"
): THREE.Material {
  const texturedBase = baseMat as
    | (THREE.Material & { map?: THREE.Texture | null; alphaTest?: number })
    | undefined;
  const side = baseMat?.side ?? THREE.FrontSide;
  const alphaTest = texturedBase?.alphaTest ?? 0.5;
  const map = texturedBase?.map ?? null;

  if (kind === "normal") {
    const mat = new THREE.MeshNormalMaterial({
      flatShading: true,
      side,
    });
    if (map && alphaTest > 0) {
      mat.alphaTest = alphaTest;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uCutoutMap = { value: map };
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <uv_pars_vertex>",
            `#include <uv_pars_vertex>\nvarying vec2 vCutoutUv;`
          )
          .replace(
            "#include <uv_vertex>",
            `#include <uv_vertex>\nvCutoutUv = uv;`
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <uv_pars_fragment>",
            `#include <uv_pars_fragment>\nuniform sampler2D uCutoutMap;\nvarying vec2 vCutoutUv;`
          )
          .replace(
            "#include <clipping_planes_fragment>",
            `#include <clipping_planes_fragment>\n\tif ( texture2D( uCutoutMap, vCutoutUv ).a < ${alphaTest.toFixed(4)} ) discard;`
          );
      };
    }
    return mat;
  }

  const mat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    side,
  });
  if (map && alphaTest > 0) {
    mat.map = map;
    mat.alphaTest = alphaTest;
  }
  return mat;
}

function unpackRgbaDepth01(r: number, g: number, b: number, a: number): number {
  return (
    (r / 255) * (1 / (256 * 256 * 256)) +
    (g / 255) * (1 / (256 * 256)) +
    (b / 255) * (1 / 256) +
    a / 255
  );
}

function swapMeshMaterialsForPass(
  meshes: readonly THREE.Mesh[],
  kind: "normal" | "depth"
): {
  restore: () => void;
  dispose: () => void;
} {
  const saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const created: THREE.Material[] = [];

  for (const mesh of meshes) {
    saved.set(mesh, mesh.material);
    if (Array.isArray(mesh.material)) {
      const nextMats = mesh.material.map((m) => {
        const createdMat = buildAlphaClippedOverrideMaterial(m, kind);
        created.push(createdMat);
        return createdMat;
      });
      mesh.material = nextMats;
    } else {
      const createdMat = buildAlphaClippedOverrideMaterial(mesh.material, kind);
      created.push(createdMat);
      mesh.material = createdMat;
    }
  }

  return {
    restore: () => {
      for (const [mesh, orig] of saved.entries()) {
        mesh.material = orig;
      }
    },
    dispose: () => {
      for (const mat of created) {
        mat.dispose();
      }
    },
  };
}

function linearizeDepthNdcToGray(
  ndcDepth01: number,
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera,
  rangeMinZ: number,
  rangeMaxZ: number
): number {
  let viewZ: number;
  if (camera instanceof THREE.OrthographicCamera) {
    viewZ = camera.near + ndcDepth01 * (camera.far - camera.near);
  } else {
    const zNdc = ndcDepth01 * 2 - 1;
    viewZ =
      (2 * camera.near * camera.far) /
      (camera.far + camera.near - zNdc * (camera.far - camera.near));
  }
  const span = Math.max(1e-4, rangeMaxZ - rangeMinZ);
  const norm = Math.max(0, Math.min(1, (viewZ - rangeMinZ) / span));
  // Near = 255, Far = 32
  return Math.max(32, Math.min(255, Math.round(255 - norm * (255 - 32))));
}

function renderSingleViewWithResources(
  renderer: THREE.WebGLRenderer,
  renderTarget: THREE.WebGLRenderTarget,
  engine: Model3DEngine,
  materialCache: RetroMaterialCache,
  opts: RenderModel3DSpriteOptions
): PixelBuffer {
  const storeState = useEditorStore.getState();
  const s3d = storeState.studio3d;
  const width = Math.max(1, Math.round(opts.width ?? storeState.canvasWidth));
  const height = Math.max(1, Math.round(opts.height ?? storeState.canvasHeight));
  const pass: Model3DBakePass = opts.pass ?? "lit";
  const projection: Model3DBakeProjection = opts.projection ?? "ortho";
  const yawDeg = opts.yawDeg ?? s3d.yawDeg;
  const pitchDeg = opts.pitchDeg ?? s3d.pitchDeg;
  const rollDeg = opts.rollDeg ?? s3d.rollDeg;
  const fovDeg = opts.fovDeg ?? 45;
  const autoFit = opts.autoFit ?? true;
  const marginPx = opts.marginPx ?? 2;
  const ppu = Math.max(1, opts.pixelsPerUnit ?? engine.pixelsPerUnit);
  const cullBackfaces = opts.cullBackfaces ?? s3d.cullBackfacesInView;

  const posedNodes = buildPosedNodes(engine, opts.clipId, opts.frame);
  const posedEngineProxy: PosedEngineProxy = {
    pixelsPerUnit: ppu,
    nodes: posedNodes,
    selectedNodeIds: [],
    activeNodeId: null,
  };

  // Use unlit material first when we need alpha cutout mask for normal/depth passes
  const baseShadingMode: ShadingMode =
    pass === "normal" || pass === "depth" ? "unlit" : passToShadingMode(pass);

  const { materialById, textureSizeByMaterialId } = materialCache.sync({
    materials: engine.materials,
    shadingMode: baseShadingMode,
    cullBackfacesInView: cullBackfaces,
    layers: storeState.layers,
    currentFrame: storeState.currentFrame,
    canvasWidth: storeState.canvasWidth,
    canvasHeight: storeState.canvasHeight,
    lightIntensity: s3d.lightIntensity,
  });

  const synced = syncModel3DScene(posedEngineProxy as unknown as Model3DEngine, {
    wireframeOverlay: false,
    materialById,
    textureSizeByMaterialId,
    defaultTextureWidth: Math.max(1, storeState.canvasWidth),
    defaultTextureHeight: Math.max(1, storeState.canvasHeight),
    // Baked sprites show the final (export) result of the modifier stack.
    modifierContext: "export",
  });

  const scene = buildBakeSceneAndLighting(synced.rootGroup, pass);
  const bounds = computeSceneBoundingBox(synced.rootGroup);
  const camInfo = configureBakeCamera(bounds, width, height, ppu, {
    projection,
    yawDeg,
    pitchDeg,
    rollDeg,
    fovDeg,
    autoFit,
    marginPx,
  });

  const meshes = collectMeshList(synced.rootGroup);
  let overrideHandle: { restore: () => void; dispose: () => void } | null = null;

  try {
    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;

    let rawBuffer: PixelBuffer;

    if (pass === "normal") {
      // Render unlit alpha mask first so alphaTest cutout pixels remain alpha=0
      renderer.clear(true, true, true);
      renderer.render(scene, camInfo.camera);
      const alphaMask = readRenderTargetToPixelBuffer(
        renderer,
        renderTarget,
        width,
        height,
        false
      );

      overrideHandle = swapMeshMaterialsForPass(meshes, "normal");
      renderer.clear(true, true, true);
      renderer.render(scene, camInfo.camera);
      const normalRaw = readRenderTargetToPixelBuffer(
        renderer,
        renderTarget,
        width,
        height,
        false
      );

      for (let i = 0; i < normalRaw.data.length; i += 4) {
        const maskAlpha = alphaMask.data[i + 3];
        if (maskAlpha === 0) {
          normalRaw.data[i] = 0;
          normalRaw.data[i + 1] = 0;
          normalRaw.data[i + 2] = 0;
          normalRaw.data[i + 3] = 0;
        } else {
          normalRaw.data[i + 3] = maskAlpha;
        }
      }
      normalRaw.markAllDirty();
      rawBuffer = normalRaw;
    } else if (pass === "depth") {
      // Render unlit alpha mask for crisp alphaTest cutout transparency
      renderer.clear(true, true, true);
      renderer.render(scene, camInfo.camera);
      const alphaMask = readRenderTargetToPixelBuffer(
        renderer,
        renderTarget,
        width,
        height,
        false
      );

      overrideHandle = swapMeshMaterialsForPass(meshes, "depth");
      renderer.clear(true, true, true);
      renderer.render(scene, camInfo.camera);
      const depthRaw = readRenderTargetToPixelBuffer(
        renderer,
        renderTarget,
        width,
        height,
        false
      );

      for (let i = 0; i < depthRaw.data.length; i += 4) {
        const maskAlpha = alphaMask.data[i + 3];
        if (maskAlpha === 0) {
          depthRaw.data[i] = 0;
          depthRaw.data[i + 1] = 0;
          depthRaw.data[i + 2] = 0;
          depthRaw.data[i + 3] = 0;
        } else {
          // MeshDepthMaterial with RGBADepthPacking packs fragCoordZ across RGBA
          const fragCoordZ = unpackRgbaDepth01(
            depthRaw.data[i],
            depthRaw.data[i + 1],
            depthRaw.data[i + 2],
            depthRaw.data[i + 3]
          );
          const gray = linearizeDepthNdcToGray(
            fragCoordZ,
            camInfo.camera,
            camInfo.boundsMinZView,
            camInfo.boundsMaxZView
          );
          depthRaw.data[i] = gray;
          depthRaw.data[i + 1] = gray;
          depthRaw.data[i + 2] = gray;
          depthRaw.data[i + 3] = maskAlpha;
        }
      }
      depthRaw.markAllDirty();
      rawBuffer = depthRaw;
    } else {
      renderer.clear(true, true, true);
      renderer.render(scene, camInfo.camera);
      // WebGLRenderTarget renders in linear working space; convert RGB to sRGB for PixelBuffer
      rawBuffer = readRenderTargetToPixelBuffer(
        renderer,
        renderTarget,
        width,
        height,
        true
      );
    }

    if (opts.applyPostProcess === false) {
      return rawBuffer;
    }

    const paletteRgba =
      opts.paletteRgba ?? paletteHexListToRgba(storeState.palette);
    return postProcessBakedSpriteBuffer(rawBuffer, {
      alphaCutoff: opts.alphaCutoff,
      quantizeToPalette: opts.quantizeToPalette,
      ditherMode: opts.ditherMode,
      paletteRgba,
      outline: opts.outline,
      outlineColor: opts.outlineColor,
    });
  } finally {
    if (overrideHandle) {
      overrideHandle.restore();
      overrideHandle.dispose();
    }
    disposeSyncedObjectTree(synced.rootGroup);
  }
}

function withOffscreenRenderContext<T>(
  width: number,
  height: number,
  fn: (
    renderer: THREE.WebGLRenderer,
    renderTarget: THREE.WebGLRenderTarget,
    materialCache: RetroMaterialCache
  ) => T
): T {
  const renderer = threeStudioRuntime.getRenderer();
  const prevTarget = renderer.getRenderTarget();
  const prevClearColor = renderer.getClearColor(new THREE.Color());
  const prevClearAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;

  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
  });
  const materialCache = new RetroMaterialCache();

  try {
    return fn(renderer, renderTarget, materialCache);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.autoClear = prevAutoClear;
    renderTarget.dispose();
    materialCache.dispose();
  }
}

/**
 * Renders the current Low-Poly 3D model from a single view into a `PixelBuffer`
 * using the singleton `ThreeStudioRuntime` renderer and an offscreen `WebGLRenderTarget`.
 */
export function renderModel3DSpriteBuffer(
  options: RenderModel3DSpriteOptions = {}
): PixelBuffer {
  const storeState = useEditorStore.getState();
  const width = Math.max(1, Math.round(options.width ?? storeState.canvasWidth));
  const height = Math.max(
    1,
    Math.round(options.height ?? storeState.canvasHeight)
  );

  return withOffscreenRenderContext(
    width,
    height,
    (renderer, renderTarget, materialCache) =>
      renderSingleViewWithResources(
        renderer,
        renderTarget,
        pixelEngine.model3d,
        materialCache,
        { ...options, width, height }
      )
  );
}

/**
 * Bakes the current 3D model view into the active Draw frame (either writing
 * into the active unlocked raster layer or creating a new `"3D Model Bake"` layer),
 * with full UndoCoordinator (`"pixels"`) support.
 */
export function bakeModel3DToCurrentFrameAction(
  options: RenderModel3DSpriteOptions = {}
): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const engine = pixelEngine.model3d;
  if (engine.nodes.length === 0) {
    state.setStatusMessage("No 3D model nodes to bake");
    return false;
  }

  const rendered = renderModel3DSpriteBuffer({
    ...options,
    width: state.canvasWidth,
    height: state.canvasHeight,
  });

  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  let targetLayerId = activeLayer?.id ?? "";
  if (
    !activeLayer ||
    activeLayer.kind !== "raster" ||
    isLayerEffectivelyLocked(state.layers, activeLayer.id)
  ) {
    targetLayerId = state.addNamedLayer("3D Model Bake");
  }

  const frameIdx = state.currentFrame;
  const cel = pixelEngine.getOrCreateCel(targetLayerId, frameIdx);
  pixelEngine.history.beginTransaction(
    targetLayerId,
    frameIdx,
    "Bake 3D Model to Frame"
  );
  pixelEngine.history.captureAllTiles(cel);
  cel.data.set(rendered.data);
  cel.markAllDirty();
  pixelEngine.history.commitTransaction(cel);

  syncHistoryAndCelState(targetLayerId, frameIdx);
  syncTimelineCels();
  pixelEngine.emitChange();
  state.setStatusMessage(
    `Baked 3D model to frame ${frameIdx + 1} (${state.canvasWidth}x${state.canvasHeight})`
  );
  return true;
}

/**
 * Bakes a 4/8/12/16-direction turntable (static pose or animated active clip)
 * into a new Draw layer across sequential frames, adding direction `AnimationTag`s
 * when `animateActiveClip` is enabled.
 */
export function bakeModel3DTurntableAction(
  options: BakeModel3DTurntableOptions
): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const engine = pixelEngine.model3d;
  if (engine.nodes.length === 0) {
    state.setStatusMessage("No 3D model nodes to bake");
    return false;
  }

  const directions = options.directions;
  const width = state.canvasWidth;
  const height = state.canvasHeight;
  const baseYawDeg = options.baseYawDeg ?? state.studio3d.yawDeg;
  const pitchDeg = options.pitchDeg ?? state.studio3d.pitchDeg;
  const rollDeg = options.rollDeg ?? state.studio3d.rollDeg;
  const sweepDeg = options.sweepDeg ?? 360;

  const activeClip =
    (options.clipId
      ? engine.clips.find((c) => c.id === options.clipId)
      : undefined) ??
    (engine.activeClipId
      ? engine.clips.find((c) => c.id === engine.activeClipId)
      : undefined);

  const animateClip = Boolean(options.animateActiveClip && activeClip);
  const clipFrameCount = animateClip
    ? Math.max(1, activeClip!.frameCount)
    : 1;

  const renderedFrames: PixelBuffer[] = [];
  const dirTags: Array<{
    name: string;
    fromFrame: number;
    toFrame: number;
    color: string;
  }> = [];

  withOffscreenRenderContext(
    width,
    height,
    (renderer, renderTarget, materialCache) => {
      for (let d = 0; d < directions; d++) {
        const yawDeg = baseYawDeg + (sweepDeg * d) / directions;
        const fromFrame = renderedFrames.length;

        for (let f = 0; f < clipFrameCount; f++) {
          const buf = renderSingleViewWithResources(
            renderer,
            renderTarget,
            engine,
            materialCache,
            {
              ...options,
              width,
              height,
              yawDeg,
              pitchDeg,
              rollDeg,
              clipId: animateClip ? activeClip!.id : undefined,
              frame: animateClip ? f : undefined,
            }
          );
          renderedFrames.push(buf);
        }

        if (animateClip) {
          const dirLabel = getTurntableDirectionLabel(d, directions);
          dirTags.push({
            name: `Dir_${dirLabel}`,
            fromFrame,
            toFrame: renderedFrames.length - 1,
            color: BAKE_TAG_COLORS[d % BAKE_TAG_COLORS.length],
          });
        }
      }
    }
  );

  if (renderedFrames.length === 0) {
    state.setStatusMessage("No turntable frames rendered");
    return false;
  }

  const layerName =
    options.layerName?.trim() ||
    (animateClip
      ? `3D ${directions}-Dir (${activeClip!.name})`
      : `3D Turntable (${directions})`);
  const targetLayerId = state.addNamedLayer(layerName);

  const addedFrames = renderedFrames.length > state.frames.length;
  while (useEditorStore.getState().frames.length < renderedFrames.length) {
    const count = useEditorStore.getState().frames.length;
    pixelEngine.insertEmptyFrame(count, count);
    useEditorStore.getState().insertFrameMetadata(count);
  }

  if (addedFrames) {
    for (let i = 0; i < renderedFrames.length; i++) {
      const cel = pixelEngine.getOrCreateCel(targetLayerId, i);
      cel.data.set(renderedFrames[i].data);
      cel.markAllDirty();
    }
    pixelEngine.history.clear();
    pixelEngine.undoCoordinator.clear();
    useEditorStore.getState().setHistoryFlags(false, false);
  } else {
    pixelEngine.history.beginMultiCelTransaction("Bake 3D Turntable");
    for (let i = 0; i < renderedFrames.length; i++) {
      const cel = pixelEngine.getOrCreateCel(targetLayerId, i);
      pixelEngine.history.captureMultiCel(targetLayerId, i, cel);
      cel.data.set(renderedFrames[i].data);
      cel.markAllDirty();
    }
    pixelEngine.history.commitMultiCelTransaction();
  }

  const storeAfter = useEditorStore.getState();
  if (animateClip) {
    for (const tag of dirTags) {
      storeAfter.addTag(tag.name, tag.fromFrame, tag.toFrame, tag.color);
    }
  }

  syncTimelineCels();
  syncHistoryAndCelState(targetLayerId, 0);
  storeAfter.setCurrentFrame(0);
  pixelEngine.emitChange();
  storeAfter.setStatusMessage(
    animateClip
      ? `Baked ${renderedFrames.length}-frame 3D turntable (${directions} dirs, ${dirTags.length} tags)`
      : `Baked ${renderedFrames.length}-frame 3D turntable`
  );
  return true;
}

/**
 * Renders 1 or 4 cardinal yaw rotations (`+0°, +90°, +180°, +270°`) of the
 * 3D model directly into new slots of the active `Tileset`, recording a
 * `"tileset"` undo entry via `TilemapHistory` + `UndoCoordinator`.
 */
export function bakeModel3DToTilesetAction(
  options: BakeModel3DToTilesetOptions = {}
): number[] {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const engine = pixelEngine.model3d;
  if (engine.nodes.length === 0) {
    state.setStatusMessage("No 3D model nodes to bake");
    return [];
  }

  const tilesetIndex = options.tilesetIndex ?? state.activeTilesetIndex;
  const tileset =
    pixelEngine.tilesetRegistry.get(tilesetIndex) ?? pixelEngine.tileset;
  const tileW = Math.max(4, tileset.tileWidth);
  const tileH = Math.max(4, tileset.tileHeight);
  const rotations: 1 | 4 = options.rotations === 4 ? 4 : 1;
  const baseYawDeg = options.baseYawDeg ?? state.studio3d.yawDeg;
  const pitchDeg = options.pitchDeg ?? state.studio3d.pitchDeg;
  const rollDeg = options.rollDeg ?? state.studio3d.rollDeg;
  const namePrefix = options.tileNamePrefix?.trim() || "3D Tile";

  const renderedTiles: PixelBuffer[] = [];
  withOffscreenRenderContext(
    tileW,
    tileH,
    (renderer, renderTarget, materialCache) => {
      for (let i = 0; i < rotations; i++) {
        const yawDeg = baseYawDeg + i * 90;
        const buf = renderSingleViewWithResources(
          renderer,
          renderTarget,
          engine,
          materialCache,
          {
            ...options,
            width: tileW,
            height: tileH,
            yawDeg,
            pitchDeg,
            rollDeg,
          }
        );
        renderedTiles.push(buf);
      }
    }
  );

  const beforeSnap = captureTilemapHistorySnapshot(pixelEngine);
  const addedIds: number[] = [];
  for (let i = 0; i < renderedTiles.length; i++) {
    const angle = i * 90;
    const tileName =
      rotations === 4 ? `${namePrefix} ${angle}°` : namePrefix;
    const newId = tileset.addTile(renderedTiles[i], { name: tileName });
    addedIds.push(newId);
  }
  const afterSnap = captureTilemapHistorySnapshot(pixelEngine);

  const label =
    rotations === 4
      ? "Bake 3D to Tileset (4 Rotations)"
      : "Bake 3D to Tileset";
  pixelEngine.tilemapHistory.pushTilesetSnapshot(label, beforeSnap, afterSnap);

  if (addedIds.length > 0) {
    state.setActiveTileId(addedIds[0]);
  }
  state.bumpTilesetVersion();
  syncHistoryAndCelState();
  pixelEngine.emitChange();
  state.setStatusMessage(
    `Baked ${addedIds.length} tile${addedIds.length === 1 ? "" : "s"} (${tileW}x${tileH}) into "${tileset.name}"`
  );
  return addedIds;
}
