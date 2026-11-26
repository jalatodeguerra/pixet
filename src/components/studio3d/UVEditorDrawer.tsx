import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlipHorizontal2,
  FlipVertical2,
  Grid,
  Layers,
  Lock,
  Maximize2,
  Package,
  RotateCw,
  Unlock,
  X,
} from "lucide-react";
import { pixelEngine, type LayerCompositingInfo } from "../../engine/document/PixelEngine";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import { cloneCuboidData, clonePolyMeshData } from "../../engine/model3d/Model3DEngine";
import { mutateModel3D } from "../../engine/model3d/model3dActions";
import { buildPaddedTilesetAtlas } from "../../engine/model3d/tilesetAtlas";
import type {
  CuboidFaceName,
  ModelMaterial,
  ModelNode,
  Vec2,
} from "../../engine/model3d/types";
import {
  autoPackModelUvs,
  computeBoxUvFaces,
  CUBOID_FACE_NAMES,
  rasterizeUvGuideToBuffer,
  transformFaceCornerUvs,
} from "../../engine/model3d/uvOps";
import { useEditorStore } from "../../store/editorStore";

const FACE_SHORT_LABEL: Record<CuboidFaceName, string> = {
  north: "N",
  south: "S",
  east: "E",
  west: "W",
  up: "U",
  down: "D",
};

const ZOOM_LEVELS = [1, 2, 4, 8] as const;
type UVZoom = (typeof ZOOM_LEVELS)[number];
type CornerHandle = "nw" | "ne" | "se" | "sw";

interface ResolvedTextureSource {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  label: string;
}

type UVDragState =
  | {
      kind: "pan";
      startClientX: number;
      startClientY: number;
      startPanX: number;
      startPanY: number;
    }
  | {
      kind: "box-origin";
      nodeId: string;
      beforeSnap: string;
      startU: number;
      startV: number;
      origOrigin: Vec2;
    }
  | {
      kind: "cuboid-face-move";
      nodeId: string;
      faceName: CuboidFaceName;
      beforeSnap: string;
      startU: number;
      startV: number;
      origUv: [number, number, number, number];
    }
  | {
      kind: "cuboid-face-resize";
      nodeId: string;
      faceName: CuboidFaceName;
      corner: CornerHandle;
      beforeSnap: string;
      origUv: [number, number, number, number];
    }
  | {
      kind: "mesh-faces-move";
      nodeId: string;
      faceIds: string[];
      beforeSnap: string;
      startU: number;
      startV: number;
      origUvsByFace: Map<string, Vec2[]>;
    }
  | {
      kind: "mesh-vertex-move";
      nodeId: string;
      faceId: string;
      cornerIdx: number;
      beforeSnap: string;
    };

function snapValue(v: number, step: number): number {
  const s = step > 0 ? step : 1;
  const snapped = Math.round(v / s) * s;
  return Object.is(snapped, -0) ? 0 : Math.round(snapped * 100) / 100;
}

function pointInPoly2D(px: number, py: number, poly: ReadonlyArray<Vec2>): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function getNodePrimaryMaterialId(
  node: ModelNode | null,
  engineMaterials: readonly ModelMaterial[]
): string | null {
  if (node?.cuboid) {
    return node.cuboid.faces.north.materialId;
  }
  if (node?.mesh && node.mesh.faces.length > 0) {
    return node.mesh.faces[0].materialId;
  }
  return engineMaterials[0]?.id ?? null;
}

export function UVEditorDrawer() {
  const studio3d = useEditorStore((s) => s.studio3d);
  const patchStudio3D = useEditorStore((s) => s.patchStudio3D);
  const model3dVersion = useEditorStore((s) => s.model3dVersion);
  const layers = useEditorStore((s) => s.layers);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const [engineTick, setEngineTick] = useState(0);
  const [zoom, setZoom] = useState<UVZoom>(4);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 24, y: 20 });
  const [uvSnap, setUvSnap] = useState<1 | 0.5>(1);
  const [packGutter, setPackGutter] = useState<0 | 1>(1);
  const [selectedCuboidFace, setSelectedCuboidFace] =
    useState<CuboidFaceName>("north");
  const [materialOverrideId, setMaterialOverrideId] = useState<string | null>(
    null
  );
  const [canvasSize, setCanvasSize] = useState({ w: 320, h: 220 });
  const [embeddedTick, setEmbeddedTick] = useState(0);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<UVDragState | null>(null);
  const embeddedCacheRef = useRef<
    Map<string, { sig: string; width: number; height: number; rgba: Uint8ClampedArray }>
  >(new Map());
  const centeredOnceRef = useRef(false);

  const isOpen = studio3d.uvDrawerOpen || studio3d.subMode === "uv";

  useEffect(() => {
    return pixelEngine.subscribe(() => {
      setEngineTick((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setCanvasSize({
          w: Math.max(180, Math.floor(rect.width)),
          h: Math.max(140, Math.floor(rect.height)),
        });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [isOpen]);

  const engine = pixelEngine.model3d;
  const activeNode = engine.activeNodeId
    ? engine.getNode(engine.activeNodeId) ?? null
    : null;

  const defaultMatId = getNodePrimaryMaterialId(activeNode, engine.materials);
  const activeMaterial =
    engine.materials.find((m) => m.id === materialOverrideId) ??
    engine.materials.find((m) => m.id === defaultMatId) ??
    engine.materials[0] ??
    null;

  const resolvedTexture = useMemo<ResolvedTextureSource>(() => {
    void model3dVersion;
    void engineTick;
    void tilesetVersion;
    void embeddedTick;

    const wFallback = Math.max(1, canvasWidth);
    const hFallback = Math.max(1, canvasHeight);

    if (!activeMaterial) {
      return {
        width: wFallback,
        height: hFallback,
        rgba: new Uint8ClampedArray(wFallback * hFallback * 4),
        label: "Draw Canvas",
      };
    }

    const src = activeMaterial.source;
    if (src.kind === "draw-canvas") {
      if (src.layerId) {
        const cel = pixelEngine.getCel(src.layerId, currentFrame);
        return {
          width: wFallback,
          height: hFallback,
          rgba: cel
            ? new Uint8ClampedArray(cel.data)
            : new Uint8ClampedArray(wFallback * hFallback * 4),
          label: `${activeMaterial.name} (${wFallback}×${hFallback})`,
        };
      }
      const albedoLayers: LayerCompositingInfo[] = layers.filter(
        (l) => l.kind === "group" || !l.mapRole || l.mapRole === "albedo"
      );
      const comp = pixelEngine.compositeFrame(albedoLayers, currentFrame);
      return {
        width: wFallback,
        height: hFallback,
        rgba: new Uint8ClampedArray(comp),
        label: `${activeMaterial.name} (${wFallback}×${hFallback})`,
      };
    }

    if (src.kind === "tileset") {
      const ts =
        pixelEngine.tilesetRegistry.tilesets.find(
          (t) => t.id === src.tilesetId
        ) ?? pixelEngine.tileset;
      const atlas = buildPaddedTilesetAtlas(ts);
      return {
        width: atlas.width,
        height: atlas.height,
        rgba: new Uint8ClampedArray(atlas.buffer.data),
        label: `${ts.name} Atlas (${atlas.width}×${atlas.height})`,
      };
    }

    if (src.kind === "embedded") {
      const sig = `${src.width}x${src.height}:${src.pngBase64.length}:${src.pngBase64.slice(0, 48)}`;
      const cached = embeddedCacheRef.current.get(activeMaterial.id);
      if (cached && cached.sig === sig) {
        return {
          width: cached.width,
          height: cached.height,
          rgba: cached.rgba,
          label: `${activeMaterial.name} (${cached.width}×${cached.height})`,
        };
      }
      if (typeof Image !== "undefined" && src.pngBase64) {
        const img = new Image();
        img.onload = () => {
          const w = Math.max(1, img.naturalWidth || src.width);
          const h = Math.max(1, img.naturalHeight || src.height);
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, w, h);
          const imgData = ctx.getImageData(0, 0, w, h);
          embeddedCacheRef.current.set(activeMaterial.id, {
            sig,
            width: w,
            height: h,
            rgba: new Uint8ClampedArray(imgData.data),
          });
          setEmbeddedTick((v) => v + 1);
        };
        img.src = src.pngBase64.startsWith("data:")
          ? src.pngBase64
          : `data:image/png;base64,${src.pngBase64}`;
      }
      return {
        width: Math.max(1, src.width),
        height: Math.max(1, src.height),
        rgba: new Uint8ClampedArray(Math.max(1, src.width) * Math.max(1, src.height) * 4),
        label: `${activeMaterial.name} (${src.width}×${src.height})`,
      };
    }

    return {
      width: wFallback,
      height: hFallback,
      rgba: new Uint8ClampedArray(wFallback * hFallback * 4),
      label: `${activeMaterial.name}`,
    };
  }, [
    activeMaterial,
    canvasWidth,
    canvasHeight,
    currentFrame,
    layers,
    model3dVersion,
    engineTick,
    tilesetVersion,
    embeddedTick,
  ]);

  const centerView = () => {
    const texW = resolvedTexture.width;
    const texH = resolvedTexture.height;
    setPan({
      x: Math.round((canvasSize.w - texW * zoom) * 0.5),
      y: Math.round((canvasSize.h - texH * zoom) * 0.5),
    });
  };

  useEffect(() => {
    if (!isOpen || centeredOnceRef.current) return;
    if (canvasSize.w > 0 && canvasSize.h > 0) {
      centeredOnceRef.current = true;
      setPan({
        x: Math.round((canvasSize.w - resolvedTexture.width * zoom) * 0.5),
        y: Math.round((canvasSize.h - resolvedTexture.height * zoom) * 0.5),
      });
    }
  }, [isOpen, canvasSize.w, canvasSize.h, resolvedTexture.width, resolvedTexture.height, zoom]);

  // Draw texture + pixel grid + UV overlays
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = canvasSize;
    const texW = resolvedTexture.width;
    const texH = resolvedTexture.height;

    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, w, h);

    const drawX = Math.round(pan.x);
    const drawY = Math.round(pan.y);
    const drawW = texW * zoom;
    const drawH = texH * zoom;

    // Checkerboard inside texture bounds
    const checkerSize = Math.max(4, Math.min(16, zoom * 2));
    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, drawY, drawW, drawH);
    ctx.clip();
    ctx.fillStyle = "#1c1c1c";
    ctx.fillRect(drawX, drawY, drawW, drawH);
    ctx.fillStyle = "#242424";
    const cols = Math.ceil(drawW / checkerSize);
    const rows = Math.ceil(drawH / checkerSize);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if ((cx + cy) % 2 === 0) {
          ctx.fillRect(
            drawX + cx * checkerSize,
            drawY + cy * checkerSize,
            checkerSize,
            checkerSize
          );
        }
      }
    }

    // Pixel texture
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement("canvas");
    }
    const off = offscreenCanvasRef.current;
    if (off.width !== texW || off.height !== texH) {
      off.width = texW;
      off.height = texH;
    }
    const octx = off.getContext("2d");
    if (octx) {
      const imgData = new ImageData(
        new Uint8ClampedArray(resolvedTexture.rgba),
        texW,
        texH
      );
      octx.putImageData(imgData, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, drawX, drawY, drawW, drawH);
    }

    // Pixel grid at high zoom
    if (zoom >= 4 && texW <= 256 && texH <= 256) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let px = 1; px < texW; px++) {
        const gx = drawX + px * zoom + 0.5;
        ctx.moveTo(gx, drawY);
        ctx.lineTo(gx, drawY + drawH);
      }
      for (let py = 1; py < texH; py++) {
        const gy = drawY + py * zoom + 0.5;
        ctx.moveTo(drawX, gy);
        ctx.lineTo(drawX + drawW, gy);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Outer texture border
    ctx.strokeStyle = "#3d3d3d";
    ctx.lineWidth = 1;
    ctx.strokeRect(drawX + 0.5, drawY + 0.5, drawW, drawH);

    const drawNodeUvs = (node: ModelNode, isActive: boolean) => {
      if (!node.visible) return;
      if (node.kind === "cuboid" && node.cuboid) {
        const cuboid = node.cuboid;
        if (isActive && cuboid.uvMode === "box") {
          const dx = Math.max(1, Math.round(Math.abs(cuboid.to[0] - cuboid.from[0])));
          const dy = Math.max(1, Math.round(Math.abs(cuboid.to[1] - cuboid.from[1])));
          const dz = Math.max(1, Math.round(Math.abs(cuboid.to[2] - cuboid.from[2])));
          const ox = drawX + cuboid.boxUvOrigin[0] * zoom;
          const oy = drawY + cuboid.boxUvOrigin[1] * zoom;
          const bw = (2 * dz + 2 * dx) * zoom;
          const bh = (dz + dy) * zoom;
          ctx.strokeStyle = "rgba(76, 139, 245, 0.45)";
          ctx.lineWidth = 1;
          ctx.strokeRect(ox + 0.5, oy + 0.5, bw, bh);
        }

        for (const faceName of CUBOID_FACE_NAMES) {
          const face = cuboid.faces[faceName];
          if (face.hidden) continue;
          const minU = Math.min(face.uv[0], face.uv[2]);
          const maxU = Math.max(face.uv[0], face.uv[2]);
          const minV = Math.min(face.uv[1], face.uv[3]);
          const maxV = Math.max(face.uv[1], face.uv[3]);
          const rx = drawX + minU * zoom;
          const ry = drawY + minV * zoom;
          const rw = (maxU - minU) * zoom;
          const rh = (maxV - minV) * zoom;

          const isSelectedFace = isActive && faceName === selectedCuboidFace;
          ctx.fillStyle = !isActive
            ? "rgba(102, 102, 102, 0.1)"
            : isSelectedFace
              ? "rgba(255, 180, 84, 0.2)"
              : "rgba(76, 139, 245, 0.14)";
          ctx.fillRect(rx, ry, rw, rh);

          ctx.strokeStyle = !isActive
            ? "#666666"
            : isSelectedFace
              ? "#ffb454"
              : "#4c8bf5";
          ctx.lineWidth = isSelectedFace ? 2 : 1;
          ctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(1, rw), Math.max(1, rh));

          if (isActive && rw >= 12 && rh >= 12) {
            ctx.fillStyle = isSelectedFace ? "#ffb454" : "#e8e8e8";
            ctx.font = "600 9px monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(FACE_SHORT_LABEL[faceName], rx + 3, ry + 2);
          }

          if (isSelectedFace && cuboid.uvMode === "per-face") {
            const corners: Array<[number, number]> = [
              [rx, ry],
              [rx + rw, ry],
              [rx + rw, ry + rh],
              [rx, ry + rh],
            ];
            for (const [cx, cy] of corners) {
              ctx.fillStyle = "#ffb454";
              ctx.fillRect(cx - 3, cy - 3, 6, 6);
              ctx.strokeStyle = "#141414";
              ctx.lineWidth = 1;
              ctx.strokeRect(cx - 3.5, cy - 3.5, 7, 7);
            }
          }
        }
      } else if (node.kind === "mesh" && node.mesh) {
        const selectedFaceIds = new Set(engine.selectedFaces[node.id] ?? []);
        const drawPoly = (faceUvs: ReadonlyArray<Vec2>, isSelectedFace: boolean) => {
          if (faceUvs.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(drawX + faceUvs[0][0] * zoom, drawY + faceUvs[0][1] * zoom);
          for (let i = 1; i < faceUvs.length; i++) {
            ctx.lineTo(drawX + faceUvs[i][0] * zoom, drawY + faceUvs[i][1] * zoom);
          }
          ctx.closePath();
          ctx.fillStyle = !isActive
            ? "rgba(102, 102, 102, 0.1)"
            : isSelectedFace
              ? "rgba(255, 180, 84, 0.22)"
              : "rgba(76, 139, 245, 0.14)";
          ctx.fill();
          ctx.strokeStyle = !isActive
            ? "#666666"
            : isSelectedFace
              ? "#ffb454"
              : "#4c8bf5";
          ctx.lineWidth = isSelectedFace ? 1.8 : 1;
          ctx.stroke();

          if (isActive && isSelectedFace) {
            for (const [u, v] of faceUvs) {
              const vx = drawX + u * zoom;
              const vy = drawY + v * zoom;
              ctx.fillStyle = "#ffb454";
              ctx.fillRect(vx - 3, vy - 3, 6, 6);
              ctx.strokeStyle = "#141414";
              ctx.lineWidth = 1;
              ctx.strokeRect(vx - 3.5, vy - 3.5, 7, 7);
            }
          }
        };

        for (const face of node.mesh.faces) {
          if (selectedFaceIds.has(face.id)) continue;
          drawPoly(face.uvs, false);
        }
        for (const face of node.mesh.faces) {
          if (!selectedFaceIds.has(face.id)) continue;
          drawPoly(face.uvs, true);
        }
      }
    };

    for (const node of engine.nodes) {
      if (activeNode && node.id === activeNode.id) continue;
      drawNodeUvs(node, false);
    }
    if (activeNode) {
      drawNodeUvs(activeNode, true);
    }
  }, [
    isOpen,
    canvasSize,
    resolvedTexture,
    pan,
    zoom,
    engine.nodes,
    engine.selectedFaces,
    activeNode,
    selectedCuboidFace,
    model3dVersion,
    engineTick,
  ]);

  if (!isOpen) return null;

  const screenToTex = (clientX: number, clientY: number): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return [(sx - pan.x) / zoom, (sy - pan.y) / zoom];
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (e.button === 1 || (e.button === 0 && (e.altKey || spaceHeld))) {
      e.preventDefault();
      dragRef.current = {
        kind: "pan",
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0 || !activeNode || activeNode.locked) return;

    const [tu, tv] = screenToTex(e.clientX, e.clientY);

    if (activeNode.kind === "cuboid" && activeNode.cuboid) {
      const cuboid = activeNode.cuboid;

      if (cuboid.uvMode === "per-face") {
        // 1. Check corner handles of selectedCuboidFace first
        const selFace = cuboid.faces[selectedCuboidFace];
        if (!selFace.hidden) {
          const minU = Math.min(selFace.uv[0], selFace.uv[2]);
          const maxU = Math.max(selFace.uv[0], selFace.uv[2]);
          const minV = Math.min(selFace.uv[1], selFace.uv[3]);
          const maxV = Math.max(selFace.uv[1], selFace.uv[3]);
          const handles: Array<{ corner: CornerHandle; x: number; y: number }> = [
            { corner: "nw", x: pan.x + minU * zoom, y: pan.y + minV * zoom },
            { corner: "ne", x: pan.x + maxU * zoom, y: pan.y + minV * zoom },
            { corner: "se", x: pan.x + maxU * zoom, y: pan.y + maxV * zoom },
            { corner: "sw", x: pan.x + minU * zoom, y: pan.y + maxV * zoom },
          ];
          for (const h of handles) {
            if (Math.hypot(sx - h.x, sy - h.y) <= 7) {
              const beforeSnap = pixelEngine.model3dHistory.captureSnapshot(engine);
              dragRef.current = {
                kind: "cuboid-face-resize",
                nodeId: activeNode.id,
                faceName: selectedCuboidFace,
                corner: h.corner,
                beforeSnap,
                origUv: [minU, minV, maxU, maxV],
              };
              canvas.setPointerCapture(e.pointerId);
              return;
            }
          }
        }
      }

      // 2. Hit-test cuboid face rects (selected face first, then reverse draw order)
      const hitOrder: CuboidFaceName[] = [
        selectedCuboidFace,
        ...CUBOID_FACE_NAMES.filter((f) => f !== selectedCuboidFace).reverse(),
      ];
      let hitFace: CuboidFaceName | null = null;
      for (const fn of hitOrder) {
        const f = cuboid.faces[fn];
        if (f.hidden) continue;
        const minU = Math.min(f.uv[0], f.uv[2]);
        const maxU = Math.max(f.uv[0], f.uv[2]);
        const minV = Math.min(f.uv[1], f.uv[3]);
        const maxV = Math.max(f.uv[1], f.uv[3]);
        if (tu >= minU && tu <= maxU && tv >= minV && tv <= maxV) {
          hitFace = fn;
          break;
        }
      }

      if (hitFace) {
        setSelectedCuboidFace(hitFace);
        const beforeSnap = pixelEngine.model3dHistory.captureSnapshot(engine);
        if (cuboid.uvMode === "box") {
          dragRef.current = {
            kind: "box-origin",
            nodeId: activeNode.id,
            beforeSnap,
            startU: tu,
            startV: tv,
            origOrigin: [cuboid.boxUvOrigin[0], cuboid.boxUvOrigin[1]],
          };
        } else {
          const f = cuboid.faces[hitFace];
          const minU = Math.min(f.uv[0], f.uv[2]);
          const maxU = Math.max(f.uv[0], f.uv[2]);
          const minV = Math.min(f.uv[1], f.uv[3]);
          const maxV = Math.max(f.uv[1], f.uv[3]);
          dragRef.current = {
            kind: "cuboid-face-move",
            nodeId: activeNode.id,
            faceName: hitFace,
            beforeSnap,
            startU: tu,
            startV: tv,
            origUv: [minU, minV, maxU, maxV],
          };
        }
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      // In box mode, also allow dragging anywhere inside the outer Box-UV cross footprint
      if (cuboid.uvMode === "box") {
        const dx = Math.max(1, Math.round(Math.abs(cuboid.to[0] - cuboid.from[0])));
        const dy = Math.max(1, Math.round(Math.abs(cuboid.to[1] - cuboid.from[1])));
        const dz = Math.max(1, Math.round(Math.abs(cuboid.to[2] - cuboid.from[2])));
        const [ox, oy] = cuboid.boxUvOrigin;
        if (
          tu >= ox &&
          tu <= ox + 2 * dz + 2 * dx &&
          tv >= oy &&
          tv <= oy + dz + dy
        ) {
          const beforeSnap = pixelEngine.model3dHistory.captureSnapshot(engine);
          dragRef.current = {
            kind: "box-origin",
            nodeId: activeNode.id,
            beforeSnap,
            startU: tu,
            startV: tv,
            origOrigin: [ox, oy],
          };
          canvas.setPointerCapture(e.pointerId);
        }
      }
      return;
    }

    if (activeNode.kind === "mesh" && activeNode.mesh) {
      const mesh = activeNode.mesh;
      const selectedFaceIds = engine.selectedFaces[activeNode.id] ?? [];

      // 1. Hit-test UV vertex handles of selected faces
      for (const faceId of selectedFaceIds) {
        const face = mesh.faces.find((f) => f.id === faceId);
        if (!face) continue;
        for (let ci = 0; ci < face.uvs.length; ci++) {
          const [u, v] = face.uvs[ci];
          const vx = pan.x + u * zoom;
          const vy = pan.y + v * zoom;
          if (Math.hypot(sx - vx, sy - vy) <= 7) {
            const beforeSnap = pixelEngine.model3dHistory.captureSnapshot(engine);
            dragRef.current = {
              kind: "mesh-vertex-move",
              nodeId: activeNode.id,
              faceId: face.id,
              cornerIdx: ci,
              beforeSnap,
            };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
        }
      }

      // 2. Hit-test PolyFace polygons (selected faces first)
      const hitCandidates = [
        ...mesh.faces.filter((f) => selectedFaceIds.includes(f.id)).reverse(),
        ...mesh.faces.filter((f) => !selectedFaceIds.includes(f.id)).reverse(),
      ];
      const hitFace = hitCandidates.find((f) => pointInPoly2D(tu, tv, f.uvs));
      if (hitFace) {
        let nextSel: string[];
        if (e.shiftKey) {
          nextSel = selectedFaceIds.includes(hitFace.id)
            ? selectedFaceIds.filter((id) => id !== hitFace.id)
            : [...selectedFaceIds, hitFace.id];
          engine.selectedFaces[activeNode.id] = nextSel;
          useEditorStore.getState().bumpModel3DVersion();
          return;
        }
        nextSel = selectedFaceIds.includes(hitFace.id)
          ? [...selectedFaceIds]
          : [hitFace.id];
        engine.selectedFaces[activeNode.id] = nextSel;
        useEditorStore.getState().bumpModel3DVersion();

        const beforeSnap = pixelEngine.model3dHistory.captureSnapshot(engine);
        const origUvsByFace = new Map<string, Vec2[]>();
        for (const fid of nextSel) {
          const f = mesh.faces.find((x) => x.id === fid);
          if (f) {
            origUvsByFace.set(
              fid,
              f.uvs.map(([u, v]): Vec2 => [u, v])
            );
          }
        }
        dragRef.current = {
          kind: "mesh-faces-move",
          nodeId: activeNode.id,
          faceIds: nextSel,
          beforeSnap,
          startU: tu,
          startV: tv,
          origUvsByFace,
        };
        canvas.setPointerCapture(e.pointerId);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === "pan") {
      setPan({
        x: Math.round(drag.startPanX + (e.clientX - drag.startClientX)),
        y: Math.round(drag.startPanY + (e.clientY - drag.startClientY)),
      });
      return;
    }

    const node = engine.getNode(drag.nodeId);
    if (!node) return;
    const [tu, tv] = screenToTex(e.clientX, e.clientY);

    if (drag.kind === "box-origin" && node.kind === "cuboid" && node.cuboid) {
      const du = snapValue(tu - drag.startU, uvSnap);
      const dv = snapValue(tv - drag.startV, uvSnap);
      const nextOrigin: Vec2 = [
        Math.round(drag.origOrigin[0] + du),
        Math.round(drag.origOrigin[1] + dv),
      ];
      const nextCuboid = cloneCuboidData(node.cuboid);
      nextCuboid.boxUvOrigin = nextOrigin;
      const recomputed = computeBoxUvFaces(
        nextCuboid.from,
        nextCuboid.to,
        nextOrigin,
        nextCuboid.faces.north.materialId,
        Boolean(nextCuboid.mirrorUvX),
        nextCuboid.faces
      );
      for (const fn of CUBOID_FACE_NAMES) {
        recomputed[fn].materialId = nextCuboid.faces[fn].materialId;
      }
      nextCuboid.faces = recomputed;
      engine.updateNode(node.id, { cuboid: nextCuboid });
      useEditorStore.getState().bumpModel3DVersion();
      return;
    }

    if (drag.kind === "cuboid-face-move" && node.kind === "cuboid" && node.cuboid) {
      const du = snapValue(tu - drag.startU, uvSnap);
      const dv = snapValue(tv - drag.startV, uvSnap);
      const nextCuboid = cloneCuboidData(node.cuboid);
      nextCuboid.faces[drag.faceName].uv = [
        drag.origUv[0] + du,
        drag.origUv[1] + dv,
        drag.origUv[2] + du,
        drag.origUv[3] + dv,
      ];
      engine.updateNode(node.id, { cuboid: nextCuboid });
      useEditorStore.getState().bumpModel3DVersion();
      return;
    }

    if (drag.kind === "cuboid-face-resize" && node.kind === "cuboid" && node.cuboid) {
      const minSize = Math.max(uvSnap, 1);
      const su = snapValue(tu, uvSnap);
      const sv = snapValue(tv, uvSnap);
      let [u0, v0, u1, v1] = drag.origUv;
      if (drag.corner === "nw") {
        u0 = Math.min(u1 - minSize, su);
        v0 = Math.min(v1 - minSize, sv);
      } else if (drag.corner === "ne") {
        u1 = Math.max(u0 + minSize, su);
        v0 = Math.min(v1 - minSize, sv);
      } else if (drag.corner === "se") {
        u1 = Math.max(u0 + minSize, su);
        v1 = Math.max(v0 + minSize, sv);
      } else {
        u0 = Math.min(u1 - minSize, su);
        v1 = Math.max(v0 + minSize, sv);
      }
      const nextCuboid = cloneCuboidData(node.cuboid);
      nextCuboid.faces[drag.faceName].uv = [u0, v0, u1, v1];
      engine.updateNode(node.id, { cuboid: nextCuboid });
      useEditorStore.getState().bumpModel3DVersion();
      return;
    }

    if (drag.kind === "mesh-faces-move" && node.kind === "mesh" && node.mesh) {
      const du = snapValue(tu - drag.startU, uvSnap);
      const dv = snapValue(tv - drag.startV, uvSnap);
      const nextMesh = clonePolyMeshData(node.mesh);
      for (const face of nextMesh.faces) {
        const orig = drag.origUvsByFace.get(face.id);
        if (!orig) continue;
        face.uvs = orig.map(([u, v]): Vec2 => [u + du, v + dv]);
      }
      engine.updateNode(node.id, { mesh: nextMesh });
      useEditorStore.getState().bumpModel3DVersion();
      return;
    }

    if (drag.kind === "mesh-vertex-move" && node.kind === "mesh" && node.mesh) {
      const su = snapValue(tu, uvSnap);
      const sv = snapValue(tv, uvSnap);
      const nextMesh = clonePolyMeshData(node.mesh);
      const face = nextMesh.faces.find((f) => f.id === drag.faceId);
      if (face && face.uvs[drag.cornerIdx]) {
        face.uvs[drag.cornerIdx] = [su, sv];
        engine.updateNode(node.id, { mesh: nextMesh });
        useEditorStore.getState().bumpModel3DVersion();
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (drag.kind === "pan") return;

    const afterSnap = pixelEngine.model3dHistory.captureSnapshot(engine);
    if (afterSnap !== drag.beforeSnap) {
      const label =
        drag.kind === "box-origin"
          ? "Move Box UV"
          : drag.kind === "cuboid-face-move"
            ? "Move Face UV"
            : drag.kind === "cuboid-face-resize"
              ? "Resize Face UV"
              : drag.kind === "mesh-faces-move"
                ? "Move Mesh Face UVs"
                : "Move UV Vertex";
      pixelEngine.model3dHistory.pushUndo(drag.beforeSnap, label);
      pixelEngine.undoCoordinator.record("model3d", label);
      useEditorStore.getState().bumpModel3DVersion();
      pixelEngine.emitChange();
      syncHistoryAndCelState();
    }
  };

  const handleAutoPack = () => {
    const res = mutateModel3D("Auto-Pack 3D UVs", (eng) => {
      const packed = autoPackModelUvs(
        eng.nodes,
        resolvedTexture.width,
        resolvedTexture.height,
        packGutter
      );
      for (const packedNode of packed.nodes) {
        if (packedNode.kind === "cuboid" && packedNode.cuboid) {
          eng.updateNode(packedNode.id, { cuboid: packedNode.cuboid });
        } else if (packedNode.kind === "mesh" && packedNode.mesh) {
          eng.updateNode(packedNode.id, { mesh: packedNode.mesh });
        }
      }
      return packed;
    });
    setStatusMessage(
      res.overflowCount > 0
        ? `Packed ${res.packedCount} UV island(s) (${res.overflowCount} overflow)`
        : `Packed ${res.packedCount} UV island(s) (${packGutter}px gutter)`
    );
  };

  const handleGenerateUvGuideLayer = () => {
    const state = useEditorStore.getState();
    const w = Math.max(1, state.canvasWidth);
    const h = Math.max(1, state.canvasHeight);
    const guideBuf = rasterizeUvGuideToBuffer(pixelEngine.model3d.nodes, w, h);

    const existing = state.layers.find(
      (l) => l.kind === "raster" && l.name === "3D UV Guide"
    );
    const targetId = existing ? existing.id : state.addNamedLayer("3D UV Guide");
    const frameIdx = useEditorStore.getState().currentFrame;
    const cel = pixelEngine.getOrCreateCel(targetId, frameIdx);

    pixelEngine.history.beginTransaction(
      targetId,
      frameIdx,
      "Generate 3D UV Guide"
    );
    pixelEngine.history.captureAllTiles(cel);
    cel.data.set(guideBuf.data);
    cel.markAllDirty();
    pixelEngine.history.commitTransaction(cel);
    syncHistoryAndCelState(targetId, frameIdx);
    pixelEngine.emitChange();
    useEditorStore
      .getState()
      .setStatusMessage('Generated "3D UV Guide" layer in Draw');
  };

  const transformActiveMeshSelectedFaces = (
    label: string,
    rot: 0 | 90 | 180 | 270,
    flipX: boolean,
    flipY: boolean
  ) => {
    if (!activeNode || activeNode.kind !== "mesh" || !activeNode.mesh) return;
    const selIds = engine.selectedFaces[activeNode.id] ?? [];
    const targetSet = new Set(
      selIds.length > 0 ? selIds : activeNode.mesh.faces.map((f) => f.id)
    );
    if (targetSet.size === 0) return;

    mutateModel3D(label, (eng) => {
      const node = eng.getNode(activeNode.id);
      if (!node || !node.mesh) return;
      const nextMesh = clonePolyMeshData(node.mesh);
      for (const face of nextMesh.faces) {
        if (!targetSet.has(face.id)) continue;
        face.uvs = transformFaceCornerUvs(face.uvs, rot, flipX, flipY);
      }
      eng.updateNode(node.id, { mesh: nextMesh });
    });
  };

  const activeCuboid =
    activeNode?.kind === "cuboid" && activeNode.cuboid
      ? activeNode.cuboid
      : null;
  const activeMesh =
    activeNode?.kind === "mesh" && activeNode.mesh ? activeNode.mesh : null;
  const activeFaceUv = activeCuboid
    ? activeCuboid.faces[selectedCuboidFace]
    : null;
  const meshSelectedFaceCount = activeNode
    ? (engine.selectedFaces[activeNode.id]?.length ?? 0)
    : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: 290,
        minHeight: 210,
        background: "var(--bg-panel)",
        borderTop: "1px solid var(--border-strong)",
        flexShrink: 0,
      }}
      aria-label="2D Pixel-UV Editor"
    >
      {/* Top Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "5px 8px",
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-subtle)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--text-secondary)",
            }}
          >
            2D UV Editor
          </span>

          <select
            className="m3d-select"
            value={activeMaterial?.id ?? ""}
            onChange={(e) => setMaterialOverrideId(e.target.value || null)}
            title="Active Material Texture"
          >
            {engine.materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.source.kind})
              </option>
            ))}
          </select>

          <span className="m3d-badge m3d-badge-mono">{resolvedTexture.label}</span>

          <div className="option-divider" />

          <div style={{ display: "inline-flex", gap: 2 }}>
            {ZOOM_LEVELS.map((z) => (
              <button
                key={z}
                type="button"
                className={`toggle-chip ${zoom === z ? "active" : ""}`}
                style={{ padding: "2px 6px" }}
                onClick={() => setZoom(z)}
              >
                {z}×
              </button>
            ))}
          </div>

          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            title="Center Texture in UV View"
            onClick={centerView}
          >
            <Maximize2 size={12} />
          </button>

          <button
            type="button"
            className={`toggle-chip ${uvSnap === 0.5 ? "active" : ""}`}
            style={{ padding: "2px 6px" }}
            title="Toggle UV Snap (1 px / 0.5 px)"
            onClick={() => setUvSnap((s) => (s === 1 ? 0.5 : 1))}
          >
            <Grid size={11} />
            <span>Snap {uvSnap}px</span>
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <select
            className="m3d-select"
            value={packGutter}
            onChange={(e) => setPackGutter(Number(e.target.value) === 0 ? 0 : 1)}
            title="Auto-Pack Gutter"
          >
            <option value={0}>0px gutter</option>
            <option value={1}>1px gutter</option>
          </select>

          <button
            type="button"
            className="m3d-btn"
            onClick={handleAutoPack}
            disabled={engine.nodes.length === 0}
            title="Shelf-pack all node UVs into active texture bounds"
          >
            <Package size={12} />
            <span>Auto-Pack All UVs</span>
          </button>

          <button
            type="button"
            className="m3d-btn m3d-btn-primary"
            onClick={handleGenerateUvGuideLayer}
            disabled={engine.nodes.length === 0}
            title='Render color-coded UV islands onto Draw layer "3D UV Guide"'
          >
            <Layers size={12} />
            <span>Generate UV Guide Layer in Draw</span>
          </button>

          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            title="Close UV Editor Drawer"
            onClick={() =>
              patchStudio3D({
                uvDrawerOpen: false,
                ...(studio3d.subMode === "uv" ? { subMode: "model" } : {}),
              })
            }
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Main Split: Interactive UV Canvas + Selected Node/Face Controls */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          ref={wrapRef}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            position: "relative",
            overflow: "hidden",
            background: "#141414",
          }}
        >
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              imageRendering: "pixelated",
              cursor: spaceHeld ? "grab" : "crosshair",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={(e) => {
              e.preventDefault();
              const idx = ZOOM_LEVELS.indexOf(zoom);
              const nextIdx = Math.max(
                0,
                Math.min(ZOOM_LEVELS.length - 1, idx + (e.deltaY < 0 ? 1 : -1))
              );
              setZoom(ZOOM_LEVELS[nextIdx]);
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 6,
              left: 8,
              fontSize: 10,
              color: "var(--text-muted)",
              pointerEvents: "none",
              background: "rgba(20, 20, 20, 0.85)",
              padding: "2px 6px",
              border: "1px solid var(--border-subtle)",
            }}
          >
            Drag UV island/vertex to place · Middle/Alt/Space+Drag to pan · Scroll to zoom
          </div>
        </div>

        {/* Right Sub-Inspector */}
        <div
          style={{
            width: 248,
            flexShrink: 0,
            background: "var(--bg-surface)",
            borderLeft: "1px solid var(--border-subtle)",
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            overflowY: "auto",
            fontSize: 11,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--border-subtle)",
              paddingBottom: 5,
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
              {activeNode ? activeNode.name : "No Node Selected"}
            </span>
            {activeNode && (
              <span className="m3d-outliner-kind">{activeNode.kind}</span>
            )}
          </div>

          {activeCuboid && activeNode && (
            <>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  className={`toggle-chip ${activeCuboid.uvMode === "box" ? "active" : ""}`}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => {
                    if (activeCuboid.uvMode === "box") return;
                    mutateModel3D("Switch Cuboid to Box UV", (eng) => {
                      const n = eng.getNode(activeNode.id);
                      if (!n || !n.cuboid) return;
                      const next = cloneCuboidData(n.cuboid);
                      next.uvMode = "box";
                      const recomputed = computeBoxUvFaces(
                        next.from,
                        next.to,
                        next.boxUvOrigin,
                        next.faces.north.materialId,
                        Boolean(next.mirrorUvX),
                        next.faces
                      );
                      for (const fn of CUBOID_FACE_NAMES) {
                        recomputed[fn].materialId = next.faces[fn].materialId;
                      }
                      next.faces = recomputed;
                      eng.updateNode(n.id, { cuboid: next });
                    });
                  }}
                >
                  Box UV
                </button>
                <button
                  type="button"
                  className={`toggle-chip ${activeCuboid.uvMode === "per-face" ? "active" : ""}`}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => {
                    if (activeCuboid.uvMode === "per-face") return;
                    mutateModel3D("Switch Cuboid to Per-Face UV", (eng) => {
                      const n = eng.getNode(activeNode.id);
                      if (!n || !n.cuboid) return;
                      const next = cloneCuboidData(n.cuboid);
                      next.uvMode = "per-face";
                      eng.updateNode(n.id, { cuboid: next });
                    });
                  }}
                >
                  Per-Face
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={activeCuboid.uvLock}
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
                  {activeCuboid.uvLock ? <Lock size={11} /> : <Unlock size={11} />}
                  <span>UV Lock (preserve on resize)</span>
                </label>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(activeCuboid.mirrorUvX)}
                    onChange={(e) => {
                      const mirrorUvX = e.target.checked;
                      mutateModel3D("Toggle Mirror UV X", (eng) => {
                        const n = eng.getNode(activeNode.id);
                        if (!n || !n.cuboid) return;
                        const next = cloneCuboidData(n.cuboid);
                        next.mirrorUvX = mirrorUvX;
                        if (next.uvMode === "box") {
                          const recomputed = computeBoxUvFaces(
                            next.from,
                            next.to,
                            next.boxUvOrigin,
                            next.faces.north.materialId,
                            mirrorUvX,
                            next.faces
                          );
                          for (const fn of CUBOID_FACE_NAMES) {
                            recomputed[fn].materialId = next.faces[fn].materialId;
                          }
                          next.faces = recomputed;
                        }
                        eng.updateNode(n.id, { cuboid: next });
                      });
                    }}
                  />
                  <span>Mirror UV X</span>
                </label>
              </div>

              {activeCuboid.uvMode === "box" ? (
                <div className="m3d-field-label">
                  <span>Box UV Origin (px)</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                    <input
                      type="number"
                      step={1}
                      className="m3d-num-input"
                      aria-label="Box UV Origin U"
                      value={activeCuboid.boxUvOrigin[0]}
                      onChange={(e) => {
                        const ox = Math.round(Number(e.target.value) || 0);
                        const oy = activeCuboid.boxUvOrigin[1];
                        mutateModel3D("Set Box UV Origin", (eng) => {
                          const n = eng.getNode(activeNode.id);
                          if (!n || !n.cuboid) return;
                          const next = cloneCuboidData(n.cuboid);
                          next.boxUvOrigin = [ox, oy];
                          const recomputed = computeBoxUvFaces(
                            next.from,
                            next.to,
                            [ox, oy],
                            next.faces.north.materialId,
                            Boolean(next.mirrorUvX),
                            next.faces
                          );
                          for (const fn of CUBOID_FACE_NAMES) {
                            recomputed[fn].materialId = next.faces[fn].materialId;
                          }
                          next.faces = recomputed;
                          eng.updateNode(n.id, { cuboid: next });
                        });
                      }}
                    />
                    <input
                      type="number"
                      step={1}
                      className="m3d-num-input"
                      aria-label="Box UV Origin V"
                      value={activeCuboid.boxUvOrigin[1]}
                      onChange={(e) => {
                        const ox = activeCuboid.boxUvOrigin[0];
                        const oy = Math.round(Number(e.target.value) || 0);
                        mutateModel3D("Set Box UV Origin", (eng) => {
                          const n = eng.getNode(activeNode.id);
                          if (!n || !n.cuboid) return;
                          const next = cloneCuboidData(n.cuboid);
                          next.boxUvOrigin = [ox, oy];
                          const recomputed = computeBoxUvFaces(
                            next.from,
                            next.to,
                            [ox, oy],
                            next.faces.north.materialId,
                            Boolean(next.mirrorUvX),
                            next.faces
                          );
                          for (const fn of CUBOID_FACE_NAMES) {
                            recomputed[fn].materialId = next.faces[fn].materialId;
                          }
                          next.faces = recomputed;
                          eng.updateNode(n.id, { cuboid: next });
                        });
                      }}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="m3d-field-label">
                    <span>Face ({FACE_SHORT_LABEL[selectedCuboidFace]})</span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 2 }}>
                      {CUBOID_FACE_NAMES.map((fn) => (
                        <button
                          key={fn}
                          type="button"
                          className={`toggle-chip ${selectedCuboidFace === fn ? "active" : ""}`}
                          style={{ padding: "2px 0", justifyContent: "center" }}
                          onClick={() => setSelectedCuboidFace(fn)}
                          title={fn}
                        >
                          {FACE_SHORT_LABEL[fn]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {activeFaceUv && (
                    <>
                      <div className="m3d-field-label">
                        <span>Rect [u0, v0, u1, v1]</span>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3 }}>
                          {activeFaceUv.uv.map((val, idx) => (
                            <input
                              key={idx}
                              type="number"
                              step={uvSnap}
                              className="m3d-num-input"
                              value={val}
                              onChange={(e) => {
                                const num = snapValue(Number(e.target.value) || 0, uvSnap);
                                mutateModel3D("Edit Face UV Rect", (eng) => {
                                  const n = eng.getNode(activeNode.id);
                                  if (!n || !n.cuboid) return;
                                  const next = cloneCuboidData(n.cuboid);
                                  const uv: [number, number, number, number] = [
                                    ...next.faces[selectedCuboidFace].uv,
                                  ];
                                  uv[idx] = num;
                                  next.faces[selectedCuboidFace].uv = uv;
                                  eng.updateNode(n.id, { cuboid: next });
                                });
                              }}
                            />
                          ))}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          type="button"
                          className="m3d-btn"
                          style={{ flex: 1, justifyContent: "center" }}
                          onClick={() =>
                            mutateModel3D("Rotate Face UV 90°", (eng) => {
                              const n = eng.getNode(activeNode.id);
                              if (!n || !n.cuboid) return;
                              const next = cloneCuboidData(n.cuboid);
                              const f = next.faces[selectedCuboidFace];
                              f.rotation = ((f.rotation + 90) % 360) as
                                | 0
                                | 90
                                | 180
                                | 270;
                              eng.updateNode(n.id, { cuboid: next });
                            })
                          }
                        >
                          <RotateCw size={11} />
                          <span>90°</span>
                        </button>
                        <button
                          type="button"
                          className={`m3d-btn ${activeFaceUv.flipX ? "m3d-btn-primary" : ""}`}
                          style={{ flex: 1, justifyContent: "center" }}
                          onClick={() =>
                            mutateModel3D("Flip Face UV X", (eng) => {
                              const n = eng.getNode(activeNode.id);
                              if (!n || !n.cuboid) return;
                              const next = cloneCuboidData(n.cuboid);
                              const f = next.faces[selectedCuboidFace];
                              f.flipX = !f.flipX;
                              eng.updateNode(n.id, { cuboid: next });
                            })
                          }
                        >
                          <FlipHorizontal2 size={11} />
                          <span>Flip X</span>
                        </button>
                        <button
                          type="button"
                          className={`m3d-btn ${activeFaceUv.flipY ? "m3d-btn-primary" : ""}`}
                          style={{ flex: 1, justifyContent: "center" }}
                          onClick={() =>
                            mutateModel3D("Flip Face UV Y", (eng) => {
                              const n = eng.getNode(activeNode.id);
                              if (!n || !n.cuboid) return;
                              const next = cloneCuboidData(n.cuboid);
                              const f = next.faces[selectedCuboidFace];
                              f.flipY = !f.flipY;
                              eng.updateNode(n.id, { cuboid: next });
                            })
                          }
                        >
                          <FlipVertical2 size={11} />
                          <span>Flip Y</span>
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {activeMesh && activeNode && (
            <>
              <div style={{ color: "var(--text-secondary)" }}>
                Faces: <span className="mono-value">{activeMesh.faces.length}</span> · Selected:{" "}
                <span className="mono-value">{meshSelectedFaceCount}</span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  className="m3d-btn"
                  style={{ flex: 1, justifyContent: "center" }}
                  disabled={activeMesh.faces.length === 0}
                  onClick={() =>
                    transformActiveMeshSelectedFaces(
                      "Rotate Mesh UV 90°",
                      90,
                      false,
                      false
                    )
                  }
                >
                  <RotateCw size={11} />
                  <span>Rotate 90°</span>
                </button>
                <button
                  type="button"
                  className="m3d-btn"
                  style={{ flex: 1, justifyContent: "center" }}
                  disabled={activeMesh.faces.length === 0}
                  onClick={() =>
                    transformActiveMeshSelectedFaces(
                      "Flip Mesh UV U",
                      0,
                      true,
                      false
                    )
                  }
                >
                  <FlipHorizontal2 size={11} />
                  <span>Flip U</span>
                </button>
                <button
                  type="button"
                  className="m3d-btn"
                  style={{ flex: 1, justifyContent: "center" }}
                  disabled={activeMesh.faces.length === 0}
                  onClick={() =>
                    transformActiveMeshSelectedFaces(
                      "Flip Mesh UV V",
                      0,
                      false,
                      true
                    )
                  }
                >
                  <FlipVertical2 size={11} />
                  <span>Flip V</span>
                </button>
              </div>
              <div className="mode-hint">
                Click a UV polygon to select (Shift+Click multi-select). Drag faces or orange corner vertices.
              </div>
            </>
          )}

          {!activeCuboid && !activeMesh && (
            <div className="mode-hint">
              Select a Cuboid or Mesh node in the Outliner or 3D viewport to edit its UVs.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
