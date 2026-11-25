export type PanelWorkspace = "draw" | "tiles" | "rig" | "studio3d" | "data";

export type PanelId =
  | "color-palette"
  | "layers"
  | "game-data"
  | "tiles-browser"
  | "tiles-props"
  | "tiles-terrain"
  | "tiles-layers"
  | "tiles-map-props"
  | "rig-bone-tree"
  | "rig-bone-props"
  | "rig-constraints"
  | "rig-slots"
  | "rig-weights"
  | "rig-clips-poses"
  | "rig-render"
  | "rig-bound-layers";

export const PANEL_WORKSPACE_MAP: Record<PanelId, PanelWorkspace> = {
  "color-palette": "draw",
  layers: "draw",
  "game-data": "data",
  "tiles-browser": "tiles",
  "tiles-props": "tiles",
  "tiles-terrain": "tiles",
  "tiles-layers": "tiles",
  "tiles-map-props": "tiles",
  "rig-bone-tree": "rig",
  "rig-bone-props": "rig",
  "rig-constraints": "rig",
  "rig-slots": "rig",
  "rig-weights": "rig",
  "rig-clips-poses": "rig",
  "rig-render": "rig",
  "rig-bound-layers": "rig",
};

export const DEFAULT_DOCKED_ORDER: Record<PanelWorkspace, PanelId[]> = {
  draw: ["color-palette", "layers"],
  tiles: [
    "tiles-browser",
    "tiles-props",
    "tiles-terrain",
    "tiles-layers",
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
  data: ["game-data", "color-palette", "layers"],
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

export interface PanelLayoutState {
  detachedPanels: Partial<Record<PanelId, FloatingPanelRect>>;
  dockedPanelOrder: Record<PanelWorkspace, PanelId[]>;
}

export function createDefaultPanelLayout(): PanelLayoutState {
  return {
    detachedPanels: {},
    dockedPanelOrder: {
      draw: [...DEFAULT_DOCKED_ORDER.draw],
      tiles: [...DEFAULT_DOCKED_ORDER.tiles],
      rig: [...DEFAULT_DOCKED_ORDER.rig],
      studio3d: [...DEFAULT_DOCKED_ORDER.studio3d],
      data: [...DEFAULT_DOCKED_ORDER.data],
    },
  };
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
  targetIndex?: number
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
    detachedPanels: nextDetached,
    dockedPanelOrder: {
      ...state.dockedPanelOrder,
      [ws]: filtered,
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

export function deserializePanelLayout(raw: string | null): PanelLayoutState {
  const def = createDefaultPanelLayout();
  if (!raw) return def;
  try {
    const parsed = JSON.parse(raw) as Partial<PanelLayoutState>;
    if (!parsed || typeof parsed !== "object") return def;

    const validIds = new Set<string>(Object.keys(PANEL_WORKSPACE_MAP));
    const detachedPanels: Partial<Record<PanelId, FloatingPanelRect>> = {};
    if (parsed.detachedPanels && typeof parsed.detachedPanels === "object") {
      for (const [k, v] of Object.entries(parsed.detachedPanels)) {
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
    if (parsed.dockedPanelOrder && typeof parsed.dockedPanelOrder === "object") {
      for (const ws of ["draw", "tiles", "rig", "data"] as const) {
        const rawList = parsed.dockedPanelOrder[ws];
        if (!Array.isArray(rawList)) continue;
        const defaultList = DEFAULT_DOCKED_ORDER[ws];
        const allowed = new Set(defaultList);
        const merged: PanelId[] = [];
        for (const item of rawList) {
          if (
            typeof item === "string" &&
            allowed.has(item as PanelId) &&
            !merged.includes(item as PanelId)
          ) {
            merged.push(item as PanelId);
          }
        }
        for (const d of defaultList) {
          if (!merged.includes(d)) merged.push(d);
        }
        dockedPanelOrder[ws] = merged;
      }
    }

    return { detachedPanels, dockedPanelOrder };
  } catch {
    return def;
  }
}
