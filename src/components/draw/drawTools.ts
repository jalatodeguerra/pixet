import {
  Blend,
  Box,
  Brush,
  Circle,
  CircleDashed,
  Contrast,
  Eraser,
  Grid2x2,
  Grip,
  Lasso,
  Minus,
  Move,
  PaintBucket,
  Pencil,
  Pentagon,
  Pipette,
  Scan,
  Shuffle,
  Spline,
  SprayCan,
  Square,
  Wand2,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { ToolId } from "../../store/editorStore";

export interface DrawToolDef {
  id: ToolId;
  label: string;
  shortcut?: string;
  icon: LucideIcon;
}

export interface DrawToolGroupDef {
  id: string;
  items: DrawToolDef[];
  dividerAfter?: boolean;
}

export const DRAW_TOOL_GROUPS: DrawToolGroupDef[] = [
  {
    id: "brush-group",
    items: [
      { id: "pencil", label: "Pencil", shortcut: "B", icon: Pencil },
      { id: "fillBrush", label: "Fill Brush", shortcut: "F", icon: Brush },
      { id: "ditherBrush", label: "Dither Brush", shortcut: "D", icon: Grip },
      { id: "shading", label: "Shading", shortcut: "J", icon: Contrast },
      { id: "spray", label: "Spray", shortcut: "S", icon: SprayCan },
      { id: "jumble", label: "Jumble", shortcut: "Shift+S", icon: Shuffle },
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
      { id: "curve", label: "Curve (Bezier)", shortcut: "C", icon: Spline },
      { id: "polygon", label: "Polygon", shortcut: "P", icon: Pentagon },
      { id: "isoBox", label: "Iso Box (2:1)", shortcut: "K", icon: Box },
    ],
    dividerAfter: true,
  },
  {
    id: "fill-group",
    items: [
      { id: "fill", label: "Paint Bucket", shortcut: "G", icon: PaintBucket },
      { id: "gradient", label: "Gradient", shortcut: "Shift+G", icon: Blend },
    ],
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
      { id: "ellipseMarquee", label: "Ellipse Marquee", icon: CircleDashed },
      { id: "lasso", label: "Lasso Select", icon: Lasso },
      { id: "polyLasso", label: "Poly Lasso", icon: Waypoints },
      { id: "wand", label: "Magic Wand", shortcut: "W", icon: Wand2 },
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

const ALL_DRAW_TOOLS: DrawToolDef[] = DRAW_TOOL_GROUPS.flatMap((g) => g.items);

export const DRAW_TOOL_BY_ID = new Map<ToolId, DrawToolDef>(
  ALL_DRAW_TOOLS.map((t) => [t.id, t])
);

export const DRAW_TOOL_SHORTCUTS: Record<string, ToolId> = Object.fromEntries(
  ALL_DRAW_TOOLS.filter(
    (t) => Boolean(t.shortcut) && !t.shortcut!.includes("+")
  ).map((t) => [t.shortcut!.toLowerCase(), t.id])
) as Record<string, ToolId>;
