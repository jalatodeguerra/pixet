import { useEffect, useRef, useState } from "react";
import {
  Box,
  Brush,
  Circle,
  Eraser,
  Grid2x2,
  Lasso,
  Minus,
  Move,
  PaintBucket,
  Pencil,
  Pipette,
  Scan,
  Square,
  Wand2,
} from "lucide-react";
import { ToolId, useEditorStore } from "../store/editorStore";

interface ToolDef {
  id: ToolId;
  label: string;
  shortcut?: string;
  icon: typeof Pencil;
}

interface ToolGroupDef {
  id: string;
  items: ToolDef[];
  dividerAfter?: boolean;
}

const TOOL_GROUPS: ToolGroupDef[] = [
  {
    id: "brush-group",
    items: [
      { id: "pencil", label: "Pencil", shortcut: "B", icon: Pencil },
      { id: "fillBrush", label: "Fill Brush", shortcut: "F", icon: Brush },
    ],
  },
  {
    id: "eraser-group",
    items: [{ id: "eraser", label: "Eraser", shortcut: "E", icon: Eraser }],
    dividerAfter: true,
  },
  {
    id: "shape-group",
    items: [
      { id: "rect", label: "Rectangle", shortcut: "U", icon: Square },
      { id: "ellipse", label: "Ellipse", shortcut: "O", icon: Circle },
      { id: "line", label: "Line", shortcut: "L", icon: Minus },
      { id: "isoBox", label: "Iso Box (2:1)", shortcut: "K", icon: Box },
    ],
    dividerAfter: true,
  },
  {
    id: "fill-group",
    items: [{ id: "fill", label: "Paint Bucket", shortcut: "G", icon: PaintBucket }],
  },
  {
    id: "eyedropper-group",
    items: [{ id: "eyedropper", label: "Eyedropper", shortcut: "I", icon: Pipette }],
    dividerAfter: true,
  },
  {
    id: "select-group",
    items: [
      { id: "marquee", label: "Rect Marquee", shortcut: "M", icon: Scan },
      { id: "lasso", label: "Lasso Select", icon: Lasso },
      { id: "wand", label: "Magic Wand", icon: Wand2 },
    ],
  },
  {
    id: "move-group",
    items: [{ id: "move", label: "Move", shortcut: "V", icon: Move }],
    dividerAfter: true,
  },
  {
    id: "tile-group",
    items: [{ id: "tileStamp", label: "Tile Stamp", shortcut: "T", icon: Grid2x2 }],
  },
];

export function ToolRail() {
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
    for (const g of TOOL_GROUPS) {
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
      {TOOL_GROUPS.map((group) => {
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
