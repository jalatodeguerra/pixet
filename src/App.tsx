import { useEffect, useState } from "react";
import { ExportModal } from "./components/ExportModal";
import { RightSidebar } from "./components/RightSidebar";
import { StatusBar } from "./components/StatusBar";
import { Timeline } from "./components/Timeline";
import { ToolOptionsBar } from "./components/ToolOptionsBar";
import { ToolRail } from "./components/ToolRail";
import { TopBar } from "./components/TopBar";
import { Viewport } from "./components/Viewport";
import { pixelEngine } from "./engine/document/PixelEngine";
import { performRedo, performUndo } from "./engine/document/historyActions";
import {
  commitFloatingSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  deselectAll,
  pasteClipboard,
  selectAllCanvas,
} from "./engine/document/selectionActions";
import {
  openProjectAction,
  saveProjectAction,
} from "./engine/io/projectBridge";
import { ToolId, useEditorStore } from "./store/editorStore";

const TOOL_SHORTCUTS: Record<string, ToolId> = {
  b: "pencil",
  e: "eraser",
  l: "line",
  u: "rect",
  o: "ellipse",
  g: "fill",
  i: "eyedropper",
  m: "marquee",
  v: "move",
  t: "tileStamp",
  k: "isoBox",
};

export function App() {
  const panelsCollapsed = useEditorStore((s) => s.panelsCollapsed);
  const timelineCollapsed = useEditorStore((s) => s.timelineCollapsed);
  const setRightPanelWidth = useEditorStore((s) => s.setRightPanelWidth);
  const setTimelineHeight = useEditorStore((s) => s.setTimelineHeight);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const fps = useEditorStore((s) => s.fps);
  const frames = useEditorStore((s) => s.frames);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const nextFrame = useEditorStore((s) => s.nextFrame);
  const statusMessage = useEditorStore((s) => s.statusMessage);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const [draggingRight, setDraggingRight] = useState(false);
  const [draggingTimeline, setDraggingTimeline] = useState(false);

  // Variable-duration playback timer loop
  useEffect(() => {
    if (!isPlaying) return;
    const durationMs =
      frames[currentFrame]?.durationMs ?? Math.round(1000 / fps);
    const id = window.setTimeout(nextFrame, Math.max(16, durationMs));
    return () => window.clearTimeout(id);
  }, [isPlaying, currentFrame, frames, fps, nextFrame]);

  // Auto-clear transient status messages
  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 3500);
    return () => window.clearTimeout(timer);
  }, [statusMessage, setStatusMessage]);

  // Global keyboard shortcuts
  useEffect(() => {
    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT");

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const ctrlKey = e.key.toLowerCase();
        if (ctrlKey === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            performRedo();
          } else {
            performUndo();
          }
          return;
        }
        if (ctrlKey === "y") {
          e.preventDefault();
          performRedo();
          return;
        }
        if (ctrlKey === "c") {
          e.preventDefault();
          copySelection();
          return;
        }
        if (ctrlKey === "x") {
          e.preventDefault();
          cutSelection();
          return;
        }
        if (ctrlKey === "v") {
          e.preventDefault();
          pasteClipboard();
          return;
        }
        if (ctrlKey === "a") {
          e.preventDefault();
          selectAllCanvas();
          return;
        }
        if (ctrlKey === "d") {
          e.preventDefault();
          deselectAll();
          return;
        }
        if (ctrlKey === "s") {
          e.preventDefault();
          void saveProjectAction(e.shiftKey);
          return;
        }
        if (ctrlKey === "o") {
          e.preventDefault();
          void openProjectAction();
          return;
        }
        if (ctrlKey === "e") {
          e.preventDefault();
          useEditorStore.getState().setExportModalOpen(true);
          return;
        }
        return;
      }

      if (e.altKey) {
        return;
      }

      const key = e.key.toLowerCase();
      const state = useEditorStore.getState();

      if (e.key === "Escape") {
        e.preventDefault();
        deselectAll();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (pixelEngine.floating || pixelEngine.selection) {
          e.preventDefault();
          deleteSelection();
          return;
        }
      }

      if (
        pixelEngine.floating &&
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown")
      ) {
        e.preventDefault();
        const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
        const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        pixelEngine.floating.offsetX += dx;
        pixelEngine.floating.offsetY += dy;
        if (pixelEngine.selection) {
          pixelEngine.selection = pixelEngine.selection.translate(dx, dy);
        }
        pixelEngine.emitChange();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        state.togglePanelsCollapsed();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (pixelEngine.floating) {
          commitFloatingSelection();
          state.setStatusMessage("Committed selection");
        } else {
          state.togglePlaying();
        }
        return;
      }

      if (key === "x") {
        state.swapColors();
        return;
      }

      if (e.key === "[") {
        state.setBrushSize(state.brushSize - 1);
        return;
      }

      if (e.key === "]") {
        state.setBrushSize(state.brushSize + 1);
        return;
      }

      if (e.key === "=" || e.key === "+") {
        state.setZoom(state.zoom + 1);
        return;
      }

      if (e.key === "-") {
        state.setZoom(state.zoom - 1);
        return;
      }

      const mappedTool = TOOL_SHORTCUTS[key];
      if (mappedTool) {
        state.setActiveTool(mappedTool);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Drag resize handlers
  useEffect(() => {
    if (!draggingRight && !draggingTimeline) return;

    const onMouseMove = (e: MouseEvent) => {
      if (draggingRight) {
        setRightPanelWidth(window.innerWidth - e.clientX);
      }
      if (draggingTimeline) {
        // Status bar is 24px at bottom
        setTimelineHeight(window.innerHeight - 24 - e.clientY);
      }
    };

    const onMouseUp = () => {
      setDraggingRight(false);
      setDraggingTimeline(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [draggingRight, draggingTimeline, setRightPanelWidth, setTimelineHeight]);

  return (
    <div className="editor-shell">
      <TopBar />
      <ToolOptionsBar />

      <main className="workspace-main">
        <div className="workspace-middle">
          {!panelsCollapsed && <ToolRail />}
          <Viewport />
          {!panelsCollapsed && (
            <>
              <div
                className={`resizer-vertical ${draggingRight ? "dragging" : ""}`}
                onMouseDown={() => setDraggingRight(true)}
              />
              <RightSidebar />
            </>
          )}
        </div>

        {!panelsCollapsed && (
          <>
            {!timelineCollapsed && (
              <div
                className={`resizer-horizontal ${draggingTimeline ? "dragging" : ""}`}
                onMouseDown={() => setDraggingTimeline(true)}
              />
            )}
            <Timeline />
          </>
        )}
      </main>

      <StatusBar />
      <ExportModal />
    </div>
  );
}
