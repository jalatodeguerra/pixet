import { create } from "zustand";
import type { BlendMode } from "../engine/document/blendModes";
import type { PendingImageImport } from "../engine/io/imageImport";
import type { AutoTileMode } from "../engine/tiles/autoTile";
import type { CellFlags } from "../engine/tiles/cell";
import type { TileTool } from "../components/tiles/tileTools";
import type { LayerMapRole } from "../engine/gamedev/shaderPreview";
import type { AutoWeightMethod } from "../engine/rig/autoWeights";
import type { WeightBrushMode, WeightFalloff } from "../engine/rig/skinning";
import {
  applyLayoutSnapshot,
  bringPanelToFrontState,
  clampDockWidth,
  clampTimelineHeight,
  createDefaultPanelLayout,
  createLayoutSnapshot,
  DEFAULT_LEFT_PANEL_WIDTH,
  DEFAULT_RIGHT_PANEL_WIDTH,
  deleteSavedLayout,
  deserializePanelLayout,
  deserializeSavedLayouts,
  detachPanelState,
  dockAllPanelsState,
  dockPanelState,
  type DockSide,
  type FloatingPanelRect,
  type PanelId,
  type PanelLayoutState,
  placePanelState,
  reorderDockedPanelState,
  resetWorkspaceLayoutState,
  type SavedLayout,
  serializePanelLayout,
  serializeSavedLayouts,
  setPanelHiddenState,
  setPanelSideState,
  togglePanelHiddenState,
  upsertSavedLayout,
} from "../engine/ui/panelLayout.ts";
import {
  isTilesetDocked,
  joinBottomArea,
  setBottomEditor,
  setBottomSplitRatio,
  setBottomVisible,
  setSidebarEditor,
  setTilesetDocked,
  splitBottomArea,
  toggleBottomArea,
  type AreaEditorId,
  type AreasState,
} from "../engine/ui/areaEditors.ts";
import type { BrushShape, CustomBrushData } from "../engine/tools/brush";
import type { DitherPattern } from "../engine/tools/dither";
import type { GradientMode } from "../engine/tools/gradient";
import type { GuideAxis, GuideLine } from "../engine/tools/guides";
import type { InkMode } from "../engine/tools/ink";
import type { TransformAlgorithm, TransformState } from "../engine/tools/transform";
import {
  getPresetKeybindings,
  normalizeChordString,
  PIXET_DEFAULT_KEYBINDINGS,
  type KeybindingMap,
  type KeybindingPreset,
} from "../engine/config/keybindings.ts";
import { migrateKeybindingIds } from "../engine/config/commands.ts";
import {
  computeNextPlaybackFrame,
  type TagDirection,
} from "../engine/tools/animationHelpers.ts";
import type {
  DepthProfile,
  Light3DType,
  Render3DPass,
  SpinAxis,
  TurntableEasing,
} from "../engine/tools/rotate3d.ts";
import type {
  DepthMapMode,
  HeightMapSource,
  NormalConvention,
} from "../engine/gamedev/pbrMaps.ts";
import type { Scene3DGridMode } from "../engine/tools/scene3d.ts";
import type { RigTurntableMode } from "../engine/rig/export/bake.ts";
import { stepZoom } from "../engine/ui/zoom.ts";
import type {
  GizmoMode,
  Model3DSubMode,
  ShadingMode,
  Studio3DWorkspaceKind,
} from "../engine/model3d/types.ts";

export type {
  BlendMode,
  BrushShape,
  CustomBrushData,
  DitherPattern,
  FloatingPanelRect,
  GradientMode,
  GuideAxis,
  GuideLine,
  InkMode,
  KeybindingMap,
  KeybindingPreset,
  LayerMapRole,
  PanelId,
  TagDirection,
  TileTool,
  TransformAlgorithm,
  TransformState,
};

const PANEL_LAYOUT_STORAGE_KEY = "pixet.panelLayout.v1";

function loadPanelLayout(): PanelLayoutState {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return createDefaultPanelLayout();
  }
  try {
    return deserializePanelLayout(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY));
  } catch {
    return createDefaultPanelLayout();
  }
}

function savePanelLayout(state: PanelLayoutState): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, serializePanelLayout(state));
  } catch {
    // Ignore quota/private-mode errors
  }
}

const initialPanelLayout = loadPanelLayout();

function layoutOf(s: {
  detachedPanels: PanelLayoutState["detachedPanels"];
  dockedPanelOrder: PanelLayoutState["dockedPanelOrder"];
  panelSides: PanelLayoutState["panelSides"];
  hiddenPanels: PanelLayoutState["hiddenPanels"];
  areas: PanelLayoutState["areas"];
}): PanelLayoutState {
  return {
    detachedPanels: s.detachedPanels,
    dockedPanelOrder: s.dockedPanelOrder,
    panelSides: s.panelSides,
    hiddenPanels: s.hiddenPanels,
    areas: s.areas,
  };
}

/** Persist a changed areas map and keep the legacy tileset-docked flag in sync. */
function commitAreas(
  s: Parameters<typeof layoutOf>[0],
  areas: AreasState
): Partial<{ areas: AreasState; tilesetBrowserDocked: boolean }> | typeof s {
  if (areas === s.areas) return s;
  savePanelLayout({ ...layoutOf(s), areas });
  return { areas, tilesetBrowserDocked: isTilesetDocked(areas) };
}

const PANEL_WIDTHS_STORAGE_KEY = "pixet.panelWidths.v1";
const SAVED_LAYOUTS_STORAGE_KEY = "pixet.savedLayouts.v1";

function loadPanelWidths(): { right: number; left: number } {
  const fallback = {
    right: DEFAULT_RIGHT_PANEL_WIDTH,
    left: DEFAULT_LEFT_PANEL_WIDTH,
  };
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTHS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { right?: unknown; left?: unknown };
    return {
      right:
        typeof parsed.right === "number" ? clampDockWidth(parsed.right) : fallback.right,
      left: typeof parsed.left === "number" ? clampDockWidth(parsed.left) : fallback.left,
    };
  } catch {
    return fallback;
  }
}

function savePanelWidths(right: number, left: number): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      PANEL_WIDTHS_STORAGE_KEY,
      JSON.stringify({ right, left })
    );
  } catch {
    // Ignore quota/private-mode errors
  }
}

function loadSavedLayouts(): SavedLayout[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return [];
  }
  try {
    return deserializeSavedLayouts(
      window.localStorage.getItem(SAVED_LAYOUTS_STORAGE_KEY)
    );
  } catch {
    return [];
  }
}

function persistSavedLayouts(list: SavedLayout[]): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      SAVED_LAYOUTS_STORAGE_KEY,
      serializeSavedLayouts(list)
    );
  } catch {
    // Ignore quota/private-mode errors
  }
}

const initialPanelWidths = loadPanelWidths();

export type RightClickMode = "secondaryColor" | "erase" | "eyedropper";
export type CanvasBackdrop =
  | "checkerDark"
  | "checkerLight"
  | "solidDark"
  | "solidMid"
  | "custom";

export type ReferenceImageState = {
  dataUrl: string;
  width: number;
  height: number;
  visible: boolean;
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  behindCanvas: boolean;
  locked: boolean;
};

export type WorkspaceMode = "draw" | "tiles" | "rig" | "studio3d" | "nodes" | "data";

export interface NodesUiState {
  selectedNodeIds: string[];
  pinnedNodeId: string | null;
  compareNodeId: string | null;
  showThumbnails: boolean;
  previewTab: "2d" | "3d";
  preview2dMode: "rgba" | "gray" | "r" | "g" | "b" | "a" | "tile3x3";
  quickAddOpen: boolean;
  quickAddPos: { x: number; y: number };
  pendingWireFrom: { nodeId: string; socketId: string; handleType: "source" | "target" } | null;
}

const DEFAULT_NODES_UI_STATE: NodesUiState = {
  selectedNodeIds: [],
  pinnedNodeId: null,
  compareNodeId: null,
  showThumbnails: true,
  previewTab: "2d",
  preview2dMode: "rgba",
  quickAddOpen: false,
  quickAddPos: { x: 240, y: 180 },
  pendingWireFrom: null,
};
export type Studio3DMode = "extruded" | "stack" | "rig";
export type Studio3DSourceScope = "visible" | "active";
export type Studio3DPivotMode = "center" | "bottom" | "custom";
export type Studio3DPreviewMode = "orbit" | "turntable";
export type Studio3DZoom = "auto" | 2 | 4 | 6 | 8;

export interface Studio3DState {
  workspaceKind: Studio3DWorkspaceKind;
  subMode: Model3DSubMode;
  gizmoMode: GizmoMode;
  snapPx: number;
  shadingMode: ShadingMode;
  wireframeOverlay: boolean;
  cullBackfacesInView: boolean;
  uvDrawerOpen: boolean;
  mode: Studio3DMode;
  gridMode: Scene3DGridMode;
  showAxes: boolean;
  showFloorStage: boolean;
  sourceScope: Studio3DSourceScope;
  backFaceChoice: string;
  leftSideChoice: string;
  rightSideChoice: string;
  topSideChoice: string;
  bottomSideChoice: string;
  sideColorHex: string;
  pivotMode: Studio3DPivotMode;
  customPivotX: number;
  customPivotY: number;
  rigAutoZSort: boolean;
  rigBakeMode: RigTurntableMode;
  rigDirections: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  perspective: number;
  autoFitBounds: boolean;
  depthProfile: DepthProfile;
  extrudeDepth: number;
  heightMapLayerId: string;
  stackPitchDeg: number;
  sliceSpacing: number;
  sliceThickness: number;
  reverseOrder: boolean;
  shadeDepth: boolean;
  directionalLighting: boolean;
  lightAzimuthDeg: number;
  lightElevationDeg: number;
  lightType: Light3DType;
  lightPosX: number;
  lightPosY: number;
  lightPosZ: number;
  lightRadius: number;
  spotAngleDeg: number;
  spotSoftness: number;
  showLightGizmo: boolean;
  ambient: number;
  rimStrength: number;
  supersample: boolean;
  preScaleEPX: boolean;
  paletteLock: boolean;
  removeOrphans: boolean;
  fillHoles: boolean;
  outlineEnabled: boolean;
  outlineHex: string;
  previewMode: Studio3DPreviewMode;
  previewZoom: Studio3DZoom;
  autoSpin: boolean;
  scrubberFrame: number;
  scrubberPlaying: boolean;
  bakeFrameCount: number;
  spinAxis: SpinAxis;
  bakeStartDeg: number;
  bakeSweepDeg: number;
  bakePingPong: boolean;
  bakeEasing: TurntableEasing;
  spinTimelineFrames: boolean;
  renderPass: Render3DPass;
  lightColor: string;
  ambientColor: string;
  lightIntensity: number;
  specularStrength: number;
  shininess: number;
  celSteps: number;
  rimColor: string;
  useNormalLayer: boolean;
  normalConvention: NormalConvention;
  normalStrength: number;
  heightSource: HeightMapSource;
  heightBevelWeight: number;
  heightContrast: number;
  heightBlur: number;
  paint3dTool: "brush" | "eraser" | "fillFace" | "eyedropper" | "vertexColor";
  paint3dLockFace: boolean;
  autoKey3D: boolean;
  tileStampMode: "stamp" | "dragFill" | "extrudeBlock";
  tileExtrudeDepthPx: number;
  depthMode: DepthMapMode;
  depthInvert: boolean;
}

const DEFAULT_STUDIO3D_STATE: Studio3DState = {
  workspaceKind: "sprite25d",
  subMode: "model",
  gizmoMode: "move",
  snapPx: 1,
  shadingMode: "flat",
  wireframeOverlay: false,
  cullBackfacesInView: false,
  uvDrawerOpen: false,
  mode: "extruded",
  gridMode: "perspective",
  showAxes: true,
  showFloorStage: true,
  sourceScope: "visible",
  backFaceChoice: "none",
  leftSideChoice: "none",
  rightSideChoice: "none",
  topSideChoice: "none",
  bottomSideChoice: "none",
  sideColorHex: "#3a3f54",
  pivotMode: "center",
  customPivotX: 16,
  customPivotY: 16,
  rigAutoZSort: true,
  rigBakeMode: "pose",
  rigDirections: 8,
  yawDeg: 28,
  pitchDeg: 20,
  rollDeg: 0,
  perspective: 0.35,
  autoFitBounds: false,
  depthProfile: "slab",
  extrudeDepth: 4,
  heightMapLayerId: "",
  stackPitchDeg: 42,
  sliceSpacing: 1.5,
  sliceThickness: 1,
  reverseOrder: false,
  shadeDepth: true,
  directionalLighting: true,
  lightAzimuthDeg: -35,
  lightElevationDeg: 45,
  lightType: "point",
  lightPosX: -18,
  lightPosY: -20,
  lightPosZ: 24,
  lightRadius: 36,
  spotAngleDeg: 55,
  spotSoftness: 0.35,
  showLightGizmo: true,
  ambient: 0.45,
  rimStrength: 0,
  supersample: true,
  preScaleEPX: false,
  paletteLock: false,
  removeOrphans: false,
  fillHoles: false,
  outlineEnabled: false,
  outlineHex: "#0f0f17",
  previewMode: "orbit",
  previewZoom: "auto",
  autoSpin: false,
  scrubberFrame: 0,
  scrubberPlaying: false,
  bakeFrameCount: 8,
  spinAxis: "yaw",
  bakeStartDeg: 0,
  bakeSweepDeg: 360,
  bakePingPong: false,
  bakeEasing: "linear",
  spinTimelineFrames: false,
  renderPass: "lit",
  lightColor: "#fff4d6",
  ambientColor: "#8ca0c8",
  lightIntensity: 1.2,
  specularStrength: 0.35,
  shininess: 28,
  celSteps: 0,
  rimColor: "#cfe4ff",
  useNormalLayer: true,
  normalConvention: "opengl",
  normalStrength: 2.5,
  heightSource: "hybrid",
  heightBevelWeight: 0.55,
  heightContrast: 1.0,
  heightBlur: 0,
  paint3dTool: "brush",
  paint3dLockFace: false,
  autoKey3D: true,
  tileStampMode: "stamp",
  tileExtrudeDepthPx: 16,
  depthMode: "volume",
  depthInvert: false,
};
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
  | "rotate3d"
  | "addBone"
  | "chain"
  | "ik"
  | "weightPaint"
  | "meshEdit"
  | "pin";
export type RigWeightOverlayMode = "heatmap" | "boneColors" | "unweighted";
export type RigWeightSubTool = "brush" | "gradient" | "flood" | "inspector";
export type DataTool = "hitbox" | "hurtbox" | "collision" | "socket";

export type ToolId =
  | "pencil"
  | "fillBrush"
  | "ditherBrush"
  | "shading"
  | "spray"
  | "jumble"
  | "eraser"
  | "line"
  | "curve"
  | "polygon"
  | "rect"
  | "ellipse"
  | "fill"
  | "gradient"
  | "eyedropper"
  | "marquee"
  | "ellipseMarquee"
  | "lasso"
  | "polyLasso"
  | "wand"
  | "move"
  | "tileStamp"
  | "isoBox";

export type LayerKind =
  | "raster"
  | "group"
  | "tilemap"
  | "rig"
  | "data"
  | "object";

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
  clipped?: boolean;
  colorTag?: string | null;
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
  direction?: TagDirection;
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
  savedCustomBrushes: CustomBrushData[];
  ditherPattern: DitherPattern;
  gradientMode: GradientMode;
  gradientDither: DitherPattern | "none";
  gradientPaletteSnap: boolean;
  fillTolerance: number;
  fillDiagonal8: boolean;
  fillSampleAllLayers: boolean;
  fillDitherPattern: DitherPattern | "none";
  sprayRadius: number;
  sprayDensity: number;
  pixelPerfect: boolean;
  shapeFilled: boolean;
  fillContiguous: boolean;
  symmetryX: boolean;
  symmetryY: boolean;
  symmetryAxisX: number | null;
  symmetryAxisY: number | null;
  symmetryDiag45: boolean;
  symmetryDiag135: boolean;
  symmetryRadial: number;
  showGrid: boolean;
  seamlessWrap: boolean;
  showTileGrid: boolean;
  viewFlipH: boolean;
  viewFlipV: boolean;
  viewGrayscale: boolean;
  viewSilhouette: boolean;
  canvasBackdrop: CanvasBackdrop;
  canvasBackdropColor: string;
  showRulers: boolean;
  guides: GuideLine[];
  snapToGuides: boolean;
  showCustomGrid: boolean;
  customGridW: number;
  customGridH: number;
  customGridOffsetX: number;
  customGridOffsetY: number;
  referenceImage: ReferenceImageState | null;
  commandPaletteOpen: boolean;
  keybindings: KeybindingMap;
  keybindingsModalOpen: boolean;
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
  /** T5: draw every collidable cell's shape in Map mode. */
  showCollisionOverlay: boolean;
  /** T5: selected object on the active object layer. */
  selectedObjectId: string | null;
  /** T5: in-progress object rect drag preview (canvas pixels). */
  objectDraft: { x: number; y: number; w: number; h: number } | null;
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
  /** True while zoom was set by Fit (auto-refits on resize / document change). */
  zoomIsFit: boolean;
  /** Bumped to force the viewport to recentre / refit. */
  viewResetNonce: number;
  viewportSize: { w: number; h: number } | null;
  cursorPos: CursorPoint | null;
  canUndo: boolean;
  canRedo: boolean;

  primaryColor: string;
  secondaryColor: string;
  primaryAlpha: number;
  paletteLock: boolean;
  recentColors: string[];
  colorPickerMode: "square" | "wheel";
  palette: string[];
  paletteName: string;
  previewScale: 1 | 2 | 4;
  hasSelection: boolean;
  freeTransformActive: boolean;
  freeTransformState: TransformState | null;

  documentName: string;
  isDocumentDirty: boolean;
  currentFilePath: string | null;
  canvasWidth: number;
  canvasHeight: number;
  colorMode: "RGBA" | "Indexed";
  exportModalOpen: boolean;
  exportModalMode: "sheet" | "gif" | "png_sequence" | "tilemap";
  rigExportModalOpen: boolean;
  rotate3dModalOpen: boolean;
  newSpriteModalOpen: boolean;
  startScreenOpen: boolean;
  canvasSizeModalOpen: boolean;
  filterModalOpen: boolean;
  filterModalTab: string;
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
  /** W1 airbrush accumulation toggle (when false, caps per-stroke dab falloff). */
  rigWeightAirbrush: boolean;
  /** W2 active weight-paint sub-tool. */
  rigWeightSubTool: RigWeightSubTool;
  /** W2 flood-fill RGB color tolerance (0..255). */
  rigWeightFloodTolerance: number;
  /** W2 flood-fill contiguous-region toggle. */
  rigWeightFloodContiguous: boolean;
  /** W2 live horizontal symmetry painting. */
  rigWeightMirrorX: boolean;
  /** W2 live vertical symmetry painting. */
  rigWeightMirrorY: boolean;
  /** W2 inspected pixel coordinate for per-pixel weight editing. */
  inspectedWeightPixel: { x: number; y: number } | null;
  /** W0 smart auto-weight solver method. */
  rigAutoWeightMethod: AutoWeightMethod;
  /** W0 falloff power (0.5..6). */
  rigAutoWeightPower: number;
  /** W0 color-boundary respect penalty (0..2). */
  rigAutoWeightColorPenalty: number;
  /** W0 auto-weight only currently selected bone(s). */
  rigAutoWeightSelectedOnly: boolean;
  /** W0 clip auto-weight to active pixel selection mask when present. */
  rigAutoWeightRespectSelection: boolean;
  /** R6 post-deformation pixel cleanup toggles. */
  rigCleanupOrphans: boolean;
  rigCleanupHoles: boolean;
  rigCleanupPaletteLock: boolean;
  rigCleanupOutline: boolean;
  /** R3D-5 rig 3D render options. */
  rigAutoZSort: boolean;
  rigDirectionalLighting: boolean;
  rigPerspective3d: number;

  dataTool: DataTool;
  /** True while a Game Data tool (hitbox/socket...) owns the Draw canvas pointer. */
  dataToolActive: boolean;
  /** Incremented to ask the Game Data panel to expand itself. */
  gameDataPanelOpenSignal: number;
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
  light2dType: "point" | "directional";
  light2dAmbientColor: string;
  light2dSpecular: number;
  light2dShininess: number;
  light2dHeightScale: number;
  light2dAo: number;
  light2dCelSteps: number;
  light2dAutoNormal: boolean;
  paletteLutEnabled: boolean;
  paletteLutPresetName: string;

  layers: LayerItem[];
  activeLayerId: string;
  selectedLayerIds: string[];
  soloVisibilitySnapshot: Record<string, boolean> | null;

  frames: FrameItem[];
  currentFrame: number;
  isPlaying: boolean;
  loopPlayback: boolean;
  fps: number;
  onionSkin: boolean;
  onionPrevFrames: number;
  onionNextFrames: number;
  onionOpacity: number;
  onionSkinTint: boolean;
  onionSkinOpacity: number;
  onionSkinInFront: boolean;
  onionSkinLoopWrap: boolean;
  timelineShowThumbs: boolean;
  selectedCels: Array<{ layerId: string; frame: number }>;
  playbackPingPongDir: 1 | -1;
  tags: AnimationTag[];
  activeTagId: string | null;

  rightPanelWidth: number;
  leftPanelWidth: number;
  timelineHeight: number;
  /** True once the user dragged the timeline; otherwise it sizes to content. */
  timelineHeightManual: boolean;
  timelineCollapsed: boolean;
  panelsCollapsed: boolean;
  showFloatingPreview: boolean;
  statusMessage: string | null;
  detachedPanels: Partial<Record<PanelId, FloatingPanelRect>>;
  dockedPanelOrder: Record<WorkspaceMode, PanelId[]>;
  panelSides: Partial<Record<PanelId, DockSide>>;
  hiddenPanels: Partial<Record<PanelId, boolean>>;
  areas: AreasState;
  savedLayouts: SavedLayout[];
  saveLayoutModalOpen: boolean;
  studio3d: Studio3DState;
  model3dVersion: number;
  nodesUi: NodesUiState;
  nodesVersion: number;

  setWorkspaceMode: (mode: WorkspaceMode) => void;
  patchStudio3D: (patch: Partial<Studio3DState>) => void;
  resetStudio3DCamera: () => void;
  bumpModel3DVersion: () => void;
  patchNodesUi: (patch: Partial<NodesUiState>) => void;
  bumpNodesVersion: () => void;
  setActiveTool: (tool: ToolId) => void;
  setBrushSize: (size: number) => void;
  setBrushShape: (shape: BrushShape) => void;
  setBrushOpacity: (opacity: number) => void;
  setBrushSpacing: (spacing: number) => void;
  setInkMode: (mode: InkMode) => void;
  setRightClickMode: (mode: RightClickMode) => void;
  setCustomBrush: (brush: CustomBrushData | null) => void;
  addSavedCustomBrush: (brush: CustomBrushData) => void;
  removeSavedCustomBrush: (id: string) => void;
  setDitherPattern: (pattern: DitherPattern) => void;
  setGradientMode: (mode: GradientMode) => void;
  setGradientDither: (dither: DitherPattern | "none") => void;
  toggleGradientPaletteSnap: () => void;
  setFillTolerance: (tol: number) => void;
  toggleFillDiagonal8: () => void;
  toggleFillSampleAllLayers: () => void;
  setFillDitherPattern: (pattern: DitherPattern | "none") => void;
  setSprayRadius: (radius: number) => void;
  setSprayDensity: (density: number) => void;
  togglePixelPerfect: () => void;
  toggleShapeFilled: () => void;
  toggleFillContiguous: () => void;
  toggleSymmetryX: () => void;
  toggleSymmetryY: () => void;
  setSymmetryAxisX: (axis: number | null) => void;
  setSymmetryAxisY: (axis: number | null) => void;
  toggleSymmetryDiag45: () => void;
  toggleSymmetryDiag135: () => void;
  setSymmetryRadial: (segments: number) => void;
  toggleShowGrid: () => void;
  toggleSeamlessWrap: () => void;
  toggleShowTileGrid: () => void;
  toggleShowCollisionOverlay: () => void;
  setSelectedObjectId: (id: string | null) => void;
  setObjectDraft: (
    draft: { x: number; y: number; w: number; h: number } | null
  ) => void;
  addObjectLayer: () => void;
  toggleViewFlipH: () => void;
  toggleViewFlipV: () => void;
  toggleViewGrayscale: () => void;
  toggleViewSilhouette: () => void;
  setCanvasBackdrop: (b: CanvasBackdrop) => void;
  setCanvasBackdropColor: (c: string) => void;
  toggleShowRulers: () => void;
  toggleSnapToGuides: () => void;
  addGuide: (axis: GuideAxis, pos: number) => void;
  moveGuide: (id: string, pos: number) => void;
  removeGuide: (id: string) => void;
  clearGuides: () => void;
  toggleShowCustomGrid: () => void;
  setCustomGridSize: (w: number, h: number) => void;
  setCustomGridOffset: (ox: number, oy: number) => void;
  setReferenceImage: (img: ReferenceImageState | null) => void;
  updateReferenceImage: (patch: Partial<ReferenceImageState>) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setKeybinding: (actionId: string, chord: string) => void;
  applyKeybindingPreset: (preset: KeybindingPreset) => void;
  importKeybindingsJson: (json: string) => boolean;
  setKeybindingsModalOpen: (open: boolean) => void;
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
  /** Set the zoom from the fit computation without clearing zoomIsFit. */
  applyFitZoom: (zoom: number) => void;
  fitZoomToWindow: () => void;
  zoomActualSize: () => void;
  zoomStep: (direction: 1 | -1) => void;
  setViewportSize: (size: { w: number; h: number }) => void;
  setCursorPos: (pos: CursorPoint | null) => void;
  setHistoryFlags: (canUndo: boolean, canRedo: boolean) => void;
  setCelPopulated: (layerId: string, frameIndex: number, populated: boolean) => void;

  setPrimaryColor: (hex: string) => void;
  setSecondaryColor: (hex: string) => void;
  setPrimaryAlpha: (alpha: number) => void;
  togglePaletteLock: () => void;
  pushRecentColor: (hex: string) => void;
  setColorPickerMode: (mode: "square" | "wheel") => void;
  swapColors: () => void;
  setPreviewScale: (scale: 1 | 2 | 4) => void;
  setHasSelection: (hasSelection: boolean) => void;
  setFreeTransformActive: (active: boolean) => void;
  setFreeTransformState: (state: TransformState | null) => void;
  setPalette: (name: string, colors: string[]) => void;
  addColorToPalette: (hex: string) => void;
  removeColorFromPalette: (hex: string) => void;
  reorderPalette: (fromIdx: number, toIdx: number) => void;
  replacePaletteColor: (index: number, hex: string) => void;
  removePaletteColor: (index: number) => void;
  duplicatePaletteColor: (index: number) => void;
  appendPaletteColors: (colors: string[]) => void;

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
  toggleLayerClipped: (id: string) => void;
  setLayerColorTag: (id: string, color: string | null) => void;
  soloLayer: (id: string) => void;
  addLayer: () => void;
  addNamedLayer: (name: string) => string;
  addMapLayer: (role: "normal" | "height" | "depth" | "emission", name?: string) => string;
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
  toggleOnionSkinTint: () => void;
  setOnionSkinOpacity: (opacity: number) => void;
  toggleOnionSkinInFront: () => void;
  toggleOnionSkinLoopWrap: () => void;
  toggleTimelineShowThumbs: () => void;
  setSelectedCels: (cels: Array<{ layerId: string; frame: number }>) => void;
  clearSelectedCels: () => void;
  setActiveTagId: (tagId: string | null) => void;
  setFrameDuration: (frameIndex: number, durationMs: number) => void;
  insertFrameMetadata: (atIndex: number, durationMs?: number) => void;
  deleteFrameMetadata: (frameIndex: number) => void;
  moveFrameMetadata: (fromIndex: number, toIndex: number) => void;
  addTag: (
    name: string,
    fromFrame: number,
    toFrame: number,
    color: string,
    direction?: TagDirection
  ) => void;
  setTagDirection: (id: string, direction: TagDirection) => void;
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
  setLeftPanelWidth: (width: number) => void;
  setTimelineHeight: (height: number) => void;
  toggleTimelineCollapsed: () => void;
  togglePanelsCollapsed: () => void;
  toggleFloatingPreview: () => void;
  setShowFloatingPreview: (show: boolean) => void;
  setStatusMessage: (msg: string | null) => void;
  setCurrentFilePath: (path: string | null) => void;
  setDocumentName: (name: string) => void;
  setDocumentDirty: (dirty: boolean) => void;
  setExportModalOpen: (
    open: boolean,
    mode?: "sheet" | "gif" | "png_sequence" | "tilemap"
  ) => void;
  setRigExportModalOpen: (open: boolean) => void;
  setRotate3dModalOpen: (open: boolean) => void;
  setNewSpriteModalOpen: (open: boolean) => void;
  setStartScreenOpen: (open: boolean) => void;
  setCanvasSizeModalOpen: (open: boolean) => void;
  setFilterModalOpen: (open: boolean, tab?: string) => void;
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
  toggleRigWeightAirbrush: () => void;
  setRigWeightSubTool: (subTool: RigWeightSubTool) => void;
  setRigWeightFloodTolerance: (tolerance: number) => void;
  toggleRigWeightFloodContiguous: () => void;
  toggleRigWeightMirrorX: () => void;
  toggleRigWeightMirrorY: () => void;
  setInspectedWeightPixel: (pixel: { x: number; y: number } | null) => void;
  setRigAutoWeightMethod: (method: AutoWeightMethod) => void;
  setRigAutoWeightPower: (power: number) => void;
  setRigAutoWeightColorPenalty: (penalty: number) => void;
  toggleRigAutoWeightSelectedOnly: () => void;
  toggleRigAutoWeightRespectSelection: () => void;
  toggleRigCleanupOrphans: () => void;
  toggleRigCleanupHoles: () => void;
  toggleRigCleanupPaletteLock: () => void;
  toggleRigCleanupOutline: () => void;
  toggleRigAutoZSort: () => void;
  toggleRigDirectionalLighting: () => void;
  setRigPerspective3d: (v: number) => void;
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
      lightType: "point" | "directional";
      ambientColor: string;
      specular: number;
      shininess: number;
      heightScale: number;
      ao: number;
      celSteps: number;
      autoNormal: boolean;
    }>
  ) => void;
  setPaletteLutEnabled: (v: boolean) => void;
  setPaletteLutPresetName: (name: string) => void;
  detachPanel: (
    id: PanelId,
    initial?: Partial<Pick<FloatingPanelRect, "x" | "y" | "width">>
  ) => void;
  dockPanel: (id: PanelId, targetIndex?: number) => void;
  /** Dock (or re-order) a panel into a column, before `beforeId` or at its end. */
  placePanel: (id: PanelId, side: DockSide, beforeId?: PanelId | null) => void;
  setPanelSide: (id: PanelId, side: DockSide) => void;
  togglePanelHidden: (id: PanelId) => void;
  setPanelHidden: (id: PanelId, hidden: boolean) => void;
  resetWorkspaceLayout: (mode: WorkspaceMode) => void;
  setSidebarAreaEditor: (mode: WorkspaceMode, id: AreaEditorId) => void;
  setBottomAreaEditor: (mode: WorkspaceMode, index: number, id: AreaEditorId) => void;
  splitBottomArea: (mode: WorkspaceMode) => void;
  joinBottomArea: (mode: WorkspaceMode, closeIndex?: number) => void;
  setBottomSplitRatio: (mode: WorkspaceMode, ratio: number) => void;
  setBottomAreaVisible: (mode: WorkspaceMode, visible: boolean) => void;
  toggleBottomAreaVisible: (mode: WorkspaceMode, timelineAllowed: boolean) => void;
  saveCurrentLayout: (name: string) => void;
  applySavedLayout: (name: string) => void;
  deleteSavedLayoutByName: (name: string) => void;
  setSaveLayoutModalOpen: (open: boolean) => void;
  dockAllPanels: () => void;
  updateFloatingPanelRect: (
    id: PanelId,
    patch: Partial<FloatingPanelRect>
  ) => void;
  toggleFloatingPanelCollapsed: (id: PanelId) => void;
  toggleFloatingPanelPinned: (id: PanelId) => void;
  bringFloatingPanelToFront: (id: PanelId) => void;
  reorderDockedPanel: (mode: WorkspaceMode, id: PanelId, toIndex: number) => void;
  resetPanelLayout: () => void;
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
    guides?: GuideLine[];
  }) => void;
}

let layerCounter = 4;
let frameIdCounter = 5;
let tagIdCounter = 1;
let guideIdCounter = 1;

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

const RECENT_COLORS_STORAGE_KEY = "pixet:recentColors";
const MAX_RECENT_COLORS = 16;

function normalizeHex6(hex: string): string | null {
  const trimmed = hex.trim().toLowerCase();
  const prefixed = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-f]{6}$/.test(prefixed) ? prefixed : null;
}

function loadInitialRecentColors(): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(RECENT_COLORS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const norm = normalizeHex6(item);
      if (norm && !out.includes(norm)) {
        out.push(norm);
        if (out.length >= MAX_RECENT_COLORS) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

function persistRecentColors(colors: string[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RECENT_COLORS_STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // ignore storage quota/access errors
  }
}

function addRecentColorList(prev: string[], hex: string): string[] {
  const norm = normalizeHex6(hex);
  if (!norm) return prev;
  if (prev[0] === norm) return prev;
  const next = [norm, ...prev.filter((c) => c !== norm)].slice(
    0,
    MAX_RECENT_COLORS
  );
  persistRecentColors(next);
  return next;
}

const KEYBINDINGS_STORAGE_KEY = "pixet:keybindings";

function loadInitialKeybindings(): KeybindingMap {
  const base: KeybindingMap = { ...PIXET_DEFAULT_KEYBINDINGS };
  try {
    if (typeof localStorage === "undefined") return base;
    const raw = localStorage.getItem(KEYBINDINGS_STORAGE_KEY);
    if (!raw) return base;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return base;
    }
    const stored: KeybindingMap = {};
    for (const [actionId, chord] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (typeof chord !== "string") continue;
      stored[actionId] = chord === "" ? "" : normalizeChordString(chord);
    }
    // Overrides saved under a renamed command id move to the current id.
    return { ...base, ...migrateKeybindingIds(stored) };
  } catch {
    return base;
  }
}

function persistKeybindings(map: KeybindingMap): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota/access errors
  }
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
  savedCustomBrushes: [],
  ditherPattern: "bayer4",
  gradientMode: "linear",
  gradientDither: "bayer4",
  gradientPaletteSnap: false,
  fillTolerance: 0,
  fillDiagonal8: false,
  fillSampleAllLayers: false,
  fillDitherPattern: "none",
  sprayRadius: 6,
  sprayDensity: 30,
  pixelPerfect: true,
  shapeFilled: false,
  fillContiguous: true,
  symmetryX: false,
  symmetryY: false,
  symmetryAxisX: null,
  symmetryAxisY: null,
  symmetryDiag45: false,
  symmetryDiag135: false,
  symmetryRadial: 0,
  showGrid: true,
  seamlessWrap: false,
  showTileGrid: true,
  viewFlipH: false,
  viewFlipV: false,
  viewGrayscale: false,
  viewSilhouette: false,
  canvasBackdrop: "checkerDark",
  canvasBackdropColor: "#202020",
  showRulers: false,
  guides: [],
  snapToGuides: true,
  showCustomGrid: false,
  customGridW: 8,
  customGridH: 8,
  customGridOffsetX: 0,
  customGridOffsetY: 0,
  referenceImage: null,
  commandPaletteOpen: false,
  keybindings: loadInitialKeybindings(),
  keybindingsModalOpen: false,
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
  tilesetBrowserDocked: isTilesetDocked(initialPanelLayout.areas),
  hoveredTileCell: null,
  tileBrush: null,
  tileBrushAnchor: "topLeft",
  tileEraserSize: 1,
  tileFillContiguous: true,
  showCollisionOverlay: false,
  selectedObjectId: null,
  objectDraft: null,
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
  zoomIsFit: true,
  viewResetNonce: 0,
  viewportSize: null,
  cursorPos: null,
  canUndo: false,
  canRedo: false,

  primaryColor: "#5b8cff",
  secondaryColor: "#0f0f17",
  primaryAlpha: 255,
  paletteLock: false,
  recentColors: loadInitialRecentColors(),
  colorPickerMode: "square",
  palette: DEFAULT_PALETTE,
  paletteName: "Pixet Default 16",
  previewScale: 2,
  hasSelection: false,
  freeTransformActive: false,
  freeTransformState: null,

  documentName: "untitled.pixet",
  isDocumentDirty: false,
  currentFilePath: null,
  canvasWidth: 32,
  canvasHeight: 32,
  colorMode: "RGBA",
  exportModalOpen: false,
  exportModalMode: "sheet",
  rigExportModalOpen: false,
  rotate3dModalOpen: false,
  newSpriteModalOpen: false,
  startScreenOpen: false,
  canvasSizeModalOpen: false,
  filterModalOpen: false,
  filterModalTab: "outline",
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
  rigWeightAirbrush: false,
  rigWeightSubTool: "brush",
  rigWeightFloodTolerance: 16,
  rigWeightFloodContiguous: true,
  rigWeightMirrorX: false,
  rigWeightMirrorY: false,
  inspectedWeightPixel: null,
  rigAutoWeightMethod: "geodesic",
  rigAutoWeightPower: 2,
  rigAutoWeightColorPenalty: 0.35,
  rigAutoWeightSelectedOnly: false,
  rigAutoWeightRespectSelection: true,
  rigCleanupOrphans: false,
  rigCleanupHoles: false,
  rigCleanupPaletteLock: false,
  rigCleanupOutline: false,
  rigAutoZSort: true,
  rigDirectionalLighting: false,
  rigPerspective3d: 0.2,

  dataTool: "hitbox",
  dataToolActive: false,
  gameDataPanelOpenSignal: 0,
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
  light2dType: "point",
  light2dAmbientColor: "#3a4664",
  light2dSpecular: 0.35,
  light2dShininess: 24,
  light2dHeightScale: 0.25,
  light2dAo: 0.2,
  light2dCelSteps: 0,
  light2dAutoNormal: true,
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
  soloVisibilitySnapshot: null,

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
  onionSkinTint: true,
  onionSkinOpacity: 35,
  onionSkinInFront: false,
  onionSkinLoopWrap: false,
  timelineShowThumbs: false,
  selectedCels: [],
  playbackPingPongDir: 1,
  tags: [
    {
      id: "tag-idle",
      name: "idle",
      fromFrame: 0,
      toFrame: 3,
      color: "#5b8cff",
      direction: "forward",
    },
  ],
  activeTagId: null,

  rightPanelWidth: initialPanelWidths.right,
  leftPanelWidth: initialPanelWidths.left,
  timelineHeight: 204,
  timelineHeightManual: false,
  timelineCollapsed: false,
  panelsCollapsed: false,
  showFloatingPreview: true,
  statusMessage: null,
  detachedPanels: initialPanelLayout.detachedPanels,
  dockedPanelOrder: initialPanelLayout.dockedPanelOrder,
  panelSides: initialPanelLayout.panelSides,
  hiddenPanels: initialPanelLayout.hiddenPanels,
  areas: initialPanelLayout.areas,
  savedLayouts: loadSavedLayouts(),
  saveLayoutModalOpen: false,
  studio3d: { ...DEFAULT_STUDIO3D_STATE },
  model3dVersion: 0,
  nodesUi: { ...DEFAULT_NODES_UI_STATE },
  nodesVersion: 0,

  setWorkspaceMode: (mode) =>
    set((s) => {
      // "data" is legacy: it now means Draw with the Game Data panel open.
      if (mode === "data") {
        return {
          workspaceMode: "draw",
          dataToolActive: true,
          gameDataPanelOpenSignal: s.gameDataPanelOpenSignal + 1,
        };
      }
      return { workspaceMode: mode, dataToolActive: false };
    }),
  patchStudio3D: (patch) =>
    set((s) => ({ studio3d: { ...s.studio3d, ...patch } })),
  bumpModel3DVersion: () =>
    set((s) => ({ model3dVersion: s.model3dVersion + 1 })),
  patchNodesUi: (patch) =>
    set((s) => ({ nodesUi: { ...s.nodesUi, ...patch } })),
  bumpNodesVersion: () =>
    set((s) => ({ nodesVersion: s.nodesVersion + 1 })),
  resetStudio3DCamera: () =>
    set((s) => ({
      studio3d: {
        ...s.studio3d,
        yawDeg: DEFAULT_STUDIO3D_STATE.yawDeg,
        pitchDeg: DEFAULT_STUDIO3D_STATE.pitchDeg,
        rollDeg: DEFAULT_STUDIO3D_STATE.rollDeg,
        perspective:
          s.studio3d.gridMode === "isometric"
            ? 0
            : DEFAULT_STUDIO3D_STATE.perspective,
        stackPitchDeg: DEFAULT_STUDIO3D_STATE.stackPitchDeg,
        autoSpin: false,
      },
    })),
  setActiveTool: (activeTool) => set({ activeTool, dataToolActive: false }),
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
  addSavedCustomBrush: (brush) =>
    set((s) => ({
      savedCustomBrushes: [
        brush,
        ...s.savedCustomBrushes.filter((b) => b.id !== brush.id),
      ],
    })),
  removeSavedCustomBrush: (id) =>
    set((s) => ({
      savedCustomBrushes: s.savedCustomBrushes.filter((b) => b.id !== id),
    })),
  setDitherPattern: (ditherPattern) => set({ ditherPattern }),
  setGradientMode: (gradientMode) => set({ gradientMode }),
  setGradientDither: (gradientDither) => set({ gradientDither }),
  toggleGradientPaletteSnap: () =>
    set((s) => ({ gradientPaletteSnap: !s.gradientPaletteSnap })),
  setFillTolerance: (tol) =>
    set({ fillTolerance: Math.max(0, Math.min(255, Math.round(tol))) }),
  toggleFillDiagonal8: () =>
    set((s) => ({ fillDiagonal8: !s.fillDiagonal8 })),
  toggleFillSampleAllLayers: () =>
    set((s) => ({ fillSampleAllLayers: !s.fillSampleAllLayers })),
  setFillDitherPattern: (fillDitherPattern) => set({ fillDitherPattern }),
  setSprayRadius: (radius) =>
    set({ sprayRadius: Math.max(1, Math.min(32, Math.round(radius))) }),
  setSprayDensity: (density) =>
    set({ sprayDensity: Math.max(1, Math.min(100, Math.round(density))) }),
  togglePixelPerfect: () => set((s) => ({ pixelPerfect: !s.pixelPerfect })),
  toggleShapeFilled: () => set((s) => ({ shapeFilled: !s.shapeFilled })),
  toggleFillContiguous: () =>
    set((s) => ({ fillContiguous: !s.fillContiguous })),
  toggleSymmetryX: () => set((s) => ({ symmetryX: !s.symmetryX })),
  toggleSymmetryY: () => set((s) => ({ symmetryY: !s.symmetryY })),
  setSymmetryAxisX: (axis) =>
    set({ symmetryAxisX: axis === null ? null : Math.round(axis * 2) / 2 }),
  setSymmetryAxisY: (axis) =>
    set({ symmetryAxisY: axis === null ? null : Math.round(axis * 2) / 2 }),
  toggleSymmetryDiag45: () =>
    set((s) => ({ symmetryDiag45: !s.symmetryDiag45 })),
  toggleSymmetryDiag135: () =>
    set((s) => ({ symmetryDiag135: !s.symmetryDiag135 })),
  setSymmetryRadial: (segments) =>
    set({
      symmetryRadial:
        segments <= 0 ? 0 : Math.max(2, Math.min(12, Math.round(segments))),
    }),
  toggleShowGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleSeamlessWrap: () => set((s) => ({ seamlessWrap: !s.seamlessWrap })),
  toggleShowTileGrid: () => set((s) => ({ showTileGrid: !s.showTileGrid })),
  toggleShowCollisionOverlay: () =>
    set((s) => ({ showCollisionOverlay: !s.showCollisionOverlay })),
  setSelectedObjectId: (selectedObjectId) => set({ selectedObjectId }),
  setObjectDraft: (objectDraft) => set({ objectDraft }),
  toggleViewFlipH: () => set((s) => ({ viewFlipH: !s.viewFlipH })),
  toggleViewFlipV: () => set((s) => ({ viewFlipV: !s.viewFlipV })),
  toggleViewGrayscale: () => set((s) => ({ viewGrayscale: !s.viewGrayscale })),
  toggleViewSilhouette: () =>
    set((s) => ({ viewSilhouette: !s.viewSilhouette })),
  setCanvasBackdrop: (canvasBackdrop) => set({ canvasBackdrop }),
  setCanvasBackdropColor: (canvasBackdropColor) => set({ canvasBackdropColor }),
  toggleShowRulers: () => set((s) => ({ showRulers: !s.showRulers })),
  toggleSnapToGuides: () => set((s) => ({ snapToGuides: !s.snapToGuides })),
  addGuide: (axis, pos) =>
    set((s) => ({
      guides: [
        ...s.guides,
        { id: `guide-${guideIdCounter++}`, axis, pos: Math.round(pos) },
      ],
    })),
  moveGuide: (id, pos) =>
    set((s) => ({
      guides: s.guides.map((g) =>
        g.id === id ? { ...g, pos: Math.round(pos) } : g
      ),
    })),
  removeGuide: (id) =>
    set((s) => ({ guides: s.guides.filter((g) => g.id !== id) })),
  clearGuides: () => set({ guides: [] }),
  toggleShowCustomGrid: () =>
    set((s) => ({ showCustomGrid: !s.showCustomGrid })),
  setCustomGridSize: (w, h) =>
    set({
      customGridW: Math.max(1, Math.min(256, Math.round(w))),
      customGridH: Math.max(1, Math.min(256, Math.round(h))),
    }),
  setCustomGridOffset: (ox, oy) =>
    set({
      customGridOffsetX: Math.round(ox),
      customGridOffsetY: Math.round(oy),
    }),
  setReferenceImage: (referenceImage) => set({ referenceImage }),
  updateReferenceImage: (patch) =>
    set((s) =>
      s.referenceImage
        ? { referenceImage: { ...s.referenceImage, ...patch } }
        : s
    ),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setKeybinding: (actionId, chord) =>
    set((s) => {
      const normalized = chord.trim() === "" ? "" : normalizeChordString(chord);
      const next = { ...s.keybindings, [actionId]: normalized };
      persistKeybindings(next);
      return { keybindings: next };
    }),
  applyKeybindingPreset: (preset) => {
    const next = getPresetKeybindings(preset);
    persistKeybindings(next);
    set({ keybindings: next });
  },
  importKeybindingsJson: (json) => {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return false;
      }
      const imported: KeybindingMap = {};
      for (const [actionId, chord] of Object.entries(
        parsed as Record<string, unknown>
      )) {
        if (typeof chord !== "string") continue;
        imported[actionId] =
          chord.trim() === "" ? "" : normalizeChordString(chord);
      }
      const next: KeybindingMap = {
        ...PIXET_DEFAULT_KEYBINDINGS,
        ...migrateKeybindingIds(imported),
      };
      persistKeybindings(next);
      set({ keybindings: next });
      return true;
    } catch {
      return false;
    }
  },
  setKeybindingsModalOpen: (keybindingsModalOpen) =>
    set({ keybindingsModalOpen }),
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
    set((s) => {
      const areas = setTilesetDocked(s.areas, !s.tilesetBrowserDocked);
      savePanelLayout({ ...layoutOf(s), areas });
      return { areas, tilesetBrowserDocked: isTilesetDocked(areas) };
    }),
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
  setZoom: (zoom) =>
    set({ zoom: Math.max(1, Math.min(64, zoom)), zoomIsFit: false }),
  applyFitZoom: (zoom) =>
    set({ zoom: Math.max(1, Math.min(64, zoom)), zoomIsFit: true }),
  fitZoomToWindow: () =>
    set((s) => ({ zoomIsFit: true, viewResetNonce: s.viewResetNonce + 1 })),
  zoomActualSize: () =>
    set((s) => ({
      zoom: 1,
      zoomIsFit: false,
      viewResetNonce: s.viewResetNonce + 1,
    })),
  zoomStep: (direction) =>
    set((s) => ({
      zoom: Math.max(1, Math.min(64, stepZoom(s.zoom, direction))),
      zoomIsFit: false,
    })),
  setViewportSize: (size) =>
    set((s) =>
      s.viewportSize &&
      s.viewportSize.w === size.w &&
      s.viewportSize.h === size.h
        ? s
        : { viewportSize: size }
    ),
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

  setPrimaryColor: (primaryColor) =>
    set((s) => ({
      primaryColor,
      recentColors: addRecentColorList(s.recentColors, primaryColor),
    })),
  setSecondaryColor: (secondaryColor) => set({ secondaryColor }),
  setPrimaryAlpha: (alpha) =>
    set({
      primaryAlpha: Number.isFinite(alpha)
        ? Math.max(0, Math.min(255, Math.round(alpha)))
        : 255,
    }),
  togglePaletteLock: () => set((s) => ({ paletteLock: !s.paletteLock })),
  pushRecentColor: (hex) =>
    set((s) => ({
      recentColors: addRecentColorList(s.recentColors, hex),
    })),
  setColorPickerMode: (colorPickerMode) => set({ colorPickerMode }),
  swapColors: () =>
    set((s) => ({
      primaryColor: s.secondaryColor,
      secondaryColor: s.primaryColor,
    })),
  setPreviewScale: (previewScale) => set({ previewScale }),
  setHasSelection: (hasSelection) => set({ hasSelection }),
  setFreeTransformActive: (freeTransformActive) => set({ freeTransformActive }),
  setFreeTransformState: (freeTransformState) => set({ freeTransformState }),
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
  reorderPalette: (fromIdx, toIdx) =>
    set((s) => {
      if (
        fromIdx === toIdx ||
        fromIdx < 0 ||
        toIdx < 0 ||
        fromIdx >= s.palette.length ||
        toIdx >= s.palette.length
      ) {
        return s;
      }
      const next = s.palette.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { palette: next };
    }),
  replacePaletteColor: (index, hex) =>
    set((s) => {
      if (index < 0 || index >= s.palette.length) return s;
      const norm = normalizeHex6(hex) ?? hex.toLowerCase();
      if (s.palette[index]?.toLowerCase() === norm) return s;
      const next = s.palette.slice();
      next[index] = norm;
      return { palette: next };
    }),
  removePaletteColor: (index) =>
    set((s) => {
      if (s.palette.length <= 1 || index < 0 || index >= s.palette.length) {
        return s;
      }
      const next = s.palette.slice();
      next.splice(index, 1);
      return { palette: next };
    }),
  duplicatePaletteColor: (index) =>
    set((s) => {
      if (index < 0 || index >= s.palette.length) return s;
      const next = s.palette.slice();
      next.splice(index + 1, 0, s.palette[index]);
      return { palette: next };
    }),
  appendPaletteColors: (colors) =>
    set((s) => {
      const existing = new Set(s.palette.map((c) => c.toLowerCase()));
      const additions: string[] = [];
      for (const raw of colors) {
        const norm = normalizeHex6(raw) ?? raw.toLowerCase();
        if (!existing.has(norm)) {
          existing.add(norm);
          additions.push(norm);
        }
      }
      if (additions.length === 0) return s;
      return { palette: [...s.palette, ...additions] };
    }),

  selectLayer: (activeLayerId) =>
    set({
      activeLayerId,
      selectedLayerIds: [activeLayerId],
      selectedObjectId: null,
    }),
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
  toggleLayerClipped: (id) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, clipped: !l.clipped } : l
      ),
    })),
  setLayerColorTag: (id, color) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, colorTag: color } : l
      ),
    })),
  soloLayer: (id) =>
    set((s) => {
      const target = s.layers.find((l) => l.id === id);
      if (!target) return s;

      const byId = new Map(s.layers.map((l) => [l.id, l]));
      const allowedVisible = new Set<string>([id]);
      let curParent = target.parentId;
      const visited = new Set<string>([id]);
      while (curParent && !visited.has(curParent)) {
        visited.add(curParent);
        allowedVisible.add(curParent);
        curParent = byId.get(curParent)?.parentId ?? null;
      }

      const isAlreadySoloedOnId =
        s.soloVisibilitySnapshot !== null &&
        s.layers.every((l) =>
          allowedVisible.has(l.id) ? l.visible : !l.visible
        );

      if (isAlreadySoloedOnId) {
        const snapshot = s.soloVisibilitySnapshot!;
        return {
          layers: s.layers.map((l) => ({
            ...l,
            visible: snapshot[l.id] ?? l.visible,
          })),
          soloVisibilitySnapshot: null,
        };
      }

      const nextSnapshot: Record<string, boolean> =
        s.soloVisibilitySnapshot ?? {};
      if (!s.soloVisibilitySnapshot) {
        for (const l of s.layers) {
          nextSnapshot[l.id] = l.visible;
        }
      }

      return {
        layers: s.layers.map((l) => ({
          ...l,
          visible: allowedVisible.has(l.id),
        })),
        soloVisibilitySnapshot: nextSnapshot,
      };
    }),
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
    const defaultName =
      role === "normal"
        ? "Normal Map"
        : role === "height"
          ? "Height Map"
          : role === "depth"
            ? "Depth Map"
            : "Emission Map";
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
  addObjectLayer: () =>
    set((s) => {
      const id = `object-${layerCounter++}`;
      const active = s.layers.find((l) => l.id === s.activeLayerId);
      const newLayer: LayerItem = {
        id,
        name: `Objects ${s.layers.filter((l) => l.kind === "object").length + 1}`,
        kind: "object",
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
        selectedObjectId: null,
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
      const activeTag = s.activeTagId
        ? s.tags.find((t) => t.id === s.activeTagId)
        : undefined;
      const direction: TagDirection = activeTag?.direction ?? "forward";
      const step = computeNextPlaybackFrame(
        s.currentFrame,
        start,
        end,
        direction,
        s.playbackPingPongDir,
        s.loopPlayback
      );
      return {
        currentFrame: step.nextFrame,
        playbackPingPongDir: step.nextPingPongDir,
        isPlaying: step.stop ? false : s.isPlaying,
      };
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
  setOnionOpacity: (opacity) => {
    const clamped = Math.max(0.1, Math.min(0.8, opacity));
    set({
      onionOpacity: clamped,
      onionSkinOpacity: Math.round(clamped * 100),
    });
  },
  toggleOnionSkinTint: () =>
    set((s) => ({ onionSkinTint: !s.onionSkinTint })),
  setOnionSkinOpacity: (opacity) => {
    const clamped = Math.max(10, Math.min(80, Math.round(opacity) || 10));
    set({
      onionSkinOpacity: clamped,
      onionOpacity: clamped / 100,
    });
  },
  toggleOnionSkinInFront: () =>
    set((s) => ({ onionSkinInFront: !s.onionSkinInFront })),
  toggleOnionSkinLoopWrap: () =>
    set((s) => ({ onionSkinLoopWrap: !s.onionSkinLoopWrap })),
  toggleTimelineShowThumbs: () =>
    set((s) => ({ timelineShowThumbs: !s.timelineShowThumbs })),
  setSelectedCels: (selectedCels) => set({ selectedCels }),
  clearSelectedCels: () => set({ selectedCels: [] }),
  setActiveTagId: (activeTagId) =>
    set((s) => {
      if (!activeTagId) return { activeTagId: null, playbackPingPongDir: 1 };
      const tag = s.tags.find((t) => t.id === activeTagId);
      if (!tag) return { activeTagId: null, playbackPingPongDir: 1 };
      const dir = tag.direction ?? "forward";
      const initialDir: 1 | -1 = dir === "reverse" ? -1 : 1;
      const clampedFrame =
        s.currentFrame < tag.fromFrame || s.currentFrame > tag.toFrame
          ? dir === "reverse"
            ? tag.toFrame
            : tag.fromFrame
          : s.currentFrame;
      return {
        activeTagId,
        currentFrame: clampedFrame,
        playbackPingPongDir: initialDir,
      };
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
        selectedCels: [],
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
        selectedCels: [],
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
        selectedCels: [],
      };
    }),
  addTag: (name, fromFrame, toFrame, color, direction = "forward") =>
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
        direction,
      };
      return {
        tags: [...s.tags, newTag],
        activeTagId: newTag.id,
        currentFrame: direction === "reverse" ? hi : lo,
        playbackPingPongDir: direction === "reverse" ? -1 : 1,
      };
    }),
  setTagDirection: (id, direction) =>
    set((s) => ({
      tags: s.tags.map((t) => (t.id === id ? { ...t, direction } : t)),
      playbackPingPongDir:
        s.activeTagId === id ? (direction === "reverse" ? -1 : 1) : s.playbackPingPongDir,
    })),
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
    set((s) => {
      const right = clampDockWidth(width);
      savePanelWidths(right, s.leftPanelWidth);
      return { rightPanelWidth: right };
    }),
  setLeftPanelWidth: (width) =>
    set((s) => {
      const left = clampDockWidth(width);
      savePanelWidths(s.rightPanelWidth, left);
      return { leftPanelWidth: left };
    }),
  setTimelineHeight: (height) =>
    set({
      timelineHeight: clampTimelineHeight(height),
      timelineHeightManual: true,
    }),
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
  setDocumentDirty: (isDocumentDirty) =>
    set((s) => (s.isDocumentDirty === isDocumentDirty ? s : { isDocumentDirty })),
  setExportModalOpen: (exportModalOpen, mode) =>
    set(
      exportModalOpen
        ? { exportModalOpen, exportModalMode: mode ?? "sheet" }
        : { exportModalOpen }
    ),
  setRigExportModalOpen: (rigExportModalOpen) => set({ rigExportModalOpen }),
  setRotate3dModalOpen: (open) =>
    set((s) =>
      open
        ? { workspaceMode: "studio3d", rotate3dModalOpen: false }
        : { rotate3dModalOpen: false, workspaceMode: s.workspaceMode }
    ),
  setNewSpriteModalOpen: (newSpriteModalOpen) => set({ newSpriteModalOpen }),
  setStartScreenOpen: (startScreenOpen) => set({ startScreenOpen }),
  setCanvasSizeModalOpen: (canvasSizeModalOpen) => set({ canvasSizeModalOpen }),
  setFilterModalOpen: (filterModalOpen, tab) =>
    set((s) => ({
      filterModalOpen,
      filterModalTab: tab ?? s.filterModalTab,
    })),
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
  toggleRigWeightAirbrush: () =>
    set((s) => ({ rigWeightAirbrush: !s.rigWeightAirbrush })),
  setRigWeightSubTool: (rigWeightSubTool) => set({ rigWeightSubTool }),
  setRigWeightFloodTolerance: (tolerance) =>
    set({
      rigWeightFloodTolerance: Math.max(0, Math.min(255, Math.round(tolerance))),
    }),
  toggleRigWeightFloodContiguous: () =>
    set((s) => ({
      rigWeightFloodContiguous: !s.rigWeightFloodContiguous,
    })),
  toggleRigWeightMirrorX: () =>
    set((s) => ({ rigWeightMirrorX: !s.rigWeightMirrorX })),
  toggleRigWeightMirrorY: () =>
    set((s) => ({ rigWeightMirrorY: !s.rigWeightMirrorY })),
  setInspectedWeightPixel: (inspectedWeightPixel) =>
    set({ inspectedWeightPixel }),
  setRigAutoWeightMethod: (rigAutoWeightMethod) => set({ rigAutoWeightMethod }),
  setRigAutoWeightPower: (power) =>
    set({ rigAutoWeightPower: Math.max(0.5, Math.min(6, power)) }),
  setRigAutoWeightColorPenalty: (penalty) =>
    set({ rigAutoWeightColorPenalty: Math.max(0, Math.min(2, penalty)) }),
  toggleRigAutoWeightSelectedOnly: () =>
    set((s) => ({ rigAutoWeightSelectedOnly: !s.rigAutoWeightSelectedOnly })),
  toggleRigAutoWeightRespectSelection: () =>
    set((s) => ({
      rigAutoWeightRespectSelection: !s.rigAutoWeightRespectSelection,
    })),
  toggleRigCleanupOrphans: () =>
    set((s) => ({ rigCleanupOrphans: !s.rigCleanupOrphans })),
  toggleRigCleanupHoles: () =>
    set((s) => ({ rigCleanupHoles: !s.rigCleanupHoles })),
  toggleRigCleanupPaletteLock: () =>
    set((s) => ({ rigCleanupPaletteLock: !s.rigCleanupPaletteLock })),
  toggleRigCleanupOutline: () =>
    set((s) => ({ rigCleanupOutline: !s.rigCleanupOutline })),
  toggleRigAutoZSort: () => set((s) => ({ rigAutoZSort: !s.rigAutoZSort })),
  toggleRigDirectionalLighting: () =>
    set((s) => ({ rigDirectionalLighting: !s.rigDirectionalLighting })),
  setRigPerspective3d: (v) =>
    set({ rigPerspective3d: Math.max(0, Math.min(1, v)) }),
  setDataTool: (dataTool) => set({ dataTool, dataToolActive: true }),
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
      light2dType: patch.lightType ?? s.light2dType,
      light2dAmbientColor: patch.ambientColor ?? s.light2dAmbientColor,
      light2dSpecular: patch.specular ?? s.light2dSpecular,
      light2dShininess: patch.shininess ?? s.light2dShininess,
      light2dHeightScale: patch.heightScale ?? s.light2dHeightScale,
      light2dAo: patch.ao ?? s.light2dAo,
      light2dCelSteps: patch.celSteps ?? s.light2dCelSteps,
      light2dAutoNormal: patch.autoNormal ?? s.light2dAutoNormal,
    })),
  setPaletteLutEnabled: (paletteLutEnabled) => set({ paletteLutEnabled }),
  setPaletteLutPresetName: (paletteLutPresetName) =>
    set({ paletteLutPresetName }),
  detachPanel: (id, initial) =>
    set((s) => {
      const next = detachPanelState(layoutOf(s), id, initial);
      savePanelLayout(next);
      return next;
    }),
  dockPanel: (id, targetIndex) =>
    set((s) => {
      const next = dockPanelState(layoutOf(s), id, targetIndex);
      savePanelLayout(next);
      return next;
    }),
  placePanel: (id, side, beforeId) =>
    set((s) => {
      const next = placePanelState(layoutOf(s), id, side, beforeId);
      savePanelLayout(next);
      return next;
    }),
  setPanelSide: (id, side) =>
    set((s) => {
      const next = setPanelSideState(layoutOf(s), id, side);
      if (next.panelSides === s.panelSides) return s;
      savePanelLayout(next);
      return { panelSides: next.panelSides };
    }),
  togglePanelHidden: (id) =>
    set((s) => {
      const next = togglePanelHiddenState(layoutOf(s), id);
      savePanelLayout(next);
      return { hiddenPanels: next.hiddenPanels };
    }),
  setPanelHidden: (id, hidden) =>
    set((s) => {
      const next = setPanelHiddenState(layoutOf(s), id, hidden);
      if (next.hiddenPanels === s.hiddenPanels) return s;
      savePanelLayout(next);
      return { hiddenPanels: next.hiddenPanels };
    }),
  resetWorkspaceLayout: (mode) =>
    set((s) => {
      const next = resetWorkspaceLayoutState(layoutOf(s), mode);
      savePanelLayout(next);
      return { ...next, tilesetBrowserDocked: isTilesetDocked(next.areas) };
    }),
  setSidebarAreaEditor: (mode, id) =>
    set((s) => commitAreas(s, setSidebarEditor(s.areas, mode, id))),
  setBottomAreaEditor: (mode, index, id) =>
    set((s) => commitAreas(s, setBottomEditor(s.areas, mode, index, id))),
  splitBottomArea: (mode) =>
    set((s) => commitAreas(s, splitBottomArea(s.areas, mode))),
  joinBottomArea: (mode, closeIndex) =>
    set((s) => commitAreas(s, joinBottomArea(s.areas, mode, closeIndex))),
  setBottomSplitRatio: (mode, ratio) =>
    set((s) => commitAreas(s, setBottomSplitRatio(s.areas, mode, ratio))),
  setBottomAreaVisible: (mode, visible) =>
    set((s) => commitAreas(s, setBottomVisible(s.areas, mode, visible))),
  toggleBottomAreaVisible: (mode, timelineAllowed) =>
    set((s) => commitAreas(s, toggleBottomArea(s.areas, mode, timelineAllowed))),
  dockAllPanels: () =>
    set((s) => {
      const next = dockAllPanelsState(layoutOf(s));
      savePanelLayout(next);
      return next;
    }),
  updateFloatingPanelRect: (id, patch) =>
    set((s) => {
      const cur = s.detachedPanels[id];
      if (!cur) return s;
      const next: PanelLayoutState = {
        ...layoutOf(s),
        detachedPanels: { ...s.detachedPanels, [id]: { ...cur, ...patch } },
      };
      savePanelLayout(next);
      return { detachedPanels: next.detachedPanels };
    }),
  toggleFloatingPanelCollapsed: (id) =>
    set((s) => {
      const cur = s.detachedPanels[id];
      if (!cur) return s;
      const next: PanelLayoutState = {
        ...layoutOf(s),
        detachedPanels: {
          ...s.detachedPanels,
          [id]: { ...cur, collapsed: !cur.collapsed },
        },
      };
      savePanelLayout(next);
      return { detachedPanels: next.detachedPanels };
    }),
  toggleFloatingPanelPinned: (id) =>
    set((s) => {
      const cur = s.detachedPanels[id];
      if (!cur) return s;
      const next: PanelLayoutState = {
        ...layoutOf(s),
        detachedPanels: {
          ...s.detachedPanels,
          [id]: { ...cur, pinned: !cur.pinned },
        },
      };
      savePanelLayout(next);
      return { detachedPanels: next.detachedPanels };
    }),
  bringFloatingPanelToFront: (id) =>
    set((s) => {
      const next = bringPanelToFrontState(layoutOf(s), id);
      if (next.detachedPanels === s.detachedPanels) return s;
      savePanelLayout(next);
      return { detachedPanels: next.detachedPanels };
    }),
  reorderDockedPanel: (mode, id, toIndex) =>
    set((s) => {
      const next = reorderDockedPanelState(layoutOf(s), mode, id, toIndex);
      savePanelLayout(next);
      return { dockedPanelOrder: next.dockedPanelOrder };
    }),
  resetPanelLayout: () =>
    set(() => {
      const next = createDefaultPanelLayout();
      savePanelLayout(next);
      return { ...next, tilesetBrowserDocked: isTilesetDocked(next.areas) };
    }),
  saveCurrentLayout: (name) =>
    set((s) => {
      const snapshot = createLayoutSnapshot(layoutOf(s), {
        rightPanelWidth: s.rightPanelWidth,
        leftPanelWidth: s.leftPanelWidth,
        timelineHeight: s.timelineHeight,
      });
      const list = upsertSavedLayout(s.savedLayouts, name, snapshot);
      if (list === s.savedLayouts) return s;
      persistSavedLayouts(list);
      return { savedLayouts: list };
    }),
  applySavedLayout: (name) =>
    set((s) => {
      const entry = s.savedLayouts.find(
        (l) => l.name.toLowerCase() === name.toLowerCase()
      );
      if (!entry) return s;
      const snap = applyLayoutSnapshot(entry.snapshot);
      savePanelLayout(snap.panelLayout);
      savePanelWidths(snap.rightPanelWidth, snap.leftPanelWidth);
      return {
        ...snap.panelLayout,
        rightPanelWidth: snap.rightPanelWidth,
        leftPanelWidth: snap.leftPanelWidth,
        timelineHeight: snap.timelineHeight,
        timelineHeightManual: true,
        tilesetBrowserDocked: isTilesetDocked(snap.panelLayout.areas),
      };
    }),
  deleteSavedLayoutByName: (name) =>
    set((s) => {
      const list = deleteSavedLayout(s.savedLayouts, name);
      persistSavedLayouts(list);
      return { savedLayouts: list };
    }),
  setSaveLayoutModalOpen: (open) => set({ saveLayoutModalOpen: open }),
  loadProjectState: (payload) =>
    set({
      zoomIsFit: true,
      viewResetNonce: get().viewResetNonce + 1,
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
      soloVisibilitySnapshot: null,
      frames: payload.frames,
      currentFrame: 0,
      tags: payload.tags,
      guides: payload.guides ?? [],
      activeTagId: null,
      playbackPingPongDir: 1,
      selectedCels: [],
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
