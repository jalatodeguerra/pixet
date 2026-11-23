import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Lock,
  Pipette,
  Plus,
  SlidersHorizontal,
  Unlock,
  Upload,
} from "lucide-react";
import { ColorPicker } from "../ColorPicker";
import { DockablePanelSection } from "../DockablePanelSection";
import { hexToRgba, rgbaToHex } from "../../engine/document/PixelBuffer";
import { applyBufferFilterAction } from "../../engine/document/filterActions";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { applyColorReplace } from "../../engine/tools/filters";
import {
  computeColorHarmonies,
  extractPaletteMedianCut,
  generateHueShiftedRamp,
  sortPaletteColors,
  type PaletteSortMode,
} from "../../engine/tools/paletteOps";
import { useEditorStore } from "../../store/editorStore";
import {
  buildShadingRamp,
  hexToHsv,
  hsvToHex,
  isValidHex,
} from "../../utils/color";
import { PALETTE_PRESETS, parsePaletteFile } from "../../utils/paletteParser";

type ReadoutMode = "rgb" | "hsv";

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function ColorPalettePanel() {
  const primaryColor = useEditorStore((s) => s.primaryColor);
  const secondaryColor = useEditorStore((s) => s.secondaryColor);
  const primaryAlpha = useEditorStore((s) => s.primaryAlpha);
  const paletteLock = useEditorStore((s) => s.paletteLock);
  const recentColors = useEditorStore((s) => s.recentColors);
  const colorPickerMode = useEditorStore((s) => s.colorPickerMode);
  const setPrimaryColor = useEditorStore((s) => s.setPrimaryColor);
  const setSecondaryColor = useEditorStore((s) => s.setSecondaryColor);
  const setPrimaryAlpha = useEditorStore((s) => s.setPrimaryAlpha);
  const togglePaletteLock = useEditorStore((s) => s.togglePaletteLock);
  const setColorPickerMode = useEditorStore((s) => s.setColorPickerMode);
  const swapColors = useEditorStore((s) => s.swapColors);
  const palette = useEditorStore((s) => s.palette);
  const paletteName = useEditorStore((s) => s.paletteName);
  const setPalette = useEditorStore((s) => s.setPalette);
  const addColorToPalette = useEditorStore((s) => s.addColorToPalette);
  const reorderPalette = useEditorStore((s) => s.reorderPalette);
  const replacePaletteColor = useEditorStore((s) => s.replacePaletteColor);
  const removePaletteColor = useEditorStore((s) => s.removePaletteColor);
  const duplicatePaletteColor = useEditorStore((s) => s.duplicatePaletteColor);
  const appendPaletteColors = useEditorStore((s) => s.appendPaletteColors);
  const openContextMenu = useEditorStore((s) => s.openContextMenu);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const [hexInput, setHexInput] = useState(primaryColor);
  const [readoutMode, setReadoutMode] = useState<ReadoutMode>("hsv");
  const [rampOpen, setRampOpen] = useState(false);
  const [rampDark, setRampDark] = useState("#1a1030");
  const [rampLight, setRampLight] = useState("#f8e8a0");
  const [rampSteps, setRampSteps] = useState(5);
  const [rampHueShift, setRampHueShift] = useState(-18);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const paletteFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHexInput(primaryColor);
  }, [primaryColor]);

  const shadingRamp = useMemo(
    () => buildShadingRamp(primaryColor),
    [primaryColor]
  );
  const harmonies = useMemo(
    () => computeColorHarmonies(primaryColor),
    [primaryColor]
  );
  const previewRamp = useMemo(
    () => generateHueShiftedRamp(rampDark, rampLight, rampSteps, rampHueShift),
    [rampDark, rampLight, rampSteps, rampHueShift]
  );

  const hsv = hexToHsv(primaryColor);
  const [rgbR, rgbG, rgbB] = hexToRgba(primaryColor, 255);
  const isPresetMatch = PALETTE_PRESETS.some((p) => p.name === paletteName);

  const handleHexChange = (val: string) => {
    const normalized = val.startsWith("#") ? val : `#${val}`;
    setHexInput(normalized);
    if (isValidHex(normalized)) {
      setPrimaryColor(normalized.toLowerCase());
    }
  };

  const handlePaletteImport = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const content = await file.text();
    const parsed = parsePaletteFile(file.name, content);
    if (parsed.colors.length === 0) {
      setStatusMessage(`No valid colors found in ${file.name}`);
      return;
    }
    setPalette(parsed.name, parsed.colors);
    setStatusMessage(
      `Imported "${parsed.name}" (${parsed.colors.length} colors)`
    );
  };

  const handleExtractPalette = () => {
    const state = useEditorStore.getState();
    const rasterIds = new Set(
      state.layers.filter((l) => l.kind === "raster").map((l) => l.id)
    );
    const buffers = [];
    for (const [key, buf] of pixelEngine.cels.entries()) {
      const sep = key.lastIndexOf(":");
      const layerId = key.slice(0, sep);
      if (rasterIds.has(layerId)) {
        buffers.push(buf);
      }
    }
    const extracted = extractPaletteMedianCut(buffers, 16);
    if (extracted.length === 0) {
      setStatusMessage("No opaque pixels found in sprite to extract");
      return;
    }
    setPalette("Extracted", extracted);
    setStatusMessage(`Extracted ${extracted.length} colors from sprite`);
  };

  const handleSortChange = (mode: string) => {
    if (mode !== "hue" && mode !== "luminance" && mode !== "saturation") return;
    const sorted = sortPaletteColors(palette, mode as PaletteSortMode);
    setPalette(paletteName, sorted);
    setStatusMessage(`Sorted palette by ${mode}`);
  };

  const handleRgbInput = (channel: 0 | 1 | 2, val: number) => {
    const next: [number, number, number] = [rgbR, rgbG, rgbB];
    next[channel] = clampInt(val, 0, 255);
    setPrimaryColor(rgbaToHex(next[0], next[1], next[2]));
  };

  const handleHsvInput = (channel: "h" | "s" | "v", val: number) => {
    const nh = channel === "h" ? clampInt(val, 0, 359) : hsv.h;
    const ns = channel === "s" ? clampInt(val, 0, 100) : hsv.s;
    const nv = channel === "v" ? clampInt(val, 0, 100) : hsv.v;
    setPrimaryColor(hsvToHex(nh, ns, nv));
  };

  const handleSwatchContextMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    swatch: string,
    index: number
  ) => {
    e.preventDefault();
    const fgNorm = primaryColor.toLowerCase();
    const swatchNorm = swatch.toLowerCase();
    openContextMenu(e.clientX, e.clientY, [
      {
        kind: "item",
        label: "Set Secondary",
        action: () => setSecondaryColor(swatch),
      },
      {
        kind: "item",
        label: "Replace with FG",
        action: () => replacePaletteColor(index, primaryColor),
      },
      {
        kind: "item",
        label: "Remap Sprite Color → FG",
        disabled: fgNorm === swatchNorm,
        action: () => {
          const fromRgba = hexToRgba(swatchNorm, 255);
          const toRgba = hexToRgba(fgNorm, 255);
          replacePaletteColor(index, fgNorm);
          applyBufferFilterAction("Remap Palette Color", "sprite", (buf, mask) =>
            applyColorReplace(
              buf,
              { fromRgba, toRgba, tolerance: 0 },
              mask
            )
          );
        },
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Duplicate",
        action: () => duplicatePaletteColor(index),
      },
      {
        kind: "item",
        label: "Delete",
        danger: true,
        disabled: palette.length <= 1,
        action: () => removePaletteColor(index),
      },
    ]);
  };

  return (
    <DockablePanelSection
      id="color-palette"
      title="Color & Palette"
      actions={
        <>
          <button
            type="button"
            className="toggle-chip"
            style={{ padding: "1px 5px", fontSize: 10 }}
            title={
              colorPickerMode === "square"
                ? "Switch to Color Wheel"
                : "Switch to SV Square"
            }
            onClick={() =>
              setColorPickerMode(
                colorPickerMode === "square" ? "wheel" : "square"
              )
            }
          >
            {colorPickerMode === "square" ? "Square" : "Wheel"}
          </button>
          <span
            className="mono-value"
            style={{ fontSize: 10, color: "var(--text-muted)" }}
          >
            {palette.length}
          </span>
        </>
      }
    >
      <div className="color-top-row">
            <div className="fg-bg-stack">
              <div
                className="swatch-bg"
                style={{ backgroundColor: secondaryColor }}
                title="Background Color"
              >
                <input
                  type="color"
                  className="swatch-native-input"
                  value={secondaryColor}
                  aria-label="Background Color"
                  onChange={(e) => setSecondaryColor(e.target.value)}
                />
              </div>
              <div
                className="swatch-fg"
                style={{ backgroundColor: primaryColor }}
                title="Foreground Color"
              >
                <input
                  type="color"
                  className="swatch-native-input"
                  value={primaryColor}
                  aria-label="Foreground Color"
                  onChange={(e) => setPrimaryColor(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="swap-colors-btn"
                title="Swap FG / BG (X)"
                onClick={swapColors}
              >
                <ArrowLeftRight size={10} />
              </button>
            </div>

            <div className="color-meta">
              <div className="hex-row">
                <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                  HEX
                </span>
                <input
                  type="text"
                  className="hex-input"
                  value={hexInput}
                  maxLength={7}
                  aria-label="Primary Hex Color"
                  onChange={(e) => handleHexChange(e.target.value)}
                />
              </div>
              <div className="shading-ramp" title="Hue-shifted shading ramp">
                {shadingRamp.map((stepHex, i) => (
                  <button
                    key={`${stepHex}-${i}`}
                    type="button"
                    className="ramp-step"
                    style={{ backgroundColor: stepHex }}
                    title={`Ramp ${i + 1}: ${stepHex}`}
                    onClick={() => setPrimaryColor(stepHex)}
                  />
                ))}
              </div>
            </div>
          </div>

          <ColorPicker
            hex={primaryColor}
            onChange={setPrimaryColor}
            mode={colorPickerMode}
            alpha={primaryAlpha}
            onAlphaChange={setPrimaryAlpha}
          />

          <div className="draw-color-readout">
            <div className="draw-color-readout-header">
              <button
                type="button"
                className="toggle-chip"
                style={{ padding: "1px 6px", fontSize: 10 }}
                title="Toggle RGB / HSV numeric inputs"
                onClick={() =>
                  setReadoutMode((m) => (m === "hsv" ? "rgb" : "hsv"))
                }
              >
                {readoutMode.toUpperCase()}
              </button>
              <span className="draw-color-alpha-badge">
                A {primaryAlpha}
              </span>
            </div>

            {readoutMode === "hsv" ? (
              <div className="draw-numeric-grid">
                <label className="draw-numeric-cell">
                  <span>H</span>
                  <input
                    type="number"
                    min={0}
                    max={359}
                    value={hsv.h}
                    aria-label="Hue"
                    onChange={(e) => handleHsvInput("h", Number(e.target.value))}
                  />
                </label>
                <label className="draw-numeric-cell">
                  <span>S</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={hsv.s}
                    aria-label="Saturation"
                    onChange={(e) => handleHsvInput("s", Number(e.target.value))}
                  />
                </label>
                <label className="draw-numeric-cell">
                  <span>V</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={hsv.v}
                    aria-label="Value"
                    onChange={(e) => handleHsvInput("v", Number(e.target.value))}
                  />
                </label>
              </div>
            ) : (
              <div className="draw-numeric-grid">
                <label className="draw-numeric-cell">
                  <span>R</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={rgbR}
                    aria-label="Red"
                    onChange={(e) => handleRgbInput(0, Number(e.target.value))}
                  />
                </label>
                <label className="draw-numeric-cell">
                  <span>G</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={rgbG}
                    aria-label="Green"
                    onChange={(e) => handleRgbInput(1, Number(e.target.value))}
                  />
                </label>
                <label className="draw-numeric-cell">
                  <span>B</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={rgbB}
                    aria-label="Blue"
                    onChange={(e) => handleRgbInput(2, Number(e.target.value))}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="draw-color-strip-section">
            <div className="draw-color-strip-label">Harmonies</div>
            <div className="draw-harmony-groups">
              {(
                [
                  ["Comp", harmonies.complementary],
                  ["Ana", harmonies.analogous],
                  ["Tri", harmonies.triadic],
                  ["Split", harmonies.splitComplementary],
                ] as const
              ).map(([label, colors]) => (
                <div key={label} className="draw-harmony-group">
                  <span className="draw-harmony-tag">{label}</span>
                  {colors.map((c, idx) => (
                    <button
                      key={`${label}-${idx}-${c}`}
                      type="button"
                      className="draw-mini-swatch"
                      style={{ backgroundColor: c }}
                      title={`${label}: ${c}`}
                      onClick={() => setPrimaryColor(c)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {recentColors.length > 0 && (
            <div className="draw-color-strip-section">
              <div className="draw-color-strip-label">Recent</div>
              <div className="draw-recent-strip">
                {recentColors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`draw-mini-swatch ${
                      c.toLowerCase() === primaryColor.toLowerCase()
                        ? "active"
                        : ""
                    }`}
                    style={{ backgroundColor: c }}
                    title={`${c} (LMB: FG · RMB: BG)`}
                    onClick={() => setPrimaryColor(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSecondaryColor(c);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="palette-toolbar">
            <select
              className="palette-select"
              aria-label="Palette Preset"
              value={paletteName}
              onChange={(e) => {
                const preset = PALETTE_PRESETS.find(
                  (p) => p.name === e.target.value
                );
                if (preset) setPalette(preset.name, preset.colors);
              }}
            >
              {!isPresetMatch && (
                <option value={paletteName}>{paletteName}</option>
              )}
              {PALETTE_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>

            <input
              ref={paletteFileRef}
              type="file"
              accept=".hex,.gpl,.txt"
              style={{ display: "none" }}
              onChange={handlePaletteImport}
            />
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="Import .hex / .gpl Palette"
              onClick={() => paletteFileRef.current?.click()}
            >
              <Upload size={12} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="Add Current Color to Palette"
              onClick={() => addColorToPalette(primaryColor)}
            >
              <Plus size={12} />
            </button>
          </div>

          <div className="draw-palette-actions">
            <button
              type="button"
              className={`toggle-chip ${paletteLock ? "active" : ""}`}
              style={{ padding: "2px 6px", fontSize: 10 }}
              title="Lock painting to nearest color in active palette"
              onClick={togglePaletteLock}
            >
              {paletteLock ? <Lock size={10} /> : <Unlock size={10} />}
              <span>Lock</span>
            </button>

            <select
              className="palette-select"
              aria-label="Sort Palette"
              value=""
              style={{ fontSize: 10, padding: "2px 4px" }}
              onChange={(e) => handleSortChange(e.target.value)}
            >
              <option value="" disabled>
                Sort...
              </option>
              <option value="hue">Hue</option>
              <option value="luminance">Luminance</option>
              <option value="saturation">Saturation</option>
            </select>

            <button
              type="button"
              className="mini-btn"
              title="Extract up to 16 colors from sprite"
              onClick={handleExtractPalette}
            >
              <Pipette size={10} />
              <span>Extract</span>
            </button>

            <button
              type="button"
              className={`toggle-chip ${rampOpen ? "active" : ""}`}
              style={{ padding: "2px 6px", fontSize: 10 }}
              title="Toggle Hue-Shifted Ramp Builder"
              onClick={() => setRampOpen((v) => !v)}
            >
              <SlidersHorizontal size={10} />
              <span>Ramp</span>
            </button>
          </div>

          {rampOpen && (
            <div className="draw-ramp-builder">
              <div className="draw-ramp-endpoints">
                <label className="draw-ramp-endpoint">
                  <span>Dark</span>
                  <input
                    type="color"
                    value={rampDark}
                    aria-label="Ramp Dark Color"
                    onChange={(e) => setRampDark(e.target.value)}
                  />
                </label>
                <label className="draw-ramp-endpoint">
                  <span>Light</span>
                  <input
                    type="color"
                    value={rampLight}
                    aria-label="Ramp Light Color"
                    onChange={(e) => setRampLight(e.target.value)}
                  />
                </label>
              </div>
              <label className="hsv-row">
                <span className="hsv-label" style={{ width: 32 }}>
                  Steps
                </span>
                <input
                  type="range"
                  className="hsv-range"
                  min={3}
                  max={12}
                  value={rampSteps}
                  onChange={(e) => setRampSteps(Number(e.target.value))}
                />
                <span className="hsv-val">{rampSteps}</span>
              </label>
              <label className="hsv-row">
                <span className="hsv-label" style={{ width: 32 }}>
                  Shift
                </span>
                <input
                  type="range"
                  className="hsv-range"
                  min={-45}
                  max={45}
                  value={rampHueShift}
                  onChange={(e) => setRampHueShift(Number(e.target.value))}
                />
                <span className="hsv-val">{rampHueShift}°</span>
              </label>
              <div className="draw-ramp-preview">
                {previewRamp.map((c, idx) => (
                  <div
                    key={`${c}-${idx}`}
                    className="draw-ramp-preview-cell"
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              <button
                type="button"
                className="mini-btn"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => {
                  appendPaletteColors(previewRamp);
                  setStatusMessage(
                    `Added ${previewRamp.length}-step ramp to palette`
                  );
                }}
              >
                Add Ramp
              </button>
            </div>
          )}

          <div
            className="palette-grid"
            title="Left-click: FG · Right-click: Context Menu · Drag: Reorder"
          >
            {palette.map((swatch, index) => {
              const active =
                swatch.toLowerCase() === primaryColor.toLowerCase();
              const isDropTarget = dropIdx === index && dragIdx !== index;
              return (
                <button
                  key={`${index}-${swatch}`}
                  type="button"
                  draggable
                  className={`palette-swatch ${active ? "active" : ""} ${
                    isDropTarget ? "draw-swatch-drop" : ""
                  }`}
                  style={{ backgroundColor: swatch }}
                  title={swatch}
                  onClick={() => setPrimaryColor(swatch)}
                  onContextMenu={(e) =>
                    handleSwatchContextMenu(e, swatch, index)
                  }
                  onDragStart={(e) => {
                    setDragIdx(index);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(index));
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dropIdx !== index) setDropIdx(index);
                  }}
                  onDragLeave={() => {
                    if (dropIdx === index) setDropIdx(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null && dragIdx !== index) {
                      reorderPalette(dragIdx, index);
                    }
                    setDragIdx(null);
                    setDropIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setDropIdx(null);
                  }}
                />
              );
            })}
          </div>
    </DockablePanelSection>
  );
}
