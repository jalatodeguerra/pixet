import { Dices, Download, Image, Play, Plus, Redo2, Square, Undo2, Upload } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { performRedo, performUndo } from "../../engine/document/historyActions";
import {
  addNode,
  cloneGraph,
  createEmptyGraph,
  deserializeNodesExt,
  nextNodeId,
} from "../../engine/nodes/NodeGraph";
import { nodeRegistry } from "../../engine/nodes/NodeRegistry";
import {
  ensureActiveNodeGraph,
  getNodeEvaluator,
  mutateActiveNodeGraph,
} from "../../engine/nodes/nodeActions";
import { NODE_GRAPH_PRESETS } from "../../engine/nodes/presets";
import type { NodeGraph } from "../../engine/nodes/types";
import { useEditorStore } from "../../store/editorStore";

const BASE_RES: Array<NodeGraph["baseResolution"]> = [32, 64, 128, 256, 512, 1024];

export function NodesToolOptionsBar() {
  useEditorStore((s) => s.nodesVersion);
  const bumpNodesVersion = useEditorStore((s) => s.bumpNodesVersion);
  const showThumbnails = useEditorStore((s) => s.nodesUi.showThumbnails);
  const patchNodesUi = useEditorStore((s) => s.patchNodesUi);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const togglePlaying = useEditorStore((s) => s.togglePlaying);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const frameCount = useEditorStore((s) => s.frames.length);

  const active = ensureActiveNodeGraph();
  const graphs = pixelEngine.nodes.graphs;
  const stats = getNodeEvaluator().getStats();
  const vramMb = (stats.vramBytes / (1024 * 1024)).toFixed(1);

  return (
    <div className="tool-options-bar">
      <div className="tool-opt-group">
        <button
          type="button"
          className="icon-action-btn"
          title="Undo (Ctrl+Z)"
          disabled={!pixelEngine.nodesHistory.canUndo()}
          onClick={performUndo}
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          className="icon-action-btn"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!pixelEngine.nodesHistory.canRedo()}
          onClick={performRedo}
        >
          <Redo2 size={13} />
        </button>
      </div>

      <div className="tool-opt-group">
        <select
          className="palette-select"
          value={active.id}
          onChange={(e) => {
            pixelEngine.nodes.setActiveGraph(e.target.value);
            getNodeEvaluator().markAllDirty();
            bumpNodesVersion();
          }}
        >
          {graphs.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.kind})
            </option>
          ))}
        </select>

        <button
          type="button"
          className="mini-btn"
          title="New Material Graph"
          onClick={() => {
            const g = createEmptyGraph(
              `Material ${graphs.length + 1}`,
              "material",
              128
            );
            pixelEngine.nodes.replaceActiveGraph(g);
            getNodeEvaluator().markAllDirty();
            bumpNodesVersion();
          }}
        >
          <Plus size={12} /> Graph
        </button>

        <select
          className="palette-select"
          value=""
          title="Load Starter Preset"
          onChange={(e) => {
            const preset = NODE_GRAPH_PRESETS.find((p) => p.id === e.target.value);
            if (!preset) return;
            const built = preset.build();
            built.id = nextNodeId("graph");
            pixelEngine.nodes.replaceActiveGraph(built);
            getNodeEvaluator().markAllDirty();
            bumpNodesVersion();
          }}
        >
          <option value="" disabled>
            Presets ▾
          </option>
          {NODE_GRAPH_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="icon-action-btn"
          title="Export .pixet-graph.json"
          onClick={() => {
            const payload = JSON.stringify({ schemaVersion: 1, graph: cloneGraph(active) }, null, 2);
            const blob = new Blob([payload], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${active.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "_")}.pixet-graph.json`;
            a.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={13} />
        </button>

        <label className="icon-action-btn" title="Import .pixet-graph.json" style={{ cursor: "pointer" }}>
          <Upload size={13} />
          <input
            type="file"
            accept=".json,.pixet-graph.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const say = (m: string) => useEditorStore.getState().setStatusMessage(m);
              void file
                .text()
                .then((txt) => {
                  const parsed = JSON.parse(txt) as { graph?: NodeGraph } | null;
                  if (!parsed || typeof parsed !== "object" || !parsed.graph) {
                    say(`Could not import ${file.name}: no node graph found.`);
                    return;
                  }
                  const ext = deserializeNodesExt({ schemaVersion: 1, graphs: [parsed.graph] });
                  if (ext.graphs[0]) {
                    ext.graphs[0].id = nextNodeId("graph");
                    pixelEngine.nodes.replaceActiveGraph(ext.graphs[0]);
                    getNodeEvaluator().markAllDirty();
                    bumpNodesVersion();
                    say(`Imported graph from ${file.name}`);
                  }
                })
                .catch((err: unknown) => {
                  say(
                    `Could not import ${file.name}: ${
                      err instanceof SyntaxError ? "not a valid graph file" : String(err)
                    }`
                  );
                });
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <div className="tool-opt-group">
        <span className="tool-opt-label">Res</span>
        <select
          className="palette-select"
          value={active.baseResolution}
          onChange={(e) => {
            const res = Number(e.target.value) as NodeGraph["baseResolution"];
            mutateActiveNodeGraph("Base Resolution", (g) => ({
              ...g,
              baseResolution: res,
            }));
          }}
        >
          {BASE_RES.map((r) => (
            <option key={r} value={r}>
              {r}×{r}
            </option>
          ))}
        </select>
      </div>

      <div className="tool-opt-group">
        <span className="tool-opt-label">Seed {active.seed}</span>
        <button
          type="button"
          className="icon-action-btn"
          title="Randomize Graph Seed"
          onClick={() => {
            mutateActiveNodeGraph("Randomize Seed", (g) => ({
              ...g,
              seed: Math.floor(Math.random() * 99999),
            }));
          }}
        >
          <Dices size={13} />
        </button>
      </div>

      <div className="tool-opt-group">
        <button
          type="button"
          className={`toggle-chip ${showThumbnails ? "active" : ""}`}
          onClick={() => patchNodesUi({ showThumbnails: !showThumbnails })}
        >
          <Image size={12} /> Thumbs
        </button>

        <button
          type="button"
          className={`toggle-chip ${isPlaying ? "active" : ""}`}
          title="Play / Pause Animation (Enter)"
          onClick={togglePlaying}
        >
          {isPlaying ? <Square size={11} /> : <Play size={11} />} F{currentFrame + 1}/{frameCount}
        </button>

        <button
          type="button"
          className="mini-btn"
          title="Add 4-Knob DAW Macro Rack"
          onClick={() => {
            const id = nextNodeId("n");
            const inst = nodeRegistry.createNodeInstance("macro.controller", { x: 80, y: 120 }, { id });
            mutateActiveNodeGraph("Add Macro Rack", (g) => addNode(g, inst), [id]);
            patchNodesUi({ selectedNodeIds: [id] });
          }}
        >
          + Macro
        </button>

        <button
          type="button"
          className="mini-btn"
          title="Add LFO Oscillator"
          onClick={() => {
            const id = nextNodeId("n");
            const inst = nodeRegistry.createNodeInstance("anim.lfo", { x: 80, y: 280 }, { id });
            mutateActiveNodeGraph("Add LFO", (g) => addNode(g, inst), [id]);
            patchNodesUi({ selectedNodeIds: [id] });
          }}
        >
          + LFO
        </button>
      </div>

      <div className="tool-opt-group" style={{ marginLeft: "auto" }}>
        <span className="tool-opt-label">
          {stats.lastEvalMs.toFixed(1)} ms · {vramMb} MB
        </span>
      </div>
    </div>
  );
}
