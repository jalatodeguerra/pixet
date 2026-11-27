import { pixelEngine } from "../document/PixelEngine.ts";
import { useEditorStore } from "../../store/editorStore.ts";
import { collectUniqueEdges, invertSelection } from "./boxSelect.ts";
import { loopCutEdges } from "./loopCut.ts";
import { mutateModel3D } from "./model3dActions.ts";
import {
  collectAffectedVertexIndices,
  computeVerticesCentroid,
  convertNodeCuboidToMesh,
  deleteSelectedElements,
  mergeVertices,
  subdivideFacesOrLoopCut,
} from "./meshOps.ts";
import type { ModelNode, PolyMeshData, SelectionGranularity } from "./types.ts";

/**
 * Object Mode / Edit Mode state and the non-modal Edit Mode operators.
 *
 * Edit Mode is "selectionGranularity is vertex, edge or face"; Object Mode is
 * "object". The last used edit granularity is remembered so Tab returns to it.
 */

export type EditGranularity = Exclude<SelectionGranularity, "object">;

let lastEditGranularity: EditGranularity = "vertex";

export function getLastEditGranularity(): EditGranularity {
  return lastEditGranularity;
}

export function isEditMode(): boolean {
  return pixelEngine.model3d.selectionGranularity !== "object";
}

function say(message: string): void {
  useEditorStore.getState().setStatusMessage(message);
}

function activeNode(): ModelNode | undefined {
  const eng = pixelEngine.model3d;
  return eng.activeNodeId ? eng.getNode(eng.activeNodeId) : undefined;
}

/** The active unlocked mesh node, or null (with a status message explaining why). */
export function requireEditableMesh(): (ModelNode & { mesh: PolyMeshData }) | null {
  const node = activeNode();
  if (!node) {
    say("Select a mesh node first");
    return null;
  }
  if (node.locked) {
    say(`"${node.name}" is locked`);
    return null;
  }
  if (node.kind !== "mesh" || !node.mesh) {
    say("The active node is not a mesh — press Tab to leave Edit Mode, then Tab again to convert it");
    return null;
  }
  return node as ModelNode & { mesh: PolyMeshData };
}

/**
 * Enters Edit Mode for the active node at `granularity` (default: the last one
 * used). Cuboids are converted to meshes in one undo step. Returns false (with a
 * status message) when there is nothing editable.
 */
export function enterEditMode(granularity?: EditGranularity): boolean {
  const eng = pixelEngine.model3d;
  const target = granularity ?? lastEditGranularity;
  const node = activeNode();
  if (!node) {
    say("Select a mesh or cuboid node to enter Edit Mode");
    return false;
  }
  if (node.kind === "group") {
    say("Groups have no geometry — select a mesh or cuboid to enter Edit Mode");
    return false;
  }
  if (node.locked) {
    say(`"${node.name}" is locked — unlock it to enter Edit Mode`);
    return false;
  }
  if (node.kind === "cuboid") {
    mutateModel3D("Convert to Mesh for Edit Mode", (m) => {
      const n = m.getNode(node.id);
      if (!n) return;
      const idx = m.nodes.findIndex((x) => x.id === n.id);
      if (idx >= 0) m.nodes[idx] = convertNodeCuboidToMesh(n);
      m.setSelectionGranularity(target);
    });
    lastEditGranularity = target;
    say(`Converted "${node.name}" to a mesh for Edit Mode — Ctrl+Z undoes it`);
    return true;
  }
  eng.setSelectionGranularity(target);
  lastEditGranularity = target;
  useEditorStore.getState().bumpModel3DVersion();
  return true;
}

export function exitEditMode(): void {
  const eng = pixelEngine.model3d;
  if (eng.selectionGranularity !== "object") {
    lastEditGranularity = eng.selectionGranularity;
  }
  eng.setSelectionGranularity("object");
  useEditorStore.getState().bumpModel3DVersion();
}

/** Tab: Object Mode <-> Edit Mode for the active node. */
export function toggleEditMode(): void {
  if (isEditMode()) exitEditMode();
  else enterEditMode();
}

/** 1 / 2 / 3 (and the rail buttons): switch granularity, entering Edit Mode if needed. */
export function setEditGranularity(granularity: EditGranularity): void {
  const eng = pixelEngine.model3d;
  if (eng.selectionGranularity === "object") {
    enterEditMode(granularity);
    return;
  }
  eng.setSelectionGranularity(granularity);
  lastEditGranularity = granularity;
  useEditorStore.getState().bumpModel3DVersion();
}

/** Short selection summary for the viewport header, e.g. "3 verts". */
export function describeSelectionCount(): string {
  const eng = pixelEngine.model3d;
  const gran = eng.selectionGranularity;
  const id = eng.activeNodeId;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (gran === "object") {
    return plural(eng.selectedNodeIds.length, "node", "nodes");
  }
  if (!id) return plural(0, gran === "vertex" ? "vert" : gran, gran === "vertex" ? "verts" : `${gran}s`);
  if (gran === "vertex") {
    return plural(eng.selectedVertices[id]?.length ?? 0, "vert", "verts");
  }
  if (gran === "edge") {
    return plural(eng.selectedEdges[id]?.length ?? 0, "edge", "edges");
  }
  return plural(eng.selectedFaces[id]?.length ?? 0, "face", "faces");
}

function bump(): void {
  useEditorStore.getState().bumpModel3DVersion();
}

function usedVertexIndices(mesh: PolyMeshData): number[] {
  const set = new Set<number>();
  for (const f of mesh.faces) for (const vi of f.verts) set.add(vi);
  return Array.from(set).sort((a, b) => a - b);
}

function edgeKeyOf(e: readonly [number, number]): string {
  return `${e[0]}:${e[1]}`;
}

/** A: select every element of the active granularity (Object Mode: every node). */
export function selectAllElements(): void {
  const eng = pixelEngine.model3d;
  const gran = eng.selectionGranularity;
  if (gran === "object") {
    const ids = eng.nodes.filter((n) => n.visible).map((n) => n.id);
    eng.selectNodes(ids, eng.activeNodeId ?? ids[ids.length - 1] ?? null);
    bump();
    return;
  }
  const node = requireEditableMesh();
  if (!node) return;
  if (gran === "vertex") eng.selectedVertices[node.id] = usedVertexIndices(node.mesh);
  else if (gran === "edge") eng.selectedEdges[node.id] = collectUniqueEdges(node.mesh);
  else eng.selectedFaces[node.id] = node.mesh.faces.map((f) => f.id);
  bump();
}

/** Alt+A: deselect everything of the active granularity (Object Mode: every node). */
export function deselectAllElements(): void {
  const eng = pixelEngine.model3d;
  const gran = eng.selectionGranularity;
  if (gran === "object") {
    eng.clearSelection();
    bump();
    return;
  }
  const id = eng.activeNodeId;
  if (!id) return;
  if (gran === "vertex") eng.selectedVertices[id] = [];
  else if (gran === "edge") eng.selectedEdges[id] = [];
  else eng.selectedFaces[id] = [];
  bump();
}

/** Ctrl+I: invert the selection of the active granularity. */
export function invertElementSelection(): void {
  const eng = pixelEngine.model3d;
  const gran = eng.selectionGranularity;
  if (gran === "object") {
    const all = eng.nodes.filter((n) => n.visible).map((n) => n.id);
    const next = invertSelection(all, eng.selectedNodeIds);
    eng.selectNodes(next, next[next.length - 1] ?? null);
    bump();
    return;
  }
  const node = requireEditableMesh();
  if (!node) return;
  if (gran === "vertex") {
    eng.selectedVertices[node.id] = invertSelection(
      usedVertexIndices(node.mesh),
      eng.selectedVertices[node.id] ?? []
    );
  } else if (gran === "edge") {
    eng.selectedEdges[node.id] = invertSelection(
      collectUniqueEdges(node.mesh),
      eng.selectedEdges[node.id] ?? [],
      edgeKeyOf
    );
  } else {
    eng.selectedFaces[node.id] = invertSelection(
      node.mesh.faces.map((f) => f.id),
      eng.selectedFaces[node.id] ?? []
    );
  }
  bump();
}

/**
 * Deletes the selected vertices/edges/faces of the active mesh (X / Delete in Edit Mode).
 * Returns true when a sub-element selection existed and was handled.
 */
export function deleteSelectedMeshElements(): boolean {
  const eng = pixelEngine.model3d;
  const gran = eng.selectionGranularity;
  const node = activeNode();
  if (gran === "object" || !node || node.locked || node.kind !== "mesh" || !node.mesh) {
    return false;
  }
  const selVerts = eng.selectedVertices[node.id] ?? [];
  const selEdges = eng.selectedEdges[node.id] ?? [];
  const selFaces = eng.selectedFaces[node.id] ?? [];
  const hasSubSel =
    (gran === "vertex" && selVerts.length > 0) ||
    (gran === "edge" && selEdges.length > 0) ||
    (gran === "face" && selFaces.length > 0);
  if (!hasSubSel) return false;
  let deletedCount = 0;
  mutateModel3D("Delete Mesh Elements", (m) => {
    const n = m.getNode(node.id);
    if (!n || n.kind !== "mesh" || !n.mesh) return;
    const res = deleteSelectedElements(n.mesh, gran, selVerts, selEdges, selFaces);
    deletedCount = res.deletedFaceCount;
    m.updateNode(node.id, { mesh: res.mesh });
    m.selectedVertices[node.id] = [];
    m.selectedEdges[node.id] = [];
    m.selectedFaces[node.id] = [];
  });
  say(deletedCount > 0 ? `Deleted ${deletedCount} face(s)` : "No faces deleted");
  return true;
}

/** M: merge the selected elements' vertices at their center. */
export function mergeSelectedAtCenter(): void {
  const eng = pixelEngine.model3d;
  const node = requireEditableMesh();
  if (!node) return;
  const verts = collectAffectedVertexIndices(
    node.mesh,
    eng.selectionGranularity,
    eng.selectedVertices[node.id] ?? [],
    eng.selectedEdges[node.id] ?? [],
    eng.selectedFaces[node.id] ?? []
  );
  if (verts.length < 2) {
    say("Select at least two vertices to merge");
    return;
  }
  const center = computeVerticesCentroid(node.mesh.vertices, verts);
  mutateModel3D("Merge at Center", (m) => {
    const n = m.getNode(node.id);
    if (!n || n.kind !== "mesh" || !n.mesh) return;
    const merged = mergeVertices(n.mesh, verts, "center");
    m.updateNode(node.id, { mesh: merged });
    m.selectedEdges[node.id] = [];
    m.selectedFaces[node.id] = [];
    m.selectedVertices[node.id] = [];
    if (center) {
      const idx = merged.vertices.findIndex(
        (v) =>
          Math.abs(v[0] - center[0]) < 1e-3 &&
          Math.abs(v[1] - center[1]) < 1e-3 &&
          Math.abs(v[2] - center[2]) < 1e-3
      );
      if (idx >= 0) {
        m.setSelectionGranularity("vertex");
        m.selectedVertices[node.id] = [idx];
      }
    }
  });
  say(`Merged ${verts.length} vertices at center`);
}

/**
 * Ctrl+R. Edge mode: cuts one loop through the ring of each selected edge (the
 * new loop crosses the selected edge at its midpoint and continues across the
 * quads on either side). Face mode: subdivides the selected faces once.
 * Vertex mode: asks for an edge.
 */
export function loopCutOrSubdivide(): void {
  const eng = pixelEngine.model3d;
  const gran = eng.selectionGranularity;
  const node = requireEditableMesh();
  if (!node) return;
  if (gran === "vertex") {
    say("Loop cut needs an edge — press 2 and select one (or press 3 to subdivide faces)");
    return;
  }
  if (gran === "edge") {
    const edges = eng.selectedEdges[node.id] ?? [];
    if (edges.length === 0) {
      say("Select an edge to cut a loop through");
      return;
    }
    let cut = 0;
    mutateModel3D("Loop Cut", (m) => {
      const n = m.getNode(node.id);
      if (!n || n.kind !== "mesh" || !n.mesh) return;
      const res = loopCutEdges(n.mesh, edges);
      cut = res.cutFaceCount;
      if (cut === 0) return;
      m.updateNode(node.id, { mesh: res.mesh });
      m.selectedEdges[node.id] = res.newEdges;
    });
    say(
      cut > 0
        ? `Loop cut through ${cut} quad(s)`
        : "No quad ring found at the selected edge (loop cut needs quads)"
    );
    return;
  }
  const faces = eng.selectedFaces[node.id] ?? [];
  if (faces.length === 0) {
    say("Select faces to subdivide");
    return;
  }
  let count = 0;
  mutateModel3D("Subdivide Faces", (m) => {
    const n = m.getNode(node.id);
    if (!n || n.kind !== "mesh" || !n.mesh) return;
    const oldIds = new Set(n.mesh.faces.map((f) => f.id));
    const sub = subdivideFacesOrLoopCut(n.mesh, faces, "both");
    count = sub.faces.length - n.mesh.faces.length;
    if (count <= 0) return;
    m.updateNode(node.id, { mesh: sub });
    const targets = new Set(faces);
    m.selectedFaces[node.id] = sub.faces
      .filter(
        (f) =>
          targets.has(f.id) ||
          (!oldIds.has(f.id) && faces.some((id) => f.id.startsWith(`${id}-sub`)))
      )
      .map((f) => f.id);
  });
  say(count > 0 ? "Subdivided selected faces (quads only)" : "Only quad faces can be subdivided");
}
