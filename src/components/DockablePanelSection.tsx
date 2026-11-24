import { type CSSProperties, type ReactNode, useState } from "react";
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
  getMaxZOrder,
  PANEL_WORKSPACE_MAP,
  type PanelId,
} from "../engine/ui/panelLayout";
import { useEditorStore } from "../store/editorStore";
import {
  useCurrentAreaId,
  useLayoutInteraction,
} from "./layout/LayoutContext";

export interface DockablePanelSectionProps {
  id: PanelId;
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}

function findDockedDropTarget(
  clientY: number,
  excludeId: PanelId
): { targetId: PanelId | null; index: number } {
  const sidebar = document.querySelector(".right-sidebar");
  if (!sidebar) return { targetId: null, index: 0 };
  const rows = Array.from(
    sidebar.querySelectorAll<HTMLElement>("[data-panel-id]")
  ).filter((el) => el.offsetParent !== null);

  let idx = 0;
  for (const row of rows) {
    const rowId = row.dataset.panelId as PanelId | undefined;
    if (!rowId || rowId === excludeId) continue;
    const rect = row.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return { targetId: rowId, index: idx };
    }
    idx++;
  }
  return { targetId: null, index: idx };
}

function clearDropHighlights(): void {
  document
    .querySelectorAll(".panel-section.is-drop-before")
    .forEach((el) => el.classList.remove("is-drop-before"));
  document
    .querySelector(".right-sidebar.is-dock-target")
    ?.classList.remove("is-dock-target");
}

export function DockablePanelSection({
  id,
  title,
  icon,
  actions,
  defaultOpen = true,
  style,
  children,
}: DockablePanelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const layout = useLayoutInteraction();
  const currentAreaId = useCurrentAreaId();

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
  const reorderDockedPanel = useEditorStore((s) => s.reorderDockedPanel);

  const panelWorkspace = PANEL_WORKSPACE_MAP[id];
  const detachedRect = detachedPanels[id];
  const maxZOrder = getMaxZOrder(detachedPanels);
  const orderList = dockedPanelOrder[panelWorkspace] ?? [];
  const dockedOrderIdx = orderList.indexOf(id);

  const startFloatingDrag = (
    startX: number,
    startY: number,
    origX: number,
    origY: number
  ) => {
    const host = document.getElementById("floating-panels-root");
    const hostRect = host?.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>(".right-sidebar");

    const onMove = (ev: MouseEvent) => {
      clearDropHighlights();
      const sidebarRect = sidebar?.getBoundingClientRect();
      if (sidebarRect && ev.clientX >= sidebarRect.left - 12) {
        sidebar?.classList.add("is-dock-target");
        const drop = findDockedDropTarget(ev.clientY, id);
        if (drop.targetId) {
          sidebar
            ?.querySelector(`[data-panel-id="${drop.targetId}"]`)
            ?.classList.add("is-drop-before");
        }
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

      const sidebarRect = sidebar?.getBoundingClientRect();
      if (sidebarRect && ev.clientX >= sidebarRect.left - 12) {
        const drop = findDockedDropTarget(ev.clientY, id);
        dockPanel(id, drop.index);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleDockedDragStart = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (layout) {
      layout.startPanelDrag(id, currentAreaId, e);
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const sidebar = document.querySelector<HTMLElement>(".right-sidebar");
    const sidebarRect = sidebar?.getBoundingClientRect();
    const host = document.getElementById("floating-panels-root");
    const hostRect = host?.getBoundingClientRect();
    let detachedDuringDrag = false;

    const onMove = (ev: MouseEvent) => {
      if (detachedDuringDrag) return;
      clearDropHighlights();

      // Dragging horizontally left out of the sidebar detaches into a live floating window
      if (sidebarRect && ev.clientX < sidebarRect.left - 24) {
        detachedDuringDrag = true;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);

        const width = Math.max(240, Math.min(360, sidebarRect.width));
        const initX = hostRect
          ? Math.max(0, ev.clientX - hostRect.left - width / 2)
          : 40;
        const initY = hostRect
          ? Math.max(0, ev.clientY - hostRect.top - 12)
          : 40;
        detachPanel(id, { x: initX, y: initY, width });
        startFloatingDrag(ev.clientX, ev.clientY, initX, initY);
        return;
      }

      if (sidebar) {
        const drop = findDockedDropTarget(ev.clientY, id);
        if (drop.targetId) {
          sidebar
            .querySelector(`[data-panel-id="${drop.targetId}"]`)
            ?.classList.add("is-drop-before");
        }
      }
    };

    const onUp = (ev: MouseEvent) => {
      if (detachedDuringDrag) return;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      clearDropHighlights();

      if (Math.abs(ev.clientY - startY) < 6 && Math.abs(ev.clientX - startX) < 6) {
        return;
      }
      const drop = findDockedDropTarget(ev.clientY, id);
      const curList =
        useEditorStore.getState().dockedPanelOrder[panelWorkspace] ?? [];
      const fromIdx = curList.indexOf(id);
      const targetIdx =
        drop.index > fromIdx ? Math.max(0, drop.index - 1) : drop.index;
      reorderDockedPanel(panelWorkspace, id, targetIdx);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleDetachClick = () => {
    const host = document.getElementById("floating-panels-root");
    const hostRect = host?.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>(".right-sidebar");
    const sidebarWidth = sidebar?.getBoundingClientRect().width ?? 270;
    const width = Math.max(240, Math.min(360, sidebarWidth));
    const count = Object.keys(detachedPanels).length;
    const x = hostRect
      ? Math.max(12, hostRect.width - width - (sidebarWidth + 16) - (count % 4) * 18)
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

  if (detachedRect) {
    const visible = panelWorkspace === workspaceMode || detachedRect.pinned;
    if (!visible) return null;
    const host =
      typeof document !== "undefined"
        ? document.getElementById("floating-panels-root")
        : null;
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
              title="Dock back to sidebar"
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

  return (
    <section
      className="panel-section"
      data-panel-id={id}
      style={{
        ...(!layout && dockedOrderIdx >= 0 ? { order: dockedOrderIdx } : undefined),
        ...style,
      }}
    >
      <div className="panel-header">
        <span
          className="panel-drag-handle"
          title={
            layout
              ? "Drag to reorder or dock into any area"
              : "Drag to reorder or pull left to detach"
          }
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
            title="Detach panel"
            onClick={handleDetachClick}
          >
            <PictureInPicture2 size={11} />
          </button>
        </div>
      </div>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}
