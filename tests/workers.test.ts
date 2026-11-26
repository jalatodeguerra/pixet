import assert from "node:assert/strict";
import test from "node:test";
import { PixelBuffer, type RGBA } from "../src/engine/document/PixelBuffer.ts";
import { computeAutoWeightsV2 } from "../src/engine/rig/autoWeights.ts";
import { runAutoWeightJob } from "../src/engine/rig/autoWeightJob.ts";
import { computeAutoWeightsV2Async } from "../src/engine/rig/autoWeightsClient.ts";
import { RigState } from "../src/engine/rig/RigEngine.ts";
import { applyQuantizeToPalette } from "../src/engine/tools/filters.ts";
import { runQuantizeJob } from "../src/engine/tools/quantizeJob.ts";
import {
  applyQuantizeToPaletteAsync,
  shouldQuantizeOffThread,
} from "../src/engine/tools/quantizeClient.ts";
import { workersSupported } from "../src/engine/workers/workerRpc.ts";

function noisyBuffer(n: number): PixelBuffer {
  const buf = new PixelBuffer(n, n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const cx = x - n / 2;
      const cy = y - n / 2;
      if (cx * cx + cy * cy < (n * 0.4) ** 2) {
        buf.setPixel(x, y, (rnd() * 255) | 0, (rnd() * 255) | 0, (rnd() * 255) | 0, 255);
      }
    }
  }
  return buf;
}

function sortedEntries(w: { entries: Map<number, { boneId: string; w: number }[]> }) {
  return [...w.entries.entries()].sort((a, b) => a[0] - b[0]);
}

const BONES = [0, 1, 2].map((i) => ({
  id: `b${i}`,
  x: 12,
  y: 4 + i * 8,
  tipX: 12,
  tipY: 10 + i * 8,
  weightLocked: i === 2,
}));

test("workers are not available under node, so the sync fallback runs", () => {
  assert.equal(workersSupported(), false);
});

test("auto-weight job (worker payload path) matches computeAutoWeightsV2 for every method", async () => {
  const buf = noisyBuffer(24);
  for (const method of ["geodesic", "heat", "envelope", "rigid", "euclidean"] as const) {
    const options = { method, power: 2, colorPenalty: 0.35 };
    const direct = computeAutoWeightsV2(buf, BONES, options);
    // Simulate the worker: structured clone the job, solve on the copy.
    const job = structuredClone({
      width: buf.width,
      height: buf.height,
      data: buf.data,
      bones: BONES,
      options: { ...options, existingWeights: null, targetBoneIds: new Set(["b0", "b1"]) },
    });
    const viaJob = runAutoWeightJob(job);
    const directTargets = computeAutoWeightsV2(buf, BONES, {
      ...options,
      targetBoneIds: new Set(["b0", "b1"]),
    });
    assert.deepEqual(sortedEntries(viaJob), sortedEntries(directTargets), method);
    const viaAsync = await computeAutoWeightsV2Async(buf, BONES, options);
    assert.deepEqual(sortedEntries(viaAsync), sortedEntries(direct), method);
  }
});

test("RigState build/apply auto-weight split equals autoAssignBoneWeights", () => {
  const buf = noisyBuffer(20);
  const make = () => {
    const rig = new RigState();
    rig.addBone({ name: "A", parentId: null, localX: 10, localY: 3, length: 6, rotationDeg: 90 });
    rig.addBone({ name: "B", parentId: null, localX: 10, localY: 10, length: 6, rotationDeg: 90 });
    return rig;
  };
  const a = make();
  a.autoAssignBoneWeights(buf, 0, { method: "geodesic" });
  const b = make();
  const job = b.buildAutoWeightJob(0, { method: "geodesic" });
  assert.ok(job);
  b.applyAutoWeights(computeAutoWeightsV2(buf, job.bones, job.options));
  const wa = a.getBoneWeights();
  const wb = b.getBoneWeights();
  assert.ok(wa && wb);
  assert.deepEqual(sortedEntries(wb), sortedEntries(wa));
});

const PALETTE: RGBA[] = Array.from({ length: 16 }, (_, i) => [
  (i * 53) % 256,
  (i * 97) % 256,
  (i * 193) % 256,
  255,
]);

test("quantize job (worker payload path) matches applyQuantizeToPalette, with and without mask", async () => {
  const buf = noisyBuffer(32);
  const maskFlat = new Uint8Array(32 * 32);
  for (let i = 0; i < maskFlat.length; i++) maskFlat[i] = i % 3 === 0 ? 1 : 0;
  const mask = { contains: (x: number, y: number) => maskFlat[y * 32 + x] === 1 };
  for (const dither of ["none", "bayer4", "floydSteinberg"] as const) {
    for (const useMask of [false, true]) {
      const expected = applyQuantizeToPalette(
        buf,
        { palette: PALETTE, dither },
        useMask ? mask : null
      );
      const viaJob = runQuantizeJob(
        structuredClone({
          width: 32,
          height: 32,
          data: buf.data,
          palette: PALETTE,
          dither,
          mask: useMask ? maskFlat : null,
        })
      );
      assert.deepEqual(viaJob.data, expected.data, `${dither} mask=${useMask}`);
      const viaAsync = await applyQuantizeToPaletteAsync(
        buf,
        { palette: PALETTE, dither },
        useMask ? mask : null
      );
      assert.deepEqual(viaAsync.data, expected.data, `async ${dither} mask=${useMask}`);
    }
  }
});

test("quantize is only offloaded when a worker exists and the job is big", () => {
  assert.equal(shouldQuantizeOffThread({ width: 4096, height: 4096 }, PALETTE), false);
});
