import {
  Box,
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
  dividerAfter?: boolean;
}

const TOOLS: ToolDef[] = [
  { id: "pencil", label: "Pencil", shortcut: "B", icon: Pencil },
  { id: "eraser", label: "Eraser", shortcut: "E", icon: Eraser, dividerAfter: true },
  { id: "line", label: "Line", shortcut: "L", icon: Minus },
  { id: "rect", label: "Rectangle", shortcut: "U", icon: Square },
  { id: "ellipse", label: "Ellipse", shortcut: "O", icon: Circle, dividerAfter: true },
  { id: "fill", label: "Paint Bucket", shortcut: "G", icon: PaintBucket },
  { id: "eyedropper", label: "Eyedropper", shortcut: "I", icon: Pipette, dividerAfter: true },
  { id: "marquee", label: "Rect Marquee", shortcut: "M", icon: Scan },
  { id: "lasso", label: "Lasso Select", icon: Lasso },
  { id: "wand", label: "Magic Wand", icon: Wand2 },
  { id: "move", label: "Move", shortcut: "V", icon: Move, dividerAfter: true },
  { id: "tileStamp", label: "Tile Stamp", shortcut: "T", icon: Grid2x2 },
  { id: "isoBox", label: "Iso Box (2:1)", shortcut: "K", icon: Box },
];

export function ToolRail() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);

  return (
    <aside className="tool-rail" aria-label="Drawing Tools">
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        const active = activeTool === tool.id;
        const title = tool.shortcut
          ? `${tool.label} (${tool.shortcut})`
          : tool.label;
        return (
          <div key={tool.id} style={{ display: "contents" }}>
            <button
              type="button"
              className={`tool-btn ${active ? "active" : ""}`}
              title={title}
              aria-label={title}
              aria-pressed={active}
              onClick={() => setActiveTool(tool.id)}
            >
              <Icon size={16} />
            </button>
            {tool.dividerAfter && <div className="tool-rail-sep" />}
          </div>
        );
      })}
    </aside>
  );
}
