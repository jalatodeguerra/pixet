import type { PanelWorkspace } from "./panelLayout.ts";

/**
 * Swappable "area editors": the contents of the bottom strip and the right
 * sidebar can be switched between a few editor types (Blender style). Pure
 * data + helpers; the React component map lives in src/components/areas.
 */
export type AreaEditorId = "timeline" | "curves" | "tileset" | "preview" | "panels";
export type AreaSlot = "bottom" | "sidebar";

export interface AreaEditorDef {
  id: AreaEditorId;
  label: string;
  /** Key into the icon map in components/areas. */
  icon: string;
  workspaces: PanelWorkspace[];
  slots: AreaSlot[];
}

const SPRITE_WS: PanelWorkspace[] = ["draw", "tiles", "rig", "studio3d", "data"];
const ALL_WS: PanelWorkspace[] = ["draw", "tiles", "rig", "studio3d", "nodes", "data"];

export const AREA_EDITORS: AreaEditorDef[] = [
  { id: "timeline", label: "Timeline", icon: "timeline", workspaces: SPRITE_WS, slots: ["bottom"] },
  { id: "curves", label: "Curve Editor", icon: "curves", workspaces: ["rig"], slots: ["bottom"] },
  { id: "tileset", label: "Tileset", icon: "tileset", workspaces: ["tiles"], slots: ["bottom", "sidebar"] },
  { id: "preview", label: "Animation Preview", icon: "preview", workspaces: ALL_WS, slots: ["bottom", "sidebar"] },
  { id: "panels", label: "Panels", icon: "panels", workspaces: ALL_WS, slots: ["sidebar"] },
];

export interface AreaConfig {
  sidebarEditor: AreaEditorId;
  /** One area, or two side by side. */
  bottomEditors: AreaEditorId[];
  /** Share of the bottom strip given to the first area when split. */
  bottomSplitRatio: number;
  bottomVisible: boolean;
}

export type AreasState = Record<PanelWorkspace, AreaConfig>;

export const MAX_BOTTOM_AREAS = 2;
export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;
export const DEFAULT_SPLIT_RATIO = 0.5;

const WORKSPACES: PanelWorkspace[] = ["draw", "tiles", "rig", "studio3d", "nodes", "data"];

export function getAreaEditorDef(id: AreaEditorId): AreaEditorDef {
  return AREA_EDITORS.find((e) => e.id === id) ?? AREA_EDITORS[0];
}

export function isAreaEditorId(v: unknown): v is AreaEditorId {
  return typeof v === "string" && AREA_EDITORS.some((e) => e.id === v);
}

export function isEditorAvailable(
  id: AreaEditorId,
  ws: PanelWorkspace,
  slot: AreaSlot
): boolean {
  const def = AREA_EDITORS.find((e) => e.id === id);
  return !!def && def.workspaces.includes(ws) && def.slots.includes(slot);
}

export function availableEditors(ws: PanelWorkspace, slot: AreaSlot): AreaEditorDef[] {
  return AREA_EDITORS.filter((e) => isEditorAvailable(e.id, ws, slot));
}

export function clampSplitRatio(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_SPLIT_RATIO;
  return Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, r));
}

/** Defaults reproduce the pre-area layout exactly. */
export function defaultAreaConfig(ws: PanelWorkspace): AreaConfig {
  if (ws === "nodes") {
    return {
      sidebarEditor: "panels",
      bottomEditors: ["preview"],
      bottomSplitRatio: DEFAULT_SPLIT_RATIO,
      bottomVisible: false,
    };
  }
  return {
    sidebarEditor: "panels",
    bottomEditors: ["timeline"],
    bottomSplitRatio: DEFAULT_SPLIT_RATIO,
    bottomVisible: true,
  };
}

export function createDefaultAreas(): AreasState {
  const out = {} as AreasState;
  for (const ws of WORKSPACES) out[ws] = defaultAreaConfig(ws);
  return out;
}

/** Validate untrusted/persisted data; unavailable editors fall back to defaults. */
export function sanitizeAreaConfig(raw: unknown, ws: PanelWorkspace): AreaConfig {
  const def = defaultAreaConfig(ws);
  if (!raw || typeof raw !== "object") return def;
  const r = raw as Partial<Record<keyof AreaConfig, unknown>>;

  const sidebarEditor =
    isAreaEditorId(r.sidebarEditor) && isEditorAvailable(r.sidebarEditor, ws, "sidebar")
      ? r.sidebarEditor
      : def.sidebarEditor;

  let bottomEditors: AreaEditorId[] = [];
  if (Array.isArray(r.bottomEditors)) {
    for (const e of r.bottomEditors) {
      if (
        isAreaEditorId(e) &&
        isEditorAvailable(e, ws, "bottom") &&
        !bottomEditors.includes(e)
      ) {
        bottomEditors.push(e);
      }
    }
    bottomEditors = bottomEditors.slice(0, MAX_BOTTOM_AREAS);
  }
  if (bottomEditors.length === 0) bottomEditors = [...def.bottomEditors];

  return {
    sidebarEditor,
    bottomEditors,
    bottomSplitRatio:
      typeof r.bottomSplitRatio === "number"
        ? clampSplitRatio(r.bottomSplitRatio)
        : def.bottomSplitRatio,
    bottomVisible:
      typeof r.bottomVisible === "boolean" ? r.bottomVisible : def.bottomVisible,
  };
}

export function sanitizeAreas(raw: unknown): AreasState {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as AreasState;
  for (const ws of WORKSPACES) out[ws] = sanitizeAreaConfig(src[ws], ws);
  return out;
}

function withConfig(areas: AreasState, ws: PanelWorkspace, cfg: AreaConfig): AreasState {
  return { ...areas, [ws]: cfg };
}

export function setSidebarEditor(
  areas: AreasState,
  ws: PanelWorkspace,
  id: AreaEditorId
): AreasState {
  if (!isEditorAvailable(id, ws, "sidebar")) return areas;
  if (areas[ws].sidebarEditor === id) return areas;
  return withConfig(areas, ws, { ...areas[ws], sidebarEditor: id });
}

/** Picking an editor already shown in the other bottom area swaps the two. */
export function setBottomEditor(
  areas: AreasState,
  ws: PanelWorkspace,
  index: number,
  id: AreaEditorId
): AreasState {
  if (!isEditorAvailable(id, ws, "bottom")) return areas;
  const cur = areas[ws].bottomEditors;
  if (index < 0 || index >= cur.length || cur[index] === id) return areas;
  const next = [...cur];
  const other = next.indexOf(id);
  if (other !== -1) next[other] = next[index];
  next[index] = id;
  return withConfig(areas, ws, { ...areas[ws], bottomEditors: next });
}

/** Add a second bottom area, preferring a preview, else any unused editor. */
export function splitBottomArea(areas: AreasState, ws: PanelWorkspace): AreasState {
  const cfg = areas[ws];
  if (cfg.bottomEditors.length >= MAX_BOTTOM_AREAS) return areas;
  const candidates = availableEditors(ws, "bottom").filter(
    (e) => !cfg.bottomEditors.includes(e.id)
  );
  const pick = candidates.find((e) => e.id === "preview") ?? candidates[0];
  if (!pick) return areas;
  return withConfig(areas, ws, {
    ...cfg,
    bottomEditors: [...cfg.bottomEditors, pick.id],
    bottomVisible: true,
  });
}

/** Close one bottom area; the remaining one takes the whole strip. */
export function joinBottomArea(
  areas: AreasState,
  ws: PanelWorkspace,
  closeIndex = 1
): AreasState {
  const cfg = areas[ws];
  if (cfg.bottomEditors.length < 2) return areas;
  const next = cfg.bottomEditors.filter((_, i) => i !== closeIndex);
  return withConfig(areas, ws, { ...cfg, bottomEditors: next });
}

export function setBottomSplitRatio(
  areas: AreasState,
  ws: PanelWorkspace,
  ratio: number
): AreasState {
  const r = clampSplitRatio(ratio);
  if (areas[ws].bottomSplitRatio === r) return areas;
  return withConfig(areas, ws, { ...areas[ws], bottomSplitRatio: r });
}

export function setBottomVisible(
  areas: AreasState,
  ws: PanelWorkspace,
  visible: boolean
): AreasState {
  if (areas[ws].bottomVisible === visible) return areas;
  return withConfig(areas, ws, { ...areas[ws], bottomVisible: visible });
}

/**
 * Bottom editors that actually render. The timeline is suppressed where it is
 * irrelevant (Nodes, most 3D modes) via `timelineAllowed`; if both areas are
 * suppressed the strip disappears.
 */
export function visibleBottomEditors(
  cfg: AreaConfig,
  timelineAllowed: boolean
): AreaEditorId[] {
  if (!cfg.bottomVisible) return [];
  return cfg.bottomEditors.filter((e) => e !== "timeline" || timelineAllowed);
}

/**
 * "Show Bottom Area" toggle. Turning it on where the timeline is suppressed
 * (e.g. Nodes) swaps in an editor that can render there.
 */
export function toggleBottomArea(
  areas: AreasState,
  ws: PanelWorkspace,
  timelineAllowed: boolean
): AreasState {
  const cfg = areas[ws];
  if (visibleBottomEditors(cfg, timelineAllowed).length > 0) {
    return setBottomVisible(areas, ws, false);
  }
  let editors = cfg.bottomEditors;
  if (editors.every((e) => e === "timeline") && !timelineAllowed) {
    editors = ["preview"];
  }
  return withConfig(areas, ws, { ...cfg, bottomEditors: editors, bottomVisible: true });
}

/**
 * Maps the legacy "dock tileset browser at the bottom" flag onto the tileset
 * area editor (Tiles workspace).
 */
export function setTilesetDocked(areas: AreasState, docked: boolean): AreasState {
  const cfg = areas.tiles;
  const has = cfg.bottomEditors.includes("tileset");
  if (docked) {
    if (has) return setBottomVisible(areas, "tiles", true);
    const next = [...cfg.bottomEditors];
    next[0] = "tileset";
    return withConfig(areas, "tiles", {
      ...cfg,
      bottomEditors: [...new Set(next)],
      bottomVisible: true,
    });
  }
  if (!has) return areas;
  let next = cfg.bottomEditors.map((e) => (e === "tileset" ? "timeline" : e));
  next = next.filter((e, i) => next.indexOf(e) === i);
  return withConfig(areas, "tiles", { ...cfg, bottomEditors: next });
}

export function isTilesetDocked(areas: AreasState): boolean {
  return areas.tiles.bottomVisible && areas.tiles.bottomEditors.includes("tileset");
}

/** Reset a single workspace's areas to defaults. */
export function resetAreas(areas: AreasState, ws: PanelWorkspace): AreasState {
  return withConfig(areas, ws, defaultAreaConfig(ws));
}
