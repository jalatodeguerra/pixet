import { useEffect, useRef, useState } from "react";
import { ToolId, useEditorStore } from "../store/editorStore";
import { DRAW_TOOL_GROUPS } from "./draw/drawTools";
import {
  RIG_TOOL_BY_ID,
  RIG_TOOL_GROUPS,
  rigToolDisabledReason,
  rigToolTitle,
} from "./rig/rigTools";
import { TILE_TOOL_BY_ID, TILE_TOOL_GROUPS } from "./tiles/tileTools";
import { Studio3DToolRailAsync } from "./lazyWorkspaces";

export function ToolRail() {
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const tilesMode = useEditorStore((s) => s.tilesMode);
  if (workspaceMode === "studio3d") {
    return <Studio3DToolRailAsync />;
  }
  if (workspaceMode === "rig") {
    return <RigToolRail />;
  }
  if (workspaceMode === "tiles" && tilesMode === "map") {
    return <TileToolRail />;
  }
  return <DrawingToolRail />;
}

function TileToolRail() {
  const tileTool = useEditorStore((s) => s.tileTool);
  const setTileTool = useEditorStore((s) => s.setTileTool);

  return (
    <aside className="tool-rail" aria-label="Tile Tools">
      {TILE_TOOL_GROUPS.map((group, groupIdx) => (
        <div key={`tile-group-${groupIdx}`} style={{ display: "contents" }}>
          {group.ids.map((toolId) => {
            const def = TILE_TOOL_BY_ID.get(toolId);
            if (!def) return null;
            const Icon = def.icon;
            const active = tileTool === toolId;
            const title = `${def.label} (${def.shortcut})`;
            return (
              <button
                key={toolId}
                type="button"
                className={`tool-btn ${active ? "active" : ""}`}
                title={title}
                aria-label={title}
                aria-pressed={active}
                onClick={() => setTileTool(toolId)}
              >
                <Icon size={16} />
              </button>
            );
          })}
          {group.dividerAfter && <div className="tool-rail-sep" />}
        </div>
      ))}
    </aside>
  );
}

function RigToolRail() {
  const rigTool = useEditorStore((s) => s.rigTool);
  const setRigTool = useEditorStore((s) => s.setRigTool);
  const rigMode = useEditorStore((s) => s.rigMode);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  return (
    <aside className="tool-rail" aria-label="Rig Tools">
      {RIG_TOOL_GROUPS.map((group, groupIdx) => (
        <div key={`rig-group-${groupIdx}`} style={{ display: "contents" }}>
          {group.ids.map((toolId) => {
            const def = RIG_TOOL_BY_ID.get(toolId);
            if (!def) return null;
            const Icon = def.icon;
            const reason = rigToolDisabledReason(def, rigMode);
            const disabled = reason !== null;
            const active = rigTool === toolId;
            const title = rigToolTitle(def, rigMode);
            return (
              <button
                key={toolId}
                type="button"
                className={`tool-btn ${active ? "active" : ""}`}
                title={title}
                aria-label={title}
                aria-pressed={active}
                aria-disabled={disabled || undefined}
                onClick={() => {
                  if (reason) {
                    setStatusMessage(`${def.label}: ${reason}`);
                    return;
                  }
                  setRigTool(toolId);
                }}
              >
                <Icon size={16} />
              </button>
            );
          })}
          {group.dividerAfter && <div className="tool-rail-sep" />}
        </div>
      ))}
    </aside>
  );
}

function DrawingToolRail() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);

  const [groupSelection, setGroupSelection] = useState<Record<string, ToolId>>({
    "brush-group": "pencil",
    "shape-group": "rect",
    "select-group": "marquee",
  });
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const railRef = useRef<HTMLElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const openedByHoldRef = useRef(false);

  // Sync group active icon when tool changes via keyboard shortcut or store
  useEffect(() => {
    for (const g of DRAW_TOOL_GROUPS) {
      if (g.items.length > 1 && g.items.some((t) => t.id === activeTool)) {
        setGroupSelection((prev) =>
          prev[g.id] === activeTool ? prev : { ...prev, [g.id]: activeTool }
        );
        break;
      }
    }
  }, [activeTool]);

  useEffect(() => {
    if (!openGroupId) return;
    const onPointerDown = (e: PointerEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) {
        setOpenGroupId(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenGroupId(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openGroupId]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const selectToolFromGroup = (groupId: string, toolId: ToolId) => {
    setActiveTool(toolId);
    setGroupSelection((prev) => ({ ...prev, [groupId]: toolId }));
    setOpenGroupId(null);
  };

  return (
    <aside ref={railRef} className="tool-rail" aria-label="Drawing Tools">
      {DRAW_TOOL_GROUPS.map((group) => {
        const hasFlyout = group.items.length > 1;
        const selectedToolId = groupSelection[group.id] ?? group.items[0].id;
        const displayedTool =
          group.items.find((t) => t.id === selectedToolId) ?? group.items[0];
        const Icon = displayedTool.icon;
        const groupActive = group.items.some((t) => t.id === activeTool);
        const isOpen = openGroupId === group.id;

        const baseTitle = displayedTool.shortcut
          ? `${displayedTool.label} (${displayedTool.shortcut})`
          : displayedTool.label;
        const title = hasFlyout
          ? `${baseTitle} · Hold or right-click for more`
          : baseTitle;

        return (
          <div key={group.id} style={{ display: "contents" }}>
            <div className="tool-group-wrap">
              <button
                type="button"
                className={`tool-btn ${groupActive ? "active" : ""}`}
                title={title}
                aria-label={title}
                aria-pressed={groupActive}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  openedByHoldRef.current = false;
                  clearHoldTimer();
                  if (hasFlyout) {
                    holdTimerRef.current = window.setTimeout(() => {
                      openedByHoldRef.current = true;
                      setOpenGroupId(group.id);
                    }, 220);
                  }
                }}
                onPointerUp={(e) => {
                  if (e.button !== 0) return;
                  clearHoldTimer();
                  if (!openedByHoldRef.current) {
                    setActiveTool(displayedTool.id);
                    setOpenGroupId(null);
                  }
                }}
                onPointerLeave={() => {
                  if (!openedByHoldRef.current) {
                    clearHoldTimer();
                  }
                }}
                onContextMenu={(e) => {
                  if (!hasFlyout) return;
                  e.preventDefault();
                  clearHoldTimer();
                  setOpenGroupId(isOpen ? null : group.id);
                }}
              >
                <Icon size={16} />
                {hasFlyout && <span className="tool-group-corner" />}
              </button>

              {hasFlyout && isOpen && (
                <div className="tool-group-flyout" role="menu">
                  {group.items.map((item) => {
                    const ItemIcon = item.icon;
                    const itemActive = activeTool === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        className={`tool-group-item ${itemActive ? "active" : ""}`}
                        onPointerUp={() => selectToolFromGroup(group.id, item.id)}
                        onClick={() => selectToolFromGroup(group.id, item.id)}
                      >
                        <ItemIcon size={14} />
                        <span style={{ flex: 1, textAlign: "left" }}>
                          {item.label}
                        </span>
                        {item.shortcut && (
                          <span className="menu-shortcut">{item.shortcut}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {group.dividerAfter && <div className="tool-rail-sep" />}
          </div>
        );
      })}
    </aside>
  );
}
