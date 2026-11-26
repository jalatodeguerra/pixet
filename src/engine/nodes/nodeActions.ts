import { pixelEngine } from "../document/PixelEngine.ts";
import { syncHistoryAndCelState } from "../document/historyActions.ts";
import { createEmptyGraph } from "./NodeGraph.ts";
import { nodeRegistry } from "./NodeRegistry.ts";
import { WebGL2NodeEvaluator } from "./WebGL2NodeEvaluator.ts";
import "./definitions/index.ts";
import type { NodeGraph } from "./types.ts";
import { useEditorStore } from "../../store/editorStore.ts";

let sharedEvaluator: WebGL2NodeEvaluator | null = null;

export function getNodeEvaluator(): WebGL2NodeEvaluator {
  if (!sharedEvaluator) {
    sharedEvaluator = new WebGL2NodeEvaluator();
  }
  return sharedEvaluator;
}

export function ensureActiveNodeGraph(): NodeGraph {
  const existing = pixelEngine.nodes.getActiveGraph();
  if (existing) return existing;
  const created = createEmptyGraph("Material 1", "material", 128);
  pixelEngine.nodes.replaceActiveGraph(created);
  return created;
}

export function mutateActiveNodeGraph(
  label: string,
  mutator: (graph: NodeGraph) => NodeGraph,
  dirtyNodeIds?: readonly string[]
): NodeGraph {
  const current = ensureActiveNodeGraph();
  const next = mutator(current);
  if (next === current) return current;
  pixelEngine.nodesHistory.push(current, next, label);
  pixelEngine.nodes.replaceActiveGraph(next);

  const evaluator = getNodeEvaluator();
  if (dirtyNodeIds && dirtyNodeIds.length > 0) {
    for (const id of dirtyNodeIds) {
      evaluator.markNodeDirty(next, id);
    }
  } else {
    evaluator.markAllDirty();
  }

  useEditorStore.getState().bumpNodesVersion();
  syncHistoryAndCelState();
  return next;
}

export function updateActiveNodeGraphLive(
  mutator: (graph: NodeGraph) => NodeGraph,
  dirtyNodeIds?: readonly string[]
): NodeGraph {
  const current = ensureActiveNodeGraph();
  const next = mutator(current);
  if (next === current) return current;
  pixelEngine.nodes.replaceActiveGraph(next);

  const evaluator = getNodeEvaluator();
  if (dirtyNodeIds && dirtyNodeIds.length > 0) {
    for (const id of dirtyNodeIds) {
      evaluator.markNodeDirty(next, id);
    }
  } else {
    evaluator.markAllDirty();
  }

  useEditorStore.getState().bumpNodesVersion();
  return next;
}

export function beginNodeTransaction(label: string): void {
  const current = ensureActiveNodeGraph();
  pixelEngine.nodesHistory.beginTransaction(current, label);
}

export function commitNodeTransaction(): void {
  const current = ensureActiveNodeGraph();
  if (pixelEngine.nodesHistory.commitTransaction(current)) {
    useEditorStore.getState().bumpNodesVersion();
    syncHistoryAndCelState();
  }
}

export function evaluateActiveNodeGraph(): void {
  const graph = ensureActiveNodeGraph();
  const store = useEditorStore.getState();
  const evaluator = getNodeEvaluator();
  const frameCount = Math.max(1, store.frames.length);
  const fps = Math.max(1, store.fps);
  evaluator.evaluateGraph(graph, nodeRegistry, {
    pinnedNodeId: store.nodesUi.pinnedNodeId,
    selectedNodeId: store.nodesUi.selectedNodeIds[0] ?? null,
    compareNodeId: store.nodesUi.compareNodeId,
    renderThumbnails: store.nodesUi.showThumbnails,
    paletteColors: store.palette,
    frame: store.currentFrame,
    time: store.currentFrame / fps,
    progress: store.currentFrame / frameCount,
  });
}
