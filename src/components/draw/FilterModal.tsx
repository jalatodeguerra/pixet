import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Lock, Sliders, Unlock, X } from "lucide-react";
import { hexToRgba, PixelBuffer, type RGBA } from "../../engine/document/PixelBuffer";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  applyBufferFilterAction,
  scaleSpriteAction,
  type FilterScope,
} from "../../engine/document/filterActions";
import {
  applyBrightnessContrast,
  applyColorReplace,
  applyDesaturateFilter,
  applyDropShadowFilter,
  applyHsvAdjust,
  applyInvertFilter,
  applyOutlineFilter,
  applyPixelCleanupFilter,
  applyQuantizeToPalette,
} from "../../engine/tools/filters";
import {
  offsetWrapBuffer,
  scaleBufferAlgorithm,
  type ScaleSpriteAlgorithm,
} from "../../engine/tools/spriteOps";
import { useEditorStore } from "../../store/editorStore";

type FilterTabId =
  | "outline"
  | "dropShadow"
  | "hsv"
  | "brightness"
  | "colorReplace"
  | "quantize"
  | "cleanup"
  | "offsetWrap"
  | "invertGray"
  | "scaleSprite";

interface FilterTabDef {
  id: FilterTabId;
  label: string;
}

const FILTER_TABS: FilterTabDef[] = [
  { id: "outline", label: "Outline" },
  { id: "dropShadow", label: "Drop Shadow" },
  { id: "hsv", label: "HSV" },
  { id: "brightness", label: "Brightness" },
  { id: "colorReplace", label: "Color Replace" },
  { id: "quantize", label: "Quantize" },
  { id: "cleanup", label: "Cleanup" },
  { id: "offsetWrap", label: "Offset / Wrap" },
  { id: "invertGray", label: "Invert / Gray" },
  { id: "scaleSprite", label: "Scale Sprite" },
];

const VALID_TABS = new Set<string>(FILTER_TABS.map((t) => t.id));

function normalizeTab(tab: string): FilterTabId {
  return VALID_TABS.has(tab) ? (tab as FilterTabId) : "outline";
}

function drawPreviewBuffer(
  canvas: HTMLCanvasElement | null,
  buf: PixelBuffer | null
): void {
  if (!canvas || !buf) return;
  if (canvas.width !== buf.width) canvas.width = buf.width;
  if (canvas.height !== buf.height) canvas.height = buf.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = new ImageData(
    new Uint8ClampedArray(buf.data),
    buf.width,
    buf.height
  );
  ctx.putImageData(img, 0, 0);
}

export function FilterModal() {
  const open = useEditorStore((s) => s.filterModalOpen);
  const tabRaw = useEditorStore((s) => s.filterModalTab);
  const setFilterModalOpen = useEditorStore((s) => s.setFilterModalOpen);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const primaryColor = useEditorStore((s) => s.primaryColor);
  const secondaryColor = useEditorStore((s) => s.secondaryColor);
  const palette = useEditorStore((s) => s.palette);

  const activeTab = normalizeTab(tabRaw);
  const [scope, setScope] = useState<FilterScope>("cel");

  // Outline
  const [outlineThickness, setOutlineThickness] = useState(1);
  const [outlineConnectivity, setOutlineConnectivity] = useState<4 | 8>(4);
  const [outlinePlacement, setOutlinePlacement] = useState<"outside" | "inside">("outside");
  const [outlineMode, setOutlineMode] = useState<"solid" | "selective">("solid");
  const [outlineColor, setOutlineColor] = useState("#0f0f17");

  // Drop Shadow
  const [shadowOffsetX, setShadowOffsetX] = useState(1);
  const [shadowOffsetY, setShadowOffsetY] = useState(2);
  const [shadowColor, setShadowColor] = useState("#0f0f17");
  const [shadowOpacity, setShadowOpacity] = useState(60);

  // HSV
  const [hueDeg, setHueDeg] = useState(0);
  const [satDelta, setSatDelta] = useState(0);
  const [valDelta, setValDelta] = useState(0);

  // Brightness / Contrast
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);

  // Color Replace
  const [replaceFromHex, setReplaceFromHex] = useState("#5b8cff");
  const [replaceToHex, setReplaceToHex] = useState("#f4f4f8");
  const [replaceTolerance, setReplaceTolerance] = useState(12);

  // Quantize
  const [quantizeDither, setQuantizeDither] = useState<
    "none" | "bayer4" | "floydSteinberg"
  >("bayer4");

  // Cleanup
  const [removeOrphans, setRemoveOrphans] = useState(true);
  const [fillHoles, setFillHoles] = useState(false);

  // Offset / Wrap
  const [offsetDx, setOffsetDx] = useState(0);
  const [offsetDy, setOffsetDy] = useState(0);

  // Invert / Gray
  const [invertGrayOp, setInvertGrayOp] = useState<"invert" | "desaturate">("invert");

  // Scale Sprite
  const [scaleW, setScaleW] = useState(canvasWidth);
  const [scaleH, setScaleH] = useState(canvasHeight);
  const [scaleLockAspect, setScaleLockAspect] = useState(true);
  const [scaleAlgorithm, setScaleAlgorithm] =
    useState<ScaleSpriteAlgorithm>("nearest");

  const beforeCanvasRef = useRef<HTMLCanvasElement>(null);
  const afterCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    setReplaceFromHex(primaryColor);
    setReplaceToHex(secondaryColor);
    setScaleW(canvasWidth);
    setScaleH(canvasHeight);
  }, [open, primaryColor, secondaryColor, canvasWidth, canvasHeight]);

  const paletteRgbas = useMemo<RGBA[]>(
    () => palette.map((hex) => hexToRgba(hex, 255)),
    [palette]
  );

  const sourcePreviewBuffer = useMemo(() => {
    if (!open) return new PixelBuffer(1, 1);
    const cel = pixelEngine.getCel(activeLayerId, currentFrame);
    return cel ? cel.clone() : new PixelBuffer(canvasWidth, canvasHeight);
  }, [open, activeLayerId, currentFrame, canvasWidth, canvasHeight]);

  const activeMask = useMemo(() => {
    if (!open || scope !== "cel") return null;
    if (pixelEngine.selection && !pixelEngine.selection.isEmpty()) {
      return pixelEngine.selection;
    }
    return null;
  }, [open, scope]);

  const afterPreviewBuffer = useMemo(() => {
    if (!open) return new PixelBuffer(1, 1);
    switch (activeTab) {
      case "outline":
        return applyOutlineFilter(
          sourcePreviewBuffer,
          {
            thickness: outlineThickness,
            connectivity: outlineConnectivity,
            placement: outlinePlacement,
            mode: outlineMode,
            color: hexToRgba(outlineColor, 255),
          },
          activeMask
        );
      case "dropShadow":
        return applyDropShadowFilter(
          sourcePreviewBuffer,
          {
            offsetX: shadowOffsetX,
            offsetY: shadowOffsetY,
            color: hexToRgba(shadowColor, 255),
            opacity: shadowOpacity,
          },
          activeMask
        );
      case "hsv":
        return applyHsvAdjust(
          sourcePreviewBuffer,
          { hueDeg, satDelta, valDelta },
          activeMask
        );
      case "brightness":
        return applyBrightnessContrast(
          sourcePreviewBuffer,
          { brightness, contrast },
          activeMask
        );
      case "colorReplace":
        return applyColorReplace(
          sourcePreviewBuffer,
          {
            fromRgba: hexToRgba(replaceFromHex, 255),
            toRgba: hexToRgba(replaceToHex, 255),
            tolerance: replaceTolerance,
          },
          activeMask
        );
      case "quantize":
        return applyQuantizeToPalette(
          sourcePreviewBuffer,
          { palette: paletteRgbas, dither: quantizeDither },
          activeMask
        );
      case "cleanup":
        return applyPixelCleanupFilter(
          sourcePreviewBuffer,
          { removeOrphans, fillHoles },
          activeMask
        );
      case "offsetWrap":
        return offsetWrapBuffer(sourcePreviewBuffer, offsetDx, offsetDy, activeMask);
      case "invertGray":
        return invertGrayOp === "invert"
          ? applyInvertFilter(sourcePreviewBuffer, activeMask)
          : applyDesaturateFilter(sourcePreviewBuffer, activeMask);
      case "scaleSprite":
        return scaleBufferAlgorithm(
          sourcePreviewBuffer,
          Math.max(1, Math.min(2048, Math.round(scaleW) || canvasWidth)),
          Math.max(1, Math.min(2048, Math.round(scaleH) || canvasHeight)),
          scaleAlgorithm
        );
    }
  }, [
    open,
    activeTab,
    sourcePreviewBuffer,
    activeMask,
    outlineThickness,
    outlineConnectivity,
    outlinePlacement,
    outlineMode,
    outlineColor,
    shadowOffsetX,
    shadowOffsetY,
    shadowColor,
    shadowOpacity,
    hueDeg,
    satDelta,
    valDelta,
    brightness,
    contrast,
    replaceFromHex,
    replaceToHex,
    replaceTolerance,
    paletteRgbas,
    quantizeDither,
    removeOrphans,
    fillHoles,
    offsetDx,
    offsetDy,
    invertGrayOp,
    scaleW,
    scaleH,
    scaleAlgorithm,
    canvasWidth,
    canvasHeight,
  ]);

  useEffect(() => {
    if (!open) return;
    drawPreviewBuffer(beforeCanvasRef.current, sourcePreviewBuffer);
    drawPreviewBuffer(afterCanvasRef.current, afterPreviewBuffer);
  }, [open, sourcePreviewBuffer, afterPreviewBuffer]);

  const handleApply = useCallback(() => {
    if (activeTab === "scaleSprite") {
      scaleSpriteAction(scaleW, scaleH, scaleAlgorithm);
      setFilterModalOpen(false);
      return;
    }

    switch (activeTab) {
      case "outline":
        applyBufferFilterAction("Auto-Outline", scope, (buf, mask) =>
          applyOutlineFilter(
            buf,
            {
              thickness: outlineThickness,
              connectivity: outlineConnectivity,
              placement: outlinePlacement,
              mode: outlineMode,
              color: hexToRgba(outlineColor, 255),
            },
            mask
          )
        );
        break;
      case "dropShadow":
        applyBufferFilterAction("Drop Shadow", scope, (buf, mask) =>
          applyDropShadowFilter(
            buf,
            {
              offsetX: shadowOffsetX,
              offsetY: shadowOffsetY,
              color: hexToRgba(shadowColor, 255),
              opacity: shadowOpacity,
            },
            mask
          )
        );
        break;
      case "hsv":
        applyBufferFilterAction("HSV Adjust", scope, (buf, mask) =>
          applyHsvAdjust(buf, { hueDeg, satDelta, valDelta }, mask)
        );
        break;
      case "brightness":
        applyBufferFilterAction("Brightness / Contrast", scope, (buf, mask) =>
          applyBrightnessContrast(buf, { brightness, contrast }, mask)
        );
        break;
      case "colorReplace":
        applyBufferFilterAction("Color Replace", scope, (buf, mask) =>
          applyColorReplace(
            buf,
            {
              fromRgba: hexToRgba(replaceFromHex, 255),
              toRgba: hexToRgba(replaceToHex, 255),
              tolerance: replaceTolerance,
            },
            mask
          )
        );
        break;
      case "quantize":
        applyBufferFilterAction("Quantize to Palette", scope, (buf, mask) =>
          applyQuantizeToPalette(
            buf,
            { palette: paletteRgbas, dither: quantizeDither },
            mask
          )
        );
        break;
      case "cleanup":
        applyBufferFilterAction("Pixel Cleanup", scope, (buf, mask) =>
          applyPixelCleanupFilter(buf, { removeOrphans, fillHoles }, mask)
        );
        break;
      case "offsetWrap":
        applyBufferFilterAction("Offset / Wrap", scope, (buf, mask) =>
          offsetWrapBuffer(buf, offsetDx, offsetDy, mask)
        );
        break;
      case "invertGray":
        if (invertGrayOp === "invert") {
          applyBufferFilterAction("Invert Colors", scope, (buf, mask) =>
            applyInvertFilter(buf, mask)
          );
        } else {
          applyBufferFilterAction("Desaturate", scope, (buf, mask) =>
            applyDesaturateFilter(buf, mask)
          );
        }
        break;
    }

    setFilterModalOpen(false);
  }, [
    activeTab,
    scope,
    outlineThickness,
    outlineConnectivity,
    outlinePlacement,
    outlineMode,
    outlineColor,
    shadowOffsetX,
    shadowOffsetY,
    shadowColor,
    shadowOpacity,
    hueDeg,
    satDelta,
    valDelta,
    brightness,
    contrast,
    replaceFromHex,
    replaceToHex,
    replaceTolerance,
    paletteRgbas,
    quantizeDither,
    removeOrphans,
    fillHoles,
    offsetDx,
    offsetDy,
    invertGrayOp,
    scaleW,
    scaleH,
    scaleAlgorithm,
    setFilterModalOpen,
  ]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setFilterModalOpen(false);
      } else if (e.key === "Enter") {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "TEXTAREA") return;
        e.preventDefault();
        e.stopPropagation();
        handleApply();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, setFilterModalOpen, handleApply]);

  if (!open) return null;

  const beforeDisplayScale = Math.max(
    1,
    Math.min(8, Math.floor(152 / Math.max(sourcePreviewBuffer.width, sourcePreviewBuffer.height)))
  );
  const afterDisplayScale = Math.max(
    1,
    Math.min(8, Math.floor(152 / Math.max(afterPreviewBuffer.width, afterPreviewBuffer.height)))
  );

  const handleScaleWChange = (nextW: number) => {
    const clampedW = Math.max(1, Math.min(2048, Math.round(nextW) || 1));
    setScaleW(clampedW);
    if (scaleLockAspect && canvasWidth > 0) {
      setScaleH(
        Math.max(1, Math.min(2048, Math.round((clampedW * canvasHeight) / canvasWidth)))
      );
    }
  };

  const handleScaleHChange = (nextH: number) => {
    const clampedH = Math.max(1, Math.min(2048, Math.round(nextH) || 1));
    setScaleH(clampedH);
    if (scaleLockAspect && canvasHeight > 0) {
      setScaleW(
        Math.max(1, Math.min(2048, Math.round((clampedH * canvasWidth) / canvasHeight)))
      );
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setFilterModalOpen(false);
      }}
    >
      <div
        className="modal-card draw-filter-modal-card"
        role="dialog"
        aria-label="Filters & Sprite Operations"
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Sliders size={14} />
            <span>Filters &amp; Sprite Operations</span>
          </div>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => setFilterModalOpen(false)}
            title="Close (Esc)"
          >
            <X size={13} />
          </button>
        </div>

        <div className="draw-filter-layout">
          <nav className="draw-filter-sidebar" aria-label="Filter Categories">
            {FILTER_TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`draw-filter-tab ${active ? "active" : ""}`}
                  onClick={() => setFilterModalOpen(true, tab.id)}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="draw-filter-main">
            <div className="draw-filter-previews">
              <div className="draw-filter-preview-box">
                <div className="draw-filter-preview-label">
                  <span>Before</span>
                  <span>
                    {sourcePreviewBuffer.width}×{sourcePreviewBuffer.height}
                  </span>
                </div>
                <div className="draw-filter-preview-stage">
                  <canvas
                    ref={beforeCanvasRef}
                    className="draw-filter-canvas"
                    style={{
                      width: sourcePreviewBuffer.width * beforeDisplayScale,
                      height: sourcePreviewBuffer.height * beforeDisplayScale,
                    }}
                  />
                </div>
              </div>

              <div className="draw-filter-preview-box">
                <div className="draw-filter-preview-label">
                  <span>After (Live)</span>
                  <span>
                    {afterPreviewBuffer.width}×{afterPreviewBuffer.height}
                  </span>
                </div>
                <div className="draw-filter-preview-stage">
                  <canvas
                    ref={afterCanvasRef}
                    className="draw-filter-canvas"
                    style={{
                      width: afterPreviewBuffer.width * afterDisplayScale,
                      height: afterPreviewBuffer.height * afterDisplayScale,
                    }}
                  />
                </div>
              </div>
            </div>

            {activeTab !== "scaleSprite" && (
              <div className="draw-filter-scope-row">
                <span className="draw-filter-field-label">Scope</span>
                <div className="draw-filter-seg">
                  {(
                    [
                      { id: "cel", label: "Active Cel" },
                      { id: "layer", label: "Active Layer" },
                      { id: "sprite", label: "Entire Sprite" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`mini-btn ${scope === opt.id ? "active" : ""}`}
                      onClick={() => setScope(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="draw-filter-controls">
              {activeTab === "outline" && (
                <>
                  <label className="draw-filter-slider-row">
                    <span>Thickness</span>
                    <input
                      type="range"
                      min={1}
                      max={4}
                      step={1}
                      value={outlineThickness}
                      onChange={(e) => setOutlineThickness(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{outlineThickness}px</span>
                  </label>

                  <div className="modal-grid-2">
                    <div className="modal-field">
                      <span>Connectivity</span>
                      <div className="draw-filter-seg">
                        <button
                          type="button"
                          className={`mini-btn ${outlineConnectivity === 4 ? "active" : ""}`}
                          onClick={() => setOutlineConnectivity(4)}
                        >
                          4-way
                        </button>
                        <button
                          type="button"
                          className={`mini-btn ${outlineConnectivity === 8 ? "active" : ""}`}
                          onClick={() => setOutlineConnectivity(8)}
                        >
                          8-way
                        </button>
                      </div>
                    </div>

                    <div className="modal-field">
                      <span>Placement</span>
                      <div className="draw-filter-seg">
                        <button
                          type="button"
                          className={`mini-btn ${outlinePlacement === "outside" ? "active" : ""}`}
                          onClick={() => setOutlinePlacement("outside")}
                        >
                          Outside
                        </button>
                        <button
                          type="button"
                          className={`mini-btn ${outlinePlacement === "inside" ? "active" : ""}`}
                          onClick={() => setOutlinePlacement("inside")}
                        >
                          Inside
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="modal-grid-2">
                    <div className="modal-field">
                      <span>Mode</span>
                      <div className="draw-filter-seg">
                        <button
                          type="button"
                          className={`mini-btn ${outlineMode === "solid" ? "active" : ""}`}
                          onClick={() => setOutlineMode("solid")}
                        >
                          Solid
                        </button>
                        <button
                          type="button"
                          className={`mini-btn ${outlineMode === "selective" ? "active" : ""}`}
                          onClick={() => setOutlineMode("selective")}
                        >
                          Selective
                        </button>
                      </div>
                    </div>

                    <label className="modal-field">
                      <span>Outline Color</span>
                      <div className="draw-filter-color-row">
                        <input
                          type="color"
                          className="draw-filter-color-input"
                          value={outlineColor}
                          disabled={outlineMode === "selective"}
                          onChange={(e) => setOutlineColor(e.target.value)}
                        />
                        <input
                          type="text"
                          className="palette-select"
                          value={outlineColor}
                          disabled={outlineMode === "selective"}
                          onChange={(e) => setOutlineColor(e.target.value)}
                        />
                      </div>
                    </label>
                  </div>
                </>
              )}

              {activeTab === "dropShadow" && (
                <>
                  <label className="draw-filter-slider-row">
                    <span>Offset X</span>
                    <input
                      type="range"
                      min={-16}
                      max={16}
                      step={1}
                      value={shadowOffsetX}
                      onChange={(e) => setShadowOffsetX(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{shadowOffsetX}px</span>
                  </label>
                  <label className="draw-filter-slider-row">
                    <span>Offset Y</span>
                    <input
                      type="range"
                      min={-16}
                      max={16}
                      step={1}
                      value={shadowOffsetY}
                      onChange={(e) => setShadowOffsetY(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{shadowOffsetY}px</span>
                  </label>
                  <label className="draw-filter-slider-row">
                    <span>Opacity</span>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={shadowOpacity}
                      onChange={(e) => setShadowOpacity(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{shadowOpacity}%</span>
                  </label>
                  <label className="modal-field">
                    <span>Shadow Color</span>
                    <div className="draw-filter-color-row">
                      <input
                        type="color"
                        className="draw-filter-color-input"
                        value={shadowColor}
                        onChange={(e) => setShadowColor(e.target.value)}
                      />
                      <input
                        type="text"
                        className="palette-select"
                        value={shadowColor}
                        onChange={(e) => setShadowColor(e.target.value)}
                      />
                    </div>
                  </label>
                </>
              )}

              {activeTab === "hsv" && (
                <>
                  <label className="draw-filter-slider-row">
                    <span>Hue</span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={hueDeg}
                      onChange={(e) => setHueDeg(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{hueDeg}°</span>
                  </label>
                  <label className="draw-filter-slider-row">
                    <span>Saturation</span>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      step={1}
                      value={satDelta}
                      onChange={(e) => setSatDelta(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{satDelta}</span>
                  </label>
                  <label className="draw-filter-slider-row">
                    <span>Value</span>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      step={1}
                      value={valDelta}
                      onChange={(e) => setValDelta(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{valDelta}</span>
                  </label>
                  <div className="draw-filter-inline-actions">
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => {
                        setHueDeg(0);
                        setSatDelta(0);
                        setValDelta(0);
                      }}
                    >
                      Reset HSV
                    </button>
                  </div>
                </>
              )}

              {activeTab === "brightness" && (
                <>
                  <label className="draw-filter-slider-row">
                    <span>Brightness</span>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      step={1}
                      value={brightness}
                      onChange={(e) => setBrightness(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{brightness}</span>
                  </label>
                  <label className="draw-filter-slider-row">
                    <span>Contrast</span>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      step={1}
                      value={contrast}
                      onChange={(e) => setContrast(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{contrast}</span>
                  </label>
                  <div className="draw-filter-inline-actions">
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => {
                        setBrightness(0);
                        setContrast(0);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </>
              )}

              {activeTab === "colorReplace" && (
                <>
                  <div className="modal-grid-2">
                    <label className="modal-field">
                      <span>From Color</span>
                      <div className="draw-filter-color-row">
                        <input
                          type="color"
                          className="draw-filter-color-input"
                          value={replaceFromHex}
                          onChange={(e) => setReplaceFromHex(e.target.value)}
                        />
                        <input
                          type="text"
                          className="palette-select"
                          value={replaceFromHex}
                          onChange={(e) => setReplaceFromHex(e.target.value)}
                        />
                      </div>
                    </label>
                    <label className="modal-field">
                      <span>To Color</span>
                      <div className="draw-filter-color-row">
                        <input
                          type="color"
                          className="draw-filter-color-input"
                          value={replaceToHex}
                          onChange={(e) => setReplaceToHex(e.target.value)}
                        />
                        <input
                          type="text"
                          className="palette-select"
                          value={replaceToHex}
                          onChange={(e) => setReplaceToHex(e.target.value)}
                        />
                      </div>
                    </label>
                  </div>
                  <label className="draw-filter-slider-row">
                    <span>Tolerance</span>
                    <input
                      type="range"
                      min={0}
                      max={255}
                      step={1}
                      value={replaceTolerance}
                      onChange={(e) => setReplaceTolerance(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{replaceTolerance}</span>
                  </label>
                </>
              )}

              {activeTab === "quantize" && (
                <>
                  <div className="modal-field">
                    <span>Dithering Method (Active Palette: {palette.length} colors)</span>
                    <div className="draw-filter-seg">
                      <button
                        type="button"
                        className={`mini-btn ${quantizeDither === "none" ? "active" : ""}`}
                        onClick={() => setQuantizeDither("none")}
                      >
                        None
                      </button>
                      <button
                        type="button"
                        className={`mini-btn ${quantizeDither === "bayer4" ? "active" : ""}`}
                        onClick={() => setQuantizeDither("bayer4")}
                      >
                        Bayer 4×4
                      </button>
                      <button
                        type="button"
                        className={`mini-btn ${quantizeDither === "floydSteinberg" ? "active" : ""}`}
                        onClick={() => setQuantizeDither("floydSteinberg")}
                      >
                        Floyd-Steinberg
                      </button>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "cleanup" && (
                <div className="draw-filter-toggles">
                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={removeOrphans}
                      onChange={(e) => setRemoveOrphans(e.target.checked)}
                    />
                    <span>Remove Orphan Pixels (isolated 1px specks)</span>
                  </label>
                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={fillHoles}
                      onChange={(e) => setFillHoles(e.target.checked)}
                    />
                    <span>Fill 1px Holes (surrounded by 4 opaque neighbors)</span>
                  </label>
                </div>
              )}

              {activeTab === "offsetWrap" && (
                <>
                  <label className="draw-filter-slider-row">
                    <span>Offset X</span>
                    <input
                      type="range"
                      min={-64}
                      max={64}
                      step={1}
                      value={offsetDx}
                      onChange={(e) => setOffsetDx(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{offsetDx}px</span>
                  </label>
                  <label className="draw-filter-slider-row">
                    <span>Offset Y</span>
                    <input
                      type="range"
                      min={-64}
                      max={64}
                      step={1}
                      value={offsetDy}
                      onChange={(e) => setOffsetDy(Number(e.target.value))}
                    />
                    <span className="draw-filter-val">{offsetDy}px</span>
                  </label>
                  <div className="draw-filter-inline-actions">
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => {
                        setOffsetDx(Math.floor(canvasWidth / 2));
                        setOffsetDy(Math.floor(canvasHeight / 2));
                      }}
                    >
                      Half-Canvas Wrap
                    </button>
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => {
                        setOffsetDx(0);
                        setOffsetDy(0);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </>
              )}

              {activeTab === "invertGray" && (
                <div className="modal-field">
                  <span>Operation</span>
                  <div className="draw-filter-seg">
                    <button
                      type="button"
                      className={`mini-btn ${invertGrayOp === "invert" ? "active" : ""}`}
                      onClick={() => setInvertGrayOp("invert")}
                    >
                      Invert Colors
                    </button>
                    <button
                      type="button"
                      className={`mini-btn ${invertGrayOp === "desaturate" ? "active" : ""}`}
                      onClick={() => setInvertGrayOp("desaturate")}
                    >
                      Desaturate (Grayscale)
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "scaleSprite" && (
                <>
                  <div className="draw-filter-scale-row">
                    <label className="modal-field" style={{ flex: 1 }}>
                      <span>Target Width</span>
                      <input
                        type="number"
                        min={1}
                        max={2048}
                        className="palette-select"
                        value={scaleW}
                        onChange={(e) => handleScaleWChange(Number(e.target.value))}
                      />
                    </label>
                    <button
                      type="button"
                      className={`mini-btn ${scaleLockAspect ? "active" : ""}`}
                      style={{ alignSelf: "flex-end", height: 26 }}
                      onClick={() => setScaleLockAspect((v) => !v)}
                      title="Lock Aspect Ratio"
                    >
                      {scaleLockAspect ? <Lock size={12} /> : <Unlock size={12} />}
                      <span>Aspect</span>
                    </button>
                    <label className="modal-field" style={{ flex: 1 }}>
                      <span>Target Height</span>
                      <input
                        type="number"
                        min={1}
                        max={2048}
                        className="palette-select"
                        value={scaleH}
                        onChange={(e) => handleScaleHChange(Number(e.target.value))}
                      />
                    </label>
                  </div>

                  <div className="draw-filter-inline-actions">
                    {[0.5, 2, 3, 4].map((mult) => (
                      <button
                        key={mult}
                        type="button"
                        className="mini-btn"
                        onClick={() => {
                          setScaleW(Math.max(1, Math.round(canvasWidth * mult)));
                          setScaleH(Math.max(1, Math.round(canvasHeight * mult)));
                        }}
                      >
                        {mult}×
                      </button>
                    ))}
                  </div>

                  <div className="modal-field">
                    <span>Resampling Algorithm</span>
                    <div className="draw-filter-seg">
                      <button
                        type="button"
                        className={`mini-btn ${scaleAlgorithm === "nearest" ? "active" : ""}`}
                        onClick={() => setScaleAlgorithm("nearest")}
                      >
                        Nearest
                      </button>
                      <button
                        type="button"
                        className={`mini-btn ${scaleAlgorithm === "scale2x" ? "active" : ""}`}
                        onClick={() => setScaleAlgorithm("scale2x")}
                      >
                        Scale2x
                      </button>
                      <button
                        type="button"
                        className={`mini-btn ${scaleAlgorithm === "rotsprite" ? "active" : ""}`}
                        onClick={() => setScaleAlgorithm("rotsprite")}
                      >
                        RotSprite
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="mini-btn"
                onClick={() => setFilterModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="export-cta"
                onClick={handleApply}
              >
                <Check size={13} />
                <span>Apply</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
