/**
 * Built-in sample documents, generated procedurally as plain data so they can
 * be unit-tested without the engine or React. `newDocument.ts` loads them.
 */
import { hexToRgba } from "./PixelBuffer.ts";

export type SampleBlendMode = "Normal" | "Multiply";

export interface SampleLayer {
  id: string;
  name: string;
  blendMode: SampleBlendMode;
}

export interface SampleFrame {
  durationMs: number;
}

export interface SampleTag {
  name: string;
  fromFrame: number;
  toFrame: number;
  color: string;
}

export interface SampleCel {
  layerId: string;
  frameIndex: number;
  /** RGBA bytes, width * height * 4. */
  data: Uint8ClampedArray;
}

export interface SampleDocument {
  id: string;
  label: string;
  description: string;
  documentName: string;
  width: number;
  height: number;
  /** Top-most layer first, matching the store's layer order. */
  layers: SampleLayer[];
  frames: SampleFrame[];
  tags: SampleTag[];
  cels: SampleCel[];
}

type PixelWriter = (x: number, y: number, hex: string) => void;

function makeCel(
  width: number,
  height: number
): { data: Uint8ClampedArray; set: PixelWriter } {
  const data = new Uint8ClampedArray(width * height * 4);
  const set: PixelWriter = (x, y, hex) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const [r, g, b, a] = hexToRgba(hex, 255);
    const i = (y * width + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  };
  return { data, set };
}

const LAYERS: SampleLayer[] = [
  { id: "layer-outline", name: "Outline", blendMode: "Normal" },
  { id: "layer-shading", name: "Shading", blendMode: "Multiply" },
  { id: "layer-base", name: "Base", blendMode: "Normal" },
];

/** The classic starter: a pulsing blue gem, 4 frames, "idle" tag. */
export function generateGemSample(width = 32, height = 32): SampleDocument {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const cels: SampleCel[] = [];

  for (let frameIndex = 0; frameIndex < 4; frameIndex++) {
    const base = makeCel(width, height);
    const shading = makeCel(width, height);
    const outline = makeCel(width, height);
    const bobOffset = frameIndex % 2 === 1 ? -1 : 0;
    const r = 6 + (frameIndex === 2 ? 1 : 0);

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.abs(dx) + Math.abs(dy);
        const px = cx + dx;
        const py = cy + dy + bobOffset;
        if (dist === r) {
          outline.set(px, py, "#0f0f17");
        } else if (dist < r) {
          base.set(px, py, dx <= -2 && dy <= -2 ? "#d8e6ff" : "#5b8cff");
          if (dy > 1 || dx > 1) shading.set(px, py, "#8091c8");
        }
      }
    }
    cels.push(
      { layerId: "layer-outline", frameIndex, data: outline.data },
      { layerId: "layer-shading", frameIndex, data: shading.data },
      { layerId: "layer-base", frameIndex, data: base.data }
    );
  }

  return {
    id: "gem",
    label: "Gem idle (4 frames)",
    description: "32×32, 3 layers, 'idle' tag",
    documentName: "gem-idle.pixet",
    width,
    height,
    layers: LAYERS.map((l) => ({ ...l })),
    frames: [{ durationMs: 100 }, { durationMs: 100 }, { durationMs: 100 }, { durationMs: 100 }],
    tags: [{ name: "idle", fromFrame: 0, toFrame: 3, color: "#5b8cff" }],
    cels,
  };
}

// Default-palette colours used by the slime.
const SLIME_BASE = "#99e550";
const SLIME_SHADE = "#37946e";
const SLIME_OUTLINE = "#0f0f17";
const SLIME_HIGHLIGHT = "#f4f4f8";

interface SlimePose {
  /** Horizontal / vertical radius of the body ellipse in pixels. */
  rx: number;
  ry: number;
  /** Pixels the body bottom is lifted above the ground line. */
  lift: number;
  durationMs: number;
}

const GROUND_Y = 28; // exclusive bottom edge of a grounded slime

/** Squash-and-stretch hop: rest, anticipate, launch, apex, fall, land. */
const SLIME_POSES: SlimePose[] = [
  { rx: 9, ry: 7, lift: 0, durationMs: 400 },
  { rx: 11, ry: 5, lift: 0, durationMs: 120 },
  { rx: 7, ry: 10, lift: 4, durationMs: 80 },
  { rx: 8, ry: 8, lift: 9, durationMs: 140 },
  { rx: 7, ry: 9, lift: 4, durationMs: 80 },
  { rx: 12, ry: 4, lift: 0, durationMs: 120 },
];

/** A cute green slime: 32×32, 6-frame hop, 3 layers, idle + hop tags. */
export function generateSlimeSample(): SampleDocument {
  const width = 32;
  const height = 32;
  const cx = width / 2;
  const cels: SampleCel[] = [];

  SLIME_POSES.forEach((pose, frameIndex) => {
    const base = makeCel(width, height);
    const shading = makeCel(width, height);
    const outline = makeCel(width, height);
    const cy = GROUND_Y - pose.lift - pose.ry;

    const inside = (x: number, y: number): boolean => {
      const nx = (x + 0.5 - cx) / pose.rx;
      const ny = (y + 0.5 - cy) / pose.ry;
      return nx * nx + ny * ny <= 1;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!inside(x, y)) continue;
        const edge =
          !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        if (edge) {
          outline.set(x, y, SLIME_OUTLINE);
          continue;
        }
        base.set(x, y, SLIME_BASE);
        if (y > cy + pose.ry * 0.35 || x > cx + pose.rx * 0.45) {
          shading.set(x, y, SLIME_SHADE);
        }
      }
    }

    // Two highlight pixels and a pair of eyes, scaled with the pose.
    const hx = Math.round(cx - pose.rx * 0.5);
    const hy = Math.round(cy - pose.ry * 0.5);
    base.set(hx, hy, SLIME_HIGHLIGHT);
    base.set(hx + 1, hy, SLIME_HIGHLIGHT);
    base.set(hx, hy + 1, SLIME_HIGHLIGHT);

    const eyeY = Math.round(cy - pose.ry * 0.1);
    const eyeGap = Math.max(2, Math.round(pose.rx * 0.35));
    const eyeH = pose.ry >= 6 ? 2 : 1;
    for (let k = 0; k < eyeH; k++) {
      outline.set(Math.round(cx) - eyeGap - 1, eyeY + k, SLIME_OUTLINE);
      outline.set(Math.round(cx) + eyeGap, eyeY + k, SLIME_OUTLINE);
    }

    cels.push(
      { layerId: "layer-outline", frameIndex, data: outline.data },
      { layerId: "layer-shading", frameIndex, data: shading.data },
      { layerId: "layer-base", frameIndex, data: base.data }
    );
  });

  return {
    id: "slime",
    label: "Slime hop (6 frames)",
    description: "32×32 character, squash-and-stretch hop, 3 layers",
    documentName: "slime-hop.pixet",
    width,
    height,
    layers: [
      { id: "layer-outline", name: "Outline", blendMode: "Normal" },
      { id: "layer-shading", name: "Shading", blendMode: "Normal" },
      { id: "layer-base", name: "Base", blendMode: "Normal" },
    ],
    frames: SLIME_POSES.map((p) => ({ durationMs: p.durationMs })),
    tags: [
      { name: "idle", fromFrame: 0, toFrame: 0, color: "#5b8cff" },
      { name: "hop", fromFrame: 1, toFrame: 5, color: "#99e550" },
    ],
    cels,
  };
}

export interface SampleEntry {
  id: string;
  label: string;
  description: string;
  generate: () => SampleDocument;
}

export const SAMPLES: SampleEntry[] = [
  {
    id: "gem",
    label: "Gem idle (4 frames)",
    description: "32×32, 3 layers, 'idle' tag",
    generate: () => generateGemSample(),
  },
  {
    id: "slime",
    label: "Slime hop (6 frames)",
    description: "32×32 character, squash-and-stretch hop, 3 layers",
    generate: () => generateSlimeSample(),
  },
];
