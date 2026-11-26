import { canConnectSockets, type NodeRegistry } from "./NodeRegistry.ts";
import type {
  EdgeConnection,
  GraphAssetEntry,
  NodeGraph,
  NodeInstance,
  NodesDocumentExt,
  SocketType,
} from "./types.ts";

let idCounter = 1;
export function nextNodeId(prefix = "n"): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function createEmptyGraph(
  name = "Material Graph",
  kind: NodeGraph["kind"] = "material",
  baseResolution: NodeGraph["baseResolution"] = 128,
  id = nextNodeId("graph")
): NodeGraph {
  return {
    id,
    name,
    kind,
    baseResolution,
    seed: 1337,
    nodes: [],
    edges: [],
    frames: [],
    exposedParams: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function cloneGraph(graph: NodeGraph): NodeGraph {
  return JSON.parse(JSON.stringify(graph)) as NodeGraph;
}

export function addNode(graph: NodeGraph, node: NodeInstance): NodeGraph {
  return {
    ...graph,
    nodes: [...graph.nodes, node],
  };
}

export function removeNodes(
  graph: NodeGraph,
  nodeIds: readonly string[]
): NodeGraph {
  if (nodeIds.length === 0) return graph;
  const removeSet = new Set(nodeIds);
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => !removeSet.has(n.id)),
    edges: graph.edges.filter(
      (e) => !removeSet.has(e.fromNode) && !removeSet.has(e.toNode)
    ),
    exposedParams: graph.exposedParams.filter((p) => !removeSet.has(p.nodeId)),
  };
}

export function wouldCreateCycle(
  graph: NodeGraph,
  fromNode: string,
  toNode: string
): boolean {
  if (fromNode === toNode) return true;
  // Adding edge fromNode -> toNode creates a cycle iff fromNode is reachable from toNode.
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    let list = adj.get(edge.fromNode);
    if (!list) {
      list = [];
      adj.set(edge.fromNode, list);
    }
    list.push(edge.toNode);
  }
  const visited = new Set<string>();
  const stack: string[] = [toNode];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === fromNode) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const next = adj.get(cur);
    if (next) {
      for (const n of next) {
        if (!visited.has(n)) stack.push(n);
      }
    }
  }
  return false;
}

export function isParamSocketId(socketId: string): boolean {
  return socketId.startsWith("param:");
}

export interface ConnectResult {
  graph: NodeGraph;
  ok: boolean;
  coerced: boolean;
  reason?: string;
}

export function connectSockets(
  graph: NodeGraph,
  registry: NodeRegistry,
  edge: Omit<EdgeConnection, "id"> & { id?: string }
): ConnectResult {
  const fromNode = graph.nodes.find((n) => n.id === edge.fromNode);
  const toNode = graph.nodes.find((n) => n.id === edge.toNode);
  if (!fromNode || !toNode) {
    return { graph, ok: false, coerced: false, reason: "Missing source or target node" };
  }
  if (fromNode.id === toNode.id) {
    return { graph, ok: false, coerced: false, reason: "Self-connections are not allowed" };
  }
  const fromDef = registry.get(fromNode.type);
  const toDef = registry.get(toNode.type);
  if (!fromDef || !toDef) {
    return { graph, ok: false, coerced: false, reason: "Unknown node definition" };
  }
  const outSock = fromDef.outputs.find((s) => s.id === edge.fromSocket);
  if (!outSock) {
    return { graph, ok: false, coerced: false, reason: "Invalid source socket id" };
  }

  let targetType: SocketType;
  if (isParamSocketId(edge.toSocket)) {
    const paramId = edge.toSocket.slice(6);
    const paramDef = toDef.params.find((p) => p.id === paramId);
    if (!paramDef || (paramDef.kind !== "float" && paramDef.kind !== "int")) {
      return { graph, ok: false, coerced: false, reason: `Invalid parameter target: ${paramId}` };
    }
    targetType = "float";
  } else {
    const inSock = toDef.inputs.find((s) => s.id === edge.toSocket);
    if (!inSock) {
      return { graph, ok: false, coerced: false, reason: "Invalid target socket id" };
    }
    targetType = inSock.type;
  }

  const compat = canConnectSockets(outSock.type, targetType);
  if (!compat.allowed) {
    return {
      graph,
      ok: false,
      coerced: false,
      reason: `Incompatible sockets: ${outSock.type} -> ${targetType}`,
    };
  }
  if (wouldCreateCycle(graph, edge.fromNode, edge.toNode)) {
    return { graph, ok: false, coerced: false, reason: "Connection would create a cycle" };
  }

  const newEdge: EdgeConnection = {
    id: edge.id ?? nextNodeId("edge"),
    fromNode: edge.fromNode,
    fromSocket: edge.fromSocket,
    toNode: edge.toNode,
    toSocket: edge.toSocket,
  };

  // Single-input fan-in: replace any existing wire targeting (toNode, toSocket).
  const filtered = graph.edges.filter(
    (e) => !(e.toNode === edge.toNode && e.toSocket === edge.toSocket)
  );
  return {
    graph: {
      ...graph,
      edges: [...filtered, newEdge],
    },
    ok: true,
    coerced: compat.coerced,
  };
}

export function removeEdges(
  graph: NodeGraph,
  edgeIds: readonly string[]
): NodeGraph {
  if (edgeIds.length === 0) return graph;
  const removeSet = new Set(edgeIds);
  return {
    ...graph,
    edges: graph.edges.filter((e) => !removeSet.has(e.id)),
  };
}

export function spliceNodeOnEdge(
  graph: NodeGraph,
  registry: NodeRegistry,
  nodeId: string,
  edgeId: string
): { graph: NodeGraph; spliced: boolean } {
  const edge = graph.edges.find((e) => e.id === edgeId);
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!edge || !node) return { graph, spliced: false };
  if (edge.fromNode === nodeId || edge.toNode === nodeId) {
    return { graph, spliced: false };
  }

  const fromNode = graph.nodes.find((n) => n.id === edge.fromNode);
  const toNode = graph.nodes.find((n) => n.id === edge.toNode);
  if (!fromNode || !toNode) return { graph, spliced: false };

  const fromDef = registry.get(fromNode.type);
  const midDef = registry.get(node.type);
  const toDef = registry.get(toNode.type);
  if (!fromDef || !midDef || !toDef) return { graph, spliced: false };

  const srcSock = fromDef.outputs.find((s) => s.id === edge.fromSocket);
  const dstSock = toDef.inputs.find((s) => s.id === edge.toSocket);
  if (!srcSock || !dstSock) return { graph, spliced: false };

  const midIn = midDef.inputs.find(
    (s) => canConnectSockets(srcSock.type, s.type).allowed
  );
  const midOut = midDef.outputs.find(
    (s) => canConnectSockets(s.type, dstSock.type).allowed
  );
  if (!midIn || !midOut) return { graph, spliced: false };

  const withoutOld = removeEdges(graph, [edgeId]);
  const step1 = connectSockets(withoutOld, registry, {
    fromNode: edge.fromNode,
    fromSocket: edge.fromSocket,
    toNode: node.id,
    toSocket: midIn.id,
  });
  if (!step1.ok) return { graph, spliced: false };

  const step2 = connectSockets(step1.graph, registry, {
    fromNode: node.id,
    fromSocket: midOut.id,
    toNode: edge.toNode,
    toSocket: edge.toSocket,
  });
  if (!step2.ok) return { graph, spliced: false };

  return { graph: step2.graph, spliced: true };
}

export function toggleBypassNodes(
  graph: NodeGraph,
  nodeIds: readonly string[]
): NodeGraph {
  if (nodeIds.length === 0) return graph;
  const target = new Set(nodeIds);
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      target.has(n.id) ? { ...n, bypassed: !n.bypassed } : n
    ),
  };
}

export function duplicateSelection(
  graph: NodeGraph,
  nodeIds: readonly string[],
  offsetX = 24,
  offsetY = 24
): { graph: NodeGraph; createdNodeIds: string[] } {
  if (nodeIds.length === 0) return { graph, createdNodeIds: [] };
  const selSet = new Set(nodeIds);
  const idMap = new Map<string, string>();
  const newNodes: NodeInstance[] = [];

  for (const node of graph.nodes) {
    if (!selSet.has(node.id)) continue;
    const newId = nextNodeId("n");
    idMap.set(node.id, newId);
    const cloned = JSON.parse(JSON.stringify(node)) as NodeInstance;
    cloned.id = newId;
    cloned.position = {
      x: node.position.x + offsetX,
      y: node.position.y + offsetY,
    };
    newNodes.push(cloned);
  }

  const newEdges: EdgeConnection[] = [];
  for (const edge of graph.edges) {
    const mappedFrom = idMap.get(edge.fromNode);
    const mappedTo = idMap.get(edge.toNode);
    if (mappedFrom && mappedTo) {
      newEdges.push({
        id: nextNodeId("edge"),
        fromNode: mappedFrom,
        fromSocket: edge.fromSocket,
        toNode: mappedTo,
        toSocket: edge.toSocket,
      });
    }
  }

  return {
    graph: {
      ...graph,
      nodes: [...graph.nodes, ...newNodes],
      edges: [...graph.edges, ...newEdges],
    },
    createdNodeIds: newNodes.map((n) => n.id),
  };
}

export function topologicalSort(graph: NodeGraph): {
  order: string[];
  hasCycle: boolean;
} {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const nodeIds = graph.nodes.map((n) => n.id).sort();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  const seenEdge = new Set<string>();
  for (const edge of graph.edges) {
    if (!inDegree.has(edge.fromNode) || !inDegree.has(edge.toNode)) continue;
    const key = `${edge.fromNode}->${edge.toNode}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    adj.get(edge.fromNode)!.push(edge.toNode);
    inDegree.set(edge.toNode, (inDegree.get(edge.toNode) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const id of nodeIds) {
    if ((inDegree.get(id) ?? 0) === 0) queue.push(id);
  }
  queue.sort();

  const order: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    const neighbors = adj.get(cur) ?? [];
    for (const nxt of neighbors) {
      const nextDeg = (inDegree.get(nxt) ?? 0) - 1;
      inDegree.set(nxt, nextDeg);
      if (nextDeg === 0) {
        queue.push(nxt);
        queue.sort();
      }
    }
  }

  return {
    order,
    hasCycle: order.length !== nodeIds.length,
  };
}

export function computeReachableNodes(
  graph: NodeGraph,
  sinkNodeIds: readonly string[]
): Set<string> {
  const nodeSet = new Set(graph.nodes.map((n) => n.id));
  const revAdj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!nodeSet.has(edge.fromNode) || !nodeSet.has(edge.toNode)) continue;
    let list = revAdj.get(edge.toNode);
    if (!list) {
      list = [];
      revAdj.set(edge.toNode, list);
    }
    list.push(edge.fromNode);
  }

  const reachable = new Set<string>();
  const stack: string[] = [];
  for (const id of sinkNodeIds) {
    if (nodeSet.has(id)) stack.push(id);
  }

  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    const parents = revAdj.get(cur);
    if (parents) {
      for (const p of parents) {
        if (!reachable.has(p)) stack.push(p);
      }
    }
  }
  return reachable;
}

export function computeDownstreamNodes(
  graph: NodeGraph,
  dirtyStartIds: readonly string[]
): Set<string> {
  const nodeSet = new Set(graph.nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!nodeSet.has(edge.fromNode) || !nodeSet.has(edge.toNode)) continue;
    let list = adj.get(edge.fromNode);
    if (!list) {
      list = [];
      adj.set(edge.fromNode, list);
    }
    list.push(edge.toNode);
  }

  const dirty = new Set<string>();
  const stack: string[] = [];
  for (const id of dirtyStartIds) {
    if (nodeSet.has(id)) stack.push(id);
  }

  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (dirty.has(cur)) continue;
    dirty.add(cur);
    const children = adj.get(cur);
    if (children) {
      for (const c of children) {
        if (!dirty.has(c)) stack.push(c);
      }
    }
  }
  return dirty;
}

export class NodeGraphManager {
  graphs: NodeGraph[] = [];
  activeGraphId: string | null = null;
  assets: Record<string, GraphAssetEntry> = {};
  version = 0;

  getActiveGraph(): NodeGraph | null {
    if (!this.activeGraphId) return this.graphs[0] ?? null;
    return this.graphs.find((g) => g.id === this.activeGraphId) ?? this.graphs[0] ?? null;
  }

  setActiveGraph(graphId: string | null): void {
    this.activeGraphId = graphId;
    this.version += 1;
  }

  replaceActiveGraph(next: NodeGraph): void {
    const idx = this.graphs.findIndex((g) => g.id === next.id);
    if (idx >= 0) {
      this.graphs[idx] = next;
    } else {
      this.graphs.push(next);
      this.activeGraphId = next.id;
    }
    this.version += 1;
  }

  reset(): void {
    this.graphs = [];
    this.activeGraphId = null;
    this.assets = {};
    this.version += 1;
  }

  loadFromExt(ext: NodesDocumentExt): void {
    this.graphs = ext.graphs.map(cloneGraph);
    this.activeGraphId = ext.activeGraphId;
    this.assets = { ...ext.assets };
    this.version += 1;
  }
}

export function collectReferencedAssetIds(
  graphs: readonly NodeGraph[]
): Set<string> {
  const used = new Set<string>();
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      for (const val of Object.values(node.params)) {
        if (typeof val === "string" && val.startsWith("asset:")) {
          used.add(val.slice("asset:".length));
        }
      }
      const assetId = node.params.assetId;
      if (typeof assetId === "string" && assetId.length > 0) {
        used.add(assetId);
      }
    }
  }
  return used;
}

export function serializeNodesExt(manager: {
  graphs: readonly NodeGraph[];
  activeGraphId: string | null;
  assets: Record<string, GraphAssetEntry>;
}): NodesDocumentExt {
  const referenced = collectReferencedAssetIds(manager.graphs);
  const prunedAssets: Record<string, GraphAssetEntry> = {};
  for (const [id, entry] of Object.entries(manager.assets)) {
    if (referenced.has(id)) {
      prunedAssets[id] = { ...entry };
    }
  }
  return {
    schemaVersion: 1,
    activeGraphId: manager.activeGraphId,
    graphs: manager.graphs.map(cloneGraph),
    assets: prunedAssets,
  };
}

export function deserializeNodesExt(raw: unknown): NodesDocumentExt {
  if (!raw || typeof raw !== "object") {
    return {
      schemaVersion: 1,
      activeGraphId: null,
      graphs: [],
      assets: {},
    };
  }
  const obj = raw as Partial<NodesDocumentExt>;
  const graphs = Array.isArray(obj.graphs)
    ? obj.graphs.map((g) => ({
        id: typeof g.id === "string" ? g.id : nextNodeId("graph"),
        name: typeof g.name === "string" ? g.name : "Material Graph",
        kind:
          g.kind === "material" || g.kind === "compositor" || g.kind === "subgraph"
            ? g.kind
            : "material",
        baseResolution:
          g.baseResolution === 32 ||
          g.baseResolution === 64 ||
          g.baseResolution === 128 ||
          g.baseResolution === 256 ||
          g.baseResolution === 512 ||
          g.baseResolution === 1024
            ? g.baseResolution
            : 128,
        seed: typeof g.seed === "number" ? g.seed : 1337,
        nodes: Array.isArray(g.nodes) ? g.nodes : [],
        edges: Array.isArray(g.edges) ? g.edges : [],
        frames: Array.isArray(g.frames) ? g.frames : [],
        exposedParams: Array.isArray(g.exposedParams) ? g.exposedParams : [],
        ...(Array.isArray(g.subgraphInputs) ? { subgraphInputs: g.subgraphInputs } : {}),
        ...(Array.isArray(g.subgraphOutputs) ? { subgraphOutputs: g.subgraphOutputs } : {}),
        ...(g.viewport ? { viewport: g.viewport } : {}),
      }))
    : [];

  const activeGraphId =
    typeof obj.activeGraphId === "string" &&
    graphs.some((g) => g.id === obj.activeGraphId)
      ? obj.activeGraphId
      : graphs[0]?.id ?? null;

  const assets: Record<string, GraphAssetEntry> =
    obj.assets && typeof obj.assets === "object"
      ? { ...(obj.assets as Record<string, GraphAssetEntry>) }
      : {};

  return {
    schemaVersion: 1,
    activeGraphId,
    graphs,
    assets,
  };
}
