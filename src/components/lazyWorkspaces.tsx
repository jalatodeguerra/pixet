import { lazy, Suspense } from "react";

// 3D Studio (three.js) and Nodes (@xyflow/react) are code-split so the
// initial bundle does not pay for them. Nothing in the eager graph may
// statically import from ./studio3d/three or ./nodes.
const Studio3DViewportLazy = lazy(() =>
  import("./studio3d/Studio3DViewport").then((m) => ({ default: m.Studio3DViewport })),
);
const Studio3DSidebarLazy = lazy(() =>
  import("./studio3d/Studio3DSidebar").then((m) => ({ default: m.Studio3DSidebar })),
);
const Studio3DToolRailLazy = lazy(() =>
  import("./studio3d/Studio3DToolRail").then((m) => ({ default: m.Studio3DToolRail })),
);
const Studio3DToolOptionsBarLazy = lazy(() =>
  import("./studio3d/Studio3DToolOptionsBar").then((m) => ({
    default: m.Studio3DToolOptionsBar,
  })),
);
const NodesWorkspaceLazy = lazy(() =>
  import("./nodes/NodesWorkspace").then((m) => ({ default: m.NodesWorkspace })),
);
const NodesSidebarLazy = lazy(() =>
  import("./nodes/NodesSidebar").then((m) => ({ default: m.NodesSidebar })),
);
const NodesToolOptionsBarLazy = lazy(() =>
  import("./nodes/NodesToolOptionsBar").then((m) => ({ default: m.NodesToolOptionsBar })),
);

function LoadingLine({ label, fill }: { label: string; fill?: boolean }) {
  return (
    <div
      role="status"
      style={{
        color: "var(--text-secondary)",
        fontSize: 12,
        padding: 12,
        ...(fill ? { flex: 1 } : null),
      }}
    >
      {label}
    </div>
  );
}

export function Studio3DViewportAsync() {
  return (
    <Suspense fallback={<LoadingLine label="Loading 3D Studio…" fill />}>
      <Studio3DViewportLazy />
    </Suspense>
  );
}
export function Studio3DSidebarAsync() {
  return (
    <Suspense fallback={<LoadingLine label="Loading 3D Studio…" />}>
      <Studio3DSidebarLazy />
    </Suspense>
  );
}
export function Studio3DToolRailAsync() {
  return (
    <Suspense fallback={null}>
      <Studio3DToolRailLazy />
    </Suspense>
  );
}
export function Studio3DToolOptionsBarAsync() {
  return (
    <Suspense fallback={null}>
      <Studio3DToolOptionsBarLazy />
    </Suspense>
  );
}
export function NodesWorkspaceAsync() {
  return (
    <Suspense fallback={<LoadingLine label="Loading Nodes…" fill />}>
      <NodesWorkspaceLazy />
    </Suspense>
  );
}
export function NodesSidebarAsync() {
  return (
    <Suspense fallback={<LoadingLine label="Loading Nodes…" />}>
      <NodesSidebarLazy />
    </Suspense>
  );
}
export function NodesToolOptionsBarAsync() {
  return (
    <Suspense fallback={null}>
      <NodesToolOptionsBarLazy />
    </Suspense>
  );
}

const RigSidebarLazy = lazy(() =>
  import("./rig/RigSidebar").then((m) => ({ default: m.RigSidebar })),
);
const TilesSidebarLazy = lazy(() =>
  import("./tiles/TilesSidebar").then((m) => ({ default: m.TilesSidebar })),
);
const CurveEditorLazy = lazy(() =>
  import("./rig/CurveEditor").then((m) => ({ default: m.CurveEditor })),
);

export function RigSidebarAsync() {
  return (
    <Suspense fallback={<LoadingLine label="Loading Rig…" />}>
      <RigSidebarLazy />
    </Suspense>
  );
}
export function TilesSidebarAsync() {
  return (
    <Suspense fallback={<LoadingLine label="Loading Tiles…" />}>
      <TilesSidebarLazy />
    </Suspense>
  );
}
export function CurveEditorAsync({ mode }: { mode: "rig" | "model3d" }) {
  return (
    <Suspense fallback={<LoadingLine label="Loading curves…" />}>
      <CurveEditorLazy mode={mode} />
    </Suspense>
  );
}
