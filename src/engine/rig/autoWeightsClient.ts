import { PixelBuffer } from "../document/PixelBuffer.ts";
import { WorkerRpc } from "../workers/workerRpc.ts";
import {
  computeAutoWeightsV2,
  type AutoWeightBoneV2,
  type AutoWeightV2Options,
} from "./autoWeights.ts";
import type { AutoWeightJob } from "./autoWeightJob.ts";
import type { BoneWeights } from "./RigEngine.ts";

const rpc = new WorkerRpc<AutoWeightJob, BoneWeights>(
  () =>
    new Worker(new URL("./autoWeights.worker.ts", import.meta.url), {
      type: "module",
    })
);

/**
 * Same result as `computeAutoWeightsV2`, computed in a module worker when one
 * is available. Falls back to the synchronous solver (node tests, no Worker,
 * or a worker that failed to start).
 */
export async function computeAutoWeightsV2Async(
  src: PixelBuffer,
  bones: readonly AutoWeightBoneV2[],
  options: AutoWeightV2Options
): Promise<BoneWeights> {
  if (rpc.available) {
    try {
      // postMessage clones, so the live buffer and weights are untouched.
      return await rpc.call({
        width: src.width,
        height: src.height,
        data: src.data,
        bones: bones.map((b) => ({ ...b })),
        options,
      });
    } catch {
      // fall through to the synchronous path
    }
  }
  return computeAutoWeightsV2(src, bones, options);
}
