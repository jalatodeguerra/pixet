import { useEffect, useMemo, useRef, useState } from "react";
import { canConnectSockets, nodeRegistry } from "../../engine/nodes/NodeRegistry";
import { addNode, connectSockets, nextNodeId } from "../../engine/nodes/NodeGraph";
import { mutateActiveNodeGraph } from "../../engine/nodes/nodeActions";
import type { NodeDefinition, SocketType } from "../../engine/nodes/types";
import { useEditorStore } from "../../store/editorStore";

interface QuickAddMenuProps {
  screenToFlow: (x: number, y: number) => { x: number; y: number };
}

export function QuickAddMenu({ screenToFlow }: QuickAddMenuProps) {
  const quickAddOpen = useEditorStore((s) => s.nodesUi.quickAddOpen);
  const quickAddPos = useEditorStore((s) => s.nodesUi.quickAddPos);
  const pendingWire = useEditorStore((s) => s.nodesUi.pendingWireFrom);
  const patchNodesUi = useEditorStore((s) => s.patchNodesUi);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (quickAddOpen) {
      setQuery("");
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [quickAddOpen]);

  const items = useMemo(() => {
    const all = nodeRegistry.list();
    let filterType: SocketType | null = null;
    if (pendingWire) {
      // Find socket type on pending node
      const q = query.trim().toLowerCase();
      void q;
    }

    const q = query.trim().toLowerCase();
    return all
      .filter((def) => {
        if (filterType) {
          return def.inputs.some((i) => canConnectSockets(filterType!, i.type).allowed);
        }
        return true;
      })
      .filter((def) => {
        if (!q) return true;
        return (
          def.label.toLowerCase().includes(q) ||
          def.category.toLowerCase().includes(q) ||
          def.type.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  }, [query, pendingWire]);

  if (!quickAddOpen) return null;

  const insertNode = (def: NodeDefinition) => {
    const flowPos = screenToFlow(quickAddPos.x, quickAddPos.y);
    const id = nextNodeId("n");
    const inst = nodeRegistry.createNodeInstance(def.type, flowPos, { id });

    mutateActiveNodeGraph(`Add ${def.label}`, (g) => {
      let next = addNode(g, inst);
      if (pendingWire) {
        if (pendingWire.handleType === "source" && def.inputs.length > 0) {
          const srcNode = g.nodes.find((n) => n.id === pendingWire.nodeId);
          const srcDef = srcNode ? nodeRegistry.get(srcNode.type) : undefined;
          const srcSock = srcDef?.outputs.find((o) => o.id === pendingWire.socketId);
          const compatIn = srcSock
            ? def.inputs.find((i) => canConnectSockets(srcSock.type, i.type).allowed)
            : def.inputs[0];
          if (compatIn) {
            const res = connectSockets(next, nodeRegistry, {
              fromNode: pendingWire.nodeId,
              fromSocket: pendingWire.socketId,
              toNode: id,
              toSocket: compatIn.id,
            });
            if (res.ok) next = res.graph;
          }
        } else if (pendingWire.handleType === "target" && def.outputs.length > 0) {
          const dstNode = g.nodes.find((n) => n.id === pendingWire.nodeId);
          const dstDef = dstNode ? nodeRegistry.get(dstNode.type) : undefined;
          const dstSock = dstDef?.inputs.find((i) => i.id === pendingWire.socketId);
          const compatOut = dstSock
            ? def.outputs.find((o) => canConnectSockets(o.type, dstSock.type).allowed)
            : def.outputs[0];
          if (compatOut) {
            const res = connectSockets(next, nodeRegistry, {
              fromNode: id,
              fromSocket: compatOut.id,
              toNode: pendingWire.nodeId,
              toSocket: pendingWire.socketId,
            });
            if (res.ok) next = res.graph;
          }
        }
      }
      return next;
    }, [id]);

    patchNodesUi({
      quickAddOpen: false,
      pendingWireFrom: null,
      selectedNodeIds: [id],
    });
  };

  return (
    <div
      className="nodes-quickadd"
      style={{
        left: Math.min(quickAddPos.x, window.innerWidth - 280),
        top: Math.min(quickAddPos.y, window.innerHeight - 340),
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          patchNodesUi({ quickAddOpen: false, pendingWireFrom: null });
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((i) => Math.min(items.length - 1, i + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((i) => Math.max(0, i - 1));
        } else if (e.key === "Enter" && items[activeIndex]) {
          e.preventDefault();
          insertNode(items[activeIndex]);
        }
      }}
    >
      <input
        ref={inputRef}
        className="nodes-quickadd-input"
        placeholder="Add node (Shift+A)..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
        }}
      />
      <div className="nodes-quickadd-list">
        {items.map((def, idx) => (
          <button
            key={def.type}
            type="button"
            className={`nodes-quickadd-item ${idx === activeIndex ? "is-active" : ""}`}
            onClick={() => insertNode(def)}
          >
            <span>{def.label}</span>
            <span className="nodes-quickadd-cat">{def.category}</span>
          </button>
        ))}
        {items.length === 0 && (
          <div className="nodes-quickadd-item">No matching nodes</div>
        )}
      </div>
    </div>
  );
}
