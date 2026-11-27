import { useEditorStore } from "../../store/editorStore";
import {
  getStudio3DFlatMode,
  studio3DFlatModeShowsTimeline,
} from "../../engine/model3d/studio3dModes";
import {
  visibleBottomEditors,
  type AreaConfig,
  type AreaEditorId,
} from "../../engine/ui/areaEditors";

/**
 * The sprite timeline is irrelevant in Nodes and in the low-poly modeller
 * (except its Animate sub-mode, which reuses this dock for 3D keyframes).
 */
export function useTimelineAllowed(): boolean {
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const flat = useEditorStore((s) =>
    getStudio3DFlatMode({
      workspaceKind: s.studio3d.workspaceKind,
      mode: s.studio3d.mode,
      subMode: s.studio3d.subMode,
    })
  );
  return (
    workspaceMode !== "nodes" &&
    !(workspaceMode === "studio3d" && !studio3DFlatModeShowsTimeline(flat))
  );
}

export function useAreaConfig(): AreaConfig {
  const ws = useEditorStore((s) => s.workspaceMode);
  return useEditorStore((s) => s.areas[ws]);
}

export function useVisibleBottomEditors(): AreaEditorId[] {
  const cfg = useAreaConfig();
  const allowed = useTimelineAllowed();
  return visibleBottomEditors(cfg, allowed);
}
