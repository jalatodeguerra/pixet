import assert from "node:assert/strict";
import test from "node:test";
import { PixelBuffer } from "../src/engine/document/PixelBuffer.ts";
import { computeAutoWeightsV2 } from "../src/engine/rig/autoWeights.ts";
import {
  heatmapRampColor,
  renderBoneInfluenceOverlay,
  RigState,
} from "../src/engine/rig/RigEngine.ts";
import {
  applyWeightGradient,
  floodFillWeights,
  mirrorBoneWeights,
  pruneWeights,
  quantizeWeights,
  transferBoneWeights,
} from "../src/engine/rig/weightTools.ts";
import {
  falloffAt,
  paintWeightBrush,
  paintWeightStroke,
  weightsAreHard,
} from "../src/engine/rig/skinning.ts";

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

test("W1: locked bone weight stays invariant under paintWeightBrush (add, subtract, smooth, sharpen)", () => {
  const locked = new Set(["b1"]);
  const weights = {
    width: 4,
    height: 4,
    entries: new Map<number, { boneId: string; w: number }[]>([
      [5, [{ boneId: "b1", w: 0.6 }, { boneId: "b2", w: 0.4 }]],
      [6, [{ boneId: "b1", w: 0.6 }, { boneId: "b3", w: 0.4 }]],
    ]),
  };

  paintWeightBrush(weights, "b1", {
    cx: 1,
    cy: 1,
    radius: 2,
    strength: 0.8,
    mode: "add",
    falloff: "linear",
    lockedBoneIds: locked,
  });
  assert.ok(Math.abs(weightFor(weights.entries.get(5), "b1") - 0.6) < 1e-5);

  paintWeightBrush(weights, "b2", {
    cx: 1,
    cy: 1,
    radius: 2,
    strength: 1,
    mode: "add",
    falloff: "hard",
    lockedBoneIds: locked,
  });
  assert.ok(Math.abs(weightFor(weights.entries.get(5), "b1") - 0.6) < 1e-5);
  assert.ok(Math.abs(weightFor(weights.entries.get(5), "b2") - 0.4) < 1e-5);

  paintWeightBrush(weights, "b2", {
    cx: 1,
    cy: 1,
    radius: 2,
    strength: 0.5,
    mode: "sharpen",
    falloff: "hard",
    lockedBoneIds: locked,
  });
  assert.ok(Math.abs(weightFor(weights.entries.get(5), "b1") - 0.6) < 1e-5);
});

test("W1: sharpen increases dominant unlocked bone share and scale adjusts target weight", () => {
  const weights = {
    width: 3,
    height: 3,
    entries: new Map<number, { boneId: string; w: number }[]>([
      [4, [{ boneId: "b1", w: 0.7 }, { boneId: "b2", w: 0.3 }]],
    ]),
  };

  paintWeightBrush(weights, "b1", {
    cx: 1,
    cy: 1,
    radius: 1,
    strength: 0.8,
    mode: "sharpen",
    falloff: "hard",
  });
  assert.ok(weightFor(weights.entries.get(4), "b1") > 0.7);
  assert.ok(weightFor(weights.entries.get(4), "b2") < 0.3);

  paintWeightBrush(weights, "b1", {
    cx: 1,
    cy: 1,
    radius: 1,
    strength: 0.25, // < 0.5 scales down
    mode: "scale",
    falloff: "hard",
  });
  const scaled = weights.entries.get(4)!;
  const sum = scaled.reduce((a, b) => a + b.w, 0);
  assert.ok(Math.abs(sum - 1) < 1e-5);
  assert.ok(weightFor(scaled, "b1") < 0.7);
});

test("W1: smoothstep and gaussian falloff curves at d=0, d=r/2, d=r", () => {
  assert.equal(falloffAt(0, 4, "smoothstep"), 1);
  assert.ok(Math.abs(falloffAt(2, 4, "smoothstep") - 0.5) < 1e-6);
  assert.equal(falloffAt(4, 4, "smoothstep"), 0);

  assert.equal(falloffAt(0, 4, "gaussian"), 1);
  assert.ok(Math.abs(falloffAt(2, 4, "gaussian") - Math.exp(-0.75)) < 1e-6);
  assert.ok(Math.abs(falloffAt(4, 4, "gaussian") - Math.exp(-3.0)) < 1e-6);
  assert.equal(falloffAt(4.1, 4, "gaussian"), 0);
});

test("W1: paintWeightStroke with per-stroke cap does not over-compound and respects selectionMask", () => {
  const weights = {
    width: 8,
    height: 4,
    entries: new Map<number, { boneId: string; w: number }[]>([
      [1 * 8 + 2, [{ boneId: "b2", w: 1 }]],
      [1 * 8 + 4, [{ boneId: "b2", w: 1 }]],
    ]),
  };
  const baseWeights = new Map(
    Array.from(weights.entries.entries()).map(([k, v]) => [k, v.map((i) => ({ ...i }))])
  );
  const visitedMax = new Map<number, number>();
  const selectionMask = {
    contains: (x: number, _y: number) => x <= 3,
  };

  paintWeightStroke(weights, "b1", 1, 1, 5, 1, {
    radius: 2,
    strength: 0.4,
    mode: "add",
    falloff: "hard",
    selectionMask,
    strokeVisitedMax: visitedMax,
    strokeBaseWeights: baseWeights,
  });

  // Inside selection mask (x=2): capped at 0 + 0.4 = 0.4 despite multiple overlapping dabs
  assert.ok(Math.abs(weightFor(weights.entries.get(1 * 8 + 2), "b1") - 0.4) < 1e-5);
  // Outside selection mask (x=4): untouched
  assert.equal(weightFor(weights.entries.get(1 * 8 + 4), "b1"), 0);
  assert.equal(weightFor(weights.entries.get(1 * 8 + 4), "b2"), 1);
});

test("W1: mapPosedPointToRest and renderBoneInfluenceOverlay follow bone deformation in animate mode", () => {
  const rig = new RigState();
  const bone = rig.addBone({
    name: "Arm",
    parentId: null,
    localX: 4,
    localY: 4,
    length: 6,
    rotationDeg: 0,
  });

  const entries = new Map<number, { boneId: string; w: number }[]>();
  for (let y = 3; y <= 5; y++) {
    for (let x = 4; x <= 10; x++) {
      entries.set(y * 16 + x, [{ boneId: bone.id, w: 1 }]);
    }
  }
  rig.setBoneWeights({ width: 16, height: 16, entries });

  // Rotate bone 90 degrees on frame 0 in active clip
  rig.setPoseOverride(bone.id, { rotationDeg: 90 }, 0);

  // Rest point (8, 4) is 4px along +X from joint (4, 4).
  // Under +90 deg rotation, it moves to (4, 8) (4px along +Y from joint (4, 4)).
  const restMapped = rig.mapPosedPointToRest(4, 8, 0, false);
  assert.ok(
    Math.hypot(restMapped.x - 8, restMapped.y - 4) < 1.2,
    `expected posed (4,8) to map near rest (8,4), got (${restMapped.x.toFixed(2)}, ${restMapped.y.toFixed(2)})`
  );

  // Deformed overlay in animate mode should place alpha > 0 at (4, 8) and 0 at (8, 4)
  const overlay = new PixelBuffer(16, 16);
  renderBoneInfluenceOverlay(rig, overlay, bone.id, {
    mode: "heatmap",
    rigMode: "animate",
    frame: 0,
    pixelSnap: false,
  });
  assert.ok(overlay.getPixel(4, 8)[3] > 0, "expected deformed overlay pixel at (4,8)");
  assert.equal(overlay.getPixel(8, 4)[3], 0, "expected rest-only pixel (8,4) to be empty after 90deg rotation");
});

test("W2: applyWeightGradient creates linear ramp from 1.0 to 0.0 and respects selectionMask", () => {
  const buf = new PixelBuffer(8, 2);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 8; x++) {
      buf.setPixel(x, y, 200, 200, 200, 255);
    }
  }
  const weights = {
    width: 8,
    height: 2,
    entries: new Map<number, { boneId: string; w: number }[]>(),
  };
  for (let i = 0; i < 16; i++) {
    weights.entries.set(i, [{ boneId: "b2", w: 1 }]);
  }

  applyWeightGradient(weights, buf, "b1", 0.5, 0.5, 7.5, 0.5, {
    falloff: "linear",
    strength: 1,
    selectionMask: { contains: (x) => x <= 6 },
  });

  assert.ok(Math.abs(weightFor(weights.entries.get(0), "b1") - 1) < 1e-4);
  assert.ok(weightFor(weights.entries.get(3), "b1") > weightFor(weights.entries.get(5), "b1"));
  // Pixel x=7 outside selectionMask remains untouched
  assert.equal(weightFor(weights.entries.get(7), "b1"), 0);
  assert.equal(weightFor(weights.entries.get(7), "b2"), 1);
});

test("W2: floodFillWeights fills contiguous same-color region without leaking across different colors", () => {
  const buf = new PixelBuffer(6, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 6; x++) {
      if (x <= 2) buf.setPixel(x, y, 255, 0, 0, 255);
      else buf.setPixel(x, y, 0, 255, 0, 255);
    }
  }
  const weights = {
    width: 6,
    height: 4,
    entries: new Map<number, { boneId: string; w: number }[]>(),
  };
  for (let i = 0; i < 24; i++) {
    weights.entries.set(i, [{ boneId: "b2", w: 1 }]);
  }

  floodFillWeights(weights, buf, "b1", 1, 1, 1.0, {
    colorTolerance: 0,
    contiguous: true,
  });

  assert.equal(weightFor(weights.entries.get(1 * 6 + 0), "b1"), 1);
  assert.equal(weightFor(weights.entries.get(2 * 6 + 2), "b1"), 1);
  assert.equal(weightFor(weights.entries.get(1 * 6 + 3), "b1"), 0);
  assert.equal(weightFor(weights.entries.get(1 * 6 + 3), "b2"), 1);
});

test("W2: mirrorBoneWeights swaps Arm_L and Arm_R across axisX", () => {
  const bones = [
    { id: "armL", name: "Arm_L" },
    { id: "armR", name: "Arm_R" },
  ];
  const weights = {
    width: 6,
    height: 2,
    entries: new Map<number, { boneId: string; w: number }[]>([
      [1, [{ boneId: "armL", w: 1 }]],
    ]),
  };

  mirrorBoneWeights(weights, bones, "LtoR", 3);
  assert.equal(weightFor(weights.entries.get(4), "armR"), 1);
  assert.equal(weightFor(weights.entries.get(4), "armL"), 0);
});

test("W2: quantizeWeights(1.0), pruneWeights, and transferBoneWeights", () => {
  const weights = {
    width: 4,
    height: 2,
    entries: new Map<number, { boneId: string; w: number }[]>([
      [0, [{ boneId: "b1", w: 0.72 }, { boneId: "b2", w: 0.25 }, { boneId: "b3", w: 0.03 }]],
    ]),
  };

  pruneWeights(weights, 0.05);
  assert.equal(weightFor(weights.entries.get(0), "b3"), 0);
  const prunedSum = weights.entries.get(0)!.reduce((a, b) => a + b.w, 0);
  assert.ok(Math.abs(prunedSum - 1) < 1e-5);

  transferBoneWeights(weights, "b2", "b4");
  assert.equal(weightFor(weights.entries.get(0), "b2"), 0);
  assert.ok(weightFor(weights.entries.get(0), "b4") > 0.2);

  quantizeWeights(weights, 1.0);
  assert.equal(weightsAreHard(weights), true);
  assert.equal(weightFor(weights.entries.get(0), "b1"), 1);
});

test("W2: unweighted overlay highlights under-weighted opaque pixels and heatmapRampColor endpoints", () => {
  assert.deepEqual(heatmapRampColor(0), [29, 78, 216]);
  assert.deepEqual(heatmapRampColor(1), [239, 68, 68]);

  const rig = new RigState();
  const bone = rig.addBone({
    name: "Root",
    parentId: null,
    localX: 1,
    localY: 1,
    length: 2,
    rotationDeg: 0,
  });
  rig.setBoneWeights({
    width: 4,
    height: 2,
    entries: new Map([[0, [{ boneId: bone.id, w: 1 }]]]),
  });

  const src = new PixelBuffer(4, 2);
  src.setPixel(0, 0, 255, 255, 255, 255); // weighted
  src.setPixel(1, 0, 255, 255, 255, 255); // unweighted opaque

  const overlay = new PixelBuffer(4, 2);
  renderBoneInfluenceOverlay(rig, overlay, bone.id, {
    mode: "unweighted",
    sourceAlpha: src.data,
  });

  assert.equal(overlay.getPixel(0, 0)[3], 0);
  assert.deepEqual(overlay.getPixel(1, 0), [255, 46, 151, 210]);
  assert.equal(overlay.getPixel(2, 0)[3], 0);
});
