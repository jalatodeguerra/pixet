import { useEditorStore } from "../store/editorStore";

export function StatusBar() {
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const cursorPos = useEditorStore((s) => s.cursorPos);
  const zoom = useEditorStore((s) => s.zoom);
  const colorMode = useEditorStore((s) => s.colorMode);
  const frames = useEditorStore((s) => s.frames);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const statusMessage = useEditorStore((s) => s.statusMessage);

  const activeFrame = frames[currentFrame] ?? frames[0];
  const activeLayer = layers.find((l) => l.id === activeLayerId);

  return (
    <footer className="statusbar">
      <div className="statusbar-group">
        <span className="mono-value">
          {canvasWidth}×{canvasHeight} px
        </span>
        <div className="status-sep" />
        <span className="mono-value">
          {cursorPos ? `X: ${cursorPos.x}, Y: ${cursorPos.y}` : "X: --, Y: --"}
        </span>
        <div className="status-sep" />
        <span className="mono-value">{zoom * 100}%</span>
        <div className="status-sep" />
        <span>{colorMode}</span>
        <div className="status-sep" />
        <span className="mono-value">
          Frame {currentFrame + 1}/{frames.length}
          {activeFrame ? ` (${activeFrame.durationMs}ms)` : ""}
        </span>
        {activeLayer && (
          <>
            <div className="status-sep" />
            <span>Layer: {activeLayer.name}</span>
          </>
        )}
      </div>

      <div className="statusbar-group">
        {statusMessage ? (
          <span className="status-toast">{statusMessage}</span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>Pixet v0.1.0</span>
        )}
      </div>
    </footer>
  );
}
