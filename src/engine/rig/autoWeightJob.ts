import { PixelBuffer } from "../document/PixelBuffer.ts";
import {
  computeAutoWeightsV2,
  type AutoWeightBoneV2,
  type AutoWeightV2Options,
} from "./autoWeights.ts";
import type { BoneWeights } from "./RigEngine.ts";

/** Structured-cloneable input of one auto-weight solve (also the worker message). */
export interface AutoWeightJob {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  bones: AutoWeightBoneV2[];
  options: AutoWeightV2Options;
}

/** The pure computation shared by the worker, the sync fallback and the tests. */
export function runAutoWeightJob(job: AutoWeightJob): BoneWeights {
  const src = new PixelBuffer(job.width, job.height, job.data);
  return computeAutoWeightsV2(src, job.bones, job.options);
}
