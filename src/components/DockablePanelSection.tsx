import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  PanelRightClose,
  PictureInPicture2,
  Pin,
} from "lucide-react";
import {
  clampFloatingRect,
  type DockSide,
  getMaxZOrder,
  PANEL_WORKSPACE_MAP,
  type PanelId,
} from "../engine/ui/panelLayout";
import { useEditorStore } from "../store/editorStore";

export interface DockablePanelSectionProps {
  id: PanelId;
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** When this number increases (and is > 0), the section expands. */
  openSignal?: number;
  style?: CSSProperties;
  children: ReactNode;
}

const COLUMN_SELECTOR: Record<DockSide, string> = {
  right: ".right-sidebar",
  left: ".left-sidebar",
};

function getColumn(side: DockSide): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(COLUMN_SELECTOR[side]);
  return el && el.offsetParent !== null ? el : null;
}

/** Resolve a React-safe portal host that may mount after this component. */
function usePortalHost(hostId: string): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.getElementById(hostId) : null
  );
  useLayoutEffect(() => {
    const el = document.getElementById(hostId);
    if (el !== host) setHost(el);
  });
  return host;
}

function findDockedDropTarget(
  clientY: number,
  excludeId: PanelId,
  column: HTMLElement | null
): { targetId: PanelId | null } {
  if (!column) return { targetId: null };
  const rows = Array.from(
    column.querySelectorAll<HTMLElement>("[data-panel-id]")
  ).filter((el) => el.offsetParent !== null);

  for (const row of rows) {
    const rowId = row.dataset.panelId as PanelId | undefined;
    if (!rowId || rowId === excludeId) continue;
    const rect = row.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return { targetId: rowId };
    }
  }
  return { targetId: null };
}

interface DockHit {
  side: DockSide;
  /** Element that gets the highlight (column, or the empty-left drop zone). */
  highlight: HTMLElement;
  /** Column whose rows are used to find the drop position (null if empty). */
  column: HTMLElement | null;
}

/** Which dock column (if any) is under the pointer. */
function hitDockColumn(x: number, y: number): DockHit | null {
  const right = getColumn("right");
  if (right && x >= right.getBoundingClientRect().left - 12) {
    return { side: "right", highlight: right, column: right };
  }
  const left = getColumn("left");
  if (left) {
    if (x <= left.getBoundingClientRect().right + 12) {
      return { side: "left", highlight: left, column: left };
    }
    return null;
  }
  const zone = document.querySelector<HTMLElement>(".left-dock-dropzone");
  if (zone && zone.offsetParent !== null) {
    const r = zone.getBoundingClientRect();
    if (x <= r.right && y >= r.top && y <= r.bottom) {
      return { side: "left", highlight: zone, column: null };
    }
  }
  return null;
}

function clearDropHighlights(): void {
  document
    .querySelectorAll(".panel-section.is-drop-before")
    .forEach((el) => el.classList.remove("is-drop-before"));
  document
    .querySelectorAll(".is-dock-target")
    .forEach((el) => el.classList.remove("is-dock-target"));
}

function highlightDrop(hit: DockHit, targetId: PanelId | null): void {
  hit.highlight.classList.add("is-dock-target");
  if (targetId) {
    hit.column
      ?.querySelector(`[data-panel-id="${targetId}"]`)
      ?.classList.add("is-drop-before");
  }
}

function setDragActive(active: boolean): void {
  document.body.classList.toggle("is-panel-dragging", active);
}

export function DockablePanelSection({
  id,
  title,
  icon,
  actions,
  defaultOpen = true,
  openSignal = 0,
  style,
  children,
}: DockablePanelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const detachedPanels = useEditorStore((s) => s.detachedPanels);
  const dockedPanelOrder = useEditorStore((s) => s.dockedPanelOrder);
  const detachPanel = useEditorStore((s) => s.detachPanel);
  const dockPanel = useEditorStore((s) => s.dockPanel);
  const updateFloatingPanelRect = useEditorStore(
    (s) => s.updateFloatingPanelRect
  );
  const toggleFloatingPanelCollapsed = useEditorStore(
    (s) => s.toggleFloatingPanelCollapsed
  );
  const toggleFloatingPanelPinned = useEditorStore(
    (s) => s.toggleFloatingPanelPinned
  );
  const bringFloatingPanelToFront = useEditorStore(
    (s) => s.bringFloatingPanelToFront
  );
  const placePanel = useEditorStore((s) => s.placePanel);
  const setPanelSide = useEditorStore((s) => s.setPanelSide);
  const setPanelHidden = useEditorStore((s) => s.setPanelHidden);
  const openContextMenu = useEditorStore((s) => s.openContextMenu);
  const panelSides = useEditorStore((s) => s.panelSides);
  const hiddenPanels = useEditorStore((s) => s.hiddenPanels);
  const floatingHost = usePortalHost("floating-panels-root");
  const leftHost = usePortalHost("left-dock-root");

  const panelWorkspace = PANEL_WORKSPACE_MAP[id];
  const detachedRect = detachedPanels[id];
  const maxZOrder = getMaxZOrder(detachedPanels);
  const orderList = dockedPanelOrder[panelWorkspace] ?? [];
  const dockedOrderIdx = orderList.indexOf(id);
  const hidden = hiddenPanels[id] === true;
  // A side only applies inside the panel's own workspace (draw panels also
  // appear in the Tiles sidebar and stay on the right there).
  const dockSide: DockSide =
    panelSides[id] === "left" && panelWorkspace === workspaceMode
      ? "left"
      : "right";

  const startFloatingDrag = (
    startX: number,
    startY: number,
    origX: number,
    origY: number
  ) => {
    const hostRect = document
      .getElementById("floating-panels-root")
      ?.getBoundingClientRect();
    setDragActive(true);

    const onMove = (ev: MouseEvent) => {
      clearDropHighlights();
      const hit = hitDockColumn(ev.clientX, ev.clientY);
      if (hit) {
        highlightDrop(hit, findDockedDropTarget(ev.clientY, id, hit.column).targetId);
      }

      const curRect = useEditorStore.getState().detachedPanels[id];
      if (!curRect) return;
      const boundsW = hostRect?.width ?? window.innerWidth;
      const boundsH = hostRect?.height ?? window.innerHeight;
      const clamped = clampFloatingRect(
        {
          ...curRect,
          x: origX + (ev.clientX - startX),
          y: origY + (ev.clientY - startY),
        },
        boundsW,
        boundsH
      );
      updateFloatingPanelRect(id, { x: clamped.x, y: clamped.y });
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      clearDropHighlights();
      // Hit-test while the empty-left drop zone is still displayed.
      const hit = hitDockColumn(ev.clientX, ev.clientY);
      setDragActive(false);
      if (hit) {
        const drop = findDockedDropTarget(ev.clientY, id, hit.column);
        placePanel(id, hit.side, drop.targetId);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleDockedDragStart = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const ownColumn = getColumn(dockSide);
    const ownRect = ownColumn?.getBoundingClientRect();
    const hostRect = document
      .getElementById("floating-panels-root")
      ?.getBoundingClientRect();
    let detachedDuringDrag = false;
    setDragActive(true);

    const outsideOwn = (x: number) =>
      ownRect
        ? dockSide === "right"
          ? x < ownRect.left - 24
          : x > ownRect.right + 24
        : false;

    const onMove = (ev: MouseEvent) => {
      if (detachedDuringDrag) return;
      clearDropHighlights();

      const hit = hitDockColumn(ev.clientX, ev.clientY);
      if (hit) {
        highlightDrop(hit, findDockedDropTarget(ev.clientY, id, hit.column).targetId);
        return;
      }

      // Pulling out of the column detaches into a live floating window
      if (outsideOwn(ev.clientX)) {
        detachedDuringDrag = true;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);

        const width = Math.max(240, Math.min(360, ownRect?.width ?? 270));
        const initX = hostRect
          ? Math.max(0, ev.clientX - hostRect.left - width / 2)
          : 40;
        const initY = hostRect
          ? Math.max(0, ev.clientY - hostRect.top - 12)
          : 40;
        detachPanel(id, { x: initX, y: initY, width });
        startFloatingDrag(ev.clientX, ev.clientY, initX, initY);
      }
    };

    const onUp = (ev: MouseEvent) => {
      if (detachedDuringDrag) return;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      clearDropHighlights();
      const hit = hitDockColumn(ev.clientX, ev.clientY);
      setDragActive(false);

      if (Math.abs(ev.clientY - startY) < 6 && Math.abs(ev.clientX - startX) < 6) {
        return;
      }
      if (!hit) return;
      const drop = findDockedDropTarget(ev.clientY, id, hit.column);
      placePanel(id, hit.side, drop.targetId);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleDetachClick = () => {
    const host = document.getElementById("floating-panels-root");
    const hostRect = host?.getBoundingClientRect();
    const sidebar = getColumn(dockSide);
    const sidebarWidth = sidebar?.getBoundingClientRect().width ?? 270;
    const width = Math.max(240, Math.min(360, sidebarWidth));
    const count = Object.keys(detachedPanels).length;
    const x = hostRect
      ? dockSide === "left"
        ? Math.max(12, sidebarWidth + 16 + (count % 4) * 18)
        : Math.max(12, hostRect.width - width - (sidebarWidth + 16) - (count % 4) * 18)
      : 40;
    const y = 16 + (count % 5) * 24;
    detachPanel(id, { x, y, width });
  };

  const startResize = (
    e: React.MouseEvent<HTMLDivElement>,
    edges: { east?: boolean; south?: boolean }
  ) => {
    if (!detachedRect || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const origW = detachedRect.width;
    const origH =
      detachedRect.height ??
      (e.currentTarget.parentElement?.getBoundingClientRect().height || 220);
    const host = document.getElementById("floating-panels-root");
    const hostRect = host?.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const boundsW = hostRect?.width ?? window.innerWidth;
      const boundsH = hostRect?.height ?? window.innerHeight;
      const nextW = edges.east ? origW + (ev.clientX - startX) : origW;
      const nextH = edges.south ? origH + (ev.clientY - startY) : detachedRect.height;
      const clamped = clampFloatingRect(
        { ...detachedRect, width: nextW, height: nextH },
        boundsW,
        boundsH
      );
      updateFloatingPanelRect(id, {
        width: clamped.width,
        height: clamped.height,
      });
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (hidden) return null;

  const openPanelMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const otherSide: DockSide = dockSide === "left" ? "right" : "left";
    openContextMenu(e.clientX, e.clientY, [
      detachedRect
        ? {
            kind: "item",
            label: "Dock Back to Sidebar",
            action: () => dockPanel(id),
          }
        : {
            kind: "item",
            label: "Detach Panel",
            action: handleDetachClick,
          },
      {
        kind: "item",
        label: `Move to ${otherSide === "left" ? "Left" : "Right"} Dock`,
        action: () => {
          if (detachedRect) placePanel(id, otherSide);
          else setPanelSide(id, otherSide);
        },
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Hide Panel",
        action: () => setPanelHidden(id, true),
      },
    ]);
  };

  if (detachedRect) {
    const visible = panelWorkspace === workspaceMode || detachedRect.pinned;
    if (!visible) return null;
    const host = floatingHost;
    if (!host) return null;

    const isFocused = detachedRect.zOrder === maxZOrder;

    return createPortal(
      <div
        className={`floating-panel-window ${isFocused ? "is-focused" : ""}`}
        style={{
          left: detachedRect.x,
          top: detachedRect.y,
          width: detachedRect.width,
          height: detachedRect.collapsed
            ? "auto"
            : detachedRect.height !== null
              ? detachedRect.height
              : "auto",
          zIndex: 1 + detachedRect.zOrder,
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          bringFloatingPanelToFront(id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <div
          className="floating-panel-header"
          onContextMenu={openPanelMenu}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button")) return;
            e.preventDefault();
            e.stopPropagation();
            bringFloatingPanelToFront(id);
            startFloatingDrag(
              e.clientX,
              e.clientY,
              detachedRect.x,
              detachedRect.y
            );
          }}
        >
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 18, height: 18 }}
            title={detachedRect.collapsed ? "Expand Panel" : "Collapse Panel"}
            onClick={() => toggleFloatingPanelCollapsed(id)}
          >
            {detachedRect.collapsed ? (
              <ChevronRight size={12} />
            ) : (
              <ChevronDown size={12} />
            )}
          </button>
          <span className="floating-panel-title">
            <GripVertical size={11} color="var(--text-muted)" />
            {icon}
            <span>{title}</span>
          </span>
          <div className="panel-header-actions">
            {actions}
            <button
              type="button"
              className={`icon-action-btn ${detachedRect.pinned ? "active" : ""}`}
              style={{ width: 18, height: 18 }}
              title={
                detachedRect.pinned
                  ? "Unpin (follow workspace)"
                  : "Pin across workspaces"
              }
              onClick={() => toggleFloatingPanelPinned(id)}
            >
              <Pin size={11} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 18, height: 18 }}
              title="Dock back to sidebar (right-click header for more)"
              onClick={() => dockPanel(id)}
            >
              <PanelRightClose size={11} />
            </button>
          </div>
        </div>

        {!detachedRect.collapsed && (
          <div className="floating-panel-body">
            <div className="panel-body">{children}</div>
          </div>
        )}

        {!detachedRect.collapsed && (
          <>
            <div
              className="floating-panel-resize-e"
              onMouseDown={(e) => startResize(e, { east: true })}
            />
            <div
              className="floating-panel-resize-s"
              onMouseDown={(e) => startResize(e, { south: true })}
            />
            <div
              className="floating-panel-resize-se"
              onMouseDown={(e) => startResize(e, { east: true, south: true })}
            />
          </>
        )}
      </div>,
      host
    );
  }

  const section = (
    <section
      className="panel-section"
      data-panel-id={id}
      style={{
        ...(dockedOrderIdx >= 0 ? { order: dockedOrderIdx } : undefined),
        ...style,
      }}
    >
      <div className="panel-header" onContextMenu={openPanelMenu}>
        <span
          className="panel-drag-handle"
          title="Drag to reorder, move between docks, or pull out to detach"
          onMouseDown={handleDockedDragStart}
        >
          <GripVertical size={11} />
        </span>
        <button
          type="button"
          className="panel-collapse-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {icon}
          <span>{title}</span>
        </button>
        <div className="panel-header-actions">
          {actions}
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 18, height: 18 }}
            title="Detach panel (right-click header for more)"
            onClick={handleDetachClick}
          >
            <PictureInPicture2 size={11} />
          </button>
        </div>
      </div>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );

  if (dockSide === "left") {
    // Until the left dock mounts, keep the panel in place (right column).
    return leftHost ? createPortal(section, leftHost) : section;
  }
  return section;
}
