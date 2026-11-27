import {
  createDefaultAreas,
  resetAreas,
  sanitizeAreas,
  type AreasState,
} from "./areaEditors.ts";

export type PanelWorkspace = "draw" | "tiles" | "rig" | "studio3d" | "nodes" | "data";

export type PanelId =
  | "color-palette"
  | "brush"
  | "reference"
  | "history"
  | "layers"
  | "game-data"
  | "tiles-browser"
  | "tiles-props"
  | "tiles-terrain"
  | "tiles-layers"
  | "tiles-objects"
  | "tiles-map-props"
  | "rig-bone-tree"
  | "rig-bone-props"
  | "rig-constraints"
  | "rig-slots"
  | "rig-weights"
  | "rig-clips-poses"
  | "rig-render"
  | "rig-bound-layers"
  | "nodes-preview"
  | "nodes-inspector";

export const PANEL_WORKSPACE_MAP: Record<PanelId, PanelWorkspace> = {
  "color-palette": "draw",
  brush: "draw",
  reference: "draw",
  history: "draw",
  layers: "draw",
  "game-data": "draw",
  "tiles-browser": "tiles",
  "tiles-props": "tiles",
  "tiles-terrain": "tiles",
  "tiles-layers": "tiles",
  "tiles-objects": "tiles",
  "tiles-map-props": "tiles",
  "rig-bone-tree": "rig",
  "rig-bone-props": "rig",
  "rig-constraints": "rig",
  "rig-slots": "rig",
  "rig-weights": "rig",
  "rig-clips-poses": "rig",
  "rig-render": "rig",
  "rig-bound-layers": "rig",
  "nodes-preview": "nodes",
  "nodes-inspector": "nodes",
};

/** Short names for menus (panel headers may add counts etc.). */
export const PANEL_TITLES: Record<PanelId, string> = {
  "color-palette": "Color & Palette",
  brush: "Brush & Ink",
  reference: "Reference",
  history: "History",
  layers: "Layers",
  "game-data": "Game Data",
  "tiles-browser": "Tileset",
  "tiles-props": "Tile Properties",
  "tiles-terrain": "Terrains & Auto-Tile",
  "tiles-layers": "Map Layers",
  "tiles-objects": "Objects",
  "tiles-map-props": "Map Properties",
  "rig-bone-tree": "Bone Tree",
  "rig-bone-props": "Bone Properties",
  "rig-constraints": "Constraints",
  "rig-slots": "Slots & Attachments",
  "rig-weights": "Weights",
  "rig-clips-poses": "Clips & Poses",
  "rig-render": "Render",
  "rig-bound-layers": "Bound Layers",
  "nodes-preview": "Preview",
  "nodes-inspector": "Inspector",
};

export const DEFAULT_DOCKED_ORDER: Record<PanelWorkspace, PanelId[]> = {
  draw: ["color-palette", "brush", "reference", "history", "layers", "game-data"],
  tiles: [
    "tiles-browser",
    "tiles-props",
    "tiles-terrain",
    "tiles-layers",
    "tiles-objects",
    "tiles-map-props",
  ],
  rig: [
    "rig-bone-tree",
    "rig-bone-props",
    "rig-constraints",
    "rig-slots",
    "rig-weights",
    "rig-clips-poses",
    "rig-render",
    "rig-bound-layers",
  ],
  studio3d: [],
  nodes: ["nodes-preview", "nodes-inspector"],
  data: [], // legacy: folded into draw
};

export interface FloatingPanelRect {
  x: number;
  y: number;
  width: number;
  height: number | null;
  collapsed: boolean;
  pinned: boolean;
  zOrder: number;
}

export type DockSide = "left" | "right";

export interface PanelLayoutState {
  detachedPanels: Partial<Record<PanelId, FloatingPanelRect>>;
  /** One ordered list per workspace; shared by both dock columns. */
  dockedPanelOrder: Record<PanelWorkspace, PanelId[]>;
  /** Which dock column a docked panel lives in. Missing means "right". */
  panelSides: Partial<Record<PanelId, DockSide>>;
  /** Hidden panels render nothing. Only `true` entries are stored. */
  hiddenPanels: Partial<Record<PanelId, boolean>>;
  /** Swappable area editors (bottom strip + sidebar) per workspace. */
  areas: AreasState;
}

export const MIN_DOCK_WIDTH = 230;
export const MAX_DOCK_WIDTH = 420;
export const DEFAULT_RIGHT_PANEL_WIDTH = 276;
export const DEFAULT_LEFT_PANEL_WIDTH = 276;
export const MIN_TIMELINE_HEIGHT = 120;
export const MAX_TIMELINE_HEIGHT = 360;
export const DEFAULT_TIMELINE_HEIGHT = 204;

const ALL_WORKSPACES: PanelWorkspace[] = [
  "draw",
  "tiles",
  "rig",
  "studio3d",
  "nodes",
  "data",
];

export function clampDockWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_RIGHT_PANEL_WIDTH;
  return Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, Math.round(width)));
}

export function clampTimelineHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_TIMELINE_HEIGHT;
  return Math.max(
    MIN_TIMELINE_HEIGHT,
    Math.min(MAX_TIMELINE_HEIGHT, Math.round(height))
  );
}

export function createDefaultPanelLayout(): PanelLayoutState {
  return {
    detachedPanels: {},
    dockedPanelOrder: {
      draw: [...DEFAULT_DOCKED_ORDER.draw],
      tiles: [...DEFAULT_DOCKED_ORDER.tiles],
      rig: [...DEFAULT_DOCKED_ORDER.rig],
      studio3d: [...DEFAULT_DOCKED_ORDER.studio3d],
      nodes: [...DEFAULT_DOCKED_ORDER.nodes],
      data: [...DEFAULT_DOCKED_ORDER.data],
    },
    panelSides: {},
    hiddenPanels: {},
    areas: createDefaultAreas(),
  };
}

export function getPanelSide(state: Pick<PanelLayoutState, "panelSides">, id: PanelId): DockSide {
  return state.panelSides[id] === "left" ? "left" : "right";
}

export function isPanelHidden(
  state: Pick<PanelLayoutState, "hiddenPanels">,
  id: PanelId
): boolean {
  return state.hiddenPanels[id] === true;
}

/** Panels of a workspace in their current order (drops ids not in the map). */
export function panelsOfWorkspace(
  state: Pick<PanelLayoutState, "dockedPanelOrder">,
  ws: PanelWorkspace
): PanelId[] {
  return [...(state.dockedPanelOrder[ws] ?? DEFAULT_DOCKED_ORDER[ws])];
}

/**
 * True when `ws` has at least one visible panel docked (not floating, not
 * hidden) in the given column.
 */
export function workspaceHasDockedOnSide(
  state: PanelLayoutState,
  ws: PanelWorkspace,
  side: DockSide
): boolean {
  return panelsOfWorkspace(state, ws).some(
    (id) =>
      !state.detachedPanels[id] &&
      !isPanelHidden(state, id) &&
      getPanelSide(state, id) === side
  );
}

export function getMaxZOrder(
  detached: Partial<Record<PanelId, FloatingPanelRect>>
): number {
  let max = 0;
  for (const rect of Object.values(detached)) {
    if (rect && rect.zOrder > max) max = rect.zOrder;
  }
  return max;
}

export function clampFloatingRect(
  rect: FloatingPanelRect,
  boundsW: number,
  boundsH: number
): FloatingPanelRect {
  const safeW = Math.max(210, boundsW);
  const safeH = Math.max(110, boundsH);
  const width = Math.max(210, Math.min(480, Math.min(safeW, Math.round(rect.width))));
  const height =
    rect.height === null
      ? null
      : Math.max(110, Math.min(safeH, Math.round(rect.height)));
  const maxX = Math.max(0, safeW - width);
  const effectiveH = height ?? 160;
  const maxY = Math.max(0, safeH - Math.min(effectiveH, safeH));

  return {
    ...rect,
    width,
    height,
    x: Math.max(0, Math.min(maxX, Math.round(rect.x))),
    y: Math.max(0, Math.min(maxY, Math.round(rect.y))),
  };
}

export function detachPanelState(
  state: PanelLayoutState,
  id: PanelId,
  initial?: Partial<Pick<FloatingPanelRect, "x" | "y" | "width">>
): PanelLayoutState {
  const existing = state.detachedPanels[id];
  const nextZ = getMaxZOrder(state.detachedPanels) + 1;
  const count = Object.keys(state.detachedPanels).length;
  const rect: FloatingPanelRect = existing
    ? { ...existing, zOrder: nextZ }
    : {
        x: initial?.x ?? 24 + (count % 6) * 20,
        y: initial?.y ?? 24 + (count % 6) * 20,
        width: Math.max(210, Math.min(480, initial?.width ?? 270)),
        height: null,
        collapsed: false,
        pinned: false,
        zOrder: nextZ,
      };

  return {
    ...state,
    detachedPanels: {
      ...state.detachedPanels,
      [id]: rect,
    },
  };
}

export function dockPanelState(
  state: PanelLayoutState,
  id: PanelId,
  targetIndex?: number,
  side?: DockSide
): PanelLayoutState {
  if (!state.detachedPanels[id]) return state;
  const nextDetached = { ...state.detachedPanels };
  delete nextDetached[id];

  const ws = PANEL_WORKSPACE_MAP[id];
  const currentOrder = state.dockedPanelOrder[ws] ?? DEFAULT_DOCKED_ORDER[ws];
  const filtered = currentOrder.filter((p) => p !== id);
  if (targetIndex !== undefined) {
    const clampedIdx = Math.max(0, Math.min(filtered.length, targetIndex));
    filtered.splice(clampedIdx, 0, id);
  } else {
    filtered.push(id);
  }

  return {
    ...state,
    detachedPanels: nextDetached,
    dockedPanelOrder: {
      ...state.dockedPanelOrder,
      [ws]: filtered,
    },
    panelSides: side ? withSide(state.panelSides, id, side) : state.panelSides,
  };
}

function withSide(
  sides: PanelLayoutState["panelSides"],
  id: PanelId,
  side: DockSide
): PanelLayoutState["panelSides"] {
  const next = { ...sides };
  if (side === "left") next[id] = "left";
  else delete next[id];
  return next;
}

/**
 * Place a panel (docked or floating) into a dock column, immediately before
 * `beforeId`, or at the end of that column when `beforeId` is null/absent.
 */
export function placePanelState(
  state: PanelLayoutState,
  id: PanelId,
  side: DockSide,
  beforeId?: PanelId | null
): PanelLayoutState {
  const ws = PANEL_WORKSPACE_MAP[id];
  const nextDetached = { ...state.detachedPanels };
  delete nextDetached[id];
  const nextSides = withSide(state.panelSides, id, side);
  const list = panelsOfWorkspace(state, ws).filter((p) => p !== id);

  let at = beforeId ? list.indexOf(beforeId) : -1;
  if (at === -1) {
    // End of the destination column: right after its last member.
    let last = -1;
    list.forEach((p, i) => {
      if (getPanelSide({ panelSides: nextSides }, p) === side) last = i;
    });
    at = last === -1 ? list.length : last + 1;
  }
  list.splice(at, 0, id);

  return {
    ...state,
    detachedPanels: nextDetached,
    panelSides: nextSides,
    dockedPanelOrder: { ...state.dockedPanelOrder, [ws]: list },
  };
}

export function setPanelSideState(
  state: PanelLayoutState,
  id: PanelId,
  side: DockSide
): PanelLayoutState {
  if (getPanelSide(state, id) === side) return state;
  return { ...state, panelSides: withSide(state.panelSides, id, side) };
}

export function setPanelHiddenState(
  state: PanelLayoutState,
  id: PanelId,
  hidden: boolean
): PanelLayoutState {
  if (isPanelHidden(state, id) === hidden) return state;
  const next = { ...state.hiddenPanels };
  if (hidden) next[id] = true;
  else delete next[id];
  return { ...state, hiddenPanels: next };
}

export function togglePanelHiddenState(
  state: PanelLayoutState,
  id: PanelId
): PanelLayoutState {
  return setPanelHiddenState(state, id, !isPanelHidden(state, id));
}

/** Reset order, side, floating and hidden state for one workspace's panels. */
export function resetWorkspaceLayoutState(
  state: PanelLayoutState,
  ws: PanelWorkspace
): PanelLayoutState {
  const inWs = (id: string) => PANEL_WORKSPACE_MAP[id as PanelId] === ws;
  const keep = <T,>(rec: Partial<Record<PanelId, T>>) => {
    const out: Partial<Record<PanelId, T>> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (!inWs(k)) out[k as PanelId] = v as T;
    }
    return out;
  };
  return {
    detachedPanels: keep(state.detachedPanels),
    panelSides: keep(state.panelSides),
    hiddenPanels: keep(state.hiddenPanels),
    areas: resetAreas(state.areas, ws),
    dockedPanelOrder: {
      ...state.dockedPanelOrder,
      [ws]: [...DEFAULT_DOCKED_ORDER[ws]],
    },
  };
}

export function dockAllPanelsState(state: PanelLayoutState): PanelLayoutState {
  return {
    ...state,
    detachedPanels: {},
  };
}

export function bringPanelToFrontState(
  state: PanelLayoutState,
  id: PanelId
): PanelLayoutState {
  const rect = state.detachedPanels[id];
  if (!rect) return state;
  const maxZ = getMaxZOrder(state.detachedPanels);
  if (rect.zOrder === maxZ && maxZ > 0) return state;
  return {
    ...state,
    detachedPanels: {
      ...state.detachedPanels,
      [id]: { ...rect, zOrder: maxZ + 1 },
    },
  };
}

export function reorderDockedPanelState(
  state: PanelLayoutState,
  workspace: PanelWorkspace,
  id: PanelId,
  toIndex: number
): PanelLayoutState {
  const list = [...(state.dockedPanelOrder[workspace] ?? DEFAULT_DOCKED_ORDER[workspace])];
  const fromIndex = list.indexOf(id);
  if (fromIndex === -1) return state;
  const clampedTo = Math.max(0, Math.min(list.length - 1, toIndex));
  if (fromIndex === clampedTo) return state;
  list.splice(fromIndex, 1);
  list.splice(clampedTo, 0, id);

  return {
    ...state,
    dockedPanelOrder: {
      ...state.dockedPanelOrder,
      [workspace]: list,
    },
  };
}

export function serializePanelLayout(state: PanelLayoutState): string {
  return JSON.stringify(state);
}

/**
 * Merge a persisted order with the current defaults. Unknown/duplicate ids are
 * dropped; panels added since the layout was saved are slotted in right after
 * their predecessor in the default order, so an untouched old layout keeps the
 * default visual order.
 */
function mergeOrder(rawList: unknown[], defaultList: PanelId[]): PanelId[] {
  const allowed = new Set<string>(defaultList);
  const merged: PanelId[] = [];
  for (const item of rawList) {
    if (
      typeof item === "string" &&
      allowed.has(item) &&
      !merged.includes(item as PanelId)
    ) {
      merged.push(item as PanelId);
    }
  }
  defaultList.forEach((d, i) => {
    if (merged.includes(d)) return;
    // Predecessors were already placed, so the previous default is present.
    const prev = i > 0 ? merged.indexOf(defaultList[i - 1]) : -1;
    merged.splice(prev + 1, 0, d);
  });
  return merged;
}

function parsePanelLayoutObject(parsed: unknown): PanelLayoutState {
  const def = createDefaultPanelLayout();
  if (!parsed || typeof parsed !== "object") return def;
  const src = parsed as Partial<PanelLayoutState>;

  const validIds = new Set<string>(Object.keys(PANEL_WORKSPACE_MAP));
  const detachedPanels: Partial<Record<PanelId, FloatingPanelRect>> = {};
  if (src.detachedPanels && typeof src.detachedPanels === "object") {
    for (const [k, v] of Object.entries(src.detachedPanels)) {
      if (!validIds.has(k) || !v || typeof v !== "object") continue;
      const r = v as Partial<FloatingPanelRect>;
      detachedPanels[k as PanelId] = {
        x: typeof r.x === "number" && Number.isFinite(r.x) ? r.x : 24,
        y: typeof r.y === "number" && Number.isFinite(r.y) ? r.y : 24,
        width:
          typeof r.width === "number" && Number.isFinite(r.width)
            ? Math.max(210, Math.min(480, r.width))
            : 270,
        height:
          typeof r.height === "number" && Number.isFinite(r.height)
            ? Math.max(110, r.height)
            : null,
        collapsed: Boolean(r.collapsed),
        pinned: Boolean(r.pinned),
        zOrder:
          typeof r.zOrder === "number" && Number.isFinite(r.zOrder)
            ? r.zOrder
            : 1,
      };
    }
  }

  const dockedPanelOrder = { ...def.dockedPanelOrder };
  if (src.dockedPanelOrder && typeof src.dockedPanelOrder === "object") {
    for (const ws of ALL_WORKSPACES) {
      const rawList = (src.dockedPanelOrder as Record<string, unknown>)[ws];
      if (!Array.isArray(rawList)) continue;
      dockedPanelOrder[ws] = mergeOrder(rawList, DEFAULT_DOCKED_ORDER[ws]);
    }
  }

  const panelSides: PanelLayoutState["panelSides"] = {};
  if (src.panelSides && typeof src.panelSides === "object") {
    for (const [k, v] of Object.entries(src.panelSides)) {
      if (validIds.has(k) && v === "left") panelSides[k as PanelId] = "left";
    }
  }

  const hiddenPanels: PanelLayoutState["hiddenPanels"] = {};
  if (src.hiddenPanels && typeof src.hiddenPanels === "object") {
    for (const [k, v] of Object.entries(src.hiddenPanels)) {
      if (validIds.has(k) && v === true) hiddenPanels[k as PanelId] = true;
    }
  }

  return {
    detachedPanels,
    dockedPanelOrder,
    panelSides,
    hiddenPanels,
    areas: sanitizeAreas(src.areas),
  };
}

/** Accepts the legacy format (no sides/hidden) and yields defaults for them. */
export function deserializePanelLayout(raw: string | null): PanelLayoutState {
  if (!raw) return createDefaultPanelLayout();
  try {
    return parsePanelLayoutObject(JSON.parse(raw));
  } catch {
    return createDefaultPanelLayout();
  }
}

// ---------------------------------------------------------------------------
// Saved named layouts

export interface LayoutSnapshot {
  panelLayout: PanelLayoutState;
  rightPanelWidth: number;
  leftPanelWidth: number;
  timelineHeight: number;
}

export interface SavedLayout {
  name: string;
  savedAt: number;
  snapshot: LayoutSnapshot;
}

export const MAX_SAVED_LAYOUTS = 24;
export const MAX_LAYOUT_NAME_LENGTH = 40;

function cloneLayout(state: PanelLayoutState): PanelLayoutState {
  return parsePanelLayoutObject(JSON.parse(JSON.stringify(state)));
}

export function createLayoutSnapshot(
  panelLayout: PanelLayoutState,
  sizes: {
    rightPanelWidth: number;
    leftPanelWidth: number;
    timelineHeight: number;
  }
): LayoutSnapshot {
  return {
    panelLayout: cloneLayout(panelLayout),
    rightPanelWidth: clampDockWidth(sizes.rightPanelWidth),
    leftPanelWidth: clampDockWidth(sizes.leftPanelWidth),
    timelineHeight: clampTimelineHeight(sizes.timelineHeight),
  };
}

/** Validated copy of a snapshot, ready to replace the live layout. */
export function applyLayoutSnapshot(snapshot: LayoutSnapshot): LayoutSnapshot {
  return createLayoutSnapshot(snapshot.panelLayout, snapshot);
}

export function normalizeLayoutName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_LAYOUT_NAME_LENGTH);
}

export function upsertSavedLayout(
  list: SavedLayout[],
  name: string,
  snapshot: LayoutSnapshot,
  now: number = Date.now()
): SavedLayout[] {
  const clean = normalizeLayoutName(name);
  if (!clean) return list;
  const entry: SavedLayout = { name: clean, savedAt: now, snapshot };
  const idx = list.findIndex((l) => l.name.toLowerCase() === clean.toLowerCase());
  if (idx !== -1) {
    const next = [...list];
    next[idx] = entry;
    return next;
  }
  return [...list, entry].slice(-MAX_SAVED_LAYOUTS);
}

export function deleteSavedLayout(list: SavedLayout[], name: string): SavedLayout[] {
  const key = name.toLowerCase();
  return list.filter((l) => l.name.toLowerCase() !== key);
}

export function serializeSavedLayouts(list: SavedLayout[]): string {
  return JSON.stringify(list);
}

export function deserializeSavedLayouts(raw: string | null): SavedLayout[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    let out: SavedLayout[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const r = item as Partial<SavedLayout> & { snapshot?: Partial<LayoutSnapshot> };
      if (typeof r.name !== "string") continue;
      const snap = r.snapshot;
      if (!snap || typeof snap !== "object") continue;
      const num = (v: unknown, fallback: number) =>
        typeof v === "number" && Number.isFinite(v) ? v : fallback;
      out = upsertSavedLayout(
        out,
        r.name,
        createLayoutSnapshot(parsePanelLayoutObject(snap.panelLayout), {
          rightPanelWidth: num(snap.rightPanelWidth, DEFAULT_RIGHT_PANEL_WIDTH),
          leftPanelWidth: num(snap.leftPanelWidth, DEFAULT_LEFT_PANEL_WIDTH),
          timelineHeight: num(snap.timelineHeight, DEFAULT_TIMELINE_HEIGHT),
        }),
        num(r.savedAt, 0)
      );
    }
    return out;
  } catch {
    return [];
  }
}
