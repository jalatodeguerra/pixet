import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorBoundary } from "../ErrorBoundary";
import { Timeline } from "../Timeline";
import { CurveEditorAsync } from "../lazyWorkspaces";
import { TilesetBrowserPanel } from "../tiles/TilesetBrowserPanel";
import { useEditorStore } from "../../store/editorStore";
import {
  getAreaEditorDef,
  MAX_BOTTOM_AREAS,
  type AreaEditorId,
} from "../../engine/ui/areaEditors";
import {
  AreaChromeContext,
  AreaHeader,
  AreaSwitcher,
  CollapseButton,
  JoinButton,
  SplitButton,
} from "./AreaChrome";
import { EmbeddedPreview } from "./EmbeddedPreview";
import { useAreaConfig, useVisibleBottomEditors } from "./useAreaLayout";

export function AreaEditorBody({ id }: { id: AreaEditorId }) {
  switch (id) {
    case "curves":
      return <CurveEditorAsync mode="rig" />;
    case "tileset":
      return <TilesetBrowserPanel docked />;
    case "preview":
      return <EmbeddedPreview />;
    default:
      return null;
  }
}

interface BottomProps {
  /** Show the manual-height resizer above the strip. */
  resizer: ReactNode;
}

/** The bottom strip: one or two side-by-side area editors. */
export function BottomAreas({ resizer }: BottomProps) {
  const ws = useEditorStore((s) => s.workspaceMode);
  const cfg = useAreaConfig();
  const editors = useVisibleBottomEditors();
  const timelineHeight = useEditorStore((s) => s.timelineHeight);
  const timelineCollapsed = useEditorStore((s) => s.timelineCollapsed);
  const toggleTimelineCollapsed = useEditorStore((s) => s.toggleTimelineCollapsed);
  const setBottomAreaEditor = useEditorStore((s) => s.setBottomAreaEditor);
  const splitBottomArea = useEditorStore((s) => s.splitBottomArea);
  const joinBottomArea = useEditorStore((s) => s.joinBottomArea);
  const setBottomSplitRatio = useEditorStore((s) => s.setBottomSplitRatio);

  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const dragRatioRef = useRef<number | null>(null);

  useEffect(() => {
    if (dragRatio === null) return;
    const onMove = (e: MouseEvent) => {
      const r = rowRef.current?.getBoundingClientRect();
      if (!r || r.width <= 0) return;
      const ratio = Math.max(0.2, Math.min(0.8, (e.clientX - r.left) / r.width));
      dragRatioRef.current = ratio;
      setDragRatio(ratio);
    };
    const onUp = () => {
      if (dragRatioRef.current !== null) setBottomSplitRatio(ws, dragRatioRef.current);
      dragRatioRef.current = null;
      setDragRatio(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragRatio === null, ws, setBottomSplitRatio]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editors.length === 0) return null;

  // Editor index in config (a suppressed timeline may hide the other area).
  const render = (id: AreaEditorId, visIdx: number) => {
    const cfgIdx = cfg.bottomEditors.indexOf(id);
    const split = editors.length > 1;
    const canSplit = cfg.bottomEditors.length < MAX_BOTTOM_AREAS;
    const switcher = (
      <AreaSwitcher
        workspace={ws}
        slot="bottom"
        value={id}
        onChange={(next) => setBottomAreaEditor(ws, cfgIdx, next)}
      />
    );
    const trailing = (
      <>
        {!split && canSplit && <SplitButton onClick={() => splitBottomArea(ws)} />}
        {split && visIdx === 1 && <JoinButton onClick={() => joinBottomArea(ws, cfgIdx)} />}
      </>
    );

    if (id === "timeline") {
      return (
        <AreaChromeContext.Provider value={{ leading: switcher, trailing, fill: split }}>
          <ErrorBoundary name="Timeline" fallback="region">
            <Timeline />
          </ErrorBoundary>
        </AreaChromeContext.Provider>
      );
    }
    return (
      <div className="area-frame" style={{ flex: 1, minHeight: 0 }}>
        <AreaHeader
          switcher={switcher}
          title={getAreaEditorDef(id).label}
          actions={
            <>
              {trailing}
              <CollapseButton collapsed={timelineCollapsed} onClick={toggleTimelineCollapsed} />
            </>
          }
        />
        {!timelineCollapsed && (
          <div className="area-frame-body">
            <ErrorBoundary name={getAreaEditorDef(id).label} fallback="region">
              <AreaEditorBody id={id} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    );
  };

  const resizerEl = !timelineCollapsed ? resizer : null;

  // Default case: a lone timeline renders exactly as before.
  if (editors.length === 1 && editors[0] === "timeline") {
    return (
      <>
        {resizerEl}
        {render("timeline", 0)}
      </>
    );
  }

  const height = timelineCollapsed ? 32 : timelineHeight;
  const ratio = dragRatio ?? cfg.bottomSplitRatio;

  return (
    <>
      {resizerEl}
      <div ref={rowRef} className="area-bottom-row" style={{ height }}>
        {editors.map((id, i) => (
          <Fragment key={id}>
            {i === 1 && (
              <div
                className={`area-divider ${dragRatio !== null ? "dragging" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  dragRatioRef.current = ratio;
                  setDragRatio(ratio);
                }}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize areas"
              />
            )}
            <div
              className="area-cell"
              style={{
                flex:
                  editors.length > 1
                    ? `${i === 0 ? ratio : 1 - ratio} 1 0`
                    : "1 1 0",
              }}
            >
              {render(id, i)}
            </div>
          </Fragment>
        ))}
      </div>
    </>
  );
}
