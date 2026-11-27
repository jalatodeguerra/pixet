import { Dices, Plus, Upload, X } from "lucide-react";
import { DockablePanelSection } from "../DockablePanelSection";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { nodeRegistry } from "../../engine/nodes/NodeRegistry";
import {
  CUSTOM_PALETTE_SOURCE,
  DOCUMENT_PALETTE_SOURCE,
  normalizePaletteParam,
  resolvePaletteColors,
} from "../../engine/nodes/PaletteLut";
import {
  assignGraphToModel3DMaterial,
  bakeAnimationToDrawFrames,
  bakeAutoTileSetFromGraph,
  bakeMaterialToDrawMapRoleStack,
  bakeNodeOutputToDrawLayer,
  bakeNodeOutputToTilesetSlot,
  exportPbrOrmAndGodotPack,
} from "../../engine/nodes/pixetBridges";
import {
  beginNodeTransaction,
  commitNodeTransaction,
  mutateActiveNodeGraph,
  updateActiveNodeGraphLive,
} from "../../engine/nodes/nodeActions";
import type {
  FilterMode,
  NodeInstance,
  ParamDef,
  ResolutionMode,
  WrapMode,
} from "../../engine/nodes/types";
import { useEditorStore } from "../../store/editorStore";
import { PALETTE_PRESETS, parsePaletteFile } from "../../utils/paletteParser";

const RESOLUTIONS: ResolutionMode[] = [
  "inherit",
  16,
  32,
  64,
  128,
  256,
  512,
  1024,
];

function renderParamControl(
  node: NodeInstance,
  param: ParamDef,
  onLiveChange: (val: unknown) => void,
  onCommitChange: (val: unknown) => void,
  documentPalette: readonly string[]
) {
  const val = node.params[param.id] ?? param.default;

  if (param.kind === "float" || param.kind === "int") {
    const num = Number(val ?? param.default);
    return (
      <div key={param.id} className="nodes-param-row">
        <div className="nodes-param-head">
          <span>{param.label}</span>
          <span className="nodes-param-val">
            {param.kind === "int" ? Math.round(num) : num.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={num}
          onPointerDown={() => beginNodeTransaction(`Change ${param.label}`)}
          onChange={(e) => onLiveChange(Number(e.target.value))}
          onPointerUp={() => commitNodeTransaction()}
        />
      </div>
    );
  }

  if (param.kind === "bool") {
    return (
      <label key={param.id} className="nodes-param-row">
        <div className="nodes-param-inline">
          <input
            type="checkbox"
            checked={Boolean(val)}
            onChange={(e) => onCommitChange(e.target.checked)}
          />
          <span style={{ fontSize: 11, color: "#cccccc" }}>{param.label}</span>
        </div>
      </label>
    );
  }

  if (param.kind === "enum") {
    return (
      <div key={param.id} className="nodes-param-row">
        <div className="nodes-param-head">
          <span>{param.label}</span>
        </div>
        <select
          className="nodes-select"
          value={String(val)}
          onChange={(e) => onCommitChange(e.target.value)}
        >
          {param.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (param.kind === "color") {
    return (
      <div key={param.id} className="nodes-param-row">
        <div className="nodes-param-head">
          <span>{param.label}</span>
          <span className="nodes-param-val">{String(val)}</span>
        </div>
        <input
          type="color"
          value={String(val).slice(0, 7)}
          onFocus={() => beginNodeTransaction(`Change ${param.label}`)}
          onChange={(e) => onLiveChange(e.target.value)}
          onBlur={() => commitNodeTransaction()}
        />
      </div>
    );
  }

  if (param.kind === "seed") {
    const num = Number(val ?? param.default);
    return (
      <div key={param.id} className="nodes-param-row">
        <div className="nodes-param-head">
          <span>{param.label}</span>
        </div>
        <div className="nodes-param-inline">
          <input
            type="number"
            className="nodes-input"
            style={{ flex: 1 }}
            value={num}
            onChange={(e) => onCommitChange(Number(e.target.value) || 0)}
          />
          <button
            type="button"
            className="mini-btn"
            title="Randomize Seed"
            onClick={() => onCommitChange(Math.floor(Math.random() * 99999))}
          >
            <Dices size={12} />
          </button>
        </div>
      </div>
    );
  }

  if (param.kind === "palette") {
    const palParam = normalizePaletteParam(val);
    const resolved = resolvePaletteColors(palParam, documentPalette);
    const isCustom = palParam.source === CUSTOM_PALETTE_SOURCE;

    return (
      <div key={param.id} className="nodes-param-row">
        <div className="nodes-param-head">
          <span>{param.label}</span>
          <span className="nodes-param-val">{resolved.length} colors</span>
        </div>
        <select
          className="nodes-select"
          value={palParam.source}
          onChange={(e) => {
            const nextSource = e.target.value;
            const nextColors =
              nextSource === CUSTOM_PALETTE_SOURCE ? [...resolved] : palParam.colors;
            onCommitChange({ source: nextSource, colors: nextColors });
          }}
        >
          <option value={DOCUMENT_PALETTE_SOURCE}>Document Palette</option>
          {PALETTE_PRESETS.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
          <option value={CUSTOM_PALETTE_SOURCE}>Custom</option>
        </select>

        <div className="nodes-inspector-palette-grid">
          {resolved.map((hex, idx) =>
            isCustom ? (
              <div key={`${idx}-${hex}`} className="nodes-inspector-swatch-wrap">
                <label
                  className="nodes-inspector-swatch is-editable"
                  style={{ background: hex }}
                  title={`Color ${idx + 1}: ${hex}`}
                >
                  <input
                    type="color"
                    value={hex.slice(0, 7)}
                    onFocus={() => beginNodeTransaction("Edit Palette Color")}
                    onChange={(e) => {
                      const nextColors = [...resolved];
                      nextColors[idx] = e.target.value;
                      onLiveChange({ source: CUSTOM_PALETTE_SOURCE, colors: nextColors });
                    }}
                    onBlur={() => commitNodeTransaction()}
                  />
                </label>
                {resolved.length > 1 && (
                  <button
                    type="button"
                    className="nodes-inspector-swatch-del"
                    title="Remove color"
                    onClick={() => {
                      const nextColors = resolved.filter((_, i) => i !== idx);
                      onCommitChange({ source: CUSTOM_PALETTE_SOURCE, colors: nextColors });
                    }}
                  >
                    <X size={9} />
                  </button>
                )}
              </div>
            ) : (
              <span
                key={`${idx}-${hex}`}
                className="nodes-inspector-swatch"
                style={{ background: hex }}
                title={hex}
              />
            )
          )}
        </div>

        <div className="nodes-param-inline" style={{ marginTop: 4, flexWrap: "wrap" }}>
          {isCustom ? (
            <>
              <button
                type="button"
                className="mini-btn"
                onClick={() => {
                  const nextColors = [...resolved, "#ffffff"];
                  onCommitChange({ source: CUSTOM_PALETTE_SOURCE, colors: nextColors });
                }}
              >
                <Plus size={11} /> Add
              </button>
              <button
                type="button"
                className="mini-btn"
                onClick={() => {
                  const nextColors =
                    documentPalette.length > 0 ? [...documentPalette] : [...resolved];
                  onCommitChange({ source: CUSTOM_PALETTE_SOURCE, colors: nextColors });
                }}
              >
                From Doc
              </button>
              <label className="mini-btn" style={{ cursor: "pointer" }}>
                <Upload size={11} /> Import
                <input
                  type="file"
                  accept=".hex,.gpl,.txt"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const text = String(reader.result ?? "");
                      const parsed = parsePaletteFile(file.name, text);
                      if (parsed.colors.length > 0) {
                        onCommitChange({
                          source: CUSTOM_PALETTE_SOURCE,
                          colors: parsed.colors.slice(0, 256),
                        });
                      }
                    };
                    reader.readAsText(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </>
          ) : (
            <button
              type="button"
              className="mini-btn"
              onClick={() =>
                onCommitChange({ source: CUSTOM_PALETTE_SOURCE, colors: [...resolved] })
              }
            >
              Customize Colors
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}

export function NodeInspectorPanel() {
  useEditorStore((s) => s.nodesVersion);
  const documentPalette = useEditorStore((s) => s.palette);
  const selectedNodeIds = useEditorStore((s) => s.nodesUi.selectedNodeIds);
  const graph = pixelEngine.nodes.getActiveGraph();

  const selectedNode =
    selectedNodeIds.length === 1 && graph
      ? graph.nodes.find((n) => n.id === selectedNodeIds[0]) ?? null
      : null;
  const def = selectedNode ? nodeRegistry.get(selectedNode.type) : undefined;

  if (!graph) return null;

  if (!selectedNode || !def) {
    return (
      <DockablePanelSection id="nodes-inspector" title="Graph Parameters">
        <div>
          {graph.exposedParams.length === 0 ? (
            <div style={{ fontSize: 11, color: "#888888" }}>
              Select a node to edit its parameters, or press Shift+A to add nodes.
            </div>
          ) : (
            graph.exposedParams.map((ep) => {
              const target = graph.nodes.find((n) => n.id === ep.nodeId);
              const tDef = target ? nodeRegistry.get(target.type) : undefined;
              const pDef = tDef?.params.find((p) => p.id === ep.paramId);
              if (!target || !pDef) return null;
              return renderParamControl(
                target,
                { ...pDef, label: ep.label },
                (v) =>
                  updateActiveNodeGraphLive(
                    (g) => ({
                      ...g,
                      nodes: g.nodes.map((n) =>
                        n.id === target.id
                          ? { ...n, params: { ...n.params, [pDef.id]: v } }
                          : n
                      ),
                    }),
                    [target.id]
                  ),
                (v) =>
                  mutateActiveNodeGraph(
                    `Edit ${ep.label}`,
                    (g) => ({
                      ...g,
                      nodes: g.nodes.map((n) =>
                        n.id === target.id
                          ? { ...n, params: { ...n.params, [pDef.id]: v } }
                          : n
                      ),
                    }),
                    [target.id]
                  ),
                documentPalette
              );
            })
          )}
        </div>
      </DockablePanelSection>
    );
  }

  return (
    <DockablePanelSection
      id="nodes-inspector"
      title={def.label}
      actions={<span style={{ fontSize: 10, color: "#888888" }}>{def.category}</span>}
    >
      <div>
        {def.params.map((param) =>
          renderParamControl(
            selectedNode,
            param,
            (v) =>
              updateActiveNodeGraphLive(
                (g) => ({
                  ...g,
                  nodes: g.nodes.map((n) =>
                    n.id === selectedNode.id
                      ? { ...n, params: { ...n.params, [param.id]: v } }
                      : n
                  ),
                }),
                [selectedNode.id]
              ),
            (v) =>
              mutateActiveNodeGraph(
                `Edit ${param.label}`,
                (g) => ({
                  ...g,
                  nodes: g.nodes.map((n) =>
                    n.id === selectedNode.id
                      ? { ...n, params: { ...n.params, [param.id]: v } }
                      : n
                  ),
                }),
                [selectedNode.id]
              ),
            documentPalette
          )
        )}

        {!def.paletteEvaluate && !def.scalarEvaluate && (
        <div style={{ borderTop: "1px solid #2b2b2b", paddingTop: 8, marginTop: 8 }}>
          <div className="nodes-param-row">
            <div className="nodes-param-head">
              <span>Resolution</span>
            </div>
            <select
              className="nodes-select"
              value={String(selectedNode.resolution)}
              onChange={(e) => {
                const raw = e.target.value;
                const res: ResolutionMode =
                  raw === "inherit" ? "inherit" : (Number(raw) as ResolutionMode);
                mutateActiveNodeGraph(
                  "Node Resolution",
                  (g) => ({
                    ...g,
                    nodes: g.nodes.map((n) =>
                      n.id === selectedNode.id ? { ...n, resolution: res } : n
                    ),
                  }),
                  [selectedNode.id]
                );
              }}
            >
              {RESOLUTIONS.map((r) => (
                <option key={String(r)} value={String(r)}>
                  {r === "inherit" ? "Inherit" : `${r}×${r}`}
                </option>
              ))}
            </select>
          </div>

          <div className="nodes-param-inline" style={{ marginTop: 6 }}>
            <select
              className="nodes-select"
              value={selectedNode.wrap}
              onChange={(e) =>
                mutateActiveNodeGraph(
                  "Node Wrap",
                  (g) => ({
                    ...g,
                    nodes: g.nodes.map((n) =>
                      n.id === selectedNode.id
                        ? { ...n, wrap: e.target.value as WrapMode }
                        : n
                    ),
                  }),
                  [selectedNode.id]
                )
              }
            >
              <option value="repeat">Wrap: Repeat</option>
              <option value="clamp">Wrap: Clamp</option>
            </select>
            <select
              className="nodes-select"
              value={selectedNode.filter}
              onChange={(e) =>
                mutateActiveNodeGraph(
                  "Node Filter",
                  (g) => ({
                    ...g,
                    nodes: g.nodes.map((n) =>
                      n.id === selectedNode.id
                        ? { ...n, filter: e.target.value as FilterMode }
                        : n
                    ),
                  }),
                  [selectedNode.id]
                )
              }
            >
              <option value="nearest">Filter: Nearest</option>
              <option value="linear">Filter: Linear</option>
            </select>
          </div>
        </div>
        )}

        {(selectedNode.type === "output.material" ||
          selectedNode.type === "output.bake" ||
          selectedNode.type === "output.preview") && (
          <div
            style={{
              borderTop: "1px solid #2b2b2b",
              paddingTop: 8,
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {selectedNode.type === "output.material" && (
              <>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => assignGraphToModel3DMaterial(graph.id, graph.name)}
                >
                  Assign to 3D Model Material
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => bakeMaterialToDrawMapRoleStack(selectedNode.id)}
                >
                  Bake PBR Stack to Draw
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => bakeAutoTileSetFromGraph(graph, selectedNode.id, 0)}
                >
                  Bake 16-Tile Auto-Tile Set
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => void exportPbrOrmAndGodotPack(selectedNode.id)}
                >
                  Export PBR + ORM + Godot .tres
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => bakeAnimationToDrawFrames(selectedNode.id, "albedo", true)}
                >
                  Bake Animation to Draw Frames
                </button>
              </>
            )}
            {(selectedNode.type === "output.bake" || selectedNode.type === "output.preview") && (
              <>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() =>
                    bakeNodeOutputToDrawLayer(
                      selectedNode.id,
                      "out",
                      String(selectedNode.params.layerName ?? "Node Bake")
                    )
                  }
                >
                  Bake to Draw Layer
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => bakeAnimationToDrawFrames(selectedNode.id, "out", false)}
                >
                  Bake Animation to Draw Frames
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() =>
                    bakeNodeOutputToTilesetSlot(
                      selectedNode.id,
                      "out",
                      Number(selectedNode.params.tilesetIndex ?? 0),
                      Number(selectedNode.params.tileId ?? 0)
                    )
                  }
                >
                  Bake to Tileset Slot
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </DockablePanelSection>
  );
}
