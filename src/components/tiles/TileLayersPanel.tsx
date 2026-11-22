import { useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Plus } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";

export function TileLayersPanel() {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const toggleLayerVisible = useEditorStore((s) => s.toggleLayerVisible);
  const addTilemapLayer = useEditorStore((s) => s.addTilemapLayer);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  const [collapsed, setCollapsed] = useState(false);

  const tilemapLayers = layers.filter((l) => l.kind === "tilemap");

  return (
    <section className="panel-section">
      <div className="panel-header">
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span>Tilemap Layers ({tilemapLayers.length})</span>
        </button>
        <div className="panel-header-actions">
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            title="New Tilemap Layer"
            onClick={() => {
              addTilemapLayer();
              setStatusMessage("Created Tilemap layer");
            }}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="panel-body">
          {tilemapLayers.length === 0 ? (
            <div className="mode-hint">
              No tilemap layers yet. Click + to add one.
            </div>
          ) : (
            <div className="tiles-layer-list">
              {tilemapLayers.map((layer) => {
                const active = layer.id === activeLayerId;
                return (
                  <div
                    key={layer.id}
                    className={`tiles-layer-row ${active ? "active" : ""}`}
                    onClick={() => selectLayer(layer.id)}
                  >
                    <button
                      type="button"
                      className="icon-action-btn"
                      style={{ width: 20, height: 20 }}
                      title={layer.visible ? "Hide Layer" : "Show Layer"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLayerVisible(layer.id);
                      }}
                    >
                      {layer.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                    </button>
                    <span className="tiles-layer-name">{layer.name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
