import * as THREE from "three";
import { PixelBuffer } from "../../../engine/document/PixelBuffer";
import { pixelEngine, type LayerCompositingInfo } from "../../../engine/document/PixelEngine";
import {
  buildPaddedTilesetAtlas,
  type PaddedTilesetAtlas,
} from "../../../engine/model3d/tilesetAtlas";
import { resolveNodeGraphMaterialSnapshot } from "../../../engine/nodes/pixetBridges";
import type { ModelMaterial, ShadingMode } from "../../../engine/model3d/types";
import type { Tileset } from "../../../engine/tiles/Tileset";
import type { LayerItem } from "../../../store/editorStore";

export interface MaterialSyncInput {
  materials: readonly ModelMaterial[];
  shadingMode: ShadingMode;
  cullBackfacesInView: boolean;
  layers: readonly LayerItem[];
  currentFrame: number;
  canvasWidth: number;
  canvasHeight: number;
  lightIntensity?: number;
  tilesetVersion?: number;
}

export interface MaterialTextureInfo {
  width: number;
  height: number;
}

interface CachedTextureSlot {
  texture: THREE.DataTexture;
  width: number;
  height: number;
  buffer: Uint8Array;
}

interface CachedTilesetAtlasEntry {
  tilesetId: string;
  versionKey: string;
  atlas: PaddedTilesetAtlas;
}

function configureNearestTexture(
  tex: THREE.DataTexture,
  colorSpace: THREE.ColorSpace
): void {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = colorSpace;
  tex.flipY = true;
}

function createPlaceholderPixelBuffer(width = 16, height = 16): PixelBuffer {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const buf = new PixelBuffer(safeW, safeH);
  for (let y = 0; y < safeH; y++) {
    for (let x = 0; x < safeW; x++) {
      const idx = (y * safeW + x) * 4;
      const even = ((x >> 2) + (y >> 2)) % 2 === 0;
      const v = even ? 210 : 170;
      buf.data[idx] = v;
      buf.data[idx + 1] = v;
      buf.data[idx + 2] = v;
      buf.data[idx + 3] = 255;
    }
  }
  return buf;
}

function createPlaceholderTexture(colorSpace: THREE.ColorSpace): CachedTextureSlot {
  const width = 16;
  const height = 16;
  const buffer = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const even = ((x >> 2) + (y >> 2)) % 2 === 0;
      const v = even ? 210 : 170;
      buffer[idx] = v;
      buffer[idx + 1] = v;
      buffer[idx + 2] = v;
      buffer[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(
    buffer,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  configureNearestTexture(tex, colorSpace);
  tex.needsUpdate = true;
  return { texture: tex, width, height, buffer };
}

function createDrawCanvasSlot(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  colorSpace: THREE.ColorSpace,
  existing?: CachedTextureSlot
): CachedTextureSlot {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const byteLen = safeW * safeH * 4;

  // Check if source has any opaque pixels; if completely empty, show subtle checker fallback
  // only for albedo? No — keep exact canvas alpha so painted/empty pixels stay accurate,
  // unless we want empty canvases to still show model geometry. Wait: if all alpha is 0 and
  // alphaTest is 0.5, a completely blank Draw canvas would make cuboids invisible!
  // Let's detect empty canvas and synthesize a neutral solid white texture if completely empty.
  if (
    existing &&
    existing.width === safeW &&
    existing.height === safeH &&
    existing.buffer.length === byteLen
  ) {
    existing.buffer.set(rgba);
    existing.texture.needsUpdate = true;
    return existing;
  }

  if (existing) {
    existing.texture.dispose();
  }

  const buffer = new Uint8Array(byteLen);
  buffer.set(rgba);
  const tex = new THREE.DataTexture(
    buffer,
    safeW,
    safeH,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  configureNearestTexture(tex, colorSpace);
  tex.needsUpdate = true;
  return { texture: tex, width: safeW, height: safeH, buffer };
}

function hasAnyNonZeroAlpha(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 0) return true;
  }
  return false;
}

function isLayerVisibleChain(
  layer: LayerItem,
  byId: Map<string, LayerItem>
): boolean {
  let cur: LayerItem | undefined = layer;
  const visited = new Set<string>();
  while (cur) {
    if (visited.has(cur.id)) break;
    visited.add(cur.id);
    if (!cur.visible) return false;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return true;
}

function collectRoleLayers(
  layers: readonly LayerItem[],
  role: "albedo" | "normal" | "emission"
): LayerCompositingInfo[] {
  return layers.filter((l) => {
    if (l.kind === "group") return true;
    const r = l.mapRole ?? "albedo";
    return r === role;
  });
}

function hasVisibleRolePixels(
  layers: readonly LayerItem[],
  role: "normal" | "emission",
  frameIndex: number
): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]));
  for (const l of layers) {
    if (l.kind === "group") continue;
    if ((l.mapRole ?? "albedo") !== role) continue;
    if (!isLayerVisibleChain(l, byId)) continue;
    const cel = pixelEngine.getCel(l.id, frameIndex);
    if (cel && !cel.isEmpty()) return true;
  }
  return false;
}

function resolveTilesetById(tilesetId: string): Tileset {
  const reg = pixelEngine.tilesetRegistry as {
    tilesets: Tileset[];
    getById?: (id: string) => Tileset | undefined;
  };
  return (
    reg.getById?.(tilesetId) ??
    reg.tilesets.find((t) => t.id === tilesetId) ??
    pixelEngine.tileset
  );
}

function computeTilesetSignature(ts: Tileset, explicitVersion?: number): string {
  if (explicitVersion !== undefined) {
    return `${ts.id}:v${explicitVersion}:${ts.count}:${ts.tileWidth}x${ts.tileHeight}`;
  }
  let revSum = 0;
  for (let id = 1; id <= ts.count; id++) {
    const tile = ts.getTile(id);
    if (tile) revSum = (revSum + tile.revision * (id + 1)) | 0;
  }
  return `${ts.id}:c${ts.count}:${ts.tileWidth}x${ts.tileHeight}:r${revSum}`;
}

function buildDrawAlbedoRgba(
  matDef: ModelMaterial,
  input: Pick<MaterialSyncInput, "layers" | "currentFrame" | "canvasWidth" | "canvasHeight">
): Uint8ClampedArray {
  if (matDef.source.kind === "draw-canvas" && matDef.source.layerId) {
    const cel = pixelEngine.getCel(matDef.source.layerId, input.currentFrame);
    if (cel) {
      return cel.data;
    }
    return new Uint8ClampedArray(
      Math.max(1, input.canvasWidth) * Math.max(1, input.canvasHeight) * 4
    );
  }
  const albedoLayers = collectRoleLayers(input.layers, "albedo");
  return pixelEngine.compositeFrame(albedoLayers, input.currentFrame);
}

/**
 * Resolves the exact RGBA `PixelBuffer` (`albedo`) for any `ModelMaterial`
 * (`draw-canvas`, 1px border-extruded `tileset` atlas, or `embedded`).
 */
export function resolveModelMaterialBuffer(
  matDef: ModelMaterial,
  input: Pick<
    MaterialSyncInput,
    "layers" | "currentFrame" | "canvasWidth" | "canvasHeight" | "tilesetVersion"
  >
): PixelBuffer {
  if (matDef.source.kind === "draw-canvas") {
    const w = Math.max(1, input.canvasWidth);
    const h = Math.max(1, input.canvasHeight);
    const rgba = buildDrawAlbedoRgba(matDef, input);
    const expectedLen = w * h * 4;
    if (rgba.length === expectedLen) {
      return new PixelBuffer(w, h, rgba);
    }
    const buf = new PixelBuffer(w, h);
    buf.data.set(rgba.subarray(0, expectedLen));
    return buf;
  }

  if (matDef.source.kind === "tileset") {
    const ts = resolveTilesetById(matDef.source.tilesetId);
    const atlas = buildPaddedTilesetAtlas(ts);
    return atlas.buffer;
  }

  if (matDef.source.kind === "node-graph") {
    const snap = resolveNodeGraphMaterialSnapshot(matDef.source.graphId);
    if (snap) {
      return new PixelBuffer(snap.width, snap.height, snap.albedo);
    }
    return createPlaceholderPixelBuffer(16, 16);
  }

  if (matDef.source.kind === "embedded") {
    const w = Math.max(1, matDef.source.width);
    const h = Math.max(1, matDef.source.height);
    if (
      typeof document !== "undefined" &&
      typeof Image !== "undefined" &&
      matDef.source.pngBase64
    ) {
      // Synchronous fallback if embedded PNG isn't cached yet
      return createPlaceholderPixelBuffer(w, h);
    }
    return createPlaceholderPixelBuffer(w, h);
  }

  return createPlaceholderPixelBuffer(16, 16);
}

type MaterialCacheKind = "basic" | "lambert" | "ps1" | "standard" | "solid";

type ThreeMeshMaterial =
  | THREE.MeshBasicMaterial
  | THREE.MeshLambertMaterial
  | THREE.MeshStandardMaterial;

/** Blender-style neutral grey of the Solid viewport shading mode. */
const SOLID_VIEW_COLOR = 0xb8b8b8;

function expectedMaterialKind(shadingMode: ShadingMode): MaterialCacheKind {
  if (shadingMode === "solid") return "solid";
  if (shadingMode === "unlit") return "basic";
  if (shadingMode === "flat") return "lambert";
  if (shadingMode === "ps1") return "ps1";
  return "standard";
}

function applyPs1ShaderPatches(material: THREE.MeshLambertMaterial): void {
  material.customProgramCacheKey = () => "pixet-ps1-v1";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
vec2 snapGrid = vec2(160.0, 120.0);
if (abs(gl_Position.w) > 0.0001) {
  gl_Position.xy = floor(gl_Position.xy / gl_Position.w * snapGrid + 0.5) / snapGrid * gl_Position.w;
}`
    );

    const bayerHelper = `
float pixetPs1Bayer4x4(vec2 fragCoord) {
  vec2 p = mod(floor(fragCoord), 4.0);
  int idx = int(p.y) * 4 + int(p.x);
  if (idx == 0) return 0.0 / 16.0;
  if (idx == 1) return 8.0 / 16.0;
  if (idx == 2) return 2.0 / 16.0;
  if (idx == 3) return 10.0 / 16.0;
  if (idx == 4) return 12.0 / 16.0;
  if (idx == 5) return 4.0 / 16.0;
  if (idx == 6) return 14.0 / 16.0;
  if (idx == 7) return 6.0 / 16.0;
  if (idx == 8) return 3.0 / 16.0;
  if (idx == 9) return 11.0 / 16.0;
  if (idx == 10) return 1.0 / 16.0;
  if (idx == 11) return 9.0 / 16.0;
  if (idx == 12) return 15.0 / 16.0;
  if (idx == 13) return 7.0 / 16.0;
  if (idx == 14) return 13.0 / 16.0;
  return 5.0 / 16.0;
}
`;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
${bayerHelper}`
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
float ps1Dither = (pixetPs1Bayer4x4(gl_FragCoord.xy) - 0.5) * (1.0 / 31.0);
gl_FragColor.rgb = clamp(floor((gl_FragColor.rgb + ps1Dither) * 31.0 + 0.5) / 31.0, 0.0, 1.0);`
      );
  };
}

function decodeBase64PngToSlot(
  pngBase64: string,
  width: number,
  height: number,
  onLoaded: (slot: CachedTextureSlot) => void
): CachedTextureSlot {
  const slot = createPlaceholderTexture(THREE.SRGBColorSpace);
  if (typeof Image === "undefined" || !pngBase64) {
    return slot;
  }
  const img = new Image();
  img.onload = () => {
    const w = Math.max(1, img.naturalWidth || width);
    const h = Math.max(1, img.naturalHeight || height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const next = createDrawCanvasSlot(
      imgData.data,
      w,
      h,
      THREE.SRGBColorSpace
    );
    onLoaded(next);
  };
  img.src = pngBase64.startsWith("data:")
    ? pngBase64
    : `data:image/png;base64,${pngBase64}`;
  return slot;
}

export class RetroMaterialCache {
  private materials = new Map<
    string,
    { kind: MaterialCacheKind; instance: ThreeMeshMaterial }
  >();
  private albedoSlots = new Map<string, CachedTextureSlot>();
  private tilesetAtlasCache = new Map<string, CachedTilesetAtlasEntry>();
  private embeddedKeys = new Map<string, string>();
  private normalSlot: CachedTextureSlot | null = null;
  private emissionSlot: CachedTextureSlot | null = null;
  private fallbackTexture: CachedTextureSlot | null = null;
  private emptyDrawTexture: CachedTextureSlot | null = null;

  private getFallbackSlot(): CachedTextureSlot {
    if (!this.fallbackTexture) {
      this.fallbackTexture = createPlaceholderTexture(THREE.SRGBColorSpace);
    }
    return this.fallbackTexture;
  }

  private getEmptyDrawFallbackSlot(width: number, height: number): CachedTextureSlot {
    const safeW = Math.max(1, width);
    const safeH = Math.max(1, height);
    if (
      this.emptyDrawTexture &&
      this.emptyDrawTexture.width === safeW &&
      this.emptyDrawTexture.height === safeH
    ) {
      return this.emptyDrawTexture;
    }
    if (this.emptyDrawTexture) {
      this.emptyDrawTexture.texture.dispose();
    }
    const buf = new Uint8Array(safeW * safeH * 4);
    for (let y = 0; y < safeH; y++) {
      for (let x = 0; x < safeW; x++) {
        const idx = (y * safeW + x) * 4;
        const checker = ((x >> 2) + (y >> 2)) % 2 === 0;
        const v = checker ? 228 : 196;
        buf[idx] = v;
        buf[idx + 1] = v;
        buf[idx + 2] = v;
        buf[idx + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(
      buf,
      safeW,
      safeH,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    configureNearestTexture(tex, THREE.SRGBColorSpace);
    tex.needsUpdate = true;
    this.emptyDrawTexture = {
      texture: tex,
      width: safeW,
      height: safeH,
      buffer: buf,
    };
    return this.emptyDrawTexture;
  }

  private getOrBuildTilesetAtlas(
    tilesetId: string,
    tilesetVersion?: number
  ): PaddedTilesetAtlas {
    const ts = resolveTilesetById(tilesetId);
    const versionKey = computeTilesetSignature(ts, tilesetVersion);
    const cached = this.tilesetAtlasCache.get(ts.id);
    if (cached && cached.versionKey === versionKey) {
      return cached.atlas;
    }
    const atlas = buildPaddedTilesetAtlas(ts);
    this.tilesetAtlasCache.set(ts.id, {
      tilesetId: ts.id,
      versionKey,
      atlas,
    });
    return atlas;
  }

  /**
   * Returns the exact RGBA `PixelBuffer` (`albedo`) for `matDef`, reusing cached
   * padded tileset atlases and decoded embedded PNG textures when available.
   */
  getMaterialPixelBuffer(
    matDef: ModelMaterial,
    input: MaterialSyncInput
  ): PixelBuffer {
    if (matDef.source.kind === "tileset") {
      return this.getOrBuildTilesetAtlas(
        matDef.source.tilesetId,
        input.tilesetVersion
      ).buffer;
    }

  if (matDef.source.kind === "embedded") {
      const slotKey = `${matDef.id}::embedded`;
      const existing = this.albedoSlots.get(slotKey);
      if (existing) {
        return new PixelBuffer(
          existing.width,
          existing.height,
          new Uint8ClampedArray(existing.buffer)
        );
      }
    }
    return resolveModelMaterialBuffer(matDef, input);
  }

  sync(input: MaterialSyncInput): {
    materialById: Map<string, THREE.Material>;
    textureSizeByMaterialId: Map<string, MaterialTextureInfo>;
  } {
    const activeMatIds = new Set(input.materials.map((m) => m.id));
    for (const [id, entry] of this.materials.entries()) {
      if (!activeMatIds.has(id)) {
        entry.instance.dispose();
        this.materials.delete(id);
      }
    }
    for (const [key, slot] of this.albedoSlots.entries()) {
      const matId = key.split("::")[0];
      if (!activeMatIds.has(matId)) {
        slot.texture.dispose();
        this.albedoSlots.delete(key);
        this.embeddedKeys.delete(matId);
      }
    }

    // Sync Draw canvas normal & emission role maps if present
    const hasNormal = hasVisibleRolePixels(
      input.layers,
      "normal",
      input.currentFrame
    );
    if (hasNormal) {
      const normLayers = collectRoleLayers(input.layers, "normal");
      const normData = pixelEngine.compositeFrame(normLayers, input.currentFrame);
      this.normalSlot = createDrawCanvasSlot(
        normData,
        input.canvasWidth,
        input.canvasHeight,
        THREE.NoColorSpace,
        this.normalSlot ?? undefined
      );
    } else if (this.normalSlot) {
      this.normalSlot.texture.dispose();
      this.normalSlot = null;
    }

    const hasEmission = hasVisibleRolePixels(
      input.layers,
      "emission",
      input.currentFrame
    );
    if (hasEmission) {
      const emLayers = collectRoleLayers(input.layers, "emission");
      const emData = pixelEngine.compositeFrame(emLayers, input.currentFrame);
      this.emissionSlot = createDrawCanvasSlot(
        emData,
        input.canvasWidth,
        input.canvasHeight,
        THREE.SRGBColorSpace,
        this.emissionSlot ?? undefined
      );
    } else if (this.emissionSlot) {
      this.emissionSlot.texture.dispose();
      this.emissionSlot = null;
    }

    const materialById = new Map<string, THREE.Material>();
    const textureSizeByMaterialId = new Map<string, MaterialTextureInfo>();
    const desiredKind = expectedMaterialKind(input.shadingMode);

    for (const matDef of input.materials) {
      const albedoSlot = this.resolveAlbedoSlot(matDef, input);
      textureSizeByMaterialId.set(matDef.id, {
        width: albedoSlot.width,
        height: albedoSlot.height,
      });

      const side: THREE.Side = input.cullBackfacesInView
        ? THREE.FrontSide
        : matDef.doubleSided
          ? THREE.DoubleSide
          : THREE.FrontSide;
      const alphaTest = matDef.alphaTest > 0 ? matDef.alphaTest : 0;

      let cached = this.materials.get(matDef.id);
      if (!cached || cached.kind !== desiredKind) {
        if (cached) {
          cached.instance.dispose();
        }
        let instance: ThreeMeshMaterial;
        if (desiredKind === "solid") {
          instance = new THREE.MeshLambertMaterial({
            color: SOLID_VIEW_COLOR,
            flatShading: true,
            side: THREE.DoubleSide,
          });
        } else if (desiredKind === "basic") {
          instance = new THREE.MeshBasicMaterial({
            vertexColors: true,
          });
        } else if (desiredKind === "lambert") {
          instance = new THREE.MeshLambertMaterial({
            vertexColors: true,
            flatShading: true,
          });
        } else if (desiredKind === "ps1") {
          const ps1Mat = new THREE.MeshLambertMaterial({
            vertexColors: true,
            flatShading: true,
          });
          applyPs1ShaderPatches(ps1Mat);
          instance = ps1Mat;
        } else {
          instance = new THREE.MeshStandardMaterial({
            vertexColors: true,
            flatShading: true,
            roughness: 0.9,
            metalness: 0.0,
          });
        }
        cached = { kind: desiredKind, instance };
        this.materials.set(matDef.id, cached);
      }

      const m = cached.instance;
      // Push faces back a hair so Edit Mode wire/dots drawn on them stay visible.
      m.polygonOffset = true;
      m.polygonOffsetFactor = 2;
      m.polygonOffsetUnits = 2;
      if (desiredKind === "solid") {
        // Untextured, opaque, double-sided: faces always read, whatever the Draw canvas holds.
        m.side = THREE.DoubleSide;
        m.alphaTest = 0;
        m.transparent = false;
        m.vertexColors = false;
        m.map = null;
        materialById.set(matDef.id, m);
        continue;
      }
      m.side = side;
      m.alphaTest = alphaTest;
      m.transparent = false;
      m.vertexColors = true;
      m.map = albedoSlot.texture;

      if (m instanceof THREE.MeshStandardMaterial) {
        m.flatShading = true;
        m.roughness = 0.9;
        m.metalness = 0.0;
        if (matDef.usePbrMaps && this.normalSlot) {
          m.normalMap = this.normalSlot.texture;
        } else {
          m.normalMap = null;
        }
        if (matDef.usePbrMaps && this.emissionSlot) {
          m.emissiveMap = this.emissionSlot.texture;
          m.emissive.setHex(0xffffff);
          m.emissiveIntensity = 1.0;
        } else {
          m.emissiveMap = null;
          m.emissive.setHex(0x000000);
        }
      } else if (m instanceof THREE.MeshLambertMaterial) {
        m.flatShading = true;
        if (matDef.usePbrMaps && this.emissionSlot) {
          m.emissiveMap = this.emissionSlot.texture;
          m.emissive.setHex(0xffffff);
          m.emissiveIntensity = 1.0;
        } else {
          m.emissiveMap = null;
          m.emissive.setHex(0x000000);
        }
      }

      m.needsUpdate = true;
      materialById.set(matDef.id, m);
    }

    return { materialById, textureSizeByMaterialId };
  }

  private resolveAlbedoSlot(
    matDef: ModelMaterial,
    input: MaterialSyncInput
  ): CachedTextureSlot {
    if (matDef.source.kind === "draw-canvas") {
      const slotKey = `${matDef.id}::draw`;
      const rgba = buildDrawAlbedoRgba(matDef, input);

      if (!hasAnyNonZeroAlpha(rgba)) {
        return this.getEmptyDrawFallbackSlot(
          input.canvasWidth,
          input.canvasHeight
        );
      }

      const nextSlot = createDrawCanvasSlot(
        rgba,
        input.canvasWidth,
        input.canvasHeight,
        THREE.SRGBColorSpace,
        this.albedoSlots.get(slotKey)
      );
      this.albedoSlots.set(slotKey, nextSlot);
      return nextSlot;
    }

    if (matDef.source.kind === "tileset") {
      const atlas = this.getOrBuildTilesetAtlas(
        matDef.source.tilesetId,
        input.tilesetVersion
      );
      const atlasW = atlas.width;
      const atlasH = atlas.height;
      const rgba = atlas.buffer.data;
      if (!hasAnyNonZeroAlpha(rgba)) {
        return this.getEmptyDrawFallbackSlot(atlasW, atlasH);
      }
      const slotKey = `${matDef.id}::tileset`;
      const nextSlot = createDrawCanvasSlot(
        rgba,
        atlasW,
        atlasH,
        THREE.SRGBColorSpace,
        this.albedoSlots.get(slotKey)
      );
      this.albedoSlots.set(slotKey, nextSlot);
      return nextSlot;
    }

    if (matDef.source.kind === "node-graph") {
      const snap = resolveNodeGraphMaterialSnapshot(matDef.source.graphId);
      if (snap && hasAnyNonZeroAlpha(snap.albedo)) {
        const slotKey = `${matDef.id}::nodegraph`;
        const nextSlot = createDrawCanvasSlot(
          snap.albedo,
          snap.width,
          snap.height,
          THREE.SRGBColorSpace,
          this.albedoSlots.get(slotKey)
        );
        this.albedoSlots.set(slotKey, nextSlot);
        return nextSlot;
      }
      return this.getEmptyDrawFallbackSlot(16, 16);
    }

  if (matDef.source.kind === "embedded") {
      const slotKey = `${matDef.id}::embedded`;
      const sig = `${matDef.source.width}x${matDef.source.height}:${matDef.source.pngBase64.slice(0, 64)}:${matDef.source.pngBase64.length}`;
      const prevSig = this.embeddedKeys.get(matDef.id);
      const existing = this.albedoSlots.get(slotKey);
      if (existing && prevSig === sig) {
        return existing;
      }
      this.embeddedKeys.set(matDef.id, sig);
      const placeholder = decodeBase64PngToSlot(
        matDef.source.pngBase64,
        matDef.source.width,
        matDef.source.height,
        (loaded) => {
          const prev = this.albedoSlots.get(slotKey);
          if (prev && prev !== loaded) prev.texture.dispose();
          this.albedoSlots.set(slotKey, loaded);
        }
      );
      if (existing) existing.texture.dispose();
      this.albedoSlots.set(slotKey, placeholder);
      return placeholder;
    }

    return this.getFallbackSlot();
  }

  dispose(): void {
    for (const entry of this.materials.values()) {
      entry.instance.dispose();
    }
    this.materials.clear();

    for (const slot of this.albedoSlots.values()) {
      slot.texture.dispose();
    }
    this.albedoSlots.clear();
    this.tilesetAtlasCache.clear();
    this.embeddedKeys.clear();

    if (this.normalSlot) {
      this.normalSlot.texture.dispose();
      this.normalSlot = null;
    }
    if (this.emissionSlot) {
      this.emissionSlot.texture.dispose();
      this.emissionSlot = null;
    }
    if (this.fallbackTexture) {
      this.fallbackTexture.texture.dispose();
      this.fallbackTexture = null;
    }
    if (this.emptyDrawTexture) {
      this.emptyDrawTexture.texture.dispose();
      this.emptyDrawTexture = null;
    }
  }
}
