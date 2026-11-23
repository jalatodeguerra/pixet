import { create } from "zustand";
import type { PendingImageImport } from "../engine/io/imageImport";
import type { AutoTileMode } from "../engine/tiles/autoTile";
import type { CellFlags } from "../engine/tiles/cell";
import type { TileTool } from "../components/tiles/tileTools";
import type { LayerMapRole } from "../engine/gamedev/shaderPreview";
import type { WeightBrushMode, WeightFalloff } from "../engine/rig/skinning";
import type { BrushShape, CustomBrushData } from "../engine/tools/brush";
import type { InkMode } from "../engine/tools/ink";

export type { BrushShape, CustomBrushData, InkMode, LayerMapRole, TileTool };

export type RightClickMode = "secondaryColor" | "erase" | "eyedropper";

export type WorkspaceMode = "draw" | "tiles" | "rig" | "data";
export type TileMode = "map" | "tile";
export interface TileBrushSelection {
  tilesetIndex: number;
  cols: number;
  rows: number;
  cells: number[];
}
export type RigMode = "setup" | "animate";
export type RigTool =
  | "select"
  | "translate"
  | "scale"
  | "addBone"
  | "chain"
  | "ik"
  | "weightPaint"
  | "meshEdit"
  | "pin";
export type RigWeightOverlayMode = "heatmap" | "boneColors";
export type DataTool = "hitbox" | "hurtbox" | "collision" | "socket";

export type ToolId =
  | "pencil"
  | "fillBrush"
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
  mapRole?: LayerMapRole;
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

export type ContextMenuItem =
  | {
      kind: "item";
      label: string;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      action: () => void;
    }
  | { kind: "separator" };

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
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
  brushShape: BrushShape;
  brushOpacity: number;
  brushSpacing: number;
  inkMode: InkMode;
  rightClickMode: RightClickMode;
  customBrush: CustomBrushData | null;
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
  tilesMode: TileMode;
  tileTool: TileTool;
  activeTilesetIndex: number;
  tileBrushFlags: CellFlags;
  tilesetBrowserZoom: number;
  tilesetBrowserDocked: boolean;
  hoveredTileCell: { col: number; row: number } | null;
  tileBrush: TileBrushSelection | null;
  tileBrushAnchor: "topLeft" | "center";
  tileEraserSize: number;
  tileFillContiguous: boolean;
  tileRandomSeed: number;
  tileSelection: string[];
  tileClipboard: TileBrushSelection | null;
  tilePreviewChanges: Array<{ col: number; row: number; cell: number }>;
  tileMarqueeRect: {
    c0: number;
    r0: number;
    c1: number;
    r1: number;
    kind: "select" | "pick";
  } | null;
  activeTerrainSetId: string | null;
  activeTerrainId: string | null;
  terrainEditMode: boolean;
  tileEditWrapPreview: boolean;
  animateTilesPreview: boolean;
  tileSearchQuery: string;
  tileImportModalOpen: boolean;
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
  rigExportModalOpen: boolean;
  rotate3dModalOpen: boolean;
  newSpriteModalOpen: boolean;
  canvasSizeModalOpen: boolean;
  pendingImportImage: PendingImageImport | null;
  contextMenu: ContextMenuState | null;

  rigTool: RigTool;
  rigMode: RigMode;
  selectedBoneId: string | null;
  selectedBoneIds: string[];
  rigPixelSnap: boolean;
  rigRotSprite: boolean;
  rigShowBones: boolean;
  rigShowInfluence: boolean;
  rigBrushSize: number;
  rigVersion: number;
  rigAutoKey: boolean;
  rigTimelineView: "dope" | "curves";
  /** R6 weight brush strength (0..1). */
  rigWeightStrength: number;
  /** R6 weight brush mode. */
  rigWeightMode: WeightBrushMode;
  /** R6 weight brush falloff. */
  rigWeightFalloff: WeightFalloff;
  /** R6 influence overlay: selected-bone heatmap or per-bone colors. */
  rigWeightOverlay: RigWeightOverlayMode;
  /** R6 post-deformation pixel cleanup toggles. */
  rigCleanupOrphans: boolean;
  rigCleanupHoles: boolean;
  rigCleanupPaletteLock: boolean;
  rigCleanupOutline: boolean;

  dataTool: DataTool;
  showGameDataOverlay: boolean;
  gameDataVersion: number;

  light2dEnabled: boolean;
  light2dX: number;
  light2dY: number;
  light2dZ: number;
  light2dColor: string;
  light2dIntensity: number;
  light2dAmbient: number;
  light2dEmission: number;
  paletteLutEnabled: boolean;
  paletteLutPresetName: string;

  layers: LayerItem[];
  activeLayerId: string;
  selectedLayerIds: string[];

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
  showFloatingPreview: boolean;
  statusMessage: string | null;

  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setActiveTool: (tool: ToolId) => void;
  setBrushSize: (size: number) => void;
  setBrushShape: (shape: BrushShape) => void;
  setBrushOpacity: (opacity: number) => void;
  setBrushSpacing: (spacing: number) => void;
  setInkMode: (mode: InkMode) => void;
  setRightClickMode: (mode: RightClickMode) => void;
  setCustomBrush: (brush: CustomBrushData | null) => void;
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
  setTilesMode: (mode: TileMode) => void;
  setTileTool: (tool: TileTool) => void;
  setActiveTilesetIndex: (index: number) => void;
  setTileBrushFlags: (flags: CellFlags) => void;
  setTilesetBrowserZoom: (zoom: number) => void;
  toggleTilesetBrowserDocked: () => void;
  setHoveredTileCell: (cell: { col: number; row: number } | null) => void;
  setTileBrush: (brush: TileBrushSelection | null) => void;
  setTileBrushAnchor: (anchor: "topLeft" | "center") => void;
  setTileEraserSize: (size: number) => void;
  toggleTileFillContiguous: () => void;
  setTileRandomSeed: (seed: number) => void;
  setTileSelection: (cells: string[]) => void;
  setTileClipboard: (clip: TileBrushSelection | null) => void;
  setTilePreviewChanges: (
    changes: Array<{ col: number; row: number; cell: number }>
  ) => void;
  setTileMarqueeRect: (
    rect: {
      c0: number;
      r0: number;
      c1: number;
      r1: number;
      kind: "select" | "pick";
    } | null
  ) => void;
  setActiveTerrainSetId: (id: string | null) => void;
  setActiveTerrainId: (id: string | null) => void;
  toggleTerrainEditMode: () => void;
  setTerrainEditMode: (v: boolean) => void;
  toggleTileEditWrapPreview: () => void;
  toggleAnimateTilesPreview: () => void;
  setTileSearchQuery: (q: string) => void;
  setTileImportModalOpen: (open: boolean) => void;
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
  selectLayerRange: (targetId: string) => void;
  toggleSelectLayer: (targetId: string) => void;
  groupSelectedLayers: (layerIds?: string[]) => void;
  ungroupLayer: (groupId: string) => void;
  toggleLayerVisible: (id: string) => void;
  toggleLayerLocked: (id: string) => void;
  toggleLayerAlphaLock: (id: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  setLayerBlendMode: (id: string, blendMode: BlendMode) => void;
  addLayer: () => void;
  addNamedLayer: (name: string) => string;
  addMapLayer: (role: "normal" | "emission", name?: string) => string;
  setLayerMapRole: (id: string, role: LayerMapRole) => void;
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
  setIsPlaying: (playing: boolean) => void;
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
  toggleFloatingPreview: () => void;
  setShowFloatingPreview: (show: boolean) => void;
  setStatusMessage: (msg: string | null) => void;
  setCurrentFilePath: (path: string | null) => void;
  setDocumentName: (name: string) => void;
  setExportModalOpen: (open: boolean) => void;
  setRigExportModalOpen: (open: boolean) => void;
  setRotate3dModalOpen: (open: boolean) => void;
  setNewSpriteModalOpen: (open: boolean) => void;
  setCanvasSizeModalOpen: (open: boolean) => void;
  setCanvasSize: (w: number, h: number) => void;
  setPendingImportImage: (img: PendingImageImport | null) => void;
  openContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  closeContextMenu: () => void;
  setRigTool: (tool: RigTool) => void;
  setRigMode: (mode: RigMode) => void;
  setSelectedBoneId: (boneId: string | null) => void;
  setSelectedBoneIds: (boneIds: string[], primaryId?: string | null) => void;
  toggleBoneSelection: (boneId: string) => void;
  toggleRigPixelSnap: () => void;
  toggleRigRotSprite: () => void;
  toggleRigShowBones: () => void;
  toggleRigShowInfluence: () => void;
  setRigBrushSize: (size: number) => void;
  bumpRigVersion: () => void;
  toggleRigAutoKey: () => void;
  setRigTimelineView: (view: "dope" | "curves") => void;
  setRigWeightStrength: (strength: number) => void;
  setRigWeightMode: (mode: WeightBrushMode) => void;
  setRigWeightFalloff: (falloff: WeightFalloff) => void;
  setRigWeightOverlay: (mode: RigWeightOverlayMode) => void;
  toggleRigCleanupOrphans: () => void;
  toggleRigCleanupHoles: () => void;
  toggleRigCleanupPaletteLock: () => void;
  toggleRigCleanupOutline: () => void;
  setDataTool: (tool: DataTool) => void;
  toggleShowGameDataOverlay: () => void;
  bumpGameDataVersion: () => void;
  setLight2d: (
    patch: Partial<{
      enabled: boolean;
      x: number;
      y: number;
      z: number;
      color: string;
      intensity: number;
      ambient: number;
      emission: number;
    }>
  ) => void;
  setPaletteLutEnabled: (v: boolean) => void;
  setPaletteLutPresetName: (name: string) => void;
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
  brushShape: "circle",
  brushOpacity: 100,
  brushSpacing: 1,
  inkMode: "simple",
  rightClickMode: "secondaryColor",
  customBrush: null,
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
  tilesMode: "map",
  tileTool: "stamp",
  activeTilesetIndex: 0,
  tileBrushFlags: { flipH: false, flipV: false, flipD: false },
  tilesetBrowserZoom: 2,
  tilesetBrowserDocked: false,
  hoveredTileCell: null,
  tileBrush: null,
  tileBrushAnchor: "topLeft",
  tileEraserSize: 1,
  tileFillContiguous: true,
  tileRandomSeed: 1337,
  tileSelection: [],
  tileClipboard: null,
  tilePreviewChanges: [],
  tileMarqueeRect: null,
  activeTerrainSetId: null,
  activeTerrainId: null,
  terrainEditMode: false,
  tileEditWrapPreview: true,
  animateTilesPreview: true,
  tileSearchQuery: "",
  tileImportModalOpen: false,
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
  rigExportModalOpen: false,
  rotate3dModalOpen: false,
  newSpriteModalOpen: false,
  canvasSizeModalOpen: false,
  pendingImportImage: null,
  contextMenu: null,

  rigTool: "select",
  rigMode: "setup",
  selectedBoneId: null,
  selectedBoneIds: [],
  rigPixelSnap: true,
  rigRotSprite: true,
  rigShowBones: true,
  rigShowInfluence: true,
  rigBrushSize: 3,
  rigVersion: 0,
  rigAutoKey: false,
  rigTimelineView: "dope",
  rigWeightStrength: 0.5,
  rigWeightMode: "add",
  rigWeightFalloff: "linear",
  rigWeightOverlay: "heatmap",
  rigCleanupOrphans: false,
  rigCleanupHoles: false,
  rigCleanupPaletteLock: false,
  rigCleanupOutline: false,

  dataTool: "hitbox",
  showGameDataOverlay: true,
  gameDataVersion: 0,

  light2dEnabled: false,
  light2dX: 0.35,
  light2dY: 0.25,
  light2dZ: 0.35,
  light2dColor: "#fff4d6",
  light2dIntensity: 1.4,
  light2dAmbient: 0.28,
  light2dEmission: 1.2,
  paletteLutEnabled: false,
  paletteLutPresetName: "PICO-8",

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
  selectedLayerIds: ["layer-outline"],

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
  showFloatingPreview: true,
  statusMessage: null,

  setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setBrushSize: (size) =>
    set({ brushSize: Math.max(1, Math.min(64, Math.round(size))) }),
  setBrushShape: (brushShape) => set({ brushShape }),
  setBrushOpacity: (opacity) =>
    set({ brushOpacity: Math.max(1, Math.min(100, Math.round(opacity))) }),
  setBrushSpacing: (spacing) =>
    set({ brushSpacing: Math.max(1, Math.min(16, Math.round(spacing))) }),
  setInkMode: (inkMode) => set({ inkMode }),
  setRightClickMode: (rightClickMode) => set({ rightClickMode }),
  setCustomBrush: (customBrush) => set({ customBrush }),
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
  setTilesMode: (tilesMode) => set({ tilesMode }),
  setTileTool: (tileTool) => set({ tileTool }),
  setActiveTilesetIndex: (index) =>
    set({ activeTilesetIndex: Math.max(0, index), tileBrush: null }),
  setTileBrushFlags: (tileBrushFlags) => set({ tileBrushFlags }),
  setTilesetBrowserZoom: (z) =>
    set({ tilesetBrowserZoom: Math.max(1, Math.min(4, Math.round(z))) }),
  toggleTilesetBrowserDocked: () =>
    set((s) => ({ tilesetBrowserDocked: !s.tilesetBrowserDocked })),
  setHoveredTileCell: (hoveredTileCell) => set({ hoveredTileCell }),
  setTileBrush: (tileBrush) => set({ tileBrush }),
  setTileBrushAnchor: (tileBrushAnchor) => set({ tileBrushAnchor }),
  setTileEraserSize: (size) =>
    set({ tileEraserSize: Math.max(1, Math.min(8, Math.round(size))) }),
  toggleTileFillContiguous: () =>
    set((s) => ({ tileFillContiguous: !s.tileFillContiguous })),
  setTileRandomSeed: (tileRandomSeed) => set({ tileRandomSeed }),
  setTileSelection: (tileSelection) => set({ tileSelection }),
  setTileClipboard: (tileClipboard) => set({ tileClipboard }),
  setTilePreviewChanges: (tilePreviewChanges) => set({ tilePreviewChanges }),
  setTileMarqueeRect: (tileMarqueeRect) => set({ tileMarqueeRect }),
  setActiveTerrainSetId: (activeTerrainSetId) => set({ activeTerrainSetId }),
  setActiveTerrainId: (activeTerrainId) => set({ activeTerrainId }),
  toggleTerrainEditMode: () =>
    set((s) => ({ terrainEditMode: !s.terrainEditMode })),
  setTerrainEditMode: (terrainEditMode) => set({ terrainEditMode }),
  toggleTileEditWrapPreview: () =>
    set((s) => ({ tileEditWrapPreview: !s.tileEditWrapPreview })),
  toggleAnimateTilesPreview: () =>
    set((s) => ({ animateTilesPreview: !s.animateTilesPreview })),
  setTileSearchQuery: (tileSearchQuery) => set({ tileSearchQuery }),
  setTileImportModalOpen: (tileImportModalOpen) => set({ tileImportModalOpen }),
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

  selectLayer: (activeLayerId) =>
    set({ activeLayerId, selectedLayerIds: [activeLayerId] }),
  selectLayerRange: (targetId) =>
    set((s) => {
      const visible = s.layers.filter(
        (l) => !isLayerHiddenByCollapsedGroup(s.layers, l)
      );
      const anchorIdx = visible.findIndex((l) => l.id === s.activeLayerId);
      const targetIdx = visible.findIndex((l) => l.id === targetId);
      if (targetIdx < 0) return s;
      if (anchorIdx < 0) {
        return { activeLayerId: targetId, selectedLayerIds: [targetId] };
      }
      const lo = Math.min(anchorIdx, targetIdx);
      const hi = Math.max(anchorIdx, targetIdx);
      return {
        selectedLayerIds: visible.slice(lo, hi + 1).map((l) => l.id),
      };
    }),
  toggleSelectLayer: (targetId) =>
    set((s) => {
      const exists = s.selectedLayerIds.includes(targetId);
      if (exists && s.selectedLayerIds.length <= 1) {
        return { activeLayerId: targetId, selectedLayerIds: [targetId] };
      }
      const next = exists
        ? s.selectedLayerIds.filter((id) => id !== targetId)
        : [...s.selectedLayerIds, targetId];
      return {
        activeLayerId: targetId,
        selectedLayerIds: next,
      };
    }),
  groupSelectedLayers: (layerIds) =>
    set((s) => {
      const candidateIds = new Set(
        layerIds && layerIds.length > 0 ? layerIds : s.selectedLayerIds
      );
      if (candidateIds.size === 0) return s;

      const byId = new Map(s.layers.map((l) => [l.id, l]));
      const hasSelectedAncestor = (layer: LayerItem): boolean => {
        let cur = layer.parentId;
        const visited = new Set<string>([layer.id]);
        while (cur && !visited.has(cur)) {
          if (candidateIds.has(cur)) return true;
          visited.add(cur);
          cur = byId.get(cur)?.parentId ?? null;
        }
        return false;
      };

      const roots = s.layers.filter(
        (l) => candidateIds.has(l.id) && !hasSelectedAncestor(l)
      );
      if (roots.length === 0) return s;
      const rootSet = new Set(roots.map((r) => r.id));

      const isUnderSelectedRoot = (layer: LayerItem): boolean => {
        if (rootSet.has(layer.id)) return true;
        let cur = layer.parentId;
        const visited = new Set<string>([layer.id]);
        while (cur && !visited.has(cur)) {
          if (rootSet.has(cur)) return true;
          visited.add(cur);
          cur = byId.get(cur)?.parentId ?? null;
        }
        return false;
      };

      const firstIdx = s.layers.findIndex((l) => rootSet.has(l.id));
      if (firstIdx < 0) return s;

      const newGroupId = `group-${layerCounter++}`;
      const newGroup: LayerItem = {
        id: newGroupId,
        name: `Group ${s.layers.filter((l) => l.kind === "group").length + 1}`,
        kind: "group",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: roots[0].parentId ?? null,
        expanded: true,
        cels: {},
      };

      const movedItems = s.layers
        .filter((l) => isUnderSelectedRoot(l))
        .map((l) => (rootSet.has(l.id) ? { ...l, parentId: newGroupId } : l));
      const remaining = s.layers.filter((l) => !isUnderSelectedRoot(l));

      let insertIdx = 0;
      for (let i = 0; i < firstIdx; i++) {
        if (!isUnderSelectedRoot(s.layers[i])) insertIdx++;
      }

      const nextLayers = remaining.slice();
      nextLayers.splice(insertIdx, 0, newGroup, ...movedItems);

      return {
        layers: nextLayers,
        activeLayerId: newGroupId,
        selectedLayerIds: [newGroupId],
      };
    }),
  ungroupLayer: (groupId) =>
    set((s) => {
      const group = s.layers.find(
        (l) => l.id === groupId && l.kind === "group"
      );
      if (!group) return s;
      const firstChild = s.layers.find((l) => l.parentId === groupId);
      const nextLayers = s.layers
        .filter((l) => l.id !== groupId)
        .map((l) =>
          l.parentId === groupId ? { ...l, parentId: group.parentId } : l
        );
      if (nextLayers.length === 0) return s;
      const nextActive = firstChild?.id ?? nextLayers[0].id;
      return {
        layers: nextLayers,
        activeLayerId: nextActive,
        selectedLayerIds: [nextActive],
      };
    }),
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
        selectedLayerIds: [id],
      };
    }),
  addNamedLayer: (name) => {
    const id = `layer-${layerCounter++}`;
    set((s) => {
      const newLayer: LayerItem = {
        id,
        name,
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        cels: { [s.currentFrame]: false },
      };
      return {
        layers: [newLayer, ...s.layers],
        activeLayerId: id,
        selectedLayerIds: [id],
      };
    });
    return id;
  },
  addMapLayer: (role, name) => {
    const id = `layer-${layerCounter++}`;
    const defaultName = role === "normal" ? "Normal Map" : "Emission Map";
    set((s) => {
      const newLayer: LayerItem = {
        id,
        name: name?.trim() || defaultName,
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        mapRole: role,
        cels: { [s.currentFrame]: false },
      };
      return {
        layers: [newLayer, ...s.layers],
        activeLayerId: id,
        selectedLayerIds: [id],
      };
    });
    return id;
  },
  setLayerMapRole: (id, role) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, mapRole: role } : l
      ),
    })),
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
        selectedLayerIds: [id],
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
        selectedLayerIds: [id],
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
        selectedLayerIds: [fallback.id],
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
  setIsPlaying: (isPlaying) => set({ isPlaying }),
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
  toggleFloatingPreview: () =>
    set((s) => ({ showFloatingPreview: !s.showFloatingPreview })),
  setShowFloatingPreview: (showFloatingPreview) => set({ showFloatingPreview }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  setCurrentFilePath: (currentFilePath) => set({ currentFilePath }),
  setDocumentName: (documentName) => set({ documentName }),
  setExportModalOpen: (exportModalOpen) => set({ exportModalOpen }),
  setRigExportModalOpen: (rigExportModalOpen) => set({ rigExportModalOpen }),
  setRotate3dModalOpen: (rotate3dModalOpen) => set({ rotate3dModalOpen }),
  setNewSpriteModalOpen: (newSpriteModalOpen) => set({ newSpriteModalOpen }),
  setCanvasSizeModalOpen: (canvasSizeModalOpen) => set({ canvasSizeModalOpen }),
  setCanvasSize: (canvasWidth, canvasHeight) => set({ canvasWidth, canvasHeight }),
  setPendingImportImage: (pendingImportImage) => set({ pendingImportImage }),
  openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  closeContextMenu: () => set({ contextMenu: null }),
  setRigTool: (rigTool) => set({ rigTool }),
  setRigMode: (rigMode) =>
    set((s) => ({
      rigMode,
      // Bone creation tools only make sense while editing the bind pose.
      rigTool:
        rigMode === "animate" &&
        (s.rigTool === "addBone" || s.rigTool === "chain")
          ? "select"
          : s.rigTool,
    })),
  setSelectedBoneId: (selectedBoneId) =>
    set({
      selectedBoneId,
      selectedBoneIds: selectedBoneId ? [selectedBoneId] : [],
    }),
  setSelectedBoneIds: (boneIds, primaryId) => {
    const unique = Array.from(new Set(boneIds));
    const nextPrimary =
      primaryId !== undefined
        ? primaryId
        : unique.length > 0
          ? unique[unique.length - 1]
          : null;
    set({
      selectedBoneIds: unique,
      selectedBoneId: nextPrimary,
    });
  },
  toggleBoneSelection: (boneId) =>
    set((s) => {
      const exists = s.selectedBoneIds.includes(boneId);
      const nextIds = exists
        ? s.selectedBoneIds.filter((id) => id !== boneId)
        : [...s.selectedBoneIds, boneId];
      const nextPrimary = exists
        ? s.selectedBoneId === boneId
          ? (nextIds[nextIds.length - 1] ?? null)
          : s.selectedBoneId
        : boneId;
      return {
        selectedBoneIds: nextIds,
        selectedBoneId: nextPrimary,
      };
    }),
  toggleRigPixelSnap: () => set((s) => ({ rigPixelSnap: !s.rigPixelSnap })),
  toggleRigRotSprite: () => set((s) => ({ rigRotSprite: !s.rigRotSprite })),
  toggleRigShowBones: () => set((s) => ({ rigShowBones: !s.rigShowBones })),
  toggleRigShowInfluence: () =>
    set((s) => ({ rigShowInfluence: !s.rigShowInfluence })),
  setRigBrushSize: (size) =>
    set({ rigBrushSize: Math.max(1, Math.min(12, Math.round(size))) }),
  bumpRigVersion: () => set((s) => ({ rigVersion: s.rigVersion + 1 })),
  toggleRigAutoKey: () => set((s) => ({ rigAutoKey: !s.rigAutoKey })),
  setRigTimelineView: (rigTimelineView) => set({ rigTimelineView }),
  setRigWeightStrength: (strength) =>
    set({ rigWeightStrength: Math.max(0, Math.min(1, strength)) }),
  setRigWeightMode: (rigWeightMode) => set({ rigWeightMode }),
  setRigWeightFalloff: (rigWeightFalloff) => set({ rigWeightFalloff }),
  setRigWeightOverlay: (rigWeightOverlay) => set({ rigWeightOverlay }),
  toggleRigCleanupOrphans: () =>
    set((s) => ({ rigCleanupOrphans: !s.rigCleanupOrphans })),
  toggleRigCleanupHoles: () =>
    set((s) => ({ rigCleanupHoles: !s.rigCleanupHoles })),
  toggleRigCleanupPaletteLock: () =>
    set((s) => ({ rigCleanupPaletteLock: !s.rigCleanupPaletteLock })),
  toggleRigCleanupOutline: () =>
    set((s) => ({ rigCleanupOutline: !s.rigCleanupOutline })),
  setDataTool: (dataTool) => set({ dataTool }),
  toggleShowGameDataOverlay: () =>
    set((s) => ({ showGameDataOverlay: !s.showGameDataOverlay })),
  bumpGameDataVersion: () =>
    set((s) => ({ gameDataVersion: s.gameDataVersion + 1 })),
  setLight2d: (patch) =>
    set((s) => ({
      light2dEnabled: patch.enabled ?? s.light2dEnabled,
      light2dX: patch.x ?? s.light2dX,
      light2dY: patch.y ?? s.light2dY,
      light2dZ: patch.z ?? s.light2dZ,
      light2dColor: patch.color ?? s.light2dColor,
      light2dIntensity: patch.intensity ?? s.light2dIntensity,
      light2dAmbient: patch.ambient ?? s.light2dAmbient,
      light2dEmission: patch.emission ?? s.light2dEmission,
    })),
  setPaletteLutEnabled: (paletteLutEnabled) => set({ paletteLutEnabled }),
  setPaletteLutPresetName: (paletteLutPresetName) =>
    set({ paletteLutPresetName }),
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
      selectedLayerIds: payload.layers[0]?.id ? [payload.layers[0].id] : [],
      frames: payload.frames,
      currentFrame: 0,
      tags: payload.tags,
      activeTagId: null,
      isPlaying: false,
      canUndo: false,
      canRedo: false,
      hasSelection: false,
      selectedBoneId: null,
      selectedBoneIds: [],
      rigMode: "setup",
      rigTool: "select",
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
