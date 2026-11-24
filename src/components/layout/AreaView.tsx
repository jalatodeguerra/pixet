import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import type { AreaNode } from "../../engine/ui/workspaceLayout";
import { useEditorStore } from "../../store/editorStore";
import { FloatingPreview } from "../FloatingPreview";
import { Timeline } from "../Timeline";
import { ToolRail } from "../ToolRail";
import { Viewport } from "../Viewport";
import { TilesetBrowserPanel } from "../tiles/TilesetBrowserPanel";
import { AreaHeader } from "./AreaHeader";
import { InspectorArea } from "./InspectorArea";
import {
  CurrentAreaIdContext,
  useLayoutInteraction,
} from "./LayoutContext";
import { PANEL_REGISTRY } from "./panelRegistry";

interface AreaViewProps {
  area: AreaNode;
}

export function AreaView({ area }: AreaViewProps) {
  const layout = useLayoutInteraction();
  const setHoveredAreaId = useEditorStore((s) => s.setHoveredAreaId);
  const toolRailVisible = useEditorStore(
    (s) => s.workspaceLayouts.toolRailVisible
  );
  const toolRailSide = useEditorStore((s) => s.workspaceLayouts.toolRailSide);

  const dropTarget =
    layout?.dropTarget?.areaId === area.id ? layout.dropTarget : null;
  const cornerPreview = layout?.cornerPreview ?? null;
  const isCornerSplitSource =
    cornerPreview?.mode === "split" && cornerPreview.sourceAreaId === area.id;
  const isCornerJoinTarget =
    cornerPreview?.mode === "join" &&
    cornerPreview.joinTargetAreaId === area.id;

  const renderBody = () => {
    if (area.editorType === "viewport") {
      return (
        <div
          className={`layout-viewport-host ${toolRailSide === "right" ? "rail-right" : "rail-left"}`}
        >
          {toolRailVisible && toolRailSide === "left" && <ToolRail />}
          <Viewport />
          {toolRailVisible && toolRailSide === "right" && <ToolRail />}
        </div>
      );
    }
    if (area.editorType === "timeline") {
      return <Timeline fluid />;
    }
    if (area.editorType === "preview") {
      return <FloatingPreview docked />;
    }
    if (area.editorType === "tiles-browser") {
      return (
        <div className="layout-area-scroll">
          <TilesetBrowserPanel docked />
        </div>
      );
    }
    if (area.editorType === "inspector") {
      return <InspectorArea area={area} />;
    }
    if (area.editorType === "panel" && area.panelId) {
      const entry = PANEL_REGISTRY[area.panelId];
      return (
        <div className="layout-inspector-scroll" data-inspector-area-id={area.id}>
          {entry ? entry.render() : null}
        </div>
      );
    }
    return null;
  };

  return (
    <CurrentAreaIdContext.Provider value={area.id}>
      <div
        className="layout-area"
        data-area-id={area.id}
        data-editor-type={area.editorType}
        onMouseEnter={() => setHoveredAreaId(area.id)}
      >
        <AreaHeader area={area} />
        <div className="layout-area-body">{renderBody()}</div>

        {/* Blender-style 4 corner action zones (drag inward to split, outward to join) */}
        <div
          className="layout-corner-zone layout-corner-nw"
          title="Drag inward to split · Drag outward to join"
          onMouseDown={(e) => layout?.startCornerDrag(area.id, "nw", e)}
        />
        <div
          className="layout-corner-zone layout-corner-ne"
          title="Drag inward to split · Drag outward to join"
          onMouseDown={(e) => layout?.startCornerDrag(area.id, "ne", e)}
        />
        <div
          className="layout-corner-zone layout-corner-sw"
          title="Drag inward to split · Drag outward to join"
          onMouseDown={(e) => layout?.startCornerDrag(area.id, "sw", e)}
        />
        <div
          className="layout-corner-zone layout-corner-se"
          title="Drag inward to split · Drag outward to join"
          onMouseDown={(e) => layout?.startCornerDrag(area.id, "se", e)}
        />

        {/* Live split line preview during corner drag */}
        {isCornerSplitSource && cornerPreview?.splitDirection && (
          <div
            className={`layout-corner-split-line ${
              cornerPreview.splitDirection === "horizontal"
                ? "is-horizontal"
                : "is-vertical"
            }`}
            style={
              cornerPreview.splitDirection === "horizontal"
                ? { left: `${Math.round((cornerPreview.splitRatio ?? 0.5) * 100)}%` }
                : { top: `${Math.round((cornerPreview.splitRatio ?? 0.5) * 100)}%` }
            }
          />
        )}

        {/* Live join overlay when dragging a neighbor's corner into this area */}
        {isCornerJoinTarget && (
          <div className="layout-join-overlay">
            {cornerPreview?.joinDirection === "right" && <ArrowRight size={28} />}
            {cornerPreview?.joinDirection === "left" && <ArrowLeft size={28} />}
            {cornerPreview?.joinDirection === "bottom" && <ArrowDown size={28} />}
            {cornerPreview?.joinDirection === "top" && <ArrowUp size={28} />}
            <span>Join Area</span>
          </div>
        )}

        {/* 5-zone drop preview during area/panel drag-to-dock */}
        {dropTarget && (
          <div
            className={`layout-drop-preview zone-${dropTarget.zone}`}
            aria-hidden="true"
          />
        )}
      </div>
    </CurrentAreaIdContext.Provider>
  );
}
