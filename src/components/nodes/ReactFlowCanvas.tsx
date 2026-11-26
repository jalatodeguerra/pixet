import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type OnConnectEnd,
  type OnNodeDrag,
  type OnNodesChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  connectSockets,
  isParamSocketId,
  removeEdges,
  spliceNodeOnEdge,
} from "../../engine/nodes/NodeGraph";
import { SOCKET_COLORS, nodeRegistry } from "../../engine/nodes/NodeRegistry";
import {
  beginNodeTransaction,
  commitNodeTransaction,
  ensureActiveNodeGraph,
  evaluateActiveNodeGraph,
  getNodeEvaluator,
  mutateActiveNodeGraph,
  updateActiveNodeGraphLive,
} from "../../engine/nodes/nodeActions";
import { useEditorStore } from "../../store/editorStore";
import { NodeContextMenu, type NodeContextMenuState } from "./NodeContextMenu";
import { PixetFlowNode, type PixetFlowNodeType } from "./PixetFlowNode";
import { QuickAddMenu } from "./QuickAddMenu";

const NODE_TYPES = {
  pixetNode: PixetFlowNode,
};

function ReactFlowInner() {
  const nodesVersion = useEditorStore((s) => s.nodesVersion);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const palette = useEditorStore((s) => s.palette);
  const selectedNodeIds = useEditorStore((s) => s.nodesUi.selectedNodeIds);
  const pinnedNodeId = useEditorStore((s) => s.nodesUi.pinnedNodeId);
  const patchNodesUi = useEditorStore((s) => s.patchNodesUi);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const rf = useReactFlow();
  const draggingRef = useRef(false);
  const [ctxMenu, setCtxMenu] = useState<NodeContextMenuState | null>(null);

  const graph = ensureActiveNodeGraph();

  // Evaluate graph whenever version, frame, palette, or preview target changes
  useEffect(() => {
    evaluateActiveNodeGraph();
  }, [nodesVersion, currentFrame, palette, pinnedNodeId, selectedNodeIds]);

  const rfNodes: PixetFlowNodeType[] = useMemo(() => {
    const selSet = new Set(selectedNodeIds);
    const evaluator = getNodeEvaluator();
    return graph.nodes.map((inst) => {
      const drivenKeys: string[] = [];
      for (const e of graph.edges) {
        if (e.toNode === inst.id && isParamSocketId(e.toSocket)) {
          drivenKeys.push(e.toSocket.slice(6));
        }
      }
      const eff = evaluator.getEffectiveParams(inst.id);
      const drivenParams: Record<string, number> = {};
      if (eff) {
        for (const k of drivenKeys) {
          if (typeof eff[k] === "number") {
            drivenParams[k] = eff[k] as number;
          }
        }
      }
      return {
        id: inst.id,
        type: "pixetNode",
        position: inst.position,
        selected: selSet.has(inst.id),
        data: {
          instance: inst,
          pinned: pinnedNodeId === inst.id,
          evalVersion: nodesVersion + currentFrame,
          drivenParams,
          drivenKeys,
        },
      };
    });
  }, [graph.nodes, graph.edges, selectedNodeIds, pinnedNodeId, nodesVersion, currentFrame]);

  const rfEdges: Edge[] = useMemo(() => {
    return graph.edges.map((e) => {
      const fromNode = graph.nodes.find((n) => n.id === e.fromNode);
      const fromDef = fromNode ? nodeRegistry.get(fromNode.type) : undefined;
      const sock = fromDef?.outputs.find((o) => o.id === e.fromSocket);
      const stroke = isParamSocketId(e.toSocket)
        ? "#f59e0b"
        : sock
        ? SOCKET_COLORS[sock.type]
        : "#888888";
      return {
        id: e.id,
        source: e.fromNode,
        sourceHandle: e.fromSocket,
        target: e.toNode,
        targetHandle: e.toSocket,
        style: { stroke, strokeWidth: 2 },
      };
    });
  }, [graph.edges, graph.nodes]);

  const handleNodesChange: OnNodesChange<PixetFlowNodeType> = useCallback(
    (changes) => {
      const posUpdates = new Map<string, { x: number; y: number }>();
      for (const ch of changes) {
        if (ch.type === "position" && ch.position) {
          posUpdates.set(ch.id, ch.position);
        }
      }
      if (posUpdates.size > 0) {
        updateActiveNodeGraphLive((g) => ({
          ...g,
          nodes: g.nodes.map((n) => {
            const p = posUpdates.get(n.id);
            return p ? { ...n, position: { x: p.x, y: p.y } } : n;
          }),
        }));
      }
    },
    []
  );

  const handleNodeDragStart = useCallback(() => {
    if (!draggingRef.current) {
      draggingRef.current = true;
      beginNodeTransaction("Move Nodes");
    }
  }, []);

  const handleNodeDragStop: OnNodeDrag<PixetFlowNodeType> = useCallback(
    (_event, node) => {
      if (draggingRef.current) {
        draggingRef.current = false;
        commitNodeTransaction();
      }
      // Splice if dropped directly onto an existing edge and node has no edges yet
      const cur = pixelEngine.nodes.getActiveGraph();
      if (!cur) return;
      const hasEdges = cur.edges.some((e) => e.fromNode === node.id || e.toNode === node.id);
      if (hasEdges) return;

      for (const edge of cur.edges) {
        const src = cur.nodes.find((n) => n.id === edge.fromNode);
        const dst = cur.nodes.find((n) => n.id === edge.toNode);
        if (!src || !dst) continue;
        const midX = (src.position.x + dst.position.x) * 0.5;
        const midY = (src.position.y + dst.position.y) * 0.5;
        const dist = Math.hypot(node.position.x - midX, node.position.y - midY);
        if (dist < 42) {
          mutateActiveNodeGraph("Splice Node", (g) => {
            const res = spliceNodeOnEdge(g, nodeRegistry, node.id, edge.id);
            return res.spliced ? res.graph : g;
          }, [node.id]);
          break;
        }
      }
    },
    []
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return;
      const src = conn.source;
      const srcH = conn.sourceHandle;
      const dst = conn.target;
      const dstH = conn.targetHandle;
      mutateActiveNodeGraph(
        "Connect Nodes",
        (g) => {
          const res = connectSockets(g, nodeRegistry, {
            fromNode: src,
            fromSocket: srcH,
            toNode: dst,
            toSocket: dstH,
          });
          if (!res.ok && res.reason) {
            setStatusMessage(res.reason);
          }
          return res.ok ? res.graph : g;
        },
        [dst]
      );
    },
    [setStatusMessage]
  );

  const handleConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (!connectionState.isValid && connectionState.fromNode && connectionState.fromHandle) {
        const clientX =
          "clientX" in event ? event.clientX : event.touches[0]?.clientX ?? 240;
        const clientY =
          "clientY" in event ? event.clientY : event.touches[0]?.clientY ?? 200;
        patchNodesUi({
          quickAddOpen: true,
          quickAddPos: { x: clientX, y: clientY },
          pendingWireFrom: {
            nodeId: connectionState.fromNode.id,
            socketId: connectionState.fromHandle.id ?? "out",
            handleType: connectionState.fromHandle.type === "target" ? "target" : "source",
          },
        });
      }
    },
    [patchNodesUi]
  );

  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      if (event.altKey) {
        mutateActiveNodeGraph(
          "Disconnect Wire",
          (g) => removeEdges(g, [edge.id]),
          [edge.target]
        );
      }
    },
    []
  );

  const handleSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams) => {
      const nextIds = nodes.map((n) => n.id);
      patchNodesUi({ selectedNodeIds: nextIds });
    },
    [patchNodesUi]
  );

  const screenToFlow = useCallback(
    (x: number, y: number) => rf.screenToFlowPosition({ x, y }),
    [rf]
  );

  return (
    <div
      className="nodes-canvas-wrap"
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("react-flow__pane")) {
          patchNodesUi({
            quickAddOpen: true,
            quickAddPos: { x: e.clientX, y: e.clientY },
            pendingWireFrom: null,
          });
        }
      }}
      onClick={() => {
        if (ctxMenu) setCtxMenu(null);
        if (useEditorStore.getState().nodesUi.quickAddOpen) {
          patchNodesUi({ quickAddOpen: false, pendingWireFrom: null });
        }
      }}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onEdgeClick={handleEdgeClick}
        onSelectionChange={handleSelectionChange}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: null });
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
        }}
        deleteKeyCode={null}
        snapToGrid
        snapGrid={[8, 8]}
        fitView={graph.nodes.length > 0}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#232323" gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <QuickAddMenu screenToFlow={screenToFlow} />
      <NodeContextMenu
        menu={ctxMenu}
        onClose={() => setCtxMenu(null)}
        screenToFlow={screenToFlow}
      />
    </div>
  );
}

export function ReactFlowCanvas() {
  return (
    <ReactFlowProvider>
      <ReactFlowInner />
    </ReactFlowProvider>
  );
}
