import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  Columns2,
  GripHorizontal,
  Layers2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Rows2,
  Rows3,
  X,
} from "lucide-react";
import {
  countAreas,
  countViewportAreas,
  type AreaNode,
} from "../../engine/ui/workspaceLayout";
import type { PanelId, PanelWorkspace } from "../../engine/ui/panelLayout";
import { useEditorStore } from "../../store/editorStore";
import { useLayoutInteraction } from "./LayoutContext";
import {
  ALL_PANEL_IDS,
  AREA_EDITOR_LIST,
  getAreaDisplayMeta,
  PANEL_REGISTRY,
} from "./panelRegistry";

interface AreaHeaderProps {
  area: AreaNode;
}

const WORKSPACE_GROUP_LABELS: Record<PanelWorkspace, string> = {
  draw: "Draw Panels",
  tiles: "Tiles Panels",
  rig: "Rig Panels",
  data: "Data Panels",
};

export function AreaHeader({ area }: AreaHeaderProps) {
  const layout = useLayoutInteraction();
  const setLayoutAreaEditor = useEditorStore((s) => s.setLayoutAreaEditor);
  const splitLayoutArea = useEditorStore((s) => s.splitLayoutArea);
  const closeLayoutArea = useEditorStore((s) => s.closeLayoutArea);
  const setLayoutInspectorMode = useEditorStore((s) => s.setLayoutInspectorMode);
  const addLayoutPanelToInspector = useEditorStore(
    (s) => s.addLayoutPanelToInspector
  );
  const maximizedAreaId = useEditorStore((s) => s.maximizedAreaId);
  const toggleMaximizeArea = useEditorStore((s) => s.toggleMaximizeArea);
  const toolRailVisible = useEditorStore(
    (s) => s.workspaceLayouts.toolRailVisible
  );
  const toolRailSide = useEditorStore((s) => s.workspaceLayouts.toolRailSide);
  const toggleToolRailVisible = useEditorStore((s) => s.toggleToolRailVisible);
  const setToolRailSide = useEditorStore((s) => s.setToolRailSide);

  const [openMenu, setOpenMenu] = useState<
    "switcher" | "add-panel" | "actions" | null
  >(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const meta = getAreaDisplayMeta(area.editorType, area.panelId);
  const isMaximized = maximizedAreaId === area.id;
  const totalAreas = layout ? countAreas(layout.tree) : 1;
  const viewportCount = layout ? countViewportAreas(layout.tree) : 1;
  const canClose =
    totalAreas > 1 && !(area.editorType === "viewport" && viewportCount <= 1);

  const panelsByWorkspace: Record<PanelWorkspace, PanelId[]> = {
    draw: [],
    tiles: [],
    rig: [],
    data: [],
  };
  for (const pid of ALL_PANEL_IDS) {
    panelsByWorkspace[PANEL_REGISTRY[pid].workspace].push(pid);
  }

  return (
    <div ref={headerRef} className="layout-area-header">
      {/* Left: Editor Type Switcher (Blender-style) */}
      <div className="layout-area-menu-wrap">
        <button
          type="button"
          className={`layout-editor-switcher ${openMenu === "switcher" ? "active" : ""}`}
          title="Switch Editor Type"
          onClick={() =>
            setOpenMenu((m) => (m === "switcher" ? null : "switcher"))
          }
        >
          {meta.icon}
          <span className="layout-editor-label">{meta.label}</span>
          <ChevronDown size={10} />
        </button>

        {openMenu === "switcher" && (
          <div className="layout-dropdown layout-dropdown-left">
            <div className="layout-dropdown-heading">Editors</div>
            {AREA_EDITOR_LIST.map((ed) => {
              const isCurrent = area.editorType === ed.type;
              const disabled =
                area.editorType === "viewport" &&
                ed.type !== "viewport" &&
                viewportCount <= 1;
              return (
                <button
                  key={ed.type}
                  type="button"
                  disabled={disabled}
                  className={`layout-dropdown-item ${isCurrent ? "active" : ""}`}
                  title={
                    disabled
                      ? "Primary Canvas Viewport cannot be replaced (switch another area to Canvas Viewport to swap)"
                      : undefined
                  }
                  onClick={() => {
                    setLayoutAreaEditor(area.id, ed.type);
                    setOpenMenu(null);
                  }}
                >
                  {ed.icon}
                  <span>{ed.label}</span>
                </button>
              );
            })}

            {(["draw", "tiles", "rig", "data"] as const).map((ws) => (
              <div key={ws}>
                <div className="layout-dropdown-heading">
                  {WORKSPACE_GROUP_LABELS[ws]}
                </div>
                {panelsByWorkspace[ws].map((pid) => {
                  const entry = PANEL_REGISTRY[pid];
                  const isCurrent =
                    area.editorType === "panel" && area.panelId === pid;
                  const disabled =
                    area.editorType === "viewport" && viewportCount <= 1;
                  return (
                    <button
                      key={pid}
                      type="button"
                      disabled={disabled}
                      className={`layout-dropdown-item ${isCurrent ? "active" : ""}`}
                      onClick={() => {
                        setLayoutAreaEditor(area.id, "panel", { panelId: pid });
                        setOpenMenu(null);
                      }}
                    >
                      {entry.icon}
                      <span>{entry.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Center: Drag handle to move/dock area */}
      <div
        className="layout-area-drag-strip"
        title="Drag to move, swap, or dock area"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          layout?.startAreaDrag(area.id, e);
        }}
        onDoubleClick={() => toggleMaximizeArea(area.id)}
      >
        <GripHorizontal size={11} />
      </div>

      {/* Right: Area Controls */}
      <div className="layout-area-controls">
        {area.editorType === "viewport" && (
          <>
            <button
              type="button"
              className={`layout-area-btn ${toolRailVisible ? "active" : ""}`}
              title={
                toolRailVisible
                  ? "Hide Tool Rail (Ctrl+Shift+T)"
                  : "Show Tool Rail (Ctrl+Shift+T)"
              }
              onClick={toggleToolRailVisible}
            >
              <PanelLeft size={11} />
            </button>
            {toolRailVisible && (
              <button
                type="button"
                className="layout-area-btn"
                title={`Move Tool Rail to ${toolRailSide === "left" ? "Right" : "Left"}`}
                onClick={() =>
                  setToolRailSide(toolRailSide === "left" ? "right" : "left")
                }
              >
                <ArrowLeftRight size={10} />
              </button>
            )}
          </>
        )}

        {area.editorType === "inspector" && (
          <>
            <button
              type="button"
              className={`layout-area-btn ${area.inspectorMode === "tabs" ? "active" : ""}`}
              title={
                area.inspectorMode === "tabs"
                  ? "Switch to Vertical Stack"
                  : "Switch to Tabbed Panels"
              }
              onClick={() =>
                setLayoutInspectorMode(
                  area.id,
                  area.inspectorMode === "tabs" ? "stack" : "tabs"
                )
              }
            >
              {area.inspectorMode === "tabs" ? (
                <Rows3 size={11} />
              ) : (
                <Layers2 size={11} />
              )}
            </button>

            <div className="layout-area-menu-wrap">
              <button
                type="button"
                className={`layout-area-btn ${openMenu === "add-panel" ? "active" : ""}`}
                title="Add Panel to Inspector"
                onClick={() =>
                  setOpenMenu((m) => (m === "add-panel" ? null : "add-panel"))
                }
              >
                <Plus size={11} />
              </button>
              {openMenu === "add-panel" && (
                <div className="layout-dropdown layout-dropdown-right">
                  {(["draw", "tiles", "rig", "data"] as const).map((ws) => (
                    <div key={ws}>
                      <div className="layout-dropdown-heading">
                        {WORKSPACE_GROUP_LABELS[ws]}
                      </div>
                      {panelsByWorkspace[ws].map((pid) => {
                        const entry = PANEL_REGISTRY[pid];
                        const already = area.panels?.includes(pid) ?? false;
                        return (
                          <button
                            key={pid}
                            type="button"
                            disabled={already}
                            className={`layout-dropdown-item ${already ? "active" : ""}`}
                            onClick={() => {
                              addLayoutPanelToInspector(area.id, pid);
                              setOpenMenu(null);
                            }}
                          >
                            {entry.icon}
                            <span>{entry.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <button
          type="button"
          className={`layout-area-btn ${isMaximized ? "active" : ""}`}
          title={isMaximized ? "Restore Area (Ctrl+Space)" : "Maximize Area (Ctrl+Space)"}
          onClick={() => toggleMaximizeArea(area.id)}
        >
          {isMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
        </button>

        <div className="layout-area-menu-wrap">
          <button
            type="button"
            className={`layout-area-btn ${openMenu === "actions" ? "active" : ""}`}
            title="Area Options"
            onClick={() =>
              setOpenMenu((m) => (m === "actions" ? null : "actions"))
            }
          >
            <MoreHorizontal size={11} />
          </button>

          {openMenu === "actions" && (
            <div className="layout-dropdown layout-dropdown-right">
              <button
                type="button"
                className="layout-dropdown-item"
                onClick={() => {
                  splitLayoutArea(area.id, "horizontal", 0.5);
                  setOpenMenu(null);
                }}
              >
                <Columns2 size={11} />
                <span>Split Left / Right</span>
              </button>
              <button
                type="button"
                className="layout-dropdown-item"
                onClick={() => {
                  splitLayoutArea(area.id, "vertical", 0.5);
                  setOpenMenu(null);
                }}
              >
                <Rows2 size={11} />
                <span>Split Top / Bottom</span>
              </button>
              <button
                type="button"
                className="layout-dropdown-item"
                disabled={!canClose}
                onClick={() => {
                  closeLayoutArea(area.id);
                  setOpenMenu(null);
                }}
              >
                <X size={11} />
                <span>Close Area</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
