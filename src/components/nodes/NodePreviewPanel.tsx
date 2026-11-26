import { useEffect, useRef, useState } from "react";
import { Grid3x3, Pin } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { nodeRegistry } from "../../engine/nodes/NodeRegistry";
import { getNodeEvaluator } from "../../engine/nodes/nodeActions";
import type { Preview3DMeshKind } from "../../engine/nodes/pbrPreview3d";
import { useEditorStore, type NodesUiState } from "../../store/editorStore";

const MODES_2D: Array<{ id: NodesUiState["preview2dMode"]; label: string }> = [
  { id: "rgba", label: "RGBA" },
  { id: "gray", label: "Gray" },
  { id: "r", label: "R" },
  { id: "g", label: "G" },
  { id: "b", label: "B" },
  { id: "a", label: "A" },
  { id: "tile3x3", label: "3×3" },
];

const MESH_KINDS: Array<{ id: Preview3DMeshKind; label: string }> = [
  { id: "cube", label: "Cube" },
  { id: "sphere", label: "Sphere" },
  { id: "quad", label: "Quad" },
  { id: "cylinder", label: "Cylinder" },
  { id: "active3d", label: "Active 3D Model" },
];

export function NodePreviewPanel() {
  const nodesVersion = useEditorStore((s) => s.nodesVersion);
  const model3dVersion = useEditorStore((s) => s.model3dVersion);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const documentPalette = useEditorStore((s) => s.palette);
  const selectedNodeIds = useEditorStore((s) => s.nodesUi.selectedNodeIds);
  const pinnedNodeId = useEditorStore((s) => s.nodesUi.pinnedNodeId);
  const previewTab = useEditorStore((s) => s.nodesUi.previewTab);
  const preview2dMode = useEditorStore((s) => s.nodesUi.preview2dMode);
  const patchNodesUi = useEditorStore((s) => s.patchNodesUi);

  const [meshKind, setMeshKind] = useState<Preview3DMeshKind>("cube");
  const [yawDeg, setYawDeg] = useState(32);
  const [pitchDeg, setPitchDeg] = useState(-20);
  const [lightAngleDeg, setLightAngleDeg] = useState(45);
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const graph = pixelEngine.nodes.getActiveGraph();

  const targetNodeId = resolvePreviewTargetNodeId(graph, pinnedNodeId, selectedNodeIds);
  const targetNode = graph?.nodes.find((n) => n.id === targetNodeId) ?? null;
  const targetDef = targetNode ? nodeRegistry.get(targetNode.type) : undefined;

  useEffect(() => {
    if (!canvasRef.current) return;
    const evaluator = getNodeEvaluator();
    if (previewTab === "2d") {
      if (!targetNode || !targetDef) return;
      if (targetDef.paletteEvaluate) {
        const colors = targetDef.paletteEvaluate(targetNode.params, documentPalette);
        const ctx = canvasRef.current.getContext("2d");
        if (ctx) {
          const w = canvasRef.current.width;
          const h = canvasRef.current.height;
          ctx.clearRect(0, 0, w, h);
          const count = Math.max(1, colors.length);
          const cols = Math.ceil(Math.sqrt(count));
          const rows = Math.ceil(count / cols);
          const cellW = w / cols;
          const cellH = h / rows;
          for (let i = 0; i < colors.length; i++) {
            const cx = i % cols;
            const cy = Math.floor(i / cols);
            ctx.fillStyle = colors[i];
            ctx.fillRect(
              Math.floor(cx * cellW),
              Math.floor(cy * cellH),
              Math.ceil(cellW),
              Math.ceil(cellH)
            );
          }
        }
        return;
      }
      const outSock = targetDef.outputs[0];
      const sockId = outSock ? outSock.id : targetNode.type === "output.material" ? "albedo" : "";
      if (!sockId) return;
      const renderMode =
        outSock?.type === "gray" && preview2dMode === "rgba" ? "gray" : preview2dMode;
      evaluator.renderPreviewToCanvas(targetNode.id, sockId, canvasRef.current, renderMode);
    } else {
      const bundle = targetNode
        ? evaluator.getPreviewMaterialBundle(targetNode.id, nodeRegistry, targetNode.type)
        : null;
      evaluator.render3DPbrPreviewToCanvas(canvasRef.current, bundle, {
        meshKind,
        yawDeg,
        pitchDeg,
        lightAngleDeg,
        modelNodes: pixelEngine.model3d.nodes,
      });
    }
  }, [
    previewTab,
    targetNode,
    targetDef,
    graph,
    preview2dMode,
    nodesVersion,
    model3dVersion,
    currentFrame,
    documentPalette,
    meshKind,
    yawDeg,
    pitchDeg,
    lightAngleDeg,
  ]);

  return (
    <section className="panel-section">
      <div className="panel-header">
        <span>
          Preview {targetDef ? `· ${targetDef.label}` : ""}
        </span>
        <div className="nodes-param-inline">
          {targetNode && (
            <button
              type="button"
              className={`mini-btn ${pinnedNodeId === targetNode.id ? "active" : ""}`}
              title="Pin preview to this node (P)"
              onClick={() =>
                patchNodesUi({
                  pinnedNodeId: pinnedNodeId === targetNode.id ? null : targetNode.id,
                })
              }
            >
              <Pin size={12} />
            </button>
          )}
          <button
            type="button"
            className={`mini-btn ${previewTab === "2d" ? "active" : ""}`}
            onClick={() => patchNodesUi({ previewTab: "2d" })}
          >
            2D
          </button>
          <button
            type="button"
            className={`mini-btn ${previewTab === "3d" ? "active" : ""}`}
            onClick={() => patchNodesUi({ previewTab: "3d" })}
          >
            3D
          </button>
        </div>
      </div>

      <div className="nodes-preview-box">
        {previewTab === "2d" ? (
          <div className="nodes-preview-toolbar">
            {MODES_2D.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`mini-btn ${preview2dMode === m.id ? "active" : ""}`}
                onClick={() => patchNodesUi({ preview2dMode: m.id })}
              >
                {m.id === "tile3x3" ? <Grid3x3 size={12} /> : m.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="nodes-preview-toolbar">
            <select
              className="nodes-select"
              style={{ flex: 1 }}
              value={meshKind}
              onChange={(e) => setMeshKind(e.target.value as Preview3DMeshKind)}
            >
              {MESH_KINDS.map((mk) => (
                <option key={mk.id} value={mk.id}>
                  {mk.label}
                </option>
              ))}
            </select>
            <input
              type="range"
              title="Light Angle"
              min={0}
              max={360}
              value={lightAngleDeg}
              style={{ width: 70 }}
              onChange={(e) => setLightAngleDeg(Number(e.target.value))}
            />
          </div>
        )}

        <div
          className="nodes-preview-canvas-wrap"
          onPointerDown={(e) => {
            if (previewTab !== "3d") return;
            dragRef.current = { x: e.clientX, y: e.clientY, yaw: yawDeg, pitch: pitchDeg };
          }}
          onPointerMove={(e) => {
            if (previewTab !== "3d" || !dragRef.current) return;
            setYawDeg(dragRef.current.yaw + (e.clientX - dragRef.current.x) * 0.6);
            setPitchDeg(
              Math.max(-85, Math.min(85, dragRef.current.pitch + (e.clientY - dragRef.current.y) * 0.6))
            );
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerLeave={() => {
            dragRef.current = null;
          }}
        >
          <canvas
            ref={canvasRef}
            width={256}
            height={256}
            className="nodes-preview-canvas"
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Preview priority:
 * 1. Explicitly pinned node (P)
 * 2. Currently selected node (first selected if multiple)
 * 3. Output node (Material Output -> Bake Output -> Preview Output -> last node) when nothing is selected
 */
function resolvePreviewTargetNodeId(
  graph: ReturnType<typeof pixelEngine.nodes.getActiveGraph>,
  pinnedNodeId: string | null,
  selectedNodeIds: readonly string[]
): string | null {
  if (!graph) return null;
  if (pinnedNodeId && graph.nodes.some((n) => n.id === pinnedNodeId)) {
    return pinnedNodeId;
  }
  if (selectedNodeIds.length > 0 && graph.nodes.some((n) => n.id === selectedNodeIds[0])) {
    return selectedNodeIds[0];
  }
  const matOut = graph.nodes.find((n) => n.type === "output.material");
  if (matOut) return matOut.id;
  const sink = graph.nodes.find((n) => nodeRegistry.get(n.type)?.isSink);
  return sink?.id ?? graph.nodes[graph.nodes.length - 1]?.id ?? null;
}
