import { useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex, isValidHex } from "../utils/color";

interface ColorPickerProps {
  hex: string;
  onChange: (hex: string) => void;
  mode?: "square" | "wheel";
  alpha?: number;
  onAlphaChange?: (a: number) => void;
}

const SV_WIDTH = 160;
const SV_HEIGHT = 110;
const HUE_WIDTH = 160;
const HUE_HEIGHT = 12;
const ALPHA_WIDTH = 160;
const ALPHA_HEIGHT = 12;

const WHEEL_SIZE = 148;
const WHEEL_CENTER = WHEEL_SIZE / 2;
const WHEEL_OUTER_R = 70;
const WHEEL_INNER_R = 54;
const WHEEL_SQ_HALF = 33;
const WHEEL_SQ_LEFT = WHEEL_CENTER - WHEEL_SQ_HALF;
const WHEEL_SQ_TOP = WHEEL_CENTER - WHEEL_SQ_HALF;
const WHEEL_SQ_SIZE = WHEEL_SQ_HALF * 2;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHexRgb(hex: string): [number, number, number] {
  if (!isValidHex(hex)) return [0, 0, 0];
  const clean = hex.slice(1);
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function hsvUnitToRgb(hDeg: number, s: number, v: number): [number, number, number] {
  const hn = ((hDeg % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hn < 60) {
    r = c; g = x; b = 0;
  } else if (hn < 120) {
    r = x; g = c; b = 0;
  } else if (hn < 180) {
    r = 0; g = c; b = x;
  } else if (hn < 240) {
    r = 0; g = x; b = c;
  } else if (hn < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function ColorPicker({
  hex,
  onChange,
  mode = "square",
  alpha = 255,
  onAlphaChange,
}: ColorPickerProps) {
  const parsed = hexToHsv(hex);
  const [hue, setHue] = useState(parsed.h);

  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const wheelCanvasRef = useRef<HTMLCanvasElement>(null);
  const alphaCanvasRef = useRef<HTMLCanvasElement>(null);
  const draggingSvRef = useRef(false);
  const draggingHueRef = useRef(false);
  const draggingWheelRef = useRef<"hue" | "sv" | null>(null);
  const draggingAlphaRef = useRef(false);

  // Preserve hue when dragging S or V to 0; sync when a chromatic color is selected externally
  useEffect(() => {
    if (parsed.s > 0 && parsed.v > 0) {
      setHue(parsed.h);
    }
  }, [parsed.h, parsed.s, parsed.v]);

  // Draw Hue strip when in square mode
  useEffect(() => {
    if (mode !== "square") return;
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(HUE_WIDTH, HUE_HEIGHT);
    const data = img.data;
    for (let x = 0; x < HUE_WIDTH; x++) {
      const h = (x / (HUE_WIDTH - 1)) * 359;
      const [r, g, b] = hsvUnitToRgb(h, 1, 1);
      for (let y = 0; y < HUE_HEIGHT; y++) {
        const idx = (y * HUE_WIDTH + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [mode]);

  // Redraw 2D Saturation/Value square when hue or mode changes
  useEffect(() => {
    if (mode !== "square") return;
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(SV_WIDTH, SV_HEIGHT);
    const data = img.data;
    for (let y = 0; y < SV_HEIGHT; y++) {
      const v = 1 - y / (SV_HEIGHT - 1);
      for (let x = 0; x < SV_WIDTH; x++) {
        const s = x / (SV_WIDTH - 1);
        const [r, g, b] = hsvUnitToRgb(hue, s, v);
        const idx = (y * SV_WIDTH + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hue, mode]);

  // Draw Hue Ring + Inner SV Square when in wheel mode
  useEffect(() => {
    if (mode !== "wheel") return;
    const canvas = wheelCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(WHEEL_SIZE, WHEEL_SIZE);
    const data = img.data;

    const sqRight = WHEEL_SQ_LEFT + WHEEL_SQ_SIZE;
    const sqBottom = WHEEL_SQ_TOP + WHEEL_SQ_SIZE;

    for (let y = 0; y < WHEEL_SIZE; y++) {
      const dy = y + 0.5 - WHEEL_CENTER;
      for (let x = 0; x < WHEEL_SIZE; x++) {
        const dx = x + 0.5 - WHEEL_CENTER;
        const dist = Math.hypot(dx, dy);
        const idx = (y * WHEEL_SIZE + x) * 4;

        if (
          x >= WHEEL_SQ_LEFT &&
          x <= sqRight &&
          y >= WHEEL_SQ_TOP &&
          y <= sqBottom
        ) {
          if (
            x === WHEEL_SQ_LEFT ||
            x === sqRight ||
            y === WHEEL_SQ_TOP ||
            y === sqBottom
          ) {
            data[idx] = 43;
            data[idx + 1] = 43;
            data[idx + 2] = 43;
            data[idx + 3] = 255;
          } else {
            const s = (x - WHEEL_SQ_LEFT) / WHEEL_SQ_SIZE;
            const v = 1 - (y - WHEEL_SQ_TOP) / WHEEL_SQ_SIZE;
            const [r, g, b] = hsvUnitToRgb(hue, s, v);
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
          continue;
        }

        if (dist >= WHEEL_INNER_R && dist <= WHEEL_OUTER_R) {
          if (dist < WHEEL_INNER_R + 1 || dist > WHEEL_OUTER_R - 1) {
            data[idx] = 43;
            data[idx + 1] = 43;
            data[idx + 2] = 43;
            data[idx + 3] = 255;
          } else {
            const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
            const [r, g, b] = hsvUnitToRgb(deg, 1, 1);
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hue, mode]);

  // Draw Alpha strip when onAlphaChange is provided
  useEffect(() => {
    if (!onAlphaChange) return;
    const canvas = alphaCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const [r, g, b] = parseHexRgb(hex);
    const img = ctx.createImageData(ALPHA_WIDTH, ALPHA_HEIGHT);
    const data = img.data;
    for (let y = 0; y < ALPHA_HEIGHT; y++) {
      const checkerY = Math.floor(y / 4);
      for (let x = 0; x < ALPHA_WIDTH; x++) {
        const checkerX = Math.floor(x / 4);
        const bg = (checkerX + checkerY) % 2 === 0 ? 48 : 80;
        const a = x / (ALPHA_WIDTH - 1);
        const idx = (y * ALPHA_WIDTH + x) * 4;
        data[idx] = Math.round(r * a + bg * (1 - a));
        data[idx + 1] = Math.round(g * a + bg * (1 - a));
        data[idx + 2] = Math.round(b * a + bg * (1 - a));
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hex, onAlphaChange]);

  const updateSvFromPointer = (el: HTMLDivElement, clientX: number, clientY: number) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const s = Math.round(clamp01((clientX - rect.left) / rect.width) * 100);
    const v = Math.round((1 - clamp01((clientY - rect.top) / rect.height)) * 100);
    onChange(hsvToHex(hue, s, v));
  };

  const updateHueFromPointer = (el: HTMLDivElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const nextHue = Math.round(clamp01((clientX - rect.left) / rect.width) * 359);
    setHue(nextHue);
    onChange(hsvToHex(nextHue, parsed.s, parsed.v));
  };

  const updateWheelFromPointer = (
    el: HTMLDivElement,
    clientX: number,
    clientY: number,
    target: "hue" | "sv"
  ) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const lx = ((clientX - rect.left) / rect.width) * WHEEL_SIZE;
    const ly = ((clientY - rect.top) / rect.height) * WHEEL_SIZE;

    if (target === "hue") {
      const dx = lx - WHEEL_CENTER;
      const dy = ly - WHEEL_CENTER;
      const nextHue = Math.round(
        (((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360)
      ) % 360;
      setHue(nextHue);
      onChange(hsvToHex(nextHue, parsed.s, parsed.v));
      return;
    }

    const s = Math.round(clamp01((lx - WHEEL_SQ_LEFT) / WHEEL_SQ_SIZE) * 100);
    const v = Math.round((1 - clamp01((ly - WHEEL_SQ_TOP) / WHEEL_SQ_SIZE)) * 100);
    onChange(hsvToHex(hue, s, v));
  };

  const updateAlphaFromPointer = (el: HTMLDivElement, clientX: number) => {
    if (!onAlphaChange) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const nextAlpha = clampByte(clamp01((clientX - rect.left) / rect.width) * 255);
    onAlphaChange(nextAlpha);
  };

  const clampedAlpha = clampByte(alpha);
  const wheelHueRad = (hue * Math.PI) / 180;
  const wheelMidR = (WHEEL_INNER_R + WHEEL_OUTER_R) / 2;
  const wheelHueLeftPct =
    ((WHEEL_CENTER + Math.cos(wheelHueRad) * wheelMidR) / WHEEL_SIZE) * 100;
  const wheelHueTopPct =
    ((WHEEL_CENTER + Math.sin(wheelHueRad) * wheelMidR) / WHEEL_SIZE) * 100;
  const wheelSvLeftPct =
    ((WHEEL_SQ_LEFT + (parsed.s / 100) * WHEEL_SQ_SIZE) / WHEEL_SIZE) * 100;
  const wheelSvTopPct =
    ((WHEEL_SQ_TOP + (1 - parsed.v / 100) * WHEEL_SQ_SIZE) / WHEEL_SIZE) * 100;

  return (
    <div className="color-picker-wrap">
      {mode === "wheel" ? (
        <div
          className="draw-wheel-wrap"
          role="application"
          aria-label="Color Wheel Picker"
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const lx = ((e.clientX - rect.left) / rect.width) * WHEEL_SIZE;
            const ly = ((e.clientY - rect.top) / rect.height) * WHEEL_SIZE;
            const dist = Math.hypot(lx - WHEEL_CENTER, ly - WHEEL_CENTER);
            const target: "hue" | "sv" =
              dist < WHEEL_INNER_R - 1 ? "sv" : "hue";
            draggingWheelRef.current = target;
            e.currentTarget.setPointerCapture(e.pointerId);
            updateWheelFromPointer(e.currentTarget, e.clientX, e.clientY, target);
          }}
          onPointerMove={(e) => {
            const target = draggingWheelRef.current;
            if (!target) return;
            updateWheelFromPointer(e.currentTarget, e.clientX, e.clientY, target);
          }}
          onPointerUp={(e) => {
            draggingWheelRef.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerCancel={() => {
            draggingWheelRef.current = null;
          }}
        >
          <canvas
            ref={wheelCanvasRef}
            width={WHEEL_SIZE}
            height={WHEEL_SIZE}
            className="draw-wheel-canvas"
          />
          <span
            className="color-sv-cursor"
            style={{
              left: `${wheelHueLeftPct}%`,
              top: `${wheelHueTopPct}%`,
            }}
          />
          <span
            className="color-sv-cursor"
            style={{
              left: `${wheelSvLeftPct}%`,
              top: `${wheelSvTopPct}%`,
            }}
          />
        </div>
      ) : (
        <>
          <div
            className="color-sv-wrap"
            role="slider"
            aria-label="Saturation and Value Picker"
            aria-valuetext={`Saturation ${parsed.s}%, Value ${parsed.v}%`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              draggingSvRef.current = true;
              updateSvFromPointer(e.currentTarget, e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (!draggingSvRef.current) return;
              updateSvFromPointer(e.currentTarget, e.clientX, e.clientY);
            }}
            onPointerUp={(e) => {
              draggingSvRef.current = false;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }}
            onPointerCancel={() => {
              draggingSvRef.current = false;
            }}
          >
            <canvas
              ref={svCanvasRef}
              width={SV_WIDTH}
              height={SV_HEIGHT}
              className="color-sv-canvas"
            />
            <span
              className="color-sv-cursor"
              style={{
                left: `${parsed.s}%`,
                top: `${100 - parsed.v}%`,
              }}
            />
          </div>

          <div
            className="color-hue-wrap"
            role="slider"
            aria-label="Hue Slider"
            aria-valuemin={0}
            aria-valuemax={359}
            aria-valuenow={hue}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              draggingHueRef.current = true;
              updateHueFromPointer(e.currentTarget, e.clientX);
            }}
            onPointerMove={(e) => {
              if (!draggingHueRef.current) return;
              updateHueFromPointer(e.currentTarget, e.clientX);
            }}
            onPointerUp={(e) => {
              draggingHueRef.current = false;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }}
            onPointerCancel={() => {
              draggingHueRef.current = false;
            }}
          >
            <canvas
              ref={hueCanvasRef}
              width={HUE_WIDTH}
              height={HUE_HEIGHT}
              className="color-hue-canvas"
            />
            <span
              className="color-hue-cursor"
              style={{ left: `${(hue / 359) * 100}%` }}
            />
          </div>
        </>
      )}

      {onAlphaChange && (
        <div
          className="draw-alpha-wrap"
          role="slider"
          aria-label="Alpha Slider"
          aria-valuemin={0}
          aria-valuemax={255}
          aria-valuenow={clampedAlpha}
          title={`Alpha: ${clampedAlpha}/255`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            draggingAlphaRef.current = true;
            updateAlphaFromPointer(e.currentTarget, e.clientX);
          }}
          onPointerMove={(e) => {
            if (!draggingAlphaRef.current) return;
            updateAlphaFromPointer(e.currentTarget, e.clientX);
          }}
          onPointerUp={(e) => {
            draggingAlphaRef.current = false;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerCancel={() => {
            draggingAlphaRef.current = false;
          }}
        >
          <canvas
            ref={alphaCanvasRef}
            width={ALPHA_WIDTH}
            height={ALPHA_HEIGHT}
            className="color-hue-canvas"
          />
          <span
            className="color-hue-cursor"
            style={{ left: `${(clampedAlpha / 255) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
