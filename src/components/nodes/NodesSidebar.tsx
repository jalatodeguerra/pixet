import { NodeInspectorPanel } from "./NodeInspectorPanel";
import { NodePreviewPanel } from "./NodePreviewPanel";

export function NodesSidebar() {
  return (
    <div className="sidebar-section-stack">
      <NodePreviewPanel />
      <NodeInspectorPanel />
    </div>
  );
}
