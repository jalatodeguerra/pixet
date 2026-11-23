import assert from "node:assert/strict";
import test from "node:test";
import { PixelBuffer } from "../src/engine/document/PixelBuffer.ts";
import { computeAutoWeightsV2 } from "../src/engine/rig/autoWeights.ts";
import { RigState } from "../src/engine/rig/RigEngine.ts";
import { weightsAreHard } from "../src/engine/rig/skinning.ts";

function weightFor(
  infs: readonly { boneId: string; w: number }[] | undefined,
  boneId: string
): number {
  return infs?.find((i) => i.boneId === boneId)?.w ?? 0;
}

test("geodesic: two parallel legs separated by transparent gap do not bleed across gap", () => {
  const buf = new PixelBuffer(10, 8);
  // Left leg: x in [1..3], y in [1..6]
  for (let y = 1; y <= 6; y++) {
    for (let x = 1; x <= 3; x++) {
      buf.setPixel(x, y, 200, 120, 80, 255);
    }
  }
  // Transparent gap at x = 4..5
  // Right leg: x in [6..8], y in [1..6]
  for (let y = 1; y <= 6; y++) {
    for (let x = 6; x <= 8; x++) {
      buf.setPixel(x, y, 200, 120, 80, 255);
    }
  }

  const weights = computeAutoWeightsV2(
    buf,
    [
      { id: "left", x: 2.5, y: 1.5, tipX: 2.5, tipY: 6.5 },
      { id: "right", x: 7.5, y: 1.5, tipX: 7.5, tipY: 6.5 },
    ],
    { method: "geodesic", power: 2 }
  );

  const leftInner = weights.entries.get(3 * 10 + 3);
  const rightInner = weights.entries.get(3 * 10 + 6);
  assert.equal(weightFor(leftInner, "left"), 1);
  assert.equal(weightFor(leftInner, "right"), 0);
  assert.equal(weightFor(rightInner, "right"), 1);
  assert.equal(weightFor(rightInner, "left"), 0);
});

test("heat: weights normalize to 1 and decrease monotonically away from bone seeds", () => {
  const buf = new PixelBuffer(16, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 16; x++) {
      buf.setPixel(x, y, 180, 180, 180, 255);
    }
  }

  const weights = computeAutoWeightsV2(
    buf,
    [
      { id: "a", x: 1.5, y: 1.5, tipX: 1.5, tipY: 2.5 },
      { id: "b", x: 14.5, y: 1.5, tipX: 14.5, tipY: 2.5 },
    ],
    { method: "heat", heatIterations: 160, colorPenalty: 0 }
  );

  let prevWeightA = 1.01;
  for (let x = 1; x <= 14; x++) {
    const infs = weights.entries.get(1 * 16 + x);
    assert.ok(infs && infs.length > 0);
    const sum = infs.reduce((acc, i) => acc + i.w, 0);
    assert.ok(Math.abs(sum - 1) < 1e-4);
    const wA = weightFor(infs, "a");
    assert.ok(
      wA <= prevWeightA + 1e-4,
      `expected monotonic decrease at x=${x}: ${wA} <= ${prevWeightA}`
    );
    prevWeightA = wA;
  }
});

test("rigid: each connected opaque island gets 100% weight on 1 bone", () => {
  const buf = new PixelBuffer(12, 6);
  // Island 1: x in [1..3], y in [1..4]
  for (let y = 1; y <= 4; y++) {
    for (let x = 1; x <= 3; x++) {
      buf.setPixel(x, y, 255, 0, 0, 255);
    }
  }
  // Island 2: x in [8..10], y in [1..4]
  for (let y = 1; y <= 4; y++) {
    for (let x = 8; x <= 10; x++) {
      buf.setPixel(x, y, 0, 0, 255, 255);
    }
  }

  const weights = computeAutoWeightsV2(
    buf,
    [
      { id: "b1", x: 2, y: 1, tipX: 2, tipY: 4 },
      { id: "b2", x: 9, y: 1, tipX: 9, tipY: 4 },
    ],
    { method: "rigid" }
  );

  assert.equal(weightsAreHard(weights), true);
  assert.equal(weightFor(weights.entries.get(2 * 12 + 3), "b1"), 1);
  assert.equal(weightFor(weights.entries.get(2 * 12 + 8), "b2"), 1);
});

test("envelope: bone with small envelopeRadius does not affect pixels outside radius when another covers them", () => {
  const buf = new PixelBuffer(12, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 12; x++) {
      buf.setPixel(x, y, 220, 220, 220, 255);
    }
  }

  const weights = computeAutoWeightsV2(
    buf,
    [
      { id: "small", x: 1.5, y: 1.5, tipX: 1.5, tipY: 2.5, envelopeRadius: 2 },
      { id: "wide", x: 9.5, y: 1.5, tipX: 9.5, tipY: 2.5, envelopeRadius: 8 },
    ],
    { method: "envelope", power: 2 }
  );

  // Pixel at x=6 is distance 4.5 from 'small' (> 2) and distance 3.5 from 'wide' (<= 8)
  const mid = weights.entries.get(1 * 12 + 6);
  assert.equal(weightFor(mid, "small"), 0);
  assert.equal(weightFor(mid, "wide"), 1);
});

test("color-boundary affinity: colorPenalty > 0 keeps weight inside same-color region", () => {
  const buf = new PixelBuffer(10, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 10; x++) {
      // Left 4 cols are red, right 6 cols are blue; seam between x=3 and x=4
      if (x <= 3) buf.setPixel(x, y, 255, 0, 0, 255);
      else buf.setPixel(x, y, 0, 0, 255, 255);
    }
  }

  const weights = computeAutoWeightsV2(
    buf,
    [
      { id: "redBone", x: 2.5, y: 1.5, tipX: 2.5, tipY: 2.5 },
      { id: "blueBone", x: 6.5, y: 1.5, tipX: 6.5, tipY: 2.5 },
    ],
    { method: "geodesic", colorPenalty: 1.5, power: 2 }
  );

  // Pixel x=4 is 1.5px from redBone (across seam) and 2.5px from blueBone (same color)
  const blueEdge = weights.entries.get(1 * 10 + 4);
  assert.ok(
    weightFor(blueEdge, "blueBone") > weightFor(blueEdge, "redBone"),
    `expected blueBone > redBone across color seam, got ${JSON.stringify(blueEdge)}`
  );
});

test("locked-bone and selection-mask preservation via RigState.autoAssignBoneWeights", () => {
  const buf = new PixelBuffer(6, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 6; x++) {
      buf.setPixel(x, y, 255, 255, 255, 255);
    }
  }

  const rig = new RigState();
  const lockedBone = rig.addBone({
    name: "Locked",
    parentId: null,
    localX: 1,
    localY: 1,
    length: 2,
    rotationDeg: 90,
    weightLocked: true,
    envelopeRadius: 5,
  });
  const freeBone = rig.addBone({
    name: "Free",
    parentId: null,
    localX: 4,
    localY: 1,
    length: 2,
    rotationDeg: 90,
  });

  // Seed existing weights: pixel (0,0) = 100% Locked; pixel (5,0) = 100% Locked
  const initialEntries = new Map<number, { boneId: string; w: number }[]>();
  for (let i = 0; i < 6 * 4; i++) {
    initialEntries.set(i, [{ boneId: lockedBone.id, w: 1 }]);
  }
  rig.setBoneWeights({ width: 6, height: 4, entries: initialEntries });

  // Selection mask covers only x in [3..5]
  const sel = new Uint8Array(6 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 3; x < 6; x++) {
      sel[y * 6 + x] = 1;
    }
  }

  rig.autoAssignBoneWeights(buf, 0, {
    method: "geodesic",
    selectionMask: sel,
    respectLockedBones: true,
  });

  const after = rig.getBoneWeights()!;
  // Pixel (0,0) is outside selectionMask -> untouched
  assert.equal(weightFor(after.entries.get(0), lockedBone.id), 1);
  // Pixel (4,1) is inside selectionMask, AND lockedBone has 1.0 existing weight -> preserved!
  assert.equal(weightFor(after.entries.get(1 * 6 + 4), lockedBone.id), 1);

  // Now test with a pixel that only had freeBone weight
  const partialEntries = new Map<number, { boneId: string; w: number }[]>();
  partialEntries.set(0, [{ boneId: lockedBone.id, w: 0.4 }, { boneId: freeBone.id, w: 0.6 }]);
  partialEntries.set(1 * 6 + 4, [{ boneId: freeBone.id, w: 1 }]);
  rig.setBoneWeights({ width: 6, height: 4, entries: partialEntries });

  rig.autoAssignBoneWeights(buf, 0, {
    method: "geodesic",
    selectionMask: sel,
    respectLockedBones: true,
  });
  const afterPartial = rig.getBoneWeights()!;
  assert.equal(weightFor(afterPartial.entries.get(0), lockedBone.id), 0.4);
  assert.equal(weightFor(afterPartial.entries.get(1 * 6 + 4), freeBone.id), 1);

  // Verify snapshot round-trip preserves envelopeRadius and weightLocked
  const snap = rig.toSnapshot();
  const restored = new RigState();
  restored.fromSnapshot(snap);
  assert.equal(restored.bones[0].weightLocked, true);
  assert.equal(restored.bones[0].envelopeRadius, 5);
});
