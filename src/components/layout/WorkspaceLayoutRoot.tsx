import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Columns2,
  Merge,
  Rows2,
  Scale,
} from "lucide-react";
import {
  clampSplitRatio,
  findArea,
  findJoinableNeighbor,
  listAreas,
  type DropZone,
  type LayoutNode,
  type SplitDirection,
  type SplitNode,
} from "../../engine/ui/workspaceLayout";
import {
  PANEL_WORKSPACE_MAP,
  type PanelId,
} from "../../engine/ui/panelLayout";
import { useEditorStore } from "../../store/editorStore";
import { AreaView } from "./AreaView";
import {
  LayoutInteractionContext,
  type BorderMenuState,
  type CornerDragPreview,
  type LayoutDragPayload,
  type LayoutDropTarget,
} from "./LayoutContext";
import { PANEL_REGISTRY } from "./panelRegistry";

function computeDropZone(
  clientX: number,
  clientY: number,
  rect: DOMRect
): DropZone {
  const rx = (clientX - rect.left) / Math.max(1, rect.width);
  const ry = (clientY - rect.top) / Math.max(1, rect.height);
  const edge = 0.24;
  if (rx < edge) return "left";
  if (rx > 1 - edge) return "right";
  if (ry < edge) return "top";
  if (ry > 1 - edge) return "bottom";
  return "center";
}

function hitTestAreaAtPoint(
  clientX: number,
  clientY: number
): { areaId: string; rect: DOMRect } | null {
  const els = document.querySelectorAll<HTMLElement>("[data-area-id]");
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      const areaId = el.dataset.areaId;
      if (areaId) return { areaId, rect };
    }
  }
  return null;
}

function findPanelInsertIndex(
  areaId: string,
  clientY: number,
  excludePanelId: PanelId
): number {
  const container = document.querySelector<HTMLElement>(
    `[data-inspector-area-id="${areaId}"]`
  );
  if (!container) return 0;
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>("[data-panel-id]")
  ).filter((el) => el.offsetParent !== null);

  let idx = 0;
  for (const row of rows) {
    const pid = row.dataset.panelId as PanelId | undefined;
    if (!pid || pid === excludePanelId) continue;
    const r = row.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) {
      return idx;
    }
    idx += 1;
  }
  return idx;
}

interface SplitNodeViewProps {
  node: SplitNode;
  openBorderMenu: (menu: BorderMenuState) => void;
}

function SplitNodeView({ node, openBorderMenu }: SplitNodeViewProps) {
  const resizeLayoutSplit = useEditorStore((s) => s.resizeLayoutSplit);
  const equalizeLayoutSplit = useEditorStore((s) => s.equalizeLayoutSplit);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const isHorizontal = node.direction === "horizontal";

  const handleSplitterMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);

    const onMove = (ev: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const size = isHorizontal ? rect.width : rect.height;
      const offset = isHorizontal
        ? ev.clientX - rect.left
        : ev.clientY - rect.top;
      const rawRatio = size > 0 ? offset / size : 0.5;
      const minPane = isHorizontal ? 140 : 88;
      resizeLayoutSplit(node.id, rawRatio, size, minPane);
    };

    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleSplitterContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    openBorderMenu({
      splitId: node.id,
      x: e.clientX,
      y: e.clientY,
      direction: node.direction,
      firstAreaId: node.first.kind === "area" ? node.first.id : null,
      secondAreaId: node.second.kind === "area" ? node.second.id : null,
    });
  };

  const firstPct = clampSplitRatio(node.ratio);
  const secondPct = 1 - firstPct;

  return (
    <div
      ref={containerRef}
      className={`layout-split ${isHorizontal ? "is-horizontal" : "is-vertical"}`}
      data-split-id={node.id}
    >
      <div className="layout-split-pane" style={{ flex: `${firstPct} 1 0%` }}>
        <LayoutNodeView node={node.first} openBorderMenu={openBorderMenu} />
      </div>

      <div
        className={`layout-splitter ${isHorizontal ? "is-horizontal" : "is-vertical"} ${
          dragging ? "dragging" : ""
        }`}
        title="Drag to resize · Double-click to equalize · Right-click for options"
        onMouseDown={handleSplitterMouseDown}
        onDoubleClick={() => equalizeLayoutSplit(node.id)}
        onContextMenu={handleSplitterContextMenu}
      />

      <div className="layout-split-pane" style={{ flex: `${secondPct} 1 0%` }}>
        <LayoutNodeView node={node.second} openBorderMenu={openBorderMenu} />
      </div>
    </div>
  );
}

function LayoutNodeView({
  node,
  openBorderMenu,
}: {
  node: LayoutNode;
  openBorderMenu: (menu: BorderMenuState) => void;
}) {
  if (node.kind === "area") {
    return <AreaView area={node} />;
  }
  return <SplitNodeView node={node} openBorderMenu={openBorderMenu} />;
}

export function WorkspaceLayoutRoot() {
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const tree = useEditorStore((s) => s.workspaceLayouts.layouts[s.workspaceMode]);
  const panelsCollapsed = useEditorStore((s) => s.panelsCollapsed);
  const maximizedAreaId = useEditorStore((s) => s.maximizedAreaId);
  const detachedPanels = useEditorStore((s) => s.detachedPanels);

  const splitLayoutArea = useEditorStore((s) => s.splitLayoutArea);
  const joinLayoutAreas = useEditorStore((s) => s.joinLayoutAreas);
  const equalizeLayoutSplit = useEditorStore((s) => s.equalizeLayoutSplit);
  const swapLayoutSplitChildren = useEditorStore(
    (s) => s.swapLayoutSplitChildren
  );
  const moveLayoutAreaToTarget = useEditorStore(
    (s) => s.moveLayoutAreaToTarget
  );
  const moveLayoutPanelToArea = useEditorStore((s) => s.moveLayoutPanelToArea);

  const rootRef = useRef<HTMLDivElement>(null);
  const [dragPayload, setDragPayload] = useState<LayoutDragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<LayoutDropTarget | null>(null);
  const [cornerPreview, setCornerPreview] = useState<CornerDragPreview | null>(
    null
  );
  const [borderMenu, setBorderMenu] = useState<BorderMenuState | null>(null);

  // Close border context menu on outside click or Escape
  useEffect(() => {
    if (!borderMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".layout-border-menu")) {
        setBorderMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBorderMenu(null);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [borderMenu]);

  const startAreaDrag = useCallback(
    (sourceAreaId: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      let latestTarget: LayoutDropTarget | null = null;

      const onMove = (ev: MouseEvent) => {
        if (!started) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
          started = true;
          setDragPayload({ kind: "area", sourceAreaId });
        }

        const hit = hitTestAreaAtPoint(ev.clientX, ev.clientY);
        if (!hit || hit.areaId === sourceAreaId) {
          latestTarget = null;
          setDropTarget(null);
          return;
        }
        const zone = computeDropZone(ev.clientX, ev.clientY, hit.rect);
        latestTarget = { areaId: hit.areaId, zone };
        setDropTarget(latestTarget);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (started && latestTarget) {
          moveLayoutAreaToTarget(
            sourceAreaId,
            latestTarget.areaId,
            latestTarget.zone
          );
        }
        setDragPayload(null);
        setDropTarget(null);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [moveLayoutAreaToTarget]
  );

  const startPanelDrag = useCallback(
    (panelId: PanelId, fromAreaId: string | null, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      let latestTarget: LayoutDropTarget | null = null;
      let latestClientY = e.clientY;

      const onMove = (ev: MouseEvent) => {
        latestClientY = ev.clientY;
        if (!started) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
          started = true;
          setDragPayload({ kind: "panel", panelId, fromAreaId });
        }

        const hit = hitTestAreaAtPoint(ev.clientX, ev.clientY);
        if (!hit) {
          latestTarget = null;
          setDropTarget(null);
          return;
        }
        const zone =
          hit.areaId === fromAreaId
            ? "center"
            : computeDropZone(ev.clientX, ev.clientY, hit.rect);
        latestTarget = { areaId: hit.areaId, zone };
        setDropTarget(latestTarget);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (started && latestTarget) {
          const insertIdx =
            latestTarget.zone === "center"
              ? findPanelInsertIndex(
                  latestTarget.areaId,
                  latestClientY,
                  panelId
                )
              : undefined;
          moveLayoutPanelToArea(
            panelId,
            fromAreaId,
            latestTarget.areaId,
            latestTarget.zone,
            insertIdx
          );
        }
        setDragPayload(null);
        setDropTarget(null);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [moveLayoutPanelToArea]
  );

  const startCornerDrag = useCallback(
    (
      sourceAreaId: string,
      _corner: "nw" | "ne" | "sw" | "se",
      e: React.MouseEvent
    ) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const areaEl = document.querySelector<HTMLElement>(
        `[data-area-id="${sourceAreaId}"]`
      );
      const areaRect = areaEl?.getBoundingClientRect();
      const rootEl = rootRef.current;
      const rootRect = rootEl?.getBoundingClientRect();
      if (!areaRect || !rootRect) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let latestPreview: CornerDragPreview | null = null;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.hypot(dx, dy) < 12) {
          latestPreview = null;
          setCornerPreview(null);
          return;
        }

        const curTree =
          useEditorStore.getState().workspaceLayouts.layouts[
            useEditorStore.getState().workspaceMode
          ];
        const bounds = {
          x: 0,
          y: 0,
          width: rootRect.width,
          height: rootRect.height,
        };

        // Check if cursor moved OUTSIDE sourceAreaRect -> Join mode
        const outsideLeft = ev.clientX < areaRect.left - 8;
        const outsideRight = ev.clientX > areaRect.right + 8;
        const outsideTop = ev.clientY < areaRect.top - 8;
        const outsideBottom = ev.clientY > areaRect.bottom + 8;

        if (outsideLeft || outsideRight || outsideTop || outsideBottom) {
          const dir: "left" | "right" | "top" | "bottom" = outsideLeft
            ? "left"
            : outsideRight
              ? "right"
              : outsideTop
                ? "top"
                : "bottom";
          const neighborId = findJoinableNeighbor(
            curTree,
            sourceAreaId,
            dir,
            bounds
          );
          if (neighborId) {
            latestPreview = {
              sourceAreaId,
              mode: "join",
              joinTargetAreaId: neighborId,
              joinDirection: dir,
            };
            setCornerPreview(latestPreview);
            return;
          }
        }

        // Otherwise -> Split mode inside sourceArea
        const splitDirection: SplitDirection =
          Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
        const rawRatio =
          splitDirection === "horizontal"
            ? (ev.clientX - areaRect.left) / Math.max(1, areaRect.width)
            : (ev.clientY - areaRect.top) / Math.max(1, areaRect.height);
        const splitRatio = clampSplitRatio(rawRatio);

        latestPreview = {
          sourceAreaId,
          mode: "split",
          splitDirection,
          splitRatio,
        };
        setCornerPreview(latestPreview);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (latestPreview) {
          if (
            latestPreview.mode === "join" &&
            latestPreview.joinTargetAreaId
          ) {
            joinLayoutAreas(sourceAreaId, latestPreview.joinTargetAreaId);
          } else if (
            latestPreview.mode === "split" &&
            latestPreview.splitDirection
          ) {
            splitLayoutArea(
              sourceAreaId,
              latestPreview.splitDirection,
              latestPreview.splitRatio ?? 0.5
            );
          }
        }
        setCornerPreview(null);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [joinLayoutAreas, splitLayoutArea]
  );

  const openBorderMenu = useCallback((menu: BorderMenuState) => {
    setBorderMenu(menu);
  }, []);

  // Determine which root node to render (Zen / Maximized / Full BSP tree)
  const effectiveNode = useMemo<LayoutNode>(() => {
    if (panelsCollapsed) {
      const vp = listAreas(tree).find((a) => a.editorType === "viewport");
      if (vp) return vp;
    }
    if (maximizedAreaId) {
      const found = findArea(tree, maximizedAreaId);
      if (found) return found;
    }
    return tree;
  }, [tree, panelsCollapsed, maximizedAreaId]);

  // Mount any detached floating panels that are not currently mounted inside the BSP tree
  // (e.g., pinned panels from another workspace, or panels detached from a closed inspector)
  const mountedPanelIds = useMemo(() => {
    const set = new Set<PanelId>();
    for (const area of listAreas(effectiveNode)) {
      if (area.editorType === "inspector" && area.panels) {
        for (const p of area.panels) set.add(p);
      } else if (area.editorType === "panel" && area.panelId) {
        set.add(area.panelId);
      }
    }
    return set;
  }, [effectiveNode]);

  const orphanDetachedPanelIds = useMemo(() => {
    const result: PanelId[] = [];
    for (const [id, rect] of Object.entries(detachedPanels)) {
      if (!rect) continue;
      const pid = id as PanelId;
      if (mountedPanelIds.has(pid)) continue;
      if (PANEL_WORKSPACE_MAP[pid] === workspaceMode || rect.pinned) {
        result.push(pid);
      }
    }
    return result;
  }, [detachedPanels, mountedPanelIds, workspaceMode]);

  const contextValue = useMemo(
    () => ({
      tree,
      rootElement: rootRef.current,
      dragPayload,
      dropTarget,
      cornerPreview,
      startAreaDrag,
      startPanelDrag,
      startCornerDrag,
      openBorderMenu,
    }),
    [
      tree,
      dragPayload,
      dropTarget,
      cornerPreview,
      startAreaDrag,
      startPanelDrag,
      startCornerDrag,
      openBorderMenu,
    ]
  );

  return (
    <LayoutInteractionContext.Provider value={contextValue}>
      <div
        ref={rootRef}
        className={`workspace-layout-root ${dragPayload ? "is-dragging-layout" : ""}`}
      >
        <LayoutNodeView node={effectiveNode} openBorderMenu={openBorderMenu} />

        {/* Floating detached panels host */}
        <div id="floating-panels-root" className="floating-panels-root" />

        {/* Hidden mount for detached/pinned panels whose source area isn't currently mounted */}
        {orphanDetachedPanelIds.length > 0 && (
          <div className="is-hidden" aria-hidden="true">
            {orphanDetachedPanelIds.map((pid) => {
              const entry = PANEL_REGISTRY[pid];
              return entry ? <div key={pid}>{entry.render()}</div> : null;
            })}
          </div>
        )}

        {/* Right-click Border Context Menu (Blender-style Area Options) */}
        {borderMenu && (
          <div
            className="layout-border-menu"
            style={{
              left: Math.min(borderMenu.x, window.innerWidth - 196),
              top: Math.min(borderMenu.y, window.innerHeight - 170),
            }}
          >
            <div className="layout-dropdown-heading">Area Border</div>
            <button
              type="button"
              className="layout-dropdown-item"
              onClick={() => {
                swapLayoutSplitChildren(borderMenu.splitId);
                setBorderMenu(null);
              }}
            >
              <ArrowLeftRight size={11} />
              <span>Swap Areas</span>
            </button>
            <button
              type="button"
              className="layout-dropdown-item"
              onClick={() => {
                equalizeLayoutSplit(borderMenu.splitId);
                setBorderMenu(null);
              }}
            >
              <Scale size={11} />
              <span>Equalize (50 / 50)</span>
            </button>
            {borderMenu.firstAreaId && (
              <button
                type="button"
                className="layout-dropdown-item"
                onClick={() => {
                  if (borderMenu.firstAreaId) {
                    splitLayoutArea(borderMenu.firstAreaId, "horizontal", 0.5);
                  }
                  setBorderMenu(null);
                }}
              >
                <Columns2 size={11} />
                <span>Vertical Split</span>
              </button>
            )}
            {borderMenu.firstAreaId && (
              <button
                type="button"
                className="layout-dropdown-item"
                onClick={() => {
                  if (borderMenu.firstAreaId) {
                    splitLayoutArea(borderMenu.firstAreaId, "vertical", 0.5);
                  }
                  setBorderMenu(null);
                }}
              >
                <Rows2 size={11} />
                <span>Horizontal Split</span>
              </button>
            )}
            {borderMenu.firstAreaId && borderMenu.secondAreaId && (
              <button
                type="button"
                className="layout-dropdown-item"
                onClick={() => {
                  if (borderMenu.firstAreaId && borderMenu.secondAreaId) {
                    joinLayoutAreas(
                      borderMenu.firstAreaId,
                      borderMenu.secondAreaId
                    );
                  }
                  setBorderMenu(null);
                }}
              >
                <Merge size={11} />
                <span>Join Areas</span>
              </button>
            )}
          </div>
        )}
      </div>
    </LayoutInteractionContext.Provider>
  );
}
