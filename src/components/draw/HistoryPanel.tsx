import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History, Redo2, Undo2 } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  getHistorySnapshot,
  jumpToHistoryIndexAction,
  performRedo,
  performUndo,
} from "../../engine/document/historyActions";
import {
  undoKindWorkspace,
  type UndoWorkspace,
} from "../../engine/history/UndoCoordinator";
import { useEditorStore } from "../../store/editorStore";

const WORKSPACE_TAGS: Record<UndoWorkspace, string> = {
  draw: "Draw",
  tiles: "Tiles",
  rig: "Rig",
  studio3d: "3D",
  nodes: "Nodes",
};

export function HistoryPanel() {
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(() => getHistorySnapshot());

  useEffect(() => {
    const sync = () => {
      setSnapshot(getHistorySnapshot());
    };
    sync();
    return pixelEngine.subscribe(sync);
  }, [canUndo, canRedo, open]);

  const { entries, currentIndex } = snapshot;

  return (
    <section className="panel-section">
      <div className="panel-header">
        <button
          type="button"
          className="panel-collapse-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <History size={11} />
          <span>History</span>
        </button>
        <div className="panel-header-actions">
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 20, height: 20 }}
            title="Undo (Ctrl+Z)"
            disabled={!canUndo}
            onClick={() => performUndo()}
          >
            <Undo2 size={12} />
          </button>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 20, height: 20 }}
            title="Redo (Ctrl+Shift+Z)"
            disabled={!canRedo}
            onClick={() => performRedo()}
          >
            <Redo2 size={12} />
          </button>
        </div>
      </div>

      {open && (
        <div className="panel-body">
          <div className="draw-history-list" role="listbox" aria-label="Edit History">
            <button
              type="button"
              role="option"
              aria-selected={currentIndex === -1}
              className={`draw-history-row ${currentIndex === -1 ? "active" : ""}`}
              onClick={() => jumpToHistoryIndexAction(-1)}
            >
              <span className="draw-history-index">0</span>
              <span className="draw-history-label">Initial State</span>
              <span className="draw-history-kind">base</span>
            </button>

            {entries.map((entry) => {
              const isActive = entry.index === currentIndex;
              const isFuture = entry.index > currentIndex;
              return (
                <button
                  key={`${entry.index}-${entry.kind}-${entry.label}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`draw-history-row ${isActive ? "active" : ""} ${isFuture ? "future" : ""}`}
                  onClick={() => jumpToHistoryIndexAction(entry.index)}
                >
                  <span className="draw-history-index">{entry.index + 1}</span>
                  <span className="draw-history-label">{entry.label}</span>
                  <span
                    className="draw-history-kind"
                    data-workspace={undoKindWorkspace(entry.kind)}
                  >
                    {WORKSPACE_TAGS[undoKindWorkspace(entry.kind)]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
