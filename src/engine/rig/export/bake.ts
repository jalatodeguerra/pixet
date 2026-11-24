import { PixelBuffer } from "../../document/PixelBuffer.ts";
import type {
  LayerCompositingInfo,
  PixelEngine,
} from "../../document/PixelEngine.ts";
import type { RigOrbit3D, RigRenderOptions } from "../RigEngine.ts";

export interface BakeTagInfo {
  name: string;
  fromFrame: number;
  toFrame: number;
  color: string;
}

export interface BakeClipsResult {
  frames: Uint8ClampedArray[];
  tags: BakeTagInfo[];
}

export type RigTurntableMode = "pose" | "multidir";

export interface RigTurntableOptions {
  mode: RigTurntableMode;
  directions: number;
  startYawDeg?: number;
  sweepDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  sourceFrame?: number;
  clipId?: string;
  renderOptions: RigRenderOptions;
  originX?: number;
  originY?: number;
}

export interface RigTurntableResult {
  frames: PixelBuffer[];
  tags: BakeTagInfo[];
}

const BAKE_TAG_COLORS = [
  "#4c8bf5",
  "#eab308",
  "#2dd4bf",
  "#f43f5e",
  "#a855f7",
  "#22c55e",
];

const DIR_LABELS_4 = ["S", "E", "N", "W"] as const;
const DIR_LABELS_8 = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"] as const;

function getDirectionLabel(index: number, total: number): string {
  if (total === 4) return DIR_LABELS_4[index] ?? `Dir_${index}`;
  if (total === 8) return DIR_LABELS_8[index] ?? `Dir_${index}`;
  return `Dir_${index}`;
}

/**
 * Renders one or more rig clips sequentially into RGBA buffers and returns
 * one `AnimationTag` range per baked clip. Restores `rig.activeClipId`
 * after baking.
 */
export function bakeRigClips(
  engine: PixelEngine,
  layers: readonly LayerCompositingInfo[],
  clipIds: readonly string[],
  opts: RigRenderOptions
): BakeClipsResult {
  const rig = engine.rig;
  const prevClipId = rig.activeClipId;
  const selectedClips =
    clipIds.length > 0
      ? rig.clips.filter((c) => clipIds.includes(c.id))
      : rig.clips;

  const frames: Uint8ClampedArray[] = [];
  const tags: BakeTagInfo[] = [];

  try {
    for (let i = 0; i < selectedClips.length; i++) {
      const clip = selectedClips[i];
      const count = Math.max(1, clip.frameCount);
      const fromFrame = frames.length;
      rig.setActiveClip(clip.id);

      for (let f = 0; f < count; f++) {
        const composited = engine.compositeRigFrame(
          layers,
          f,
          { ...opts, mode: "pose" },
          false
        );
        frames.push(new Uint8ClampedArray(composited));
      }

      tags.push({
        name: clip.name,
        fromFrame,
        toFrame: frames.length - 1,
        color: BAKE_TAG_COLORS[i % BAKE_TAG_COLORS.length],
      });
    }
  } finally {
    rig.setActiveClip(prevClipId);
  }

  return { frames, tags };
}

/**
 * Bakes a rigged character into a 3D turntable ("pose" mode) or a full
 * multi-direction animated spritesheet ("multidir" mode) using virtual
 * `rootOrbit` transforms without mutating bone state.
 */
export function bakeRigTurntable(
  engine: PixelEngine,
  layers: readonly LayerCompositingInfo[],
  opts: RigTurntableOptions
): RigTurntableResult {
  const directions = Math.max(2, Math.min(32, Math.round(opts.directions)));
  const startYawDeg = opts.startYawDeg ?? 0;
  const sweepDeg = opts.sweepDeg ?? 360;
  const pitchDeg = opts.pitchDeg ?? 0;
  const rollDeg = opts.rollDeg ?? 0;
  const originX = opts.originX ?? (engine.width - 1) / 2;
  const originY = opts.originY ?? (engine.height - 1) / 2;

  const frames: PixelBuffer[] = [];
  const tags: BakeTagInfo[] = [];

  if (opts.mode === "pose") {
    const sourceFrame = opts.sourceFrame ?? 0;
    for (let d = 0; d < directions; d++) {
      const yawDeg = startYawDeg + (sweepDeg * d) / directions;
      const rootOrbit: RigOrbit3D = {
        yawDeg,
        pitchDeg,
        rollDeg,
        originX,
        originY,
      };
      const composited = engine.compositeRigFrame(
        layers,
        sourceFrame,
        {
          ...opts.renderOptions,
          rootOrbit,
        },
        true
      );
      frames.push(new PixelBuffer(engine.width, engine.height, composited));
    }
    return { frames, tags };
  }

  const rig = engine.rig;
  const prevClipId = rig.activeClipId;
  const targetClip =
    (opts.clipId ? rig.clips.find((c) => c.id === opts.clipId) : undefined) ??
    rig.getActiveClip();

  try {
    rig.setActiveClip(targetClip.id);
    const clipFrameCount = Math.max(1, targetClip.frameCount);

    for (let d = 0; d < directions; d++) {
      const fromFrame = frames.length;
      const yawDeg = startYawDeg + (sweepDeg * d) / directions;
      const rootOrbit: RigOrbit3D = {
        yawDeg,
        pitchDeg,
        rollDeg,
        originX,
        originY,
      };

      for (let f = 0; f < clipFrameCount; f++) {
        const composited = engine.compositeRigFrame(
          layers,
          f,
          {
            ...opts.renderOptions,
            mode: "pose",
            rootOrbit,
          },
          false
        );
        frames.push(new PixelBuffer(engine.width, engine.height, composited));
      }

      const dirLabel = getDirectionLabel(d, directions);
      tags.push({
        name: `${targetClip.name}_${dirLabel}`,
        fromFrame,
        toFrame: frames.length - 1,
        color: BAKE_TAG_COLORS[d % BAKE_TAG_COLORS.length],
      });
    }
  } finally {
    rig.setActiveClip(prevClipId);
  }

  return { frames, tags };
}
