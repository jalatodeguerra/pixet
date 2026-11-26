import {
  Box,
  Brush,
  Dices,
  Eraser,
  Grid2x2,
  Minus,
  PaintBucket,
  Pipette,
  Scan,
  Sparkles,
  Square,
  type LucideIcon,
} from "lucide-react";

export type TileTool =
  | "stamp"
  | "brush"
  | "rect"
  | "fill"
  | "line"
  | "eraser"
  | "picker"
  | "select"
  | "random"
  | "terrain"
  | "object";

export interface TileToolDef {
  id: TileTool;
  label: string;
  shortcut: string;
  icon: LucideIcon;
}

export const TILE_TOOLS: TileToolDef[] = [
  { id: "stamp", label: "Tile Stamp", shortcut: "T", icon: Grid2x2 },
  { id: "brush", label: "Tile Brush", shortcut: "B", icon: Brush },
  { id: "rect", label: "Tile Rect", shortcut: "R", icon: Square },
  { id: "fill", label: "Tile Fill", shortcut: "G", icon: PaintBucket },
  { id: "line", label: "Tile Line", shortcut: "L", icon: Minus },
  { id: "eraser", label: "Tile Eraser", shortcut: "E", icon: Eraser },
  { id: "picker", label: "Tile Picker", shortcut: "I", icon: Pipette },
  { id: "select", label: "Cell Select", shortcut: "M", icon: Scan },
  { id: "random", label: "Random Brush", shortcut: "N", icon: Dices },
  { id: "terrain", label: "Terrain Paint", shortcut: "A", icon: Sparkles },
  { id: "object", label: "Object Tool", shortcut: "O", icon: Box },
];

export const TILE_TOOL_GROUPS: Array<{
  ids: TileTool[];
  dividerAfter?: boolean;
}> = [
  { ids: ["stamp", "brush", "random"], dividerAfter: true },
  { ids: ["rect", "fill", "line"], dividerAfter: true },
  { ids: ["eraser", "picker", "select"], dividerAfter: true },
  { ids: ["terrain", "object"] },
];

export const TILE_TOOL_BY_ID = new Map<TileTool, TileToolDef>(
  TILE_TOOLS.map((t) => [t.id, t])
);
