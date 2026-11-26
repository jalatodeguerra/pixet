import { PixelBuffer, type RGBA } from "../document/PixelBuffer.ts";
import { applyQuantizeToPalette, type QuantizeToPaletteOptions } from "./filters.ts";

/** Structured-cloneable input of one quantize run (also the worker message). */
export interface QuantizeJob {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  palette: RGBA[];
  dither: QuantizeToPaletteOptions["dither"];
  /** 1 = pixel may change, 0 = protected; null = no mask. */
  mask: Uint8Array | null;
}

export interface QuantizeResult {
  data: Uint8ClampedArray;
}

/** The pure computation shared by the worker, the sync fallback and the tests. */
export function runQuantizeJob(job: QuantizeJob): QuantizeResult {
  const src = new PixelBuffer(job.width, job.height, job.data);
  const flat = job.mask;
  const mask = flat
    ? { contains: (x: number, y: number) => flat[y * job.width + x] === 1 }
    : null;
  const out = applyQuantizeToPalette(
    src,
    { palette: job.palette, dither: job.dither },
    mask
  );
  return { data: out.data };
}
