// Shared export frame source. Composites flattened, visible-layer frames at
// document size using the same PixelEngine compositor the app uses for the
// canvas (compositeFrame). Not pure: depends on the engine singleton.

import { pixelEngine } from "../document/PixelEngine.ts";
import { useEditorStore } from "../../store/editorStore.ts";
import { buildFrameSequence } from "./sequence.ts";

export interface ExportFrame {
  /** Document frame index this composite came from. */
  frameIndex: number;
  durationMs: number;
  /** Document-size RGBA, owned by the caller (copied out of the engine). */
  rgba: Uint8ClampedArray;
}

export interface ExportFrameSpec {
  /** Tag id to limit to (and whose direction to follow); null = all frames. */
  tagId: string | null;
  /** Apply tag direction (animated outputs). Spritesheets pass false. */
  applyDirection: boolean;
}

export interface ExportSource {
  width: number;
  height: number;
  frames: ExportFrame[];
}

const yieldTick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export async function collectExportFrames(
  spec: ExportFrameSpec,
  onProgress?: (done: number, total: number) => void
): Promise<ExportSource> {
  const state = useEditorStore.getState();
  const width = state.canvasWidth;
  const height = state.canvasHeight;
  const tag = spec.tagId
    ? state.tags.find((t) => t.id === spec.tagId) ?? null
    : null;

  let indices: number[];
  if (spec.applyDirection) {
    indices = buildFrameSequence(
      state.frames.length,
      tag
        ? { fromFrame: tag.fromFrame, toFrame: tag.toFrame, direction: tag.direction }
        : null
    );
  } else {
    indices = buildFrameSequence(
      state.frames.length,
      tag
        ? { fromFrame: tag.fromFrame, toFrame: tag.toFrame, direction: "forward" }
        : null
    );
  }

  const frames: ExportFrame[] = [];
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const rgba = new Uint8ClampedArray(
      pixelEngine.compositeFrame(state.layers, idx)
    );
    frames.push({
      frameIndex: idx,
      durationMs: state.frames[idx]?.durationMs ?? 100,
      rgba,
    });
    onProgress?.(i + 1, indices.length);
    await yieldTick();
  }
  return { width, height, frames };
}
