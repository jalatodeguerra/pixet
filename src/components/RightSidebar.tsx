import { PANEL_WORKSPACE_MAP, type PanelId } from "../engine/ui/panelLayout";
import { useEditorStore } from "../store/editorStore";
import { GameDataPanel } from "./GameDataPanel";
import { BrushPanel } from "./draw/BrushPanel";
import { ColorPalettePanel } from "./draw/ColorPalettePanel";
import { HistoryPanel } from "./draw/HistoryPanel";
import { LayersPanel } from "./draw/LayersPanel";
import { ReferencePanel } from "./draw/ReferencePanel";
import {
  NodesSidebarAsync,
  RigSidebarAsync,
  Studio3DSidebarAsync,
  TilesSidebarAsync,
} from "./lazyWorkspaces";
import { TilesetBrowserPanel } from "./tiles/TilesetBrowserPanel";

export function RightSidebar() {
  const rightPanelWidth = useEditorStore((s) => s.rightPanelWidth);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const tilesMode = useEditorStore((s) => s.tilesMode);
  const tilesetBrowserDocked = useEditorStore((s) => s.tilesetBrowserDocked);
  const detachedPanels = useEditorStore((s) => s.detachedPanels);

  const hideDefaultSidebar =
    workspaceMode === "rig" ||
    workspaceMode === "studio3d" ||
    workspaceMode === "nodes" ||
    (workspaceMode === "tiles" && tilesMode === "map");

  const hasPinnedIn = (ws: "rig" | "tiles") =>
    Object.entries(detachedPanels).some(
      ([id, rect]) =>
        Boolean(rect?.pinned) && PANEL_WORKSPACE_MAP[id as PanelId] === ws
    );

  const showRigSidebar = workspaceMode === "rig";
  const showTilesSidebar = workspaceMode === "tiles" && tilesMode === "map";

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

        <ColorPalettePanel />
        {workspaceMode === "draw" && <BrushPanel />}
        {workspaceMode === "draw" && <ReferencePanel />}
        {workspaceMode === "draw" && <HistoryPanel />}
        <LayersPanel />
        {workspaceMode === "draw" && <GameDataPanel />}
      </div>

      {/* Focused Rig Inspector in Rig Mode (or hidden when pinned panels exist) */}
      {(showRigSidebar || hasPinnedIn("rig")) && (
        <div className={showRigSidebar ? "sidebar-section-stack" : "is-hidden"}>
          <RigSidebarAsync />
        </div>
      )}

      {/* Focused Tiles Inspector in Tiles Map Mode (or hidden when pinned panels exist) */}
      {(showTilesSidebar || hasPinnedIn("tiles")) && (
        <div className={showTilesSidebar ? "sidebar-section-stack" : "is-hidden"}>
          <TilesSidebarAsync />
        </div>
      )}

      {/* Focused 3D Studio Inspector */}
      {workspaceMode === "studio3d" && <Studio3DSidebarAsync />}

      {/* Focused Nodes Preview & Inspector */}
      {workspaceMode === "nodes" && <NodesSidebarAsync />}
    </aside>
  );
}
