import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Plus,
  Upload,
} from "lucide-react";
import { ColorPicker } from "../ColorPicker";
import { useEditorStore } from "../../store/editorStore";
import {
  buildShadingRamp,
  hexToHsv,
  hsvToHex,
  isValidHex,
} from "../../utils/color";
import { PALETTE_PRESETS, parsePaletteFile } from "../../utils/paletteParser";

export function ColorPalettePanel() {
  const primaryColor = useEditorStore((s) => s.primaryColor);
  const secondaryColor = useEditorStore((s) => s.secondaryColor);
  const setPrimaryColor = useEditorStore((s) => s.setPrimaryColor);
  const setSecondaryColor = useEditorStore((s) => s.setSecondaryColor);
  const swapColors = useEditorStore((s) => s.swapColors);
  const palette = useEditorStore((s) => s.palette);
  const paletteName = useEditorStore((s) => s.paletteName);
  const setPalette = useEditorStore((s) => s.setPalette);
  const addColorToPalette = useEditorStore((s) => s.addColorToPalette);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const [colorOpen, setColorOpen] = useState(true);
  const [hexInput, setHexInput] = useState(primaryColor);

  const paletteFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHexInput(primaryColor);
  }, [primaryColor]);

  const shadingRamp = buildShadingRamp(primaryColor);
  const hsv = hexToHsv(primaryColor);
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

  return (
    <section className="panel-section">
      <div className="panel-header">
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => setColorOpen((v) => !v)}
        >
          {colorOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>Color &amp; Palette</span>
        </button>
        <span
          className="mono-value"
          style={{ fontSize: 10, color: "var(--text-muted)" }}
        >
          {palette.length} Swatches
        </span>
      </div>
      {colorOpen && (
        <div className="panel-body">
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

          <ColorPicker hex={primaryColor} onChange={setPrimaryColor} />

          <div className="hsv-sliders">
            <label className="hsv-row">
              <span className="hsv-label">H</span>
              <input
                type="range"
                className="hsv-range"
                min={0}
                max={359}
                value={hsv.h}
                onChange={(e) =>
                  setPrimaryColor(
                    hsvToHex(Number(e.target.value), hsv.s, hsv.v)
                  )
                }
              />
              <span className="hsv-val">{hsv.h}°</span>
            </label>
            <label className="hsv-row">
              <span className="hsv-label">S</span>
              <input
                type="range"
                className="hsv-range"
                min={0}
                max={100}
                value={hsv.s}
                onChange={(e) =>
                  setPrimaryColor(
                    hsvToHex(hsv.h, Number(e.target.value), hsv.v)
                  )
                }
              />
              <span className="hsv-val">{hsv.s}%</span>
            </label>
            <label className="hsv-row">
              <span className="hsv-label">V</span>
              <input
                type="range"
                className="hsv-range"
                min={0}
                max={100}
                value={hsv.v}
                onChange={(e) =>
                  setPrimaryColor(
                    hsvToHex(hsv.h, hsv.s, Number(e.target.value))
                  )
                }
              />
              <span className="hsv-val">{hsv.v}%</span>
            </label>
          </div>

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

          <div
            className="palette-grid"
            title="Left-click: FG · Right-click: BG"
          >
            {palette.map((swatch) => {
              const active =
                swatch.toLowerCase() === primaryColor.toLowerCase();
              return (
                <button
                  key={swatch}
                  type="button"
                  className={`palette-swatch ${active ? "active" : ""}`}
                  style={{ backgroundColor: swatch }}
                  title={swatch}
                  onClick={() => setPrimaryColor(swatch)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSecondaryColor(swatch);
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
