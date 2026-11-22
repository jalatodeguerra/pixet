import { create } from "zustand";
import type { AutoTileMode } from "../engine/tiles/autoTile";

export type WorkspaceMode = "draw" | "tiles" | "rig";

export type ToolId =
  | "pencil"
  | "eraser"
  | "line"
  | "rect"
  | "ellipse"
  | "fill"
  | "eyedropper"
  | "marquee"
  | "lasso"
  | "wand"
  | "move"
  | "tileStamp"
  | "isoBox";

export type BlendMode = "Normal" | "Multiply" | "Screen" | "Overlay" | "Add";
export type LayerKind = "raster" | "group" | "tilemap" | "rig" | "data";

export interface LayerItem {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..100
  alphaLock: boolean;
  blendMode: BlendMode;
  parentId: string | null;
  expanded?: boolean;
  cels: Record<number, boolean>;
  linkedCels?: Record<number, boolean>;
}

export interface FrameItem {
  id: string;
  index: number;
  durationMs: number;
}

export interface AnimationTag {
  id: string;
  name: string;
  fromFrame: number;
  toFrame: number;
  color: string;
}

export interface CursorPoint {
  x: number;
  y: number;
}

export const DEFAULT_PALETTE = [
  "#0f0f17",
  "#232136",
  "#4a3f55",
  "#8c7a9b",
  "#f4f4f8",
  "#d95763",
  "#df7126",
  "#fbf236",
  "#99e550",
  "#37946e",
  "#5fcde4",
  "#5b6ee1",
  "#76428a",
  "#d77bba",
  "#eec39a",
  "#8f563b",
];

interface EditorState {
  workspaceMode: WorkspaceMode;
  activeTool: ToolId;
  brushSize: number;
  pixelPerfect: boolean;
  shapeFilled: boolean;
  fillContiguous: boolean;
  symmetryX: boolean;
  symmetryY: boolean;
  showGrid: boolean;
  seamlessWrap: boolean;
  showTileGrid: boolean;
  activeTileId: number;
  tileWidth: number;
  tileHeight: number;
  tilesetVersion: number;
  autoTileEnabled: boolean;
  autoTileMode: AutoTileMode;
  showIsoGrid: boolean;
  isoBoxHeight: number;
  tileProjection: "orthogonal" | "isometric";
  zoom: number;
  cursorPos: CursorPoint | null;
  canUndo: boolean;
  canRedo: boolean;

  primaryColor: string;
  secondaryColor: string;
  palette: string[];
  paletteName: string;
  previewScale: 1 | 2 | 4;
  hasSelection: boolean;

  documentName: string;
  currentFilePath: string | null;
  canvasWidth: number;
  canvasHeight: number;
  colorMode: "RGBA" | "Indexed";
  exportModalOpen: boolean;

  layers: LayerItem[];
  activeLayerId: string;

  frames: FrameItem[];
  currentFrame: number;
  isPlaying: boolean;
  loopPlayback: boolean;
  fps: number;
  onionSkin: boolean;
  onionPrevFrames: number;
  onionNextFrames: number;
  onionOpacity: number;
  tags: AnimationTag[];
  activeTagId: string | null;

  rightPanelWidth: number;
  timelineHeight: number;
  timelineCollapsed: boolean;
  panelsCollapsed: boolean;
  statusMessage: string | null;

  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setActiveTool: (tool: ToolId) => void;
  setBrushSize: (size: number) => void;
  togglePixelPerfect: () => void;
  toggleShapeFilled: () => void;
  toggleFillContiguous: () => void;
  toggleSymmetryX: () => void;
  toggleSymmetryY: () => void;
  toggleShowGrid: () => void;
  toggleSeamlessWrap: () => void;
  toggleShowTileGrid: () => void;
  setActiveTileId: (id: number) => void;
  setTileSize: (w: number, h: number) => void;
  bumpTilesetVersion: () => void;
  toggleAutoTile: () => void;
  setAutoTileEnabled: (enabled: boolean) => void;
  setAutoTileMode: (mode: AutoTileMode) => void;
  toggleShowIsoGrid: () => void;
  setIsoBoxHeight: (h: number) => void;
  setTileProjection: (proj: "orthogonal" | "isometric") => void;
  setZoom: (zoom: number) => void;
  setCursorPos: (pos: CursorPoint | null) => void;
  setHistoryFlags: (canUndo: boolean, canRedo: boolean) => void;
  setCelPopulated: (layerId: string, frameIndex: number, populated: boolean) => void;

  setPrimaryColor: (hex: string) => void;
  setSecondaryColor: (hex: string) => void;
  swapColors: () => void;
  setPreviewScale: (scale: 1 | 2 | 4) => void;
  setHasSelection: (hasSelection: boolean) => void;
  setPalette: (name: string, colors: string[]) => void;
  addColorToPalette: (hex: string) => void;
  removeColorFromPalette: (hex: string) => void;

  selectLayer: (id: string) => void;
  toggleLayerVisible: (id: string) => void;
  toggleLayerLocked: (id: string) => void;
  toggleLayerAlphaLock: (id: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  setLayerBlendMode: (id: string, blendMode: BlendMode) => void;
  addLayer: () => void;
  addGroupLayer: () => void;
  addTilemapLayer: () => void;
  deleteActiveLayer: () => void;
  renameLayer: (id: string, name: string) => void;
  duplicateActiveLayer: () => { sourceId: string; newId: string } | null;
  moveLayer: (fromIndex: number, toIndex: number) => void;
  toggleGroupExpanded: (id: string) => void;
  setLayerParent: (id: string, parentId: string | null) => void;

  setCurrentFrame: (frameIndex: number) => void;
  prevFrame: () => void;
  nextFrame: () => void;
  togglePlaying: () => void;
  toggleLoopPlayback: () => void;
  setFps: (fps: number) => void;
  toggleOnionSkin: () => void;
  setOnionPrevFrames: (count: number) => void;
  setOnionNextFrames: (count: number) => void;
  setOnionOpacity: (opacity: number) => void;
  setActiveTagId: (tagId: string | null) => void;
  setFrameDuration: (frameIndex: number, durationMs: number) => void;
  insertFrameMetadata: (atIndex: number, durationMs?: number) => void;
  deleteFrameMetadata: (frameIndex: number) => void;
  moveFrameMetadata: (fromIndex: number, toIndex: number) => void;
  addTag: (name: string, fromFrame: number, toFrame: number, color: string) => void;
  deleteTag: (id: string) => void;
  syncCelMetadata: (
    resolver: (
      layerId: string,
      frameIndex: number
    ) => { populated: boolean; linked: boolean }
  ) => void;
  addFrame: () => void;
  toggleCel: (layerId: string, frameIndex: number) => void;

  setRightPanelWidth: (width: number) => void;
  setTimelineHeight: (height: number) => void;
  toggleTimelineCollapsed: () => void;
  togglePanelsCollapsed: () => void;
  setStatusMessage: (msg: string | null) => void;
  setCurrentFilePath: (path: string | null) => void;
  setDocumentName: (name: string) => void;
  setExportModalOpen: (open: boolean) => void;
  loadProjectState: (payload: {
    documentName: string;
    filePath: string | null;
    canvasWidth: number;
    canvasHeight: number;
    colorMode: "RGBA" | "Indexed";
    paletteName: string;
    palette: string[];
    layers: LayerItem[];
    frames: FrameItem[];
    tags: AnimationTag[];
  }) => void;
}

let layerCounter = 4;
let frameIdCounter = 5;
let tagIdCounter = 1;

function getPlaybackBounds(
  framesLength: number,
  tags: readonly AnimationTag[],
  activeTagId: string | null
): { start: number; end: number } {
  const maxIdx = Math.max(0, framesLength - 1);
  if (activeTagId) {
    const tag = tags.find((t) => t.id === activeTagId);
    if (tag) {
      const start = Math.max(0, Math.min(maxIdx, tag.fromFrame));
      const end = Math.max(start, Math.min(maxIdx, tag.toFrame));
      return { start, end };
    }
  }
  return { start: 0, end: maxIdx };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  workspaceMode: "draw",
  activeTool: "pencil",
  brushSize: 1,
  pixelPerfect: true,
  shapeFilled: false,
  fillContiguous: true,
  symmetryX: false,
  symmetryY: false,
  showGrid: true,
  seamlessWrap: false,
  showTileGrid: true,
  activeTileId: 1,
  tileWidth: 16,
  tileHeight: 16,
  tilesetVersion: 0,
  autoTileEnabled: false,
  autoTileMode: "4bit",
  showIsoGrid: false,
  isoBoxHeight: 8,
  tileProjection: "orthogonal",
  zoom: 12,
  cursorPos: null,
  canUndo: false,
  canRedo: false,

  primaryColor: "#5b8cff",
  secondaryColor: "#0f0f17",
  palette: DEFAULT_PALETTE,
  paletteName: "Pixet Default 16",
  previewScale: 2,
  hasSelection: false,

  documentName: "untitled.pixet",
  currentFilePath: null,
  canvasWidth: 32,
  canvasHeight: 32,
  colorMode: "RGBA",
  exportModalOpen: false,

  layers: [
    {
      id: "layer-outline",
      name: "Outline",
      kind: "raster",
      visible: true,
      locked: false,
      opacity: 100,
      alphaLock: false,
      blendMode: "Normal",
      parentId: null,
      cels: { 0: true, 1: true, 2: true, 3: true },
    },
    {
      id: "layer-shading",
      name: "Shading",
      kind: "raster",
      visible: true,
      locked: false,
      opacity: 100,
      alphaLock: false,
      blendMode: "Multiply",
      parentId: null,
      cels: { 0: true, 1: true, 2: true, 3: true },
    },
    {
      id: "layer-base",
      name: "Base",
      kind: "raster",
      visible: true,
      locked: false,
      opacity: 100,
      alphaLock: false,
      blendMode: "Normal",
      parentId: null,
      cels: { 0: true, 1: true, 2: true, 3: true },
    },
  ],
  activeLayerId: "layer-outline",

  frames: [
    { id: "frame-1", index: 0, durationMs: 100 },
    { id: "frame-2", index: 1, durationMs: 100 },
    { id: "frame-3", index: 2, durationMs: 100 },
    { id: "frame-4", index: 3, durationMs: 100 },
  ],
  currentFrame: 0,
  isPlaying: false,
  loopPlayback: true,
  fps: 10,
  onionSkin: false,
  onionPrevFrames: 1,
  onionNextFrames: 1,
  onionOpacity: 0.35,
  tags: [
    {
      id: "tag-idle",
      name: "idle",
      fromFrame: 0,
      toFrame: 3,
      color: "#5b8cff",
    },
  ],
  activeTagId: null,

  rightPanelWidth: 276,
  timelineHeight: 204,
  timelineCollapsed: false,
  panelsCollapsed: false,
  statusMessage: null,

  setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setBrushSize: (size) =>
    set({ brushSize: Math.max(1, Math.min(16, Math.round(size))) }),
  togglePixelPerfect: () => set((s) => ({ pixelPerfect: !s.pixelPerfect })),
  toggleShapeFilled: () => set((s) => ({ shapeFilled: !s.shapeFilled })),
  toggleFillContiguous: () =>
    set((s) => ({ fillContiguous: !s.fillContiguous })),
  toggleSymmetryX: () => set((s) => ({ symmetryX: !s.symmetryX })),
  toggleSymmetryY: () => set((s) => ({ symmetryY: !s.symmetryY })),
  toggleShowGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleSeamlessWrap: () => set((s) => ({ seamlessWrap: !s.seamlessWrap })),
  toggleShowTileGrid: () => set((s) => ({ showTileGrid: !s.showTileGrid })),
  setActiveTileId: (activeTileId) => set({ activeTileId: Math.max(0, activeTileId) }),
  setTileSize: (tileWidth, tileHeight) => set({ tileWidth, tileHeight }),
  bumpTilesetVersion: () => set((s) => ({ tilesetVersion: s.tilesetVersion + 1 })),
  toggleAutoTile: () => set((s) => ({ autoTileEnabled: !s.autoTileEnabled })),
  setAutoTileEnabled: (autoTileEnabled) => set({ autoTileEnabled }),
  setAutoTileMode: (autoTileMode) => set({ autoTileMode }),
  toggleShowIsoGrid: () => set((s) => ({ showIsoGrid: !s.showIsoGrid })),
  setIsoBoxHeight: (h) =>
    set({ isoBoxHeight: Math.max(2, Math.min(24, Math.round(h))) }),
  setTileProjection: (tileProjection) => set({ tileProjection }),
  setZoom: (zoom) => set({ zoom: Math.max(1, Math.min(64, zoom)) }),
  setCursorPos: (cursorPos) => set({ cursorPos }),
  setHistoryFlags: (canUndo, canRedo) => set({ canUndo, canRedo }),
  setCelPopulated: (layerId, frameIndex, populated) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId
          ? {
              ...l,
              cels: { ...l.cels, [frameIndex]: populated },
            }
          : l
      ),
    })),

  setPrimaryColor: (primaryColor) => set({ primaryColor }),
  setSecondaryColor: (secondaryColor) => set({ secondaryColor }),
  swapColors: () =>
    set((s) => ({
      primaryColor: s.secondaryColor,
      secondaryColor: s.primaryColor,
    })),
  setPreviewScale: (previewScale) => set({ previewScale }),
  setHasSelection: (hasSelection) => set({ hasSelection }),
  setPalette: (paletteName, colors) =>
    set({ paletteName, palette: colors.length > 0 ? colors : DEFAULT_PALETTE }),
  addColorToPalette: (hex) =>
    set((s) => {
      const normalized = hex.toLowerCase();
      if (s.palette.some((c) => c.toLowerCase() === normalized)) return s;
      return { palette: [...s.palette, normalized] };
    }),
  removeColorFromPalette: (hex) =>
    set((s) => {
      if (s.palette.length <= 1) return s;
      const normalized = hex.toLowerCase();
      return {
        palette: s.palette.filter((c) => c.toLowerCase() !== normalized),
      };
    }),

  selectLayer: (activeLayerId) => set({ activeLayerId }),
  toggleLayerVisible: (id) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, visible: !l.visible } : l
      ),
    })),
  toggleLayerLocked: (id) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, locked: !l.locked } : l
      ),
    })),
  toggleLayerAlphaLock: (id) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, alphaLock: !l.alphaLock } : l
      ),
    })),
  setLayerOpacity: (id, opacity) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id
          ? { ...l, opacity: Math.max(0, Math.min(100, Math.round(opacity))) }
          : l
      ),
    })),
  setLayerBlendMode: (id, blendMode) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, blendMode } : l)),
    })),
  addLayer: () =>
    set((s) => {
      const id = `layer-${layerCounter++}`;
      const activeIdx = s.layers.findIndex((l) => l.id === s.activeLayerId);
      const active = activeIdx >= 0 ? s.layers[activeIdx] : null;
      const parentId =
        active?.kind === "group" ? active.id : (active?.parentId ?? null);

      const newLayer: LayerItem = {
        id,
        name: `Layer ${s.layers.length + 1}`,
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId,
        cels: { [s.currentFrame]: false },
      };

      const insertAt =
        active?.kind === "group"
          ? activeIdx + 1
          : activeIdx >= 0
            ? activeIdx
            : 0;
      const nextLayers = s.layers.slice();
      nextLayers.splice(insertAt, 0, newLayer);
      return {
        layers: nextLayers,
        activeLayerId: id,
      };
    }),
  addGroupLayer: () =>
    set((s) => {
      const id = `group-${layerCounter++}`;
      const active = s.layers.find((l) => l.id === s.activeLayerId);
      const newGroup: LayerItem = {
        id,
        name: `Group ${s.layers.filter((l) => l.kind === "group").length + 1}`,
        kind: "group",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: active?.parentId ?? null,
        expanded: true,
        cels: {},
      };
      return {
        layers: [newGroup, ...s.layers],
        activeLayerId: id,
      };
    }),
  addTilemapLayer: () =>
    set((s) => {
      const id = `tilemap-${layerCounter++}`;
      const active = s.layers.find((l) => l.id === s.activeLayerId);
      const newLayer: LayerItem = {
        id,
        name: `Tilemap ${s.layers.filter((l) => l.kind === "tilemap").length + 1}`,
        kind: "tilemap",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: active?.kind === "group" ? active.id : (active?.parentId ?? null),
        cels: {},
      };
      return {
        layers: [newLayer, ...s.layers],
        activeLayerId: id,
      };
    }),
  deleteActiveLayer: () =>
    set((s) => {
      if (s.layers.length <= 1) return s;
      const idx = s.layers.findIndex((l) => l.id === s.activeLayerId);
      const target = s.layers[idx];
      const nextLayers = s.layers
        .filter((l) => l.id !== s.activeLayerId)
        .map((l) =>
          l.parentId === s.activeLayerId
            ? { ...l, parentId: target?.parentId ?? null }
            : l
        );
      const fallback = nextLayers[Math.min(idx, nextLayers.length - 1)];
      return {
        layers: nextLayers,
        activeLayerId: fallback.id,
      };
    }),
  renameLayer: (id, name) =>
    set((s) => {
      const trimmed = name.trim();
      if (!trimmed) return s;
      return {
        layers: s.layers.map((l) => (l.id === id ? { ...l, name: trimmed } : l)),
      };
    }),
  duplicateActiveLayer: () => {
    const s = get();
    const idx = s.layers.findIndex((l) => l.id === s.activeLayerId);
    if (idx < 0) return null;
    const source = s.layers[idx];
    const newId =
      source.kind === "group"
        ? `group-${layerCounter++}`
        : `layer-${layerCounter++}`;
    const copy: LayerItem = {
      ...source,
      id: newId,
      name: `${source.name} Copy`,
      cels: { ...source.cels },
    };
    const nextLayers = s.layers.slice();
    nextLayers.splice(idx, 0, copy);
    set({ layers: nextLayers, activeLayerId: newId });
    return { sourceId: source.id, newId };
  },
  moveLayer: (fromIndex, toIndex) =>
    set((s) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= s.layers.length ||
        toIndex >= s.layers.length ||
        fromIndex === toIndex
      ) {
        return s;
      }
      const next = s.layers.slice();
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return { layers: next };
    }),
  toggleGroupExpanded: (id) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, expanded: l.expanded === false } : l
      ),
    })),
  setLayerParent: (id, parentId) =>
    set((s) => {
      if (id === parentId) return s;
      const byId = new Map(s.layers.map((l) => [l.id, l]));
      if (parentId !== null) {
        const parent = byId.get(parentId);
        if (!parent || parent.kind !== "group") return s;
        // Prevent cycles: ensure `id` is not an ancestor of `parentId`
        let cur: string | null = parentId;
        const visited = new Set<string>();
        while (cur) {
          if (cur === id) return s;
          if (visited.has(cur)) return s;
          visited.add(cur);
          cur = byId.get(cur)?.parentId ?? null;
        }
      }
      return {
        layers: s.layers.map((l) => (l.id === id ? { ...l, parentId } : l)),
      };
    }),

  setCurrentFrame: (frameIndex) => {
    const count = get().frames.length;
    set({ currentFrame: Math.max(0, Math.min(count - 1, frameIndex)) });
  },
  prevFrame: () =>
    set((s) => {
      const { start, end } = getPlaybackBounds(
        s.frames.length,
        s.tags,
        s.activeTagId
      );
      if (s.currentFrame <= start || s.currentFrame > end) {
        return { currentFrame: end };
      }
      return { currentFrame: s.currentFrame - 1 };
    }),
  nextFrame: () =>
    set((s) => {
      const { start, end } = getPlaybackBounds(
        s.frames.length,
        s.tags,
        s.activeTagId
      );
      if (s.currentFrame < start) {
        return { currentFrame: start };
      }
      if (s.currentFrame >= end) {
        return s.loopPlayback
          ? { currentFrame: start }
          : { isPlaying: false, currentFrame: end };
      }
      return { currentFrame: s.currentFrame + 1 };
    }),
  togglePlaying: () => set((s) => ({ isPlaying: !s.isPlaying })),
  toggleLoopPlayback: () => set((s) => ({ loopPlayback: !s.loopPlayback })),
  setFps: (fps) =>
    set((s) => {
      const nextFps = Math.max(1, Math.min(60, Math.round(fps) || 1));
      const nextMs = Math.round(1000 / nextFps);
      return {
        fps: nextFps,
        frames: s.frames.map((f) => ({ ...f, durationMs: nextMs })),
      };
    }),
  toggleOnionSkin: () => set((s) => ({ onionSkin: !s.onionSkin })),
  setOnionPrevFrames: (count) =>
    set({ onionPrevFrames: Math.max(0, Math.min(3, Math.round(count))) }),
  setOnionNextFrames: (count) =>
    set({ onionNextFrames: Math.max(0, Math.min(3, Math.round(count))) }),
  setOnionOpacity: (opacity) =>
    set({ onionOpacity: Math.max(0.1, Math.min(0.8, opacity)) }),
  setActiveTagId: (activeTagId) =>
    set((s) => {
      if (!activeTagId) return { activeTagId: null };
      const tag = s.tags.find((t) => t.id === activeTagId);
      if (!tag) return { activeTagId: null };
      const clampedFrame =
        s.currentFrame < tag.fromFrame || s.currentFrame > tag.toFrame
          ? tag.fromFrame
          : s.currentFrame;
      return { activeTagId, currentFrame: clampedFrame };
    }),
  setFrameDuration: (frameIndex, durationMs) =>
    set((s) => {
      const clamped = Math.max(16, Math.min(5000, Math.round(durationMs) || 16));
      return {
        frames: s.frames.map((f) =>
          f.index === frameIndex ? { ...f, durationMs: clamped } : f
        ),
      };
    }),
  insertFrameMetadata: (atIndex, durationMs) =>
    set((s) => {
      const clampedAt = Math.max(0, Math.min(s.frames.length, atIndex));
      const ms = durationMs ?? Math.round(1000 / s.fps);
      const nextFrames = s.frames.slice();
      nextFrames.splice(clampedAt, 0, {
        id: `frame-${frameIdCounter++}`,
        index: clampedAt,
        durationMs: ms,
      });
      const reindexed = nextFrames.map((f, idx) => ({ ...f, index: idx }));
      const nextTags = s.tags.map((t) => {
        if (t.fromFrame >= clampedAt) {
          return {
            ...t,
            fromFrame: t.fromFrame + 1,
            toFrame: t.toFrame + 1,
          };
        }
        if (t.toFrame >= clampedAt) {
          return { ...t, toFrame: t.toFrame + 1 };
        }
        return t;
      });
      return {
        frames: reindexed,
        tags: nextTags,
        currentFrame: clampedAt,
      };
    }),
  deleteFrameMetadata: (frameIndex) =>
    set((s) => {
      if (s.frames.length <= 1) return s;
      const nextFrames = s.frames
        .filter((f) => f.index !== frameIndex)
        .map((f, idx) => ({ ...f, index: idx }));
      const maxIdx = nextFrames.length - 1;
      const nextTags: AnimationTag[] = [];
      for (const t of s.tags) {
        if (t.toFrame < frameIndex) {
          nextTags.push(t);
        } else if (t.fromFrame > frameIndex) {
          nextTags.push({
            ...t,
            fromFrame: t.fromFrame - 1,
            toFrame: t.toFrame - 1,
          });
        } else {
          const nextTo = Math.max(t.fromFrame, t.toFrame - 1);
          if (t.fromFrame <= maxIdx) {
            nextTags.push({
              ...t,
              toFrame: Math.min(maxIdx, nextTo),
            });
          }
        }
      }
      const nextActiveTagId = nextTags.some((t) => t.id === s.activeTagId)
        ? s.activeTagId
        : null;
      return {
        frames: nextFrames,
        tags: nextTags,
        activeTagId: nextActiveTagId,
        currentFrame: Math.min(s.currentFrame, maxIdx),
      };
    }),
  moveFrameMetadata: (fromIndex, toIndex) =>
    set((s) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= s.frames.length ||
        toIndex >= s.frames.length
      ) {
        return s;
      }
      const nextFrames = s.frames.slice();
      const [moved] = nextFrames.splice(fromIndex, 1);
      nextFrames.splice(toIndex, 0, moved);
      const reindexed = nextFrames.map((f, idx) => ({ ...f, index: idx }));
      return {
        frames: reindexed,
        currentFrame: toIndex,
      };
    }),
  addTag: (name, fromFrame, toFrame, color) =>
    set((s) => {
      const trimmed = name.trim();
      if (!trimmed) return s;
      const maxIdx = Math.max(0, s.frames.length - 1);
      const lo = Math.max(0, Math.min(maxIdx, Math.min(fromFrame, toFrame)));
      const hi = Math.max(lo, Math.min(maxIdx, Math.max(fromFrame, toFrame)));
      const newTag: AnimationTag = {
        id: `tag-${tagIdCounter++}`,
        name: trimmed,
        fromFrame: lo,
        toFrame: hi,
        color,
      };
      return {
        tags: [...s.tags, newTag],
        activeTagId: newTag.id,
        currentFrame: lo,
      };
    }),
  deleteTag: (id) =>
    set((s) => ({
      tags: s.tags.filter((t) => t.id !== id),
      activeTagId: s.activeTagId === id ? null : s.activeTagId,
    })),
  syncCelMetadata: (resolver) =>
    set((s) => ({
      layers: s.layers.map((layer) => {
        if (layer.kind === "group") return layer;
        const cels: Record<number, boolean> = {};
        const linkedCels: Record<number, boolean> = {};
        for (const f of s.frames) {
          const info = resolver(layer.id, f.index);
          cels[f.index] = info.populated;
          if (info.linked) linkedCels[f.index] = true;
        }
        return { ...layer, cels, linkedCels };
      }),
    })),
  addFrame: () =>
    set((s) => {
      const index = s.frames.length;
      const durationMs = Math.round(1000 / s.fps);
      return {
        frames: [
          ...s.frames,
          { id: `frame-${frameIdCounter++}`, index, durationMs },
        ],
        currentFrame: index,
      };
    }),
  toggleCel: (layerId, frameIndex) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId
          ? {
              ...l,
              cels: {
                ...l.cels,
                [frameIndex]: !l.cels[frameIndex],
              },
            }
          : l
      ),
    })),

  setRightPanelWidth: (width) =>
    set({ rightPanelWidth: Math.max(230, Math.min(420, width)) }),
  setTimelineHeight: (height) =>
    set({ timelineHeight: Math.max(120, Math.min(360, height)) }),
  toggleTimelineCollapsed: () =>
    set((s) => ({ timelineCollapsed: !s.timelineCollapsed })),
  togglePanelsCollapsed: () =>
    set((s) => ({ panelsCollapsed: !s.panelsCollapsed })),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  setCurrentFilePath: (currentFilePath) => set({ currentFilePath }),
  setDocumentName: (documentName) => set({ documentName }),
  setExportModalOpen: (exportModalOpen) => set({ exportModalOpen }),
  loadProjectState: (payload) =>
    set({
      documentName: payload.documentName,
      currentFilePath: payload.filePath,
      canvasWidth: payload.canvasWidth,
      canvasHeight: payload.canvasHeight,
      colorMode: payload.colorMode,
      paletteName: payload.paletteName,
      palette: payload.palette.length > 0 ? payload.palette : DEFAULT_PALETTE,
      layers: payload.layers,
      activeLayerId: payload.layers[0]?.id ?? "",
      frames: payload.frames,
      currentFrame: 0,
      tags: payload.tags,
      activeTagId: null,
      isPlaying: false,
      canUndo: false,
      canRedo: false,
      hasSelection: false,
    }),
}));

export function isLayerEffectivelyLocked(
  layers: readonly LayerItem[],
  layerId: string
): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]));
  let cur: LayerItem | undefined = byId.get(layerId);
  const visited = new Set<string>();
  while (cur) {
    if (cur.locked) return true;
    if (!cur.parentId || visited.has(cur.id)) break;
    visited.add(cur.id);
    cur = byId.get(cur.parentId);
  }
  return false;
}

export function getLayerDepth(
  layers: readonly LayerItem[],
  layer: LayerItem
): number {
  const byId = new Map(layers.map((l) => [l.id, l]));
  let depth = 0;
  let parentId = layer.parentId;
  const visited = new Set<string>([layer.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    depth++;
    parentId = parent.parentId;
  }
  return depth;
}

export function isLayerHiddenByCollapsedGroup(
  layers: readonly LayerItem[],
  layer: LayerItem
): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]));
  let parentId = layer.parentId;
  const visited = new Set<string>([layer.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.expanded === false) return true;
    parentId = parent.parentId;
  }
  return false;
}
