import {
  DEFAULT_DOCKED_ORDER,
  PANEL_WORKSPACE_MAP,
  type PanelId,
  type PanelWorkspace,
} from "./panelLayout.ts";

export type SplitDirection = "horizontal" | "vertical";
// "horizontal" = left | right (vertical divider bar)
// "vertical"   = top  / bottom (horizontal divider bar)

export type AreaEditorType =
  | "viewport"
  | "timeline"
  | "preview"
  | "inspector"
  | "tiles-browser"
  | "panel";

export type InspectorDisplayMode = "stack" | "tabs";

export type DropZone = "left" | "right" | "top" | "bottom" | "center";

export type BuiltInPresetId =
  | "default"
  | "left-handed"
  | "dual-sidebar"
  | "animation-studio"
  | "wide-canvas";

export interface AreaNode {
  kind: "area";
  id: string;
  editorType: AreaEditorType;
  /** Ordered list of panels when editorType === "inspector" */
  panels?: PanelId[];
  /** Focused panel when editorType === "panel" */
  panelId?: PanelId;
  /** Vertical scroll stack or tabbed view for inspector areas */
  inspectorMode?: InspectorDisplayMode;
  /** Active tab when inspectorMode === "tabs" */
  activeTabPanelId?: PanelId;
}

export interface SplitNode {
  kind: "split";
  id: string;
  direction: SplitDirection;
  /** Fraction [0.08 .. 0.92] allocated to `first` */
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = AreaNode | SplitNode;

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutPreset {
  id: string;
  name: string;
  tree: LayoutNode;
}

export interface WorkspaceLayoutsState {
  version: 1;
  layouts: Record<PanelWorkspace, LayoutNode>;
  customPresets: LayoutPreset[];
  toolRailVisible: boolean;
  toolRailSide: "left" | "right";
}

export const BUILT_IN_PRESET_META: ReadonlyArray<{
  id: BuiltInPresetId;
  name: string;
  description: string;
}> = [
  {
    id: "default",
    name: "Default",
    description: "Viewport center, Inspector right, Timeline bottom",
  },
  {
    id: "left-handed",
    name: "Left-Handed",
    description: "Inspector left, Viewport & Timeline right",
  },
  {
    id: "dual-sidebar",
    name: "Dual Sidebars",
    description: "Split Inspector on left & right, Viewport & Timeline center",
  },
  {
    id: "animation-studio",
    name: "Animation Studio",
    description: "Viewport + docked Preview side-by-side, taller Timeline",
  },
  {
    id: "wide-canvas",
    name: "Wide Canvas",
    description: "Maximized Viewport with compact Inspector right",
  },
];

export const ALL_WORKSPACES: readonly PanelWorkspace[] = [
  "draw",
  "tiles",
  "rig",
  "data",
];

const VALID_EDITOR_TYPES = new Set<AreaEditorType>([
  "viewport",
  "timeline",
  "preview",
  "inspector",
  "tiles-browser",
  "panel",
]);

const VALID_PANEL_IDS = new Set<string>(Object.keys(PANEL_WORKSPACE_MAP));

let idCounter = 1;

export function generateNodeId(prefix: "area" | "split", existingIds?: Set<string>): string {
  let candidate = `${prefix}-${idCounter++}`;
  while (existingIds?.has(candidate)) {
    candidate = `${prefix}-${idCounter++}`;
  }
  return candidate;
}

export function collectNodeIds(root: LayoutNode, out = new Set<string>()): Set<string> {
  out.add(root.id);
  if (root.kind === "split") {
    collectNodeIds(root.first, out);
    collectNodeIds(root.second, out);
  }
  return out;
}

export function clampSplitRatio(
  ratio: number,
  containerSize?: number,
  minPaneSize = 100
): number {
  let minRatio = 0.08;
  let maxRatio = 0.92;
  if (
    typeof containerSize === "number" &&
    Number.isFinite(containerSize) &&
    containerSize > 0
  ) {
    const computedMin = Math.min(0.45, Math.max(0.08, minPaneSize / containerSize));
    minRatio = computedMin;
    maxRatio = 1 - computedMin;
  }
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.max(minRatio, Math.min(maxRatio, ratio));
}

export function findArea(root: LayoutNode, areaId: string): AreaNode | null {
  if (root.kind === "area") {
    return root.id === areaId ? root : null;
  }
  return findArea(root.first, areaId) ?? findArea(root.second, areaId);
}

export function findSplit(root: LayoutNode, splitId: string): SplitNode | null {
  if (root.kind === "area") return null;
  if (root.id === splitId) return root;
  return findSplit(root.first, splitId) ?? findSplit(root.second, splitId);
}

export function findParentSplit(
  root: LayoutNode,
  nodeId: string
): { parent: SplitNode; side: "first" | "second" } | null {
  if (root.kind === "area") return null;
  if (root.first.id === nodeId) return { parent: root, side: "first" };
  if (root.second.id === nodeId) return { parent: root, side: "second" };
  return (
    findParentSplit(root.first, nodeId) ?? findParentSplit(root.second, nodeId)
  );
}

export function listAreas(root: LayoutNode, out: AreaNode[] = []): AreaNode[] {
  if (root.kind === "area") {
    out.push(root);
    return out;
  }
  listAreas(root.first, out);
  listAreas(root.second, out);
  return out;
}

export function countAreas(root: LayoutNode): number {
  return listAreas(root).length;
}

export function countViewportAreas(root: LayoutNode): number {
  return listAreas(root).filter((a) => a.editorType === "viewport").length;
}

export function containsNode(root: LayoutNode, nodeId: string): boolean {
  if (root.id === nodeId) return true;
  if (root.kind === "area") return false;
  return containsNode(root.first, nodeId) || containsNode(root.second, nodeId);
}

export function computeAreaRects(
  root: LayoutNode,
  bounds: LayoutRect
): Record<string, LayoutRect> {
  const result: Record<string, LayoutRect> = {};
  const walk = (node: LayoutNode, rect: LayoutRect) => {
    if (node.kind === "area") {
      result[node.id] = rect;
      return;
    }
    const r = clampSplitRatio(node.ratio);
    if (node.direction === "horizontal") {
      const firstW = rect.width * r;
      walk(node.first, {
        x: rect.x,
        y: rect.y,
        width: firstW,
        height: rect.height,
      });
      walk(node.second, {
        x: rect.x + firstW,
        y: rect.y,
        width: rect.width - firstW,
        height: rect.height,
      });
    } else {
      const firstH = rect.height * r;
      walk(node.first, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: firstH,
      });
      walk(node.second, {
        x: rect.x,
        y: rect.y + firstH,
        width: rect.width,
        height: rect.height - firstH,
      });
    }
  };
  walk(root, bounds);
  return result;
}

/**
 * Finds an adjacent area in `direction` from `sourceAreaId` that can be joined
 * (shares a border in that direction).
 */
export function findJoinableNeighbor(
  root: LayoutNode,
  sourceAreaId: string,
  direction: "left" | "right" | "top" | "bottom",
  bounds: LayoutRect
): string | null {
  const rects = computeAreaRects(root, bounds);
  const src = rects[sourceAreaId];
  if (!src) return null;

  const eps = 2.5;
  let bestId: string | null = null;
  let bestOverlap = 0;

  for (const [id, r] of Object.entries(rects)) {
    if (id === sourceAreaId) continue;

    if (direction === "right") {
      if (Math.abs(src.x + src.width - r.x) > eps) continue;
      const overlap =
        Math.min(src.y + src.height, r.y + r.height) - Math.max(src.y, r.y);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestId = id;
      }
    } else if (direction === "left") {
      if (Math.abs(r.x + r.width - src.x) > eps) continue;
      const overlap =
        Math.min(src.y + src.height, r.y + r.height) - Math.max(src.y, r.y);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestId = id;
      }
    } else if (direction === "bottom") {
      if (Math.abs(src.y + src.height - r.y) > eps) continue;
      const overlap =
        Math.min(src.x + src.width, r.x + r.width) - Math.max(src.x, r.x);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestId = id;
      }
    } else {
      if (Math.abs(r.y + r.height - src.y) > eps) continue;
      const overlap =
        Math.min(src.x + src.width, r.x + r.width) - Math.max(src.x, r.x);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestId = id;
      }
    }
  }

  return bestOverlap > 8 ? bestId : null;
}

function replaceNode(
  root: LayoutNode,
  targetId: string,
  replacement: LayoutNode
): LayoutNode {
  if (root.id === targetId) return replacement;
  if (root.kind === "area") return root;
  const nextFirst = replaceNode(root.first, targetId, replacement);
  const nextSecond = replaceNode(root.second, targetId, replacement);
  if (nextFirst === root.first && nextSecond === root.second) return root;
  return { ...root, first: nextFirst, second: nextSecond };
}

function cloneAreaWithNewId(
  area: AreaNode,
  existingIds: Set<string>
): AreaNode {
  const id = generateNodeId("area", existingIds);
  existingIds.add(id);
  // Enforce single primary viewport: duplicating a viewport creates a preview area
  if (area.editorType === "viewport") {
    return {
      kind: "area",
      id,
      editorType: "preview",
    };
  }
  return {
    ...area,
    id,
    panels: area.panels ? [...area.panels] : undefined,
  };
}

export function splitArea(
  root: LayoutNode,
  areaId: string,
  direction: SplitDirection,
  ratio = 0.5,
  newAreaConfig?: Omit<AreaNode, "kind" | "id"> & { id?: string },
  insertBefore = false
): LayoutNode {
  const existing = findArea(root, areaId);
  if (!existing) return root;

  const ids = collectNodeIds(root);
  const splitId = generateNodeId("split", ids);
  ids.add(splitId);

  let sibling: AreaNode;
  if (newAreaConfig) {
    const newId =
      newAreaConfig.id && !ids.has(newAreaConfig.id)
        ? newAreaConfig.id
        : generateNodeId("area", ids);
    const requestedEditor =
      newAreaConfig.editorType === "viewport" && countViewportAreas(root) >= 1
        ? "preview"
        : newAreaConfig.editorType;
    sibling = {
      kind: "area",
      id: newId,
      editorType: requestedEditor,
      panels: newAreaConfig.panels ? [...newAreaConfig.panels] : undefined,
      panelId: newAreaConfig.panelId,
      inspectorMode: newAreaConfig.inspectorMode,
      activeTabPanelId: newAreaConfig.activeTabPanelId,
    };
  } else {
    sibling = cloneAreaWithNewId(existing, ids);
  }

  const clampedRatio = clampSplitRatio(ratio);
  const splitNode: SplitNode = {
    kind: "split",
    id: splitId,
    direction,
    ratio: clampedRatio,
    first: insertBefore ? sibling : existing,
    second: insertBefore ? existing : sibling,
  };

  return replaceNode(root, areaId, splitNode);
}

export function closeArea(root: LayoutNode, areaId: string): LayoutNode {
  if (root.kind === "area") return root;
  const target = findArea(root, areaId);
  if (!target) return root;
  // Never close the only viewport area
  if (target.editorType === "viewport" && countViewportAreas(root) <= 1) {
    return root;
  }

  const remove = (node: LayoutNode): LayoutNode | null => {
    if (node.kind === "area") {
      return node.id === areaId ? null : node;
    }
    if (node.first.id === areaId) return node.second;
    if (node.second.id === areaId) return node.first;
    const nextFirst = remove(node.first);
    if (nextFirst !== node.first) {
      return nextFirst === null ? node.second : { ...node, first: nextFirst };
    }
    const nextSecond = remove(node.second);
    if (nextSecond !== node.second) {
      return nextSecond === null ? node.first : { ...node, second: nextSecond };
    }
    return node;
  };

  return remove(root) ?? root;
}

/**
 * Joins `targetAreaId` into `sourceAreaId` (target is absorbed, source survives).
 * Cannot absorb the only viewport area.
 */
export function joinAreas(
  root: LayoutNode,
  sourceAreaId: string,
  targetAreaId: string
): LayoutNode {
  if (sourceAreaId === targetAreaId) return root;
  const source = findArea(root, sourceAreaId);
  const target = findArea(root, targetAreaId);
  if (!source || !target) return root;
  if (target.editorType === "viewport" && countViewportAreas(root) <= 1) {
    return root;
  }
  return closeArea(root, targetAreaId);
}

export function resizeSplit(
  root: LayoutNode,
  splitId: string,
  ratio: number,
  containerSize?: number,
  minPaneSize = 100
): LayoutNode {
  const clamped = clampSplitRatio(ratio, containerSize, minPaneSize);
  const update = (node: LayoutNode): LayoutNode => {
    if (node.kind === "area") return node;
    if (node.id === splitId) {
      if (Math.abs(node.ratio - clamped) < 0.0001) return node;
      return { ...node, ratio: clamped };
    }
    const nextFirst = update(node.first);
    const nextSecond = update(node.second);
    if (nextFirst === node.first && nextSecond === node.second) return node;
    return { ...node, first: nextFirst, second: nextSecond };
  };
  return update(root);
}

export function equalizeSplit(root: LayoutNode, splitId: string): LayoutNode {
  return resizeSplit(root, splitId, 0.5);
}

export function swapSplitChildren(root: LayoutNode, splitId: string): LayoutNode {
  const update = (node: LayoutNode): LayoutNode => {
    if (node.kind === "area") return node;
    if (node.id === splitId) {
      return {
        ...node,
        ratio: clampSplitRatio(1 - node.ratio),
        first: node.second,
        second: node.first,
      };
    }
    const nextFirst = update(node.first);
    const nextSecond = update(node.second);
    if (nextFirst === node.first && nextSecond === node.second) return node;
    return { ...node, first: nextFirst, second: nextSecond };
  };
  return update(root);
}

export function swapAreas(
  root: LayoutNode,
  areaAId: string,
  areaBId: string
): LayoutNode {
  if (areaAId === areaBId) return root;
  const a = findArea(root, areaAId);
  const b = findArea(root, areaBId);
  if (!a || !b) return root;

  const swap = (node: LayoutNode): LayoutNode => {
    if (node.kind === "area") {
      if (node.id === areaAId) return { ...b, id: areaAId };
      if (node.id === areaBId) return { ...a, id: areaBId };
      return node;
    }
    const nextFirst = swap(node.first);
    const nextSecond = swap(node.second);
    if (nextFirst === node.first && nextSecond === node.second) return node;
    return { ...node, first: nextFirst, second: nextSecond };
  };
  return swap(root);
}

export function setAreaEditor(
  root: LayoutNode,
  areaId: string,
  editorType: AreaEditorType,
  options?: {
    panelId?: PanelId;
    panels?: PanelId[];
    workspace?: PanelWorkspace;
  }
): LayoutNode {
  const target = findArea(root, areaId);
  if (!target) return root;

  // Enforce single primary viewport:
  // If switching a non-viewport area to "viewport", swap it with the existing viewport.
  if (editorType === "viewport" && target.editorType !== "viewport") {
    const existingVp = listAreas(root).find((a) => a.editorType === "viewport");
    if (existingVp) {
      return swapAreas(root, existingVp.id, areaId);
    }
  }

  // Never allow converting the ONLY viewport away from viewport
  if (
    target.editorType === "viewport" &&
    editorType !== "viewport" &&
    countViewportAreas(root) <= 1
  ) {
    return root;
  }

  const ws = options?.workspace ?? "draw";
  const nextArea: AreaNode = {
    kind: "area",
    id: target.id,
    editorType,
    panels:
      editorType === "inspector"
        ? options?.panels && options.panels.length > 0
          ? [...options.panels]
          : target.panels && target.panels.length > 0
            ? [...target.panels]
            : [...DEFAULT_DOCKED_ORDER[ws]]
        : undefined,
    panelId:
      editorType === "panel"
        ? options?.panelId ?? target.panelId ?? DEFAULT_DOCKED_ORDER[ws][0]
        : undefined,
    inspectorMode:
      editorType === "inspector" ? target.inspectorMode ?? "stack" : undefined,
    activeTabPanelId:
      editorType === "inspector"
        ? target.activeTabPanelId ??
          options?.panels?.[0] ??
          target.panels?.[0] ??
          DEFAULT_DOCKED_ORDER[ws][0]
        : undefined,
  };

  return replaceNode(root, areaId, nextArea);
}

export function setInspectorMode(
  root: LayoutNode,
  areaId: string,
  mode: InspectorDisplayMode
): LayoutNode {
  const target = findArea(root, areaId);
  if (!target || target.editorType !== "inspector") return root;
  const panels = target.panels ?? [];
  const activeTab =
    target.activeTabPanelId && panels.includes(target.activeTabPanelId)
      ? target.activeTabPanelId
      : panels[0];
  return replaceNode(root, areaId, {
    ...target,
    inspectorMode: mode,
    activeTabPanelId: activeTab,
  });
}

export function setInspectorActiveTab(
  root: LayoutNode,
  areaId: string,
  panelId: PanelId
): LayoutNode {
  const target = findArea(root, areaId);
  if (!target || target.editorType !== "inspector") return root;
  return replaceNode(root, areaId, {
    ...target,
    activeTabPanelId: panelId,
  });
}

function getPanelsInArea(area: AreaNode): PanelId[] {
  if (area.editorType === "inspector") return [...(area.panels ?? [])];
  if (area.editorType === "panel" && area.panelId) return [area.panelId];
  return [];
}

/**
 * Moves an entire area onto a drop zone of `targetAreaId`:
 * - "center": merges panels if both are inspector/panel areas, otherwise swaps them
 * - "left"/"right"/"top"/"bottom": extracts source and splits target on that edge
 */
export function moveAreaToTarget(
  root: LayoutNode,
  sourceAreaId: string,
  targetAreaId: string,
  zone: DropZone
): LayoutNode {
  if (sourceAreaId === targetAreaId) return root;
  const source = findArea(root, sourceAreaId);
  const target = findArea(root, targetAreaId);
  if (!source || !target) return root;

  if (zone === "center") {
    const srcPanels = getPanelsInArea(source);
    const tgtPanels = getPanelsInArea(target);
    if (srcPanels.length > 0 && tgtPanels.length > 0) {
      const merged = [...tgtPanels];
      for (const p of srcPanels) {
        if (!merged.includes(p)) merged.push(p);
      }
      const withoutSource = closeArea(root, sourceAreaId);
      const updatedTarget: AreaNode = {
        kind: "area",
        id: target.id,
        editorType: "inspector",
        panels: merged,
        inspectorMode: target.inspectorMode ?? "stack",
        activeTabPanelId: srcPanels[0] ?? merged[0],
      };
      return replaceNode(withoutSource, target.id, updatedTarget);
    }
    return swapAreas(root, sourceAreaId, targetAreaId);
  }

  // Edge drop: extract source (temporarily bypass single-viewport guard since we re-insert it)
  const extract = (node: LayoutNode): LayoutNode | null => {
    if (node.kind === "area") return node.id === sourceAreaId ? null : node;
    if (node.first.id === sourceAreaId) return node.second;
    if (node.second.id === sourceAreaId) return node.first;
    const nf = extract(node.first);
    if (nf !== node.first) return nf === null ? node.second : { ...node, first: nf };
    const ns = extract(node.second);
    if (ns !== node.second) return ns === null ? node.first : { ...node, second: ns };
    return node;
  };

  const withoutSource = extract(root);
  if (!withoutSource) return root;

  const direction: SplitDirection =
    zone === "left" || zone === "right" ? "horizontal" : "vertical";
  const insertBefore = zone === "left" || zone === "top";
  const ratio = insertBefore ? 0.35 : 0.65;

  const ids = collectNodeIds(withoutSource);
  const splitId = generateNodeId("split", ids);
  const targetAfter = findArea(withoutSource, targetAreaId);
  if (!targetAfter) return root;

  const splitNode: SplitNode = {
    kind: "split",
    id: splitId,
    direction,
    ratio,
    first: insertBefore ? source : targetAfter,
    second: insertBefore ? targetAfter : source,
  };

  return replaceNode(withoutSource, targetAreaId, splitNode);
}

/**
 * Moves a sub-panel from `fromAreaId` into `targetAreaId` (center = stack/reorder,
 * edge = split targetAreaId into a new panel area).
 */
export function movePanelToArea(
  root: LayoutNode,
  panelId: PanelId,
  fromAreaId: string | null,
  targetAreaId: string,
  zone: DropZone,
  insertIndex?: number
): LayoutNode {
  const target = findArea(root, targetAreaId);
  if (!target) return root;

  // Same-area reorder inside an inspector stack
  if (fromAreaId === targetAreaId && zone === "center" && target.editorType === "inspector") {
    const panels = [...(target.panels ?? [])];
    const fromIdx = panels.indexOf(panelId);
    if (fromIdx === -1) return root;
    panels.splice(fromIdx, 1);
    const rawIdx = insertIndex ?? panels.length;
    const clampedIdx = Math.max(0, Math.min(panels.length, rawIdx));
    panels.splice(clampedIdx, 0, panelId);
    return replaceNode(root, targetAreaId, { ...target, panels });
  }

  // First remove from source area (if provided)
  let nextRoot = root;
  if (fromAreaId) {
    const fromArea = findArea(nextRoot, fromAreaId);
    if (fromArea) {
      if (fromArea.editorType === "inspector") {
        const remaining = (fromArea.panels ?? []).filter((p) => p !== panelId);
        if (remaining.length === 0) {
          // Only close if it's not the target itself and not the only area
          if (fromAreaId !== targetAreaId && countAreas(nextRoot) > 1) {
            nextRoot = closeArea(nextRoot, fromAreaId);
          } else {
            nextRoot = replaceNode(nextRoot, fromAreaId, {
              ...fromArea,
              panels: remaining,
            });
          }
        } else {
          const nextTab =
            fromArea.activeTabPanelId === panelId
              ? remaining[0]
              : fromArea.activeTabPanelId;
          nextRoot = replaceNode(nextRoot, fromAreaId, {
            ...fromArea,
            panels: remaining,
            activeTabPanelId: nextTab,
          });
        }
      } else if (fromArea.editorType === "panel" && fromArea.panelId === panelId) {
        if (fromAreaId !== targetAreaId && countAreas(nextRoot) > 1) {
          nextRoot = closeArea(nextRoot, fromAreaId);
        }
      }
    }
  }

  const targetNow = findArea(nextRoot, targetAreaId);
  if (!targetNow) return nextRoot;

  if (zone === "center") {
    if (targetNow.editorType === "inspector") {
      const panels = (targetNow.panels ?? []).filter((p) => p !== panelId);
      const clampedIdx =
        insertIndex !== undefined
          ? Math.max(0, Math.min(panels.length, insertIndex))
          : panels.length;
      panels.splice(clampedIdx, 0, panelId);
      return replaceNode(nextRoot, targetAreaId, {
        ...targetNow,
        panels,
        activeTabPanelId:
          targetNow.inspectorMode === "tabs" ? panelId : targetNow.activeTabPanelId,
      });
    }
    if (targetNow.editorType === "panel") {
      const existingPanels = targetNow.panelId ? [targetNow.panelId] : [];
      const panels = existingPanels.filter((p) => p !== panelId);
      panels.push(panelId);
      return replaceNode(nextRoot, targetAreaId, {
        kind: "area",
        id: targetNow.id,
        editorType: "inspector",
        panels,
        inspectorMode: "stack",
        activeTabPanelId: panelId,
      });
    }
    // Dropping a panel onto center of viewport/timeline/preview splits to the right
    return splitArea(
      nextRoot,
      targetAreaId,
      "horizontal",
      0.75,
      { editorType: "inspector", panels: [panelId], inspectorMode: "stack", activeTabPanelId: panelId },
      false
    );
  }

  const direction: SplitDirection =
    zone === "left" || zone === "right" ? "horizontal" : "vertical";
  const insertBefore = zone === "left" || zone === "top";
  const ratio = insertBefore ? 0.25 : 0.75;
  return splitArea(
    nextRoot,
    targetAreaId,
    direction,
    ratio,
    {
      editorType: "inspector",
      panels: [panelId],
      inspectorMode: "stack",
      activeTabPanelId: panelId,
    },
    insertBefore
  );
}

export function addPanelToInspector(
  root: LayoutNode,
  areaId: string,
  panelId: PanelId
): LayoutNode {
  const area = findArea(root, areaId);
  if (!area || area.editorType !== "inspector") return root;
  const panels = area.panels ?? [];
  if (panels.includes(panelId)) return root;
  return replaceNode(root, areaId, {
    ...area,
    panels: [...panels, panelId],
    activeTabPanelId: area.inspectorMode === "tabs" ? panelId : area.activeTabPanelId,
  });
}

export function removePanelFromInspector(
  root: LayoutNode,
  areaId: string,
  panelId: PanelId
): LayoutNode {
  const area = findArea(root, areaId);
  if (!area || area.editorType !== "inspector") return root;
  const remaining = (area.panels ?? []).filter((p) => p !== panelId);
  if (remaining.length === 0 && countAreas(root) > 1) {
    return closeArea(root, areaId);
  }
  return replaceNode(root, areaId, {
    ...area,
    panels: remaining,
    activeTabPanelId:
      area.activeTabPanelId === panelId ? remaining[0] : area.activeTabPanelId,
  });
}

/**
 * Default Blender-style BSP layout per workspace — mirrors Pixet's familiar
 * layout (Viewport center, Timeline bottom, Inspector right) out of the box.
 */
export function createDefaultWorkspaceTree(workspace: PanelWorkspace): LayoutNode {
  const panels = [...DEFAULT_DOCKED_ORDER[workspace]];
  return {
    kind: "split",
    id: `split-${workspace}-root`,
    direction: "horizontal",
    ratio: 0.78,
    first: {
      kind: "split",
      id: `split-${workspace}-main`,
      direction: "vertical",
      ratio: 0.76,
      first: {
        kind: "area",
        id: `area-${workspace}-viewport`,
        editorType: "viewport",
      },
      second: {
        kind: "area",
        id: `area-${workspace}-timeline`,
        editorType: "timeline",
      },
    },
    second: {
      kind: "area",
      id: `area-${workspace}-inspector`,
      editorType: "inspector",
      panels,
      inspectorMode: "stack",
      activeTabPanelId: panels[0],
    },
  };
}

export function buildBuiltInPresetTree(
  presetId: BuiltInPresetId,
  workspace: PanelWorkspace
): LayoutNode {
  const panels = [...DEFAULT_DOCKED_ORDER[workspace]];

  if (presetId === "default") {
    return createDefaultWorkspaceTree(workspace);
  }

  if (presetId === "left-handed") {
    return {
      kind: "split",
      id: `split-${workspace}-lh-root`,
      direction: "horizontal",
      ratio: 0.22,
      first: {
        kind: "area",
        id: `area-${workspace}-lh-inspector`,
        editorType: "inspector",
        panels,
        inspectorMode: "stack",
        activeTabPanelId: panels[0],
      },
      second: {
        kind: "split",
        id: `split-${workspace}-lh-main`,
        direction: "vertical",
        ratio: 0.76,
        first: {
          kind: "area",
          id: `area-${workspace}-lh-viewport`,
          editorType: "viewport",
        },
        second: {
          kind: "area",
          id: `area-${workspace}-lh-timeline`,
          editorType: "timeline",
        },
      },
    };
  }

  if (presetId === "dual-sidebar") {
    const mid = Math.max(1, Math.ceil(panels.length / 2));
    const leftPanels = panels.slice(0, mid);
    const rightPanels = panels.slice(mid);
    return {
      kind: "split",
      id: `split-${workspace}-ds-root`,
      direction: "horizontal",
      ratio: 0.2,
      first: {
        kind: "area",
        id: `area-${workspace}-ds-left`,
        editorType: "inspector",
        panels: leftPanels,
        inspectorMode: "stack",
        activeTabPanelId: leftPanels[0],
      },
      second: {
        kind: "split",
        id: `split-${workspace}-ds-midright`,
        direction: "horizontal",
        ratio: 0.75,
        first: {
          kind: "split",
          id: `split-${workspace}-ds-center`,
          direction: "vertical",
          ratio: 0.76,
          first: {
            kind: "area",
            id: `area-${workspace}-ds-viewport`,
            editorType: "viewport",
          },
          second: {
            kind: "area",
            id: `area-${workspace}-ds-timeline`,
            editorType: "timeline",
          },
        },
        second: {
          kind: "area",
          id: `area-${workspace}-ds-right`,
          editorType: "inspector",
          panels: rightPanels.length > 0 ? rightPanels : leftPanels,
          inspectorMode: "stack",
          activeTabPanelId: (rightPanels.length > 0 ? rightPanels : leftPanels)[0],
        },
      },
    };
  }

  if (presetId === "animation-studio") {
    return {
      kind: "split",
      id: `split-${workspace}-anim-root`,
      direction: "horizontal",
      ratio: 0.8,
      first: {
        kind: "split",
        id: `split-${workspace}-anim-main`,
        direction: "vertical",
        ratio: 0.68,
        first: {
          kind: "split",
          id: `split-${workspace}-anim-top`,
          direction: "horizontal",
          ratio: 0.72,
          first: {
            kind: "area",
            id: `area-${workspace}-anim-viewport`,
            editorType: "viewport",
          },
          second: {
            kind: "area",
            id: `area-${workspace}-anim-preview`,
            editorType: "preview",
          },
        },
        second: {
          kind: "area",
          id: `area-${workspace}-anim-timeline`,
          editorType: "timeline",
        },
      },
      second: {
        kind: "area",
        id: `area-${workspace}-anim-inspector`,
        editorType: "inspector",
        panels,
        inspectorMode: "stack",
        activeTabPanelId: panels[0],
      },
    };
  }

  // wide-canvas
  return {
    kind: "split",
    id: `split-${workspace}-wc-root`,
    direction: "horizontal",
    ratio: 0.82,
    first: {
      kind: "area",
      id: `area-${workspace}-wc-viewport`,
      editorType: "viewport",
    },
    second: {
      kind: "area",
      id: `area-${workspace}-wc-inspector`,
      editorType: "inspector",
      panels,
      inspectorMode: "stack",
      activeTabPanelId: panels[0],
    },
  };
}

export function createDefaultWorkspaceLayouts(): WorkspaceLayoutsState {
  return {
    version: 1,
    layouts: {
      draw: createDefaultWorkspaceTree("draw"),
      tiles: createDefaultWorkspaceTree("tiles"),
      rig: createDefaultWorkspaceTree("rig"),
      data: createDefaultWorkspaceTree("data"),
    },
    customPresets: [],
    toolRailVisible: true,
    toolRailSide: "left",
  };
}

function sanitizeNode(
  raw: unknown,
  seenIds: Set<string>,
  seenViewport: { count: number }
): LayoutNode | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;

  if (kind === "area") {
    const rawEditor = obj.editorType;
    if (
      typeof rawEditor !== "string" ||
      !VALID_EDITOR_TYPES.has(rawEditor as AreaEditorType)
    ) {
      return null;
    }
    let editorType = rawEditor as AreaEditorType;
    if (editorType === "viewport") {
      seenViewport.count += 1;
      if (seenViewport.count > 1) {
        editorType = "preview";
      }
    }

    const rawId = typeof obj.id === "string" && obj.id.trim() ? obj.id : "";
    const id = rawId && !seenIds.has(rawId) ? rawId : generateNodeId("area", seenIds);
    seenIds.add(id);

    const panels = Array.isArray(obj.panels)
      ? obj.panels.filter(
          (p): p is PanelId => typeof p === "string" && VALID_PANEL_IDS.has(p)
        )
      : undefined;

    const panelId =
      typeof obj.panelId === "string" && VALID_PANEL_IDS.has(obj.panelId)
        ? (obj.panelId as PanelId)
        : undefined;

    const inspectorMode: InspectorDisplayMode | undefined =
      obj.inspectorMode === "tabs" || obj.inspectorMode === "stack"
        ? obj.inspectorMode
        : editorType === "inspector"
          ? "stack"
          : undefined;

    const activeTabPanelId =
      typeof obj.activeTabPanelId === "string" &&
      VALID_PANEL_IDS.has(obj.activeTabPanelId)
        ? (obj.activeTabPanelId as PanelId)
        : panels?.[0];

    return {
      kind: "area",
      id,
      editorType,
      panels: editorType === "inspector" ? panels ?? [] : undefined,
      panelId: editorType === "panel" ? panelId ?? "layers" : undefined,
      inspectorMode,
      activeTabPanelId: editorType === "inspector" ? activeTabPanelId : undefined,
    };
  }

  if (kind === "split") {
    const direction = obj.direction;
    if (direction !== "horizontal" && direction !== "vertical") return null;
    const first = sanitizeNode(obj.first, seenIds, seenViewport);
    const second = sanitizeNode(obj.second, seenIds, seenViewport);
    if (!first && !second) return null;
    if (!first) return second;
    if (!second) return first;

    const rawId = typeof obj.id === "string" && obj.id.trim() ? obj.id : "";
    const id = rawId && !seenIds.has(rawId) ? rawId : generateNodeId("split", seenIds);
    seenIds.add(id);

    const ratio = clampSplitRatio(
      typeof obj.ratio === "number" ? obj.ratio : 0.5
    );

    return {
      kind: "split",
      id,
      direction,
      ratio,
      first,
      second,
    };
  }

  return null;
}

export function sanitizeLayoutTree(
  raw: unknown,
  fallbackWorkspace: PanelWorkspace
): LayoutNode {
  const seenIds = new Set<string>();
  const seenViewport = { count: 0 };
  const sanitized = sanitizeNode(raw, seenIds, seenViewport);
  if (!sanitized || seenViewport.count === 0) {
    return createDefaultWorkspaceTree(fallbackWorkspace);
  }
  return sanitized;
}

export function serializeWorkspaceLayouts(state: WorkspaceLayoutsState): string {
  return JSON.stringify(state);
}

export function deserializeWorkspaceLayouts(
  raw: string | null
): WorkspaceLayoutsState {
  const def = createDefaultWorkspaceLayouts();
  if (!raw) return def;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceLayoutsState>;
    if (!parsed || typeof parsed !== "object") return def;

    const layouts = { ...def.layouts };
    if (parsed.layouts && typeof parsed.layouts === "object") {
      for (const ws of ALL_WORKSPACES) {
        if (parsed.layouts[ws]) {
          layouts[ws] = sanitizeLayoutTree(parsed.layouts[ws], ws);
        }
      }
    }

    const customPresets: LayoutPreset[] = [];
    if (Array.isArray(parsed.customPresets)) {
      const seenPresetIds = new Set<string>();
      for (const p of parsed.customPresets) {
        if (!p || typeof p !== "object") continue;
        const name = typeof p.name === "string" ? p.name.trim() : "";
        const id = typeof p.id === "string" ? p.id.trim() : "";
        if (!name || !id || seenPresetIds.has(id)) continue;
        const seenIds = new Set<string>();
        const seenVp = { count: 0 };
        const tree = sanitizeNode(p.tree, seenIds, seenVp);
        if (!tree || seenVp.count === 0) continue;
        seenPresetIds.add(id);
        customPresets.push({ id, name, tree });
      }
    }

    return {
      version: 1,
      layouts,
      customPresets,
      toolRailVisible:
        typeof parsed.toolRailVisible === "boolean"
          ? parsed.toolRailVisible
          : true,
      toolRailSide:
        parsed.toolRailSide === "right" ? "right" : "left",
    };
  } catch {
    return def;
  }
}
