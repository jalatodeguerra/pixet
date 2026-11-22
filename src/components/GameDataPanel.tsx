import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Plus,
  Shield,
  Square,
  Swords,
  Trash2,
} from "lucide-react";
import { pixelEngine } from "../engine/document/PixelEngine";
import type { GameBoxKind } from "../engine/gamedev/GameDataEngine";
import { type DataTool, useEditorStore } from "../store/editorStore";

const BOX_COLORS: Record<GameBoxKind, string> = {
  hitbox: "#ef6461",
  hurtbox: "#4ecd82",
  collision: "#4c8bf5",
};

export function GameDataPanel() {
  const dataTool = useEditorStore((s) => s.dataTool);
  const setDataTool = useEditorStore((s) => s.setDataTool);
  const showOverlay = useEditorStore((s) => s.showGameDataOverlay);
  const toggleShowOverlay = useEditorStore((s) => s.toggleShowGameDataOverlay);
  const gameDataVersion = useEditorStore((s) => s.gameDataVersion);
  const bumpGameDataVersion = useEditorStore((s) => s.bumpGameDataVersion);

  const currentFrame = useEditorStore((s) => s.currentFrame);
  const frames = useEditorStore((s) => s.frames);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const documentName = useEditorStore((s) => s.documentName);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const [collapsed, setCollapsed] = useState(false);
  const [eventName, setEventName] = useState("");
  const [eventPayload, setEventPayload] = useState("");

  const { frameBoxes, frameSockets, frameEvents } = useMemo(() => {
    void gameDataVersion;
    return {
      frameBoxes: pixelEngine.gameData.getBoxesAtFrame(currentFrame),
      frameSockets: pixelEngine.gameData.getSocketsAtFrame(currentFrame),
      frameEvents: pixelEngine.gameData.getEventsAtFrame(currentFrame),
    };
  }, [currentFrame, gameDataVersion]);

  const handleCopyPrevFrame = () => {
    if (currentFrame <= 0) {
      setStatusMessage("No previous frame to copy from");
      return;
    }
    const count = pixelEngine.gameData.copyFrameMetadata(
      currentFrame - 1,
      currentFrame
    );
    bumpGameDataVersion();
    setStatusMessage(
      count > 0
        ? `Copied ${count} boxes/sockets from Frame ${currentFrame}`
        : `No boxes/sockets on Frame ${currentFrame}`
    );
  };

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    const added = pixelEngine.gameData.addEvent(
      currentFrame,
      eventName,
      eventPayload
    );
    if (!added) return;
    setEventName("");
    setEventPayload("");
    bumpGameDataVersion();
  };

  const handleExportJson = () => {
    const json = pixelEngine.gameData.serializeGameDataJson(
      documentName,
      canvasWidth,
      canvasHeight,
      frames.length
    );
    const base = documentName.replace(/\.pixet$/i, "") || "sprite";
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.gamedata.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatusMessage(`Exported ${base}.gamedata.json`);
  };

  const tools: { id: DataTool; label: string; icon: typeof Swords }[] = [
    { id: "hitbox", label: "Hitbox", icon: Swords },
    { id: "hurtbox", label: "Hurtbox", icon: Shield },
    { id: "collision", label: "Collider", icon: Square },
    { id: "socket", label: "Socket", icon: Crosshair },
  ];

  return (
    <section className="panel-section">
      <div className="panel-header">
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <Crosshair size={12} />
          <span>Game Data (F{currentFrame + 1})</span>
        </button>
        <div className="panel-header-actions">
          <button
            type="button"
            className="mini-btn"
            title={showOverlay ? "Hide Overlay in Other Modes" : "Show Overlay in Other Modes"}
            onClick={toggleShowOverlay}
          >
            {showOverlay ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
          <button
            type="button"
            className="mini-btn"
            title="Copy Boxes & Sockets from Previous Frame"
            disabled={currentFrame <= 0}
            onClick={handleCopyPrevFrame}
          >
            <Copy size={11} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="panel-body">
          <div className="rig-tool-row">
            {tools.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`mini-btn ${dataTool === t.id ? "active" : ""}`}
                  onClick={() => setDataTool(t.id)}
                >
                  <Icon size={11} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mode-hint">
            {dataTool === "socket"
              ? "Click on canvas to place an attachment socket."
              : `Drag on canvas to draw a ${dataTool} rectangle.`}
          </div>

          <div className="rig-hierarchy-head">
            <span>Boxes ({frameBoxes.length})</span>
          </div>
          {frameBoxes.length > 0 && (
            <div className="gamedata-list">
              {frameBoxes.map((b) => (
                <div key={b.id} className="gamedata-row">
                  <span
                    className="rig-influence-swatch"
                    style={{ backgroundColor: BOX_COLORS[b.kind] }}
                    title={b.kind}
                  />
                  <input
                    className="rig-text-input"
                    value={b.name}
                    onChange={(e) => {
                      pixelEngine.gameData.updateBox(b.id, {
                        name: e.target.value,
                      });
                      bumpGameDataVersion();
                    }}
                  />
                  <span className="gamedata-coords">
                    {b.x},{b.y} {b.w}×{b.h}
                  </span>
                  <button
                    type="button"
                    className="icon-action-btn"
                    style={{ width: 18, height: 18 }}
                    onClick={() => {
                      pixelEngine.gameData.removeBox(b.id);
                      bumpGameDataVersion();
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rig-hierarchy-head">
            <span>Sockets ({frameSockets.length})</span>
          </div>
          {frameSockets.length > 0 && (
            <div className="gamedata-list">
              {frameSockets.map((s) => (
                <div key={s.id} className="gamedata-row">
                  <span
                    className="rig-influence-swatch"
                    style={{ backgroundColor: "#fbc531" }}
                    title="socket"
                  />
                  <input
                    className="rig-text-input"
                    value={s.name}
                    onChange={(e) => {
                      pixelEngine.gameData.updateSocket(s.id, {
                        name: e.target.value,
                      });
                      bumpGameDataVersion();
                    }}
                  />
                  <span className="gamedata-coords">
                    {s.x},{s.y}
                  </span>
                  <button
                    type="button"
                    className="icon-action-btn"
                    style={{ width: 18, height: 18 }}
                    onClick={() => {
                      pixelEngine.gameData.removeSocket(s.id);
                      bumpGameDataVersion();
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rig-hierarchy-head">
            <span>Frame Events ({frameEvents.length})</span>
          </div>
          <form className="gamedata-event-form" onSubmit={handleAddEvent}>
            <input
              type="text"
              className="rig-text-input"
              placeholder="Event (e.g. hit_swing)"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
            />
            <input
              type="text"
              className="rig-text-input"
              placeholder="Arg"
              style={{ width: 58 }}
              value={eventPayload}
              onChange={(e) => setEventPayload(e.target.value)}
            />
            <button
              type="submit"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="Add Animation Event"
            >
              <Plus size={12} />
            </button>
          </form>
          {frameEvents.length > 0 && (
            <div className="gamedata-list">
              {frameEvents.map((ev) => (
                <div key={ev.id} className="gamedata-row">
                  <span
                    className="rig-influence-swatch"
                    style={{ backgroundColor: "#bd6bed" }}
                  />
                  <span className="rig-bone-name" style={{ fontSize: 11 }}>
                    {ev.name}
                    {ev.payload ? ` (${ev.payload})` : ""}
                  </span>
                  <button
                    type="button"
                    className="icon-action-btn"
                    style={{ width: 18, height: 18 }}
                    onClick={() => {
                      pixelEngine.gameData.removeEvent(ev.id);
                      bumpGameDataVersion();
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            className="mini-btn"
            style={{ justifyContent: "center" }}
            onClick={handleExportJson}
          >
            <Download size={11} />
            <span>Export Data JSON</span>
          </button>
        </div>
      )}
    </section>
  );
}
