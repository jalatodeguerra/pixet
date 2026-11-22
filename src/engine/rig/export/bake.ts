import type {
  LayerCompositingInfo,
  PixelEngine,
} from "../../document/PixelEngine.ts";
import type { RigRenderOptions } from "../RigEngine.ts";

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

const BAKE_TAG_COLORS = [
  "#4c8bf5",
  "#eab308",
  "#2dd4bf",
  "#f43f5e",
  "#a855f7",
  "#22c55e",
];

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
