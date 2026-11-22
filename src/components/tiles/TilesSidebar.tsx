import { useEditorStore } from "../../store/editorStore";
import { MapPropertiesPanel } from "./MapPropertiesPanel";
import { TerrainPanel } from "./TerrainPanel";
import { TileLayersPanel } from "./TileLayersPanel";
import { TilePropertiesPanel } from "./TilePropertiesPanel";
import { TilesetBrowserPanel } from "./TilesetBrowserPanel";

export function TilesSidebar() {
  const tilesetBrowserDocked = useEditorStore((s) => s.tilesetBrowserDocked);

  return (
    <>
      {!tilesetBrowserDocked && <TilesetBrowserPanel />}
      <TilePropertiesPanel />
      <TerrainPanel />
      <TileLayersPanel />
      <MapPropertiesPanel />
    </>
  );
}
