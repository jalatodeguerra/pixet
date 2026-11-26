import { pixelEngine } from "../document/PixelEngine.ts";
import { useEditorStore } from "../../store/editorStore.ts";
import {
  duplicateSelection,
  removeNodes,
  toggleBypassNodes,
} from "./NodeGraph.ts";
import { mutateActiveNodeGraph } from "./nodeActions.ts";

/** Nodes-workspace actions shared by keyboard shortcuts and the palette. */

function selectedIds(): string[] {
  return useEditorStore.getState().nodesUi.selectedNodeIds;
}

export function hasNodeSelection(): boolean {
  return selectedIds().length > 0;
}

export function hasSingleNodeSelection(): boolean {
  return selectedIds().length === 1;
}

/** Opens the quick-add menu (Shift+A) near the upper-left of the window. */
export function openNodeAddMenu(): void {
  useEditorStore.getState().patchNodesUi({
    quickAddOpen: true,
    quickAddPos: {
      x: Math.round(window.innerWidth * 0.4),
      y: Math.round(window.innerHeight * 0.35),
    },
    pendingWireFrom: null,
  });
}

export function duplicateSelectedNodes(): void {
  const sel = selectedIds();
  if (sel.length === 0) return;
  let created: string[] = [];
  mutateActiveNodeGraph("Duplicate Nodes", (g) => {
    const res = duplicateSelection(g, sel);
    created = res.createdNodeIds;
    return res.graph;
  });
  if (created.length > 0) {
    useEditorStore.getState().patchNodesUi({ selectedNodeIds: created });
  }
}

export function deleteSelectedNodes(): void {
  const sel = selectedIds();
  if (sel.length === 0) return;
  mutateActiveNodeGraph("Delete Nodes", (g) => removeNodes(g, sel));
  useEditorStore.getState().patchNodesUi({ selectedNodeIds: [] });
}

export function toggleBypassSelectedNodes(): void {
  const sel = selectedIds();
  if (sel.length === 0) return;
  mutateActiveNodeGraph("Toggle Bypass", (g) => toggleBypassNodes(g, sel), sel);
}

export function togglePinSelectedNode(): void {
  const sel = selectedIds();
  if (sel.length !== 1) return;
  const st = useEditorStore.getState();
  st.patchNodesUi({
    pinnedNodeId: st.nodesUi.pinnedNodeId === sel[0] ? null : sel[0],
  });
}

export function selectAllNodes(): void {
  const g = pixelEngine.nodes.getActiveGraph();
  if (g) {
    useEditorStore
      .getState()
      .patchNodesUi({ selectedNodeIds: g.nodes.map((n) => n.id) });
  }
}
