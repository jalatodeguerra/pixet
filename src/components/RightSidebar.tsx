import { useEditorStore } from "../store/editorStore";
import { GameDataPanel } from "./GameDataPanel";
import { BrushPanel } from "./draw/BrushPanel";
import { ColorPalettePanel } from "./draw/ColorPalettePanel";
import { LayersPanel } from "./draw/LayersPanel";
import { ReferencePanel } from "./draw/ReferencePanel";
import { RigSidebar } from "./rig/RigSidebar";
import { TilesetBrowserPanel } from "./tiles/TilesetBrowserPanel";
import { TilesSidebar } from "./tiles/TilesSidebar";

export function RightSidebar() {
  const rightPanelWidth = useEditorStore((s) => s.rightPanelWidth);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const tilesMode = useEditorStore((s) => s.tilesMode);
  const tilesetBrowserDocked = useEditorStore((s) => s.tilesetBrowserDocked);

  const hideDefaultSidebar =
    workspaceMode === "rig" ||
    (workspaceMode === "tiles" && tilesMode === "map");

  return (
    <aside
      className="right-sidebar"
      style={{ width: rightPanelWidth }}
      aria-label="Inspector Sidebar"
    >
      <div
        className={`sidebar-section-stack ${hideDefaultSidebar ? "is-hidden" : ""}`}
      >
        {workspaceMode === "tiles" &&
          tilesMode === "tile" &&
          !tilesetBrowserDocked && <TilesetBrowserPanel />}

        {workspaceMode === "data" && <GameDataPanel />}

        <ColorPalettePanel />
        {workspaceMode === "draw" && <BrushPanel />}
        {workspaceMode === "draw" && <ReferencePanel />}
        <LayersPanel />
      </div>

      {/* Focused Rig Inspector in Rig Mode */}
      {workspaceMode === "rig" && <RigSidebar />}

      {/* Focused Tiles Inspector in Tiles Map Mode */}
      {workspaceMode === "tiles" && tilesMode === "map" && <TilesSidebar />}
    </aside>
  );
}
