import type { ReactNode } from "react";
import {
  Bone,
  Crosshair,
  Eye,
  Film,
  Grid,
  History,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Link2,
  Map,
  Monitor,
  Mountain,
  Paintbrush,
  Palette,
  PanelRight,
  Sliders,
  Sparkles,
  SquareStack,
  Weight,
} from "lucide-react";
import type { PanelId, PanelWorkspace } from "../../engine/ui/panelLayout";
import type { AreaEditorType } from "../../engine/ui/workspaceLayout";
import { GameDataPanel } from "../GameDataPanel";
import { BrushPanel } from "../draw/BrushPanel";
import { ColorPalettePanel } from "../draw/ColorPalettePanel";
import { HistoryPanel } from "../draw/HistoryPanel";
import { LayersPanel } from "../draw/LayersPanel";
import { ReferencePanel } from "../draw/ReferencePanel";
import { BonePropertiesPanel } from "../rig/BonePropertiesPanel";
import { BoneTreePanel } from "../rig/BoneTreePanel";
import { ClipsPosesPanel } from "../rig/ClipsPosesPanel";
import { ConstraintsPanel } from "../rig/ConstraintsPanel";
import { RigRenderPanel } from "../rig/RigRenderPanel";
import { BoundLayersPanel } from "../rig/RigSidebar";
import { SlotsPanel } from "../rig/SlotsPanel";
import { WeightsPanel } from "../rig/WeightsPanel";
import { MapPropertiesPanel } from "../tiles/MapPropertiesPanel";
import { TerrainPanel } from "../tiles/TerrainPanel";
import { TileLayersPanel } from "../tiles/TileLayersPanel";
import { TilePropertiesPanel } from "../tiles/TilePropertiesPanel";
import { TilesetBrowserPanel } from "../tiles/TilesetBrowserPanel";

export interface PanelRegistryEntry {
  id: PanelId;
  title: string;
  workspace: PanelWorkspace;
  icon: ReactNode;
  render: () => ReactNode;
}

export const PANEL_REGISTRY: Record<PanelId, PanelRegistryEntry> = {
  "color-palette": {
    id: "color-palette",
    title: "Color & Palette",
    workspace: "draw",
    icon: <Palette size={11} />,
    render: () => <ColorPalettePanel />,
  },
  brush: {
    id: "brush",
    title: "Brush & Ink",
    workspace: "draw",
    icon: <Paintbrush size={11} />,
    render: () => <BrushPanel />,
  },
  reference: {
    id: "reference",
    title: "Reference",
    workspace: "draw",
    icon: <ImageIcon size={11} />,
    render: () => <ReferencePanel />,
  },
  history: {
    id: "history",
    title: "History",
    workspace: "draw",
    icon: <History size={11} />,
    render: () => <HistoryPanel />,
  },
  layers: {
    id: "layers",
    title: "Layers",
    workspace: "draw",
    icon: <Layers size={11} />,
    render: () => <LayersPanel />,
  },
  "game-data": {
    id: "game-data",
    title: "Game Data",
    workspace: "data",
    icon: <Crosshair size={11} />,
    render: () => <GameDataPanel />,
  },
  "tiles-browser": {
    id: "tiles-browser",
    title: "Tileset Browser",
    workspace: "tiles",
    icon: <LayoutGrid size={11} />,
    render: () => <TilesetBrowserPanel />,
  },
  "tiles-props": {
    id: "tiles-props",
    title: "Tile Properties",
    workspace: "tiles",
    icon: <Sliders size={11} />,
    render: () => <TilePropertiesPanel />,
  },
  "tiles-terrain": {
    id: "tiles-terrain",
    title: "Terrain",
    workspace: "tiles",
    icon: <Mountain size={11} />,
    render: () => <TerrainPanel />,
  },
  "tiles-layers": {
    id: "tiles-layers",
    title: "Tile Layers",
    workspace: "tiles",
    icon: <Layers size={11} />,
    render: () => <TileLayersPanel />,
  },
  "tiles-map-props": {
    id: "tiles-map-props",
    title: "Map Properties",
    workspace: "tiles",
    icon: <Map size={11} />,
    render: () => <MapPropertiesPanel />,
  },
  "rig-bone-tree": {
    id: "rig-bone-tree",
    title: "Skeleton Tree",
    workspace: "rig",
    icon: <Bone size={11} />,
    render: () => <BoneTreePanel />,
  },
  "rig-bone-props": {
    id: "rig-bone-props",
    title: "Bone Properties",
    workspace: "rig",
    icon: <Sliders size={11} />,
    render: () => <BonePropertiesPanel />,
  },
  "rig-constraints": {
    id: "rig-constraints",
    title: "Constraints",
    workspace: "rig",
    icon: <Link2 size={11} />,
    render: () => <ConstraintsPanel />,
  },
  "rig-slots": {
    id: "rig-slots",
    title: "Slots & Attachments",
    workspace: "rig",
    icon: <SquareStack size={11} />,
    render: () => <SlotsPanel />,
  },
  "rig-weights": {
    id: "rig-weights",
    title: "Skin Weights",
    workspace: "rig",
    icon: <Weight size={11} />,
    render: () => <WeightsPanel />,
  },
  "rig-clips-poses": {
    id: "rig-clips-poses",
    title: "Clips & Poses",
    workspace: "rig",
    icon: <Film size={11} />,
    render: () => <ClipsPosesPanel />,
  },
  "rig-render": {
    id: "rig-render",
    title: "Rig Render",
    workspace: "rig",
    icon: <Sparkles size={11} />,
    render: () => <RigRenderPanel />,
  },
  "rig-bound-layers": {
    id: "rig-bound-layers",
    title: "Bound Layers",
    workspace: "rig",
    icon: <Layers size={11} />,
    render: () => <BoundLayersPanel />,
  },
};

export const ALL_PANEL_IDS: PanelId[] = Object.keys(PANEL_REGISTRY) as PanelId[];

export interface AreaEditorMeta {
  type: AreaEditorType;
  label: string;
  icon: ReactNode;
}

export const AREA_EDITOR_LIST: AreaEditorMeta[] = [
  { type: "viewport", label: "Canvas Viewport", icon: <Monitor size={11} /> },
  { type: "inspector", label: "Inspector Stack", icon: <PanelRight size={11} /> },
  { type: "timeline", label: "Timeline", icon: <Film size={11} /> },
  { type: "preview", label: "Animation Preview", icon: <Eye size={11} /> },
  { type: "tiles-browser", label: "Tileset Browser", icon: <Grid size={11} /> },
];

export function getAreaDisplayMeta(
  editorType: AreaEditorType,
  panelId?: PanelId
): { label: string; icon: ReactNode } {
  if (editorType === "panel" && panelId) {
    const entry = PANEL_REGISTRY[panelId];
    if (entry) return { label: entry.title, icon: entry.icon };
  }
  const found = AREA_EDITOR_LIST.find((e) => e.type === editorType);
  if (found) return { label: found.label, icon: found.icon };
  return { label: "Panel", icon: <PanelRight size={11} /> };
}
