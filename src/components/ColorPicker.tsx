import { useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex } from "../utils/color";

interface ColorPickerProps {
  hex: string;
  onChange: (hex: string) => void;
}

const SV_WIDTH = 160;
const SV_HEIGHT = 110;
const HUE_WIDTH = 160;
const HUE_HEIGHT = 12;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
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

export function ColorPicker({ hex, onChange }: ColorPickerProps) {
  const parsed = hexToHsv(hex);
  const [hue, setHue] = useState(parsed.h);

  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const draggingSvRef = useRef(false);
  const draggingHueRef = useRef(false);

  // Preserve hue when dragging S or V to 0; sync when a chromatic color is selected externally
  useEffect(() => {
    if (parsed.s > 0 && parsed.v > 0) {
      setHue(parsed.h);
    }
  }, [parsed.h, parsed.s, parsed.v]);

  // Draw Hue strip once on mount via canvas ImageData (no CSS gradients)
  useEffect(() => {
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
  }, []);

  // Redraw 2D Saturation/Value square when hue changes
  useEffect(() => {
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
  }, [hue]);

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

  return (
    <div className="color-picker-wrap">
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
    </div>
  );
}
