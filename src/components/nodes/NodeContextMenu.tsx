import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { CATEGORY_COLORS, nodeRegistry } from "../../engine/nodes/NodeRegistry";
import {
  addNode,
  duplicateSelection,
  nextNodeId,
  removeNodes,
  toggleBypassNodes,
} from "../../engine/nodes/NodeGraph";
import { mutateActiveNodeGraph } from "../../engine/nodes/nodeActions";
import type { NodeCategory, NodeDefinition } from "../../engine/nodes/types";
import { useEditorStore } from "../../store/editorStore";

export interface NodeContextMenuState {
  x: number;
  y: number;
  nodeId: string | null;
}

interface NodeContextMenuProps {
  menu: NodeContextMenuState | null;
  onClose: () => void;
  screenToFlow: (x: number, y: number) => { x: number; y: number };
}

const CATEGORY_ORDER: Array<{ id: NodeCategory; label: string }> = [
  { id: "inputs", label: "Inputs" },
  { id: "control", label: "Macro & Animation" },
  { id: "generators", label: "Generators" },
  { id: "distort", label: "Distort & Warp" },
  { id: "pixel", label: "Pixel Art & VFX" },
  { id: "adjust", label: "Adjust & Math" },
  { id: "pbr", label: "PBR & Material" },
  { id: "outputs", label: "Outputs & Bake" },
];

export function NodeContextMenu({ menu, onClose, screenToFlow }: NodeContextMenuProps) {
  const [hoveredCat, setHoveredCat] = useState<NodeCategory | null>(null);
  const selectedNodeIds = useEditorStore((s) => s.nodesUi.selectedNodeIds);
  const pinnedNodeId = useEditorStore((s) => s.nodesUi.pinnedNodeId);
  const showThumbnails = useEditorStore((s) => s.nodesUi.showThumbnails);
  const patchNodesUi = useEditorStore((s) => s.patchNodesUi);

  if (!menu) return null;

  const grouped = nodeRegistry.listByCategory();
  const targetIds =
    menu.nodeId && !selectedNodeIds.includes(menu.nodeId)
      ? [menu.nodeId]
      : selectedNodeIds;

  const spawnNode = (def: NodeDefinition) => {
    const pos = screenToFlow(menu.x, menu.y);
    const id = nextNodeId("n");
    const inst = nodeRegistry.createNodeInstance(def.type, pos, { id });
    mutateActiveNodeGraph(`Add ${def.label}`, (g) => addNode(g, inst), [id]);
    patchNodesUi({ selectedNodeIds: [id] });
    onClose();
  };

  const left = Math.min(menu.x, window.innerWidth - 360);
  const top = Math.min(menu.y, window.innerHeight - 320);

  return (
    <div
      className="nodes-ctx-menu"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="nodes-ctx-title">Add Node</div>
      {CATEGORY_ORDER.map((cat) => {
        const list = grouped[cat.id];
        if (!list || list.length === 0) return null;
        const isOpen = hoveredCat === cat.id;
        return (
          <div
            key={cat.id}
            className={`nodes-ctx-item ${isOpen ? "is-open" : ""}`}
            onMouseEnter={() => setHoveredCat(cat.id)}
          >
            <span className="nodes-ctx-cat-label">
              <span
                className="nodes-ctx-dot"
                style={{ background: CATEGORY_COLORS[cat.id] }}
              />
              {cat.label}
            </span>
            <ChevronRight size={11} />
            {isOpen && (
              <div className="nodes-ctx-sub">
                {list.map((def) => (
                  <button
                    key={def.type}
                    type="button"
                    className="nodes-ctx-sub-btn"
                    onClick={() => spawnNode(def)}
                  >
                    {def.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="nodes-ctx-sep" />

      {menu.nodeId ? (
        <>
          <button
            type="button"
            className="nodes-ctx-action"
            onClick={() => {
              let created: string[] = [];
              mutateActiveNodeGraph("Duplicate Nodes", (g) => {
                const res = duplicateSelection(g, targetIds);
                created = res.createdNodeIds;
                return res.graph;
              });
              if (created.length > 0) patchNodesUi({ selectedNodeIds: created });
              onClose();
            }}
          >
            Duplicate (Ctrl+D)
          </button>
          <button
            type="button"
            className="nodes-ctx-action"
            onClick={() => {
              mutateActiveNodeGraph("Toggle Bypass", (g) => toggleBypassNodes(g, targetIds), targetIds);
              onClose();
            }}
          >
            Toggle Bypass (M)
          </button>
          <button
            type="button"
            className="nodes-ctx-action"
            onClick={() => {
              const id = menu.nodeId!;
              patchNodesUi({ pinnedNodeId: pinnedNodeId === id ? null : id });
              onClose();
            }}
          >
            {pinnedNodeId === menu.nodeId ? "Unpin Preview (P)" : "Pin to Preview (P)"}
          </button>
          <button
            type="button"
            className="nodes-ctx-action is-danger"
            onClick={() => {
              mutateActiveNodeGraph("Delete Nodes", (g) => removeNodes(g, targetIds));
              patchNodesUi({ selectedNodeIds: [] });
              onClose();
            }}
          >
            Delete
          </button>
        </>
      ) : (
        <button
          type="button"
          className="nodes-ctx-action"
          onClick={() => {
            patchNodesUi({ showThumbnails: !showThumbnails });
            onClose();
          }}
        >
          {showThumbnails ? "Hide Node Thumbnails" : "Show Node Thumbnails"}
        </button>
      )}
    </div>
  );
}
