import { PixelBuffer, type RGBA } from "../document/PixelBuffer.ts";
import type { QuantizeJob, QuantizeResult } from "./quantizeJob.ts";
import { WorkerRpc } from "../workers/workerRpc.ts";
import {
  applyQuantizeToPalette,
  type PixelMask,
  type QuantizeToPaletteOptions,
} from "./filters.ts";

/**
 * Nearest-colour search costs about pixels x palette entries; below this the
 * worker round trip is not worth it and the sync path is used.
 */
export const QUANTIZE_WORKER_MIN_WORK = 4_000_000;

const rpc = new WorkerRpc<QuantizeJob, QuantizeResult>(
  () =>
    new Worker(new URL("./quantize.worker.ts", import.meta.url), {
      type: "module",
    })
);

export function shouldQuantizeOffThread(
  buf: Pick<PixelBuffer, "width" | "height">,
  palette: readonly RGBA[]
): boolean {
  return (
    rpc.available &&
    buf.width * buf.height * palette.length >= QUANTIZE_WORKER_MIN_WORK
  );
}

function flattenMask(
  mask: PixelMask,
  width: number,
  height: number
): Uint8Array | null {
  if (!mask) return null;
  const flat = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask.contains(x, y)) flat[y * width + x] = 1;
    }
  }
  return flat;
}

/**
 * Same result as `applyQuantizeToPalette`, computed in a worker for large
 * buffers and falling back to the synchronous filter otherwise.
 */
export async function applyQuantizeToPaletteAsync(
  buf: PixelBuffer,
  opts: QuantizeToPaletteOptions,
  mask?: PixelMask
): Promise<PixelBuffer> {
  if (shouldQuantizeOffThread(buf, opts.palette)) {
    try {
      const res = await rpc.call({
        width: buf.width,
        height: buf.height,
        data: buf.data,
        palette: opts.palette.map((c): RGBA => [c[0], c[1], c[2], c[3]]),
        dither: opts.dither,
        mask: flattenMask(mask, buf.width, buf.height),
      });
      const out = new PixelBuffer(buf.width, buf.height, res.data);
      out.markAllDirty();
      return out;
    } catch {
      // fall through to the synchronous path
    }
  }
  return applyQuantizeToPalette(buf, opts, mask);
}
