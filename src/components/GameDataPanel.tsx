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
  Sparkles,
  Square,
  Sun,
  Swords,
  Trash2,
} from "lucide-react";
import { syncHistoryAndCelState } from "../engine/document/historyActions";
import { PixelBuffer } from "../engine/document/PixelBuffer";
import { pixelEngine } from "../engine/document/PixelEngine";
import type { GameBoxKind } from "../engine/gamedev/GameDataEngine";
import { generateAutoNormalMap } from "../engine/gamedev/shaderPreview";
import { type DataTool, useEditorStore } from "../store/editorStore";
import { PALETTE_PRESETS } from "../utils/paletteParser";

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
  const layers = useEditorStore((s) => s.layers);
  const addMapLayer = useEditorStore((s) => s.addMapLayer);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const light2dEnabled = useEditorStore((s) => s.light2dEnabled);
  const light2dX = useEditorStore((s) => s.light2dX);
  const light2dY = useEditorStore((s) => s.light2dY);
  const light2dZ = useEditorStore((s) => s.light2dZ);
  const light2dColor = useEditorStore((s) => s.light2dColor);
  const light2dIntensity = useEditorStore((s) => s.light2dIntensity);
  const light2dAmbient = useEditorStore((s) => s.light2dAmbient);
  const light2dEmission = useEditorStore((s) => s.light2dEmission);
  const setLight2d = useEditorStore((s) => s.setLight2d);
  const paletteLutEnabled = useEditorStore((s) => s.paletteLutEnabled);
  const paletteLutPresetName = useEditorStore((s) => s.paletteLutPresetName);
  const setPaletteLutEnabled = useEditorStore((s) => s.setPaletteLutEnabled);
  const setPaletteLutPresetName = useEditorStore(
    (s) => s.setPaletteLutPresetName
  );

  const [collapsed, setCollapsed] = useState(false);
  const [shaderCollapsed, setShaderCollapsed] = useState(false);
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

  const handleAutoNormal = () => {
    const albedoLayers = layers.filter(
      (l) => l.kind === "group" || !l.mapRole || l.mapRole === "albedo"
    );
    const composited = pixelEngine.compositeFrame(albedoLayers, currentFrame);
    const albedoBuf = new PixelBuffer(
      canvasWidth,
      canvasHeight,
      new Uint8ClampedArray(composited)
    );
    const normalBuf = generateAutoNormalMap(albedoBuf, 2.2);

    const existingNormal = layers.find(
      (l) => l.kind === "raster" && l.mapRole === "normal"
    );
    const targetId =
      existingNormal?.id ?? addMapLayer("normal", "Normal Map");

    const dst = pixelEngine.getOrCreateCel(targetId, currentFrame);
    pixelEngine.history.beginTransaction(
      targetId,
      currentFrame,
      "Auto Normal Map"
    );
    pixelEngine.history.captureAllTiles(dst);
    dst.data.set(normalBuf.data);
    dst.markAllDirty();
    pixelEngine.history.commitTransaction(dst);
    syncHistoryAndCelState(targetId, currentFrame);
    setLight2d({ enabled: true });
    pixelEngine.emitChange();
    setStatusMessage(`Generated Normal Map on frame ${currentFrame + 1}`);
  };

  const lutPreset =
    PALETTE_PRESETS.find((p) => p.name === paletteLutPresetName) ??
    PALETTE_PRESETS[0];

  const tools: { id: DataTool; label: string; icon: typeof Swords }[] = [
    { id: "hitbox", label: "Hitbox", icon: Swords },
    { id: "hurtbox", label: "Hurtbox", icon: Shield },
    { id: "collision", label: "Collider", icon: Square },
    { id: "socket", label: "Socket", icon: Crosshair },
  ];

  return (
    <>
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

    <section className="panel-section">
      <div className="panel-header">
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => setShaderCollapsed((v) => !v)}
        >
          {shaderCollapsed ? (
            <ChevronRight size={12} />
          ) : (
            <ChevronDown size={12} />
          )}
          <span>2D Lighting &amp; Palette LUT</span>
        </button>
      </div>

      {!shaderCollapsed && (
        <div className="panel-body">
          <div className="rig-tool-row">
            <button
              type="button"
              className="mini-btn"
              title="Add Normal Map layer"
              onClick={() => addMapLayer("normal", "Normal Map")}
            >
              <Plus size={11} />
              <span>Normal</span>
            </button>
            <button
              type="button"
              className="mini-btn"
              title="Add Emission Map layer"
              onClick={() => addMapLayer("emission", "Emission Map")}
            >
              <Sparkles size={11} />
              <span>Emission</span>
            </button>
          </div>

          <button
            type="button"
            className="mini-btn"
            style={{ justifyContent: "center" }}
            title="Generate tangent-space normal map from visible albedo layers"
            onClick={handleAutoNormal}
          >
            <Sun size={11} />
            <span>Auto Normal from Albedo</span>
          </button>

          <div className="rig-option-row">
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={light2dEnabled}
                onChange={(e) => setLight2d({ enabled: e.target.checked })}
              />
              <span>2D Point Light Preview</span>
            </label>
            <input
              type="color"
              className="rotate3d-color-input"
              value={light2dColor}
              title="Light Color"
              onChange={(e) => setLight2d({ color: e.target.value })}
            />
          </div>

          {light2dEnabled && (
            <div className="hsv-sliders">
              <label className="hsv-row">
                <span className="hsv-label">X</span>
                <input
                  type="range"
                  className="hsv-range"
                  min={0}
                  max={100}
                  value={Math.round(light2dX * 100)}
                  onChange={(e) =>
                    setLight2d({ x: Number(e.target.value) / 100 })
                  }
                />
                <span className="hsv-val">{Math.round(light2dX * 100)}%</span>
              </label>
              <label className="hsv-row">
                <span className="hsv-label">Y</span>
                <input
                  type="range"
                  className="hsv-range"
                  min={0}
                  max={100}
                  value={Math.round(light2dY * 100)}
                  onChange={(e) =>
                    setLight2d({ y: Number(e.target.value) / 100 })
                  }
                />
                <span className="hsv-val">{Math.round(light2dY * 100)}%</span>
              </label>
              <label className="hsv-row">
                <span className="hsv-label">Z</span>
                <input
                  type="range"
                  className="hsv-range"
                  min={5}
                  max={150}
                  value={Math.round(light2dZ * 100)}
                  onChange={(e) =>
                    setLight2d({ z: Number(e.target.value) / 100 })
                  }
                />
                <span className="hsv-val">{light2dZ.toFixed(2)}</span>
              </label>
              <label className="hsv-row">
                <span className="hsv-label">I</span>
                <input
                  type="range"
                  className="hsv-range"
                  min={0}
                  max={300}
                  value={Math.round(light2dIntensity * 100)}
                  onChange={(e) =>
                    setLight2d({ intensity: Number(e.target.value) / 100 })
                  }
                />
                <span className="hsv-val">{light2dIntensity.toFixed(1)}</span>
              </label>
              <label className="hsv-row">
                <span className="hsv-label">A</span>
                <input
                  type="range"
                  className="hsv-range"
                  min={0}
                  max={100}
                  value={Math.round(light2dAmbient * 100)}
                  onChange={(e) =>
                    setLight2d({ ambient: Number(e.target.value) / 100 })
                  }
                />
                <span className="hsv-val">
                  {Math.round(light2dAmbient * 100)}%
                </span>
              </label>
              <label className="hsv-row">
                <span className="hsv-label">E</span>
                <input
                  type="range"
                  className="hsv-range"
                  min={0}
                  max={250}
                  value={Math.round(light2dEmission * 100)}
                  onChange={(e) =>
                    setLight2d({ emission: Number(e.target.value) / 100 })
                  }
                />
                <span className="hsv-val">{light2dEmission.toFixed(1)}</span>
              </label>
            </div>
          )}

          <div className="rig-option-row">
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={paletteLutEnabled}
                onChange={(e) => setPaletteLutEnabled(e.target.checked)}
              />
              <span>Palette-Swap LUT</span>
            </label>
          </div>

          <select
            className="palette-select"
            value={paletteLutPresetName}
            aria-label="Target LUT Palette"
            onChange={(e) => setPaletteLutPresetName(e.target.value)}
          >
            {PALETTE_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.colors.length})
              </option>
            ))}
          </select>

          <div className="lut-swatch-strip" title={lutPreset.name}>
            {lutPreset.colors.slice(0, 16).map((c, idx) => (
              <span
                key={`${c}-${idx}`}
                className="lut-swatch-cell"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      )}
    </section>
    </>
  );
}
