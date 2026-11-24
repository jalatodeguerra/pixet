import test from "node:test";
import assert from "node:assert/strict";
import {
  RigState,
  warpLayerByBone,
  warpLayerByBone3D,
  type RigOrbit3D,
  type RigRenderOptions,
} from "../src/engine/rig/RigEngine.ts";
import {
  applyPose,
  capturePose,
  copyKeyframes,
  pasteKeyframes,
  pasteMirroredPose,
} from "../src/engine/rig/animationTools.ts";
import { PixelBuffer } from "../src/engine/document/PixelBuffer.ts";
import {
  PixelEngine,
  type LayerCompositingInfo,
} from "../src/engine/document/PixelEngine.ts";

function assertClose(actual: number, expected: number, eps = 1e-5, msg?: string): void {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    msg ?? `Expected ${actual} to be within ${eps} of ${expected}`
  );
}

test("R3D-3: pure 2D fast path matches exact 2D FK math with z=0 and facingZ=1", () => {
  const rig = new RigState();
  const root = rig.addBone({
    name: "Root",
    parentId: null,
    localX: 10,
    localY: 20,
    length: 12,
    rotationDeg: 30,
    scaleX: 1.5,
    scaleY: 0.5,
  });
  const child = rig.addBone({
    name: "Child",
    parentId: root.id,
    localX: 8,
    localY: 4,
    length: 6,
    rotationDeg: -45,
    scaleX: 2,
    scaleY: 1,
  });

  const transforms = rig.computeWorldTransforms(0, "pose", false);
  const rt = transforms.get(root.id);
  const ct = transforms.get(child.id);
  assert.ok(rt && ct);

  const rRad = (30 * Math.PI) / 180;
  const expectedRootTipX = 10 + Math.cos(rRad) * 12 * 1.5;
  const expectedRootTipY = 20 + Math.sin(rRad) * 12 * 1.5;

  assert.equal(rt.x, 10);
  assert.equal(rt.y, 20);
  assert.equal(rt.z, 0);
  assert.equal(rt.tipX, expectedRootTipX);
  assert.equal(rt.tipY, expectedRootTipY);
  assert.equal(rt.tipZ, 0);
  assert.equal(rt.worldRotationDeg, 30);
  assert.equal(rt.worldYawDeg, 0);
  assert.equal(rt.worldPitchDeg, 0);
  assert.equal(rt.facingZ, 1);

  const sx = 8 * 1.5;
  const sy = 4 * 0.5;
  const expectedChildX = 10 + sx * Math.cos(rRad) - sy * Math.sin(rRad);
  const expectedChildY = 20 + sx * Math.sin(rRad) + sy * Math.cos(rRad);
  const cRad = (-15 * Math.PI) / 180;
  const expectedChildTipX = expectedChildX + Math.cos(cRad) * 6 * 3;
  const expectedChildTipY = expectedChildY + Math.sin(cRad) * 6 * 3;

  assert.equal(ct.x, expectedChildX);
  assert.equal(ct.y, expectedChildY);
  assert.equal(ct.z, 0);
  assert.equal(ct.tipX, expectedChildTipX);
  assert.equal(ct.tipY, expectedChildTipY);
  assert.equal(ct.tipZ, 0);
  assert.equal(ct.worldRotationDeg, -15);
  assert.equal(ct.worldYawDeg, 0);
  assert.equal(ct.worldPitchDeg, 0);
  assert.equal(ct.facingZ, 1);
  assert.equal(ct.worldScaleX, 3);
  assert.equal(ct.worldScaleY, 0.5);
});

test("R3D-3: 3D parent yaw rotates child (x, z) in a circle and flips facingZ at 180°", () => {
  const rig = new RigState();
  const root = rig.addBone({
    name: "Root",
    parentId: null,
    localX: 16,
    localY: 16,
    length: 10,
    rotationDeg: 0,
  });
  const child = rig.addBone({
    name: "Arm",
    parentId: root.id,
    localX: 10,
    localY: 0,
    length: 5,
    rotationDeg: 0,
  });

  // 90° yaw: +X rotates onto -Z
  rig.setPoseOverride(root.id, { yawDeg: 90 }, 0);
  const at90 = rig.computeWorldTransforms(0, "pose", true);
  const rt90 = at90.get(root.id);
  const ct90 = at90.get(child.id);
  assert.ok(rt90 && ct90);
  assertClose(rt90.worldYawDeg, 90);
  assertClose(rt90.facingZ, 0);
  assertClose(ct90.x, 16);
  assertClose(ct90.y, 16);
  assertClose(ct90.z, -10);
  assertClose(ct90.tipX, 16);
  assertClose(ct90.tipZ, -15);

  // 180° yaw: +X flips to -X, facingZ = -1 < 0
  rig.setPoseOverride(root.id, { yawDeg: 180 }, 0);
  const at180 = rig.computeWorldTransforms(0, "pose", true);
  const rt180 = at180.get(root.id);
  const ct180 = at180.get(child.id);
  assert.ok(rt180 && ct180);
  assert.ok(rt180.facingZ < 0);
  assertClose(rt180.facingZ, -1);
  assertClose(ct180.x, 6);
  assertClose(ct180.y, 16);
  assertClose(ct180.z, 0);
  assertClose(ct180.tipX, 1);
  assert.ok(ct180.facingZ < 0);
});

test("R3D-3: 3D parent pitch tilts child (y, z) properly", () => {
  const rig = new RigState();
  const root = rig.addBone({
    name: "Torso",
    parentId: null,
    localX: 20,
    localY: 20,
    length: 10,
    rotationDeg: 0,
  });
  const child = rig.addBone({
    name: "Head",
    parentId: root.id,
    localX: 0,
    localY: 10,
    length: 6,
    rotationDeg: 0,
    localZ: 0,
  });

  // 90° pitch around X: +Y rotates onto +Z
  rig.setPoseOverride(root.id, { pitchDeg: 90 }, 0);
  const at90 = rig.computeWorldTransforms(0, "pose", true);
  const ct90 = at90.get(child.id);
  assert.ok(ct90);
  assertClose(ct90.x, 20);
  assertClose(ct90.y, 20);
  assertClose(ct90.z, 10);
  assertClose(ct90.worldPitchDeg, 90);
  assertClose(ct90.facingZ, 0);

  // 45° pitch: y = 20 + 10*cos(45°), z = 10*sin(45°)
  rig.setPoseOverride(root.id, { pitchDeg: 45 }, 0);
  const at45 = rig.computeWorldTransforms(0, "pose", true);
  const ct45 = at45.get(child.id);
  assert.ok(ct45);
  const s = 10 * Math.SQRT1_2;
  assertClose(ct45.y, 20 + s);
  assertClose(ct45.z, s);
  assertClose(ct45.facingZ, Math.SQRT1_2);
});

test("R3D-3: keyframe interpolation, shortest-arc wraparound, easing, and autoKeyBone for 3D channels", () => {
  const rig = new RigState();
  const bone = rig.addBone({
    name: "Root",
    parentId: null,
    localX: 0,
    localY: 0,
    length: 10,
    rotationDeg: 0,
  });

  // Keyframe 0 -> 4 with linear shortest-arc wraparound (170° -> -170° crosses 180°)
  rig.setPoseOverride(bone.id, { yawDeg: 170, pitchDeg: -20, localZ: 0 }, 0);
  rig.setKeyframe(bone.id, 0, "linear");
  rig.setPoseOverride(bone.id, { yawDeg: -170, pitchDeg: 20, localZ: 12 }, 4);
  rig.setKeyframe(bone.id, 4, "linear");
  rig.clearPoseOverrides();

  const mid = rig.getBonePoseAtFrame(bone.id, 2, false);
  assertClose(Math.abs(mid.yawDeg), 180);
  assertClose(mid.pitchDeg, 0);
  assertClose(mid.localZ, 6);

  // EaseInOut on frame 4 -> 8
  rig.setPoseOverride(bone.id, { yawDeg: 0, pitchDeg: 0, localZ: 0 }, 4);
  rig.setKeyframe(bone.id, 4, "easeInOut");
  rig.setPoseOverride(bone.id, { yawDeg: 80, pitchDeg: 40, localZ: 16 }, 8);
  rig.setKeyframe(bone.id, 8, "linear");
  rig.clearPoseOverrides();

  // At t = 0.25, easeInOut = 0.25^2 * (3 - 0.5) = 0.15625
  const q1 = rig.getBonePoseAtFrame(bone.id, 5, false);
  assertClose(q1.yawDeg, 80 * 0.15625);
  assertClose(q1.pitchDeg, 40 * 0.15625);
  assertClose(q1.localZ, 16 * 0.15625);

  // autoKeyBone preserves untouched channels
  rig.autoKeyBone(bone.id, 1, { yawDeg: 35 }, "linear");
  rig.autoKeyBone(bone.id, 1, { localZ: -4 }, "linear");
  const track = rig.getActiveClip().tracks[bone.id];
  const k1 = track.find((k) => k.frame === 1);
  assert.ok(k1);
  assert.equal(k1.yawDeg, 35);
  assert.equal(k1.localZ, -4);
  assert.equal(k1.pitchDeg, undefined);
});

test("R3D-3: capturePose, applyPose, copyKeyframes/pasteKeyframes, and pasteMirroredPose preserve 3D channels", () => {
  const rig = new RigState();
  const left = rig.addBone({
    name: "Arm_L",
    parentId: null,
    localX: 8,
    localY: 16,
    length: 10,
    rotationDeg: 20,
  });
  const right = rig.addBone({
    name: "Arm_R",
    parentId: null,
    localX: 24,
    localY: 16,
    length: 10,
    rotationDeg: 160,
  });

  rig.setPoseOverride(
    left.id,
    { rotationDeg: 30, yawDeg: 40, pitchDeg: -15, localZ: 5 },
    0
  );
  rig.setKeyframe(left.id, 0, "linear");

  const captured = capturePose(rig, "Action3D", 0, [left.id]);
  assert.equal(captured.bones[left.id].yawDeg, 40);
  assert.equal(captured.bones[left.id].pitchDeg, -15);
  assert.equal(captured.bones[left.id].localZ, 5);

  // Copy & paste keyframe preserves 3D channels
  const copied = copyKeyframes(rig.getActiveClip(), [{ boneId: left.id, frame: 0 }]);
  pasteKeyframes(rig.getActiveClip(), copied, 3);
  rig.clearPoseOverrides();
  const pastedPose = rig.getBonePoseAtFrame(left.id, 3, false);
  assert.equal(pastedPose.yawDeg, 40);
  assert.equal(pastedPose.pitchDeg, -15);
  assert.equal(pastedPose.localZ, 5);

  // applyPose with 50% blend interpolates 3D channels
  rig.setPoseOverride(left.id, { yawDeg: 0, pitchDeg: 5, localZ: 1 }, 0);
  applyPose(rig, captured, 0, 0.5, false);
  const blended = rig.getBonePoseAtFrame(left.id, 0, true);
  assertClose(blended.yawDeg, 20);
  assertClose(blended.pitchDeg, -5);
  assertClose(blended.localZ, 3);

  // pasteMirroredPose negates yawDeg while preserving pitchDeg and localZ
  pasteMirroredPose(rig, captured, 0, false);
  const mirrored = rig.getBonePoseAtFrame(right.id, 0, true);
  assertClose(mirrored.yawDeg, -40);
  assertClose(mirrored.pitchDeg, -15);
  assertClose(mirrored.localZ, 5);
});

test("R3D-3: toSnapshot/fromSnapshot round-trip, runtime JSON, and legacy v2 backward compatibility", () => {
  const rig = new RigState();
  const root = rig.addBone({
    name: "Torso",
    parentId: null,
    localX: 16,
    localY: 16,
    length: 12,
    rotationDeg: 0,
    yawDeg: 25,
    pitchDeg: -10,
    localZ: 3,
    extrudeDepth: 4,
    depthProfile: "pillow",
    backLayerId: "layer-back",
  });
  rig.setPoseOverride(root.id, { yawDeg: 60, pitchDeg: 15, localZ: -2 }, 2);
  rig.setKeyframe(root.id, 2, "easeOut");
  rig.addPose(capturePose(rig, "Turn", 2));

  const snap = rig.toSnapshot();
  const restored = new RigState();
  restored.fromSnapshot(JSON.parse(JSON.stringify(snap)));

  assert.equal(restored.bones[0].yawDeg, 25);
  assert.equal(restored.bones[0].pitchDeg, -10);
  assert.equal(restored.bones[0].localZ, 3);
  assert.equal(restored.bones[0].extrudeDepth, 4);
  assert.equal(restored.bones[0].depthProfile, "pillow");
  assert.equal(restored.bones[0].backLayerId, "layer-back");

  const restoredKeyPose = restored.getBonePoseAtFrame(root.id, 2, false);
  assert.equal(restoredKeyPose.yawDeg, 60);
  assert.equal(restoredKeyPose.pitchDeg, 15);
  assert.equal(restoredKeyPose.localZ, -2);
  assert.equal(restored.poses[0].bones[root.id].yawDeg, 60);

  // serializeRuntimeJson includes 3D fields
  const runtimeJson = JSON.parse(restored.serializeRuntimeJson(32, 32)) as {
    bones: Array<{ extrudeDepth?: number; depthProfile?: string; backLayerId?: string | null }>;
  };
  assert.equal(runtimeJson.bones[0].extrudeDepth, 4);
  assert.equal(runtimeJson.bones[0].depthProfile, "pillow");
  assert.equal(runtimeJson.bones[0].backLayerId, "layer-back");

  // Legacy v2 snapshot without any 3D fields loads cleanly with safe defaults
  const legacySnap = {
    version: 2,
    bones: [
      {
        id: "bone-1",
        name: "LegacyRoot",
        parentId: null,
        localX: 8,
        localY: 8,
        length: 10,
        rotationDeg: 45,
        boundLayerId: null,
      },
    ],
    clips: [
      {
        id: "clip-idle",
        name: "idle",
        frameCount: 4,
        tracks: {
          "bone-1": [{ frame: 0, rotationDeg: 45 }],
        },
      },
    ],
    activeClipId: "clip-idle",
    constraints: [],
    slots: [],
    poses: [],
    weights: null,
    masks: [],
    meshes: [],
  };

  const legacyRig = new RigState();
  legacyRig.fromSnapshot(legacySnap);
  assert.equal(legacyRig.bones[0].yawDeg, 0);
  assert.equal(legacyRig.bones[0].pitchDeg, 0);
  assert.equal(legacyRig.bones[0].localZ, 0);
  assert.equal(legacyRig.bones[0].extrudeDepth, 0);
  assert.equal(legacyRig.bones[0].depthProfile, "slab");
  assert.equal(legacyRig.bones[0].backLayerId, null);

  const legacyPose = legacyRig.getBonePoseAtFrame("bone-1", 0, false);
  assert.equal(legacyPose.yawDeg, 0);
  assert.equal(legacyPose.pitchDeg, 0);
  assert.equal(legacyPose.localZ, 0);

  const legacyWorld = legacyRig.computeWorldTransforms(0, "pose", false).get("bone-1");
  assert.ok(legacyWorld);
  assert.equal(legacyWorld.z, 0);
  assert.equal(legacyWorld.facingZ, 1);
});

test("R3D-3: virtual orbit rotates entire skeleton around origin without mutating state", () => {
  const rig = new RigState();
  const root = rig.addBone({
    name: "Root",
    parentId: null,
    localX: 26,
    localY: 16,
    length: 6,
    rotationDeg: 0,
  });

  const baseline = rig.computeWorldTransforms(0, "pose", false).get(root.id);
  assert.ok(baseline);
  assert.equal(baseline.x, 26);
  assert.equal(baseline.z, 0);
  assert.equal(baseline.facingZ, 1);

  const orbit: RigOrbit3D = {
    yawDeg: 90,
    pitchDeg: 0,
    rollDeg: 0,
    originX: 16,
    originY: 16,
  };

  // Root is +10px in X from orbit origin (16, 16); 90° yaw moves it to (16, 16, -10)
  const orbitedPose = rig.evaluate(0, { orbit }).get(root.id);
  assert.ok(orbitedPose);
  assertClose(orbitedPose.x, 16);
  assertClose(orbitedPose.y, 16);
  assertClose(orbitedPose.z, -10);
  assertClose(orbitedPose.tipX, 16);
  assertClose(orbitedPose.tipZ, -16);
  assertClose(orbitedPose.worldYawDeg, 90);
  assertClose(orbitedPose.facingZ, 0);

  // Also works in rest mode via computeWorldTransforms
  const orbitedRest = rig.computeWorldTransforms(0, "rest", false, orbit).get(root.id);
  assert.ok(orbitedRest);
  assertClose(orbitedRest.x, 16);
  assertClose(orbitedRest.z, -10);

  // Original bone state and subsequent non-orbit evaluation are completely unaffected
  assert.equal(rig.bones[0].yawDeg ?? 0, 0);
  const after = rig.computeWorldTransforms(0, "pose", false).get(root.id);
  assert.ok(after);
  assert.equal(after.x, 26);
  assert.equal(after.y, 16);
  assert.equal(after.z, 0);
  assert.equal(after.facingZ, 1);
});

function fillRect(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: [number, number, number, number]
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      buf.setPixel(x, y, rgba[0], rgba[1], rgba[2], rgba[3]);
    }
  }
}

function getPixelRgba(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number
): [number, number, number, number] {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

function measureOpaqueSpanX(buf: PixelBuffer): number {
  let minX = buf.width;
  let maxX = -1;
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      if (buf.data[(y * buf.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  return maxX >= minX ? maxX - minX + 1 : 0;
}

test("R3D-4: warpLayerByBone3D flat 2D fast path matches warpLayerByBone bit-for-bit", () => {
  const rig = new RigState();
  const bone = rig.addBone({
    name: "Arm",
    parentId: null,
    localX: 16,
    localY: 16,
    length: 8,
    rotationDeg: 0,
  });

  const src = new PixelBuffer(32, 32);
  fillRect(src, 12, 12, 20, 20, [220, 60, 40, 255]);

  rig.setPoseOverride(bone.id, { localX: 19, localY: 14, rotationDeg: 35 }, 0);
  const rest = rig.computeWorldTransforms(0, "rest", false).get(bone.id)!;
  const posed = rig.computeWorldTransforms(0, "pose", true).get(bone.id)!;

  const opts: RigRenderOptions = { pixelSnap: true, rotSprite: false };
  const out2d = warpLayerByBone(src, rest, posed, opts);
  const out3d = warpLayerByBone3D(src, rest, posed, opts, {
    extrudeDepth: 0,
    depthProfile: "slab",
    backSource: null,
  });

  assert.deepEqual(out3d.data, out2d.data);
});

test("R3D-4: warpLayerByBone3D foreshortens on yaw and renders backSource when rotated 180°", () => {
  const rig = new RigState();
  const bone = rig.addBone({
    name: "Shield",
    parentId: null,
    localX: 16,
    localY: 16,
    length: 8,
    rotationDeg: 0,
  });

  const front = new PixelBuffer(32, 32);
  fillRect(front, 8, 10, 24, 22, [240, 40, 40, 255]);

  const back = new PixelBuffer(32, 32);
  fillRect(back, 8, 10, 24, 22, [40, 90, 240, 255]);

  const rest = rig.computeWorldTransforms(0, "rest", false).get(bone.id)!;
  const opts: RigRenderOptions = { pixelSnap: true, rotSprite: false, perspective3d: 0 };

  // 60° yaw foreshortens horizontal span roughly by cos(60°) = 0.5
  rig.setPoseOverride(bone.id, { yawDeg: 60 }, 0);
  const posed60 = rig.computeWorldTransforms(0, "pose", true).get(bone.id)!;
  const warped60 = warpLayerByBone3D(front, rest, posed60, opts, {
    extrudeDepth: 0,
    backSource: back,
  });
  const baseWidth = measureOpaqueSpanX(front);
  const yawWidth = measureOpaqueSpanX(warped60);
  assert.ok(
    yawWidth > 0 && yawWidth < baseWidth - 4,
    `Expected foreshortened width (${yawWidth}) to be much smaller than original (${baseWidth})`
  );

  // 180° yaw flips facingZ < 0 and displays backSource color (blue) at center
  rig.setPoseOverride(bone.id, { yawDeg: 180 }, 0);
  const posed180 = rig.computeWorldTransforms(0, "pose", true).get(bone.id)!;
  assert.ok(posed180.facingZ < 0);
  const warped180 = warpLayerByBone3D(front, rest, posed180, opts, {
    extrudeDepth: 0,
    backSource: back,
  });
  const centerPx = getPixelRgba(warped180.data, 32, 16, 16);
  assert.equal(centerPx[3], 255);
  assert.ok(centerPx[2] > 200 && centerPx[0] < 80, `Expected blue backSource pixel, got [${centerPx.join(",")}]`);
});

test("R3D-4: compositeRigFrame dynamic Z-sorting swaps overlapping bound bone layers and respects backLayerId", () => {
  const engine = new PixelEngine(32, 32);
  const layerFront = "layer-front";
  const layerBack = "layer-back";
  const layerCardBack = "layer-card-back";

  const celRed = engine.getOrCreateCel(layerFront, 0);
  fillRect(celRed, 12, 12, 20, 20, [255, 0, 0, 255]);

  const celBlue = engine.getOrCreateCel(layerBack, 0);
  fillRect(celBlue, 12, 12, 20, 20, [0, 0, 255, 255]);

  const celGreen = engine.getOrCreateCel(layerCardBack, 0);
  fillRect(celGreen, 12, 12, 20, 20, [0, 220, 0, 255]);

  // In layers[], index 0 is top of layer stack (drawn last in 2D)
  const layers: LayerCompositingInfo[] = [
    { id: layerFront, kind: "raster", visible: true, opacity: 100, blendMode: "Normal" },
    { id: layerBack, kind: "raster", visible: true, opacity: 100, blendMode: "Normal" },
    { id: layerCardBack, kind: "raster", visible: false, opacity: 100, blendMode: "Normal" },
  ];

  const boneRed = engine.rig.addBone({
    name: "RedBone",
    parentId: null,
    localX: 16,
    localY: 16,
    length: 4,
    rotationDeg: 0,
    boundLayerId: layerFront,
    localZ: 5,
    backLayerId: layerCardBack,
  });
  const boneBlue = engine.rig.addBone({
    name: "BlueBone",
    parentId: null,
    localX: 16,
    localY: 16,
    length: 4,
    rotationDeg: 0,
    boundLayerId: layerBack,
    localZ: -5,
  });

  const opts: RigRenderOptions = { pixelSnap: true, rotSprite: false, autoZSort: true };

  // Red at z=+5 is closer than Blue at z=-5 -> Red on top
  const out1 = engine.compositeRigFrame(layers, 0, opts);
  assert.deepEqual(getPixelRgba(out1, 32, 16, 16), [255, 0, 0, 255]);

  // Move Blue in front (z=+10) and Red behind (z=-10) -> Blue swaps on top!
  engine.rig.setPoseOverride(boneRed.id, { localZ: -10 }, 0);
  engine.rig.setPoseOverride(boneBlue.id, { localZ: 10 }, 0);
  const out2 = engine.compositeRigFrame(layers, 0, opts);
  assert.deepEqual(getPixelRgba(out2, 32, 16, 16), [0, 0, 255, 255]);

  // Disabling autoZSort restores original layer stack order (Red on top)
  const outNoSort = engine.compositeRigFrame(layers, 0, { ...opts, autoZSort: false });
  assert.deepEqual(getPixelRgba(outNoSort, 32, 16, 16), [255, 0, 0, 255]);

  // Flip Red bone 180° yaw while keeping it in front -> green backLayerId renders on top
  engine.rig.setPoseOverride(boneRed.id, { localZ: 10, yawDeg: 180 }, 0);
  engine.rig.setPoseOverride(boneBlue.id, { localZ: -10 }, 0);
  const outFlipped = engine.compositeRigFrame(layers, 0, { ...opts, perspective3d: 0 });
  const pxFlipped = getPixelRgba(outFlipped, 32, 16, 16);
  assert.equal(pxFlipped[3], 255);
  assert.ok(pxFlipped[1] > 180 && pxFlipped[0] < 50 && pxFlipped[2] < 50, `Expected green backLayerId, got [${pxFlipped.join(",")}]`);
});

test("R3D-4: compositeRigFrame with rootOrbit swaps depth order at 180° yaw without mutating rig state", () => {
  const engine = new PixelEngine(32, 32);
  const layerA = "limb-a";
  const layerB = "limb-b";

  // Both limbs overlap at (16, 16) in screen space, separated in Z
  fillRect(engine.getOrCreateCel(layerA, 0), 13, 13, 19, 19, [255, 40, 40, 255]);
  fillRect(engine.getOrCreateCel(layerB, 0), 13, 13, 19, 19, [40, 80, 255, 255]);

  const layers: LayerCompositingInfo[] = [
    { id: layerA, kind: "raster", visible: true, opacity: 100, blendMode: "Normal" },
    { id: layerB, kind: "raster", visible: true, opacity: 100, blendMode: "Normal" },
  ];

  const root = engine.rig.addBone({
    name: "Torso",
    parentId: null,
    localX: 16,
    localY: 16,
    length: 4,
    rotationDeg: 0,
  });
  engine.rig.addBone({
    name: "LimbA",
    parentId: root.id,
    localX: 0,
    localY: 0,
    length: 4,
    rotationDeg: 0,
    localZ: 6,
    boundLayerId: layerA,
  });
  engine.rig.addBone({
    name: "LimbB",
    parentId: root.id,
    localX: 0,
    localY: 0,
    length: 4,
    rotationDeg: 0,
    localZ: -6,
    boundLayerId: layerB,
  });

  // At 0° orbit: LimbA (z=+6, red) is on top
  const out0 = engine.compositeRigFrame(layers, 0, {
    pixelSnap: true,
    rotSprite: false,
    autoZSort: true,
    perspective3d: 0,
    rootOrbit: { yawDeg: 0, pitchDeg: 0, rollDeg: 0, originX: 16, originY: 16 },
  });
  const px0 = getPixelRgba(out0, 32, 16, 16);
  assert.ok(px0[0] > 200 && px0[2] < 80, `Expected red LimbA at 0° orbit, got [${px0.join(",")}]`);

  // At 180° yaw orbit: LimbB rotates to z=+6 and LimbA to z=-6 -> blue LimbB swaps on top!
  const out180 = engine.compositeRigFrame(layers, 0, {
    pixelSnap: true,
    rotSprite: false,
    autoZSort: true,
    perspective3d: 0,
    rootOrbit: { yawDeg: 180, pitchDeg: 0, rollDeg: 0, originX: 16, originY: 16 },
  });
  const px180 = getPixelRgba(out180, 32, 16, 16);
  assert.ok(px180[2] > 200 && px180[0] < 80, `Expected blue LimbB at 180° orbit, got [${px180.join(",")}]`);

  // Rig state must remain unmutated
  assert.equal(engine.rig.bones[0].yawDeg ?? 0, 0);
  const afterOrbit = engine.compositeRigFrame(layers, 0, {
    pixelSnap: true,
    rotSprite: false,
    autoZSort: true,
    perspective3d: 0,
  });
  const pxAfter = getPixelRgba(afterOrbit, 32, 16, 16);
  assert.ok(pxAfter[0] > 200 && pxAfter[2] < 80, `Expected red LimbA restored after orbit, got [${pxAfter.join(",")}]`);
});

test("R3D-4: pure 2D rig compositing (all z=0) preserves exact layer draw order", () => {
  const engine = new PixelEngine(32, 32);
  const layerTop = "layer-top";
  const layerBottom = "layer-bottom";

  fillRect(engine.getOrCreateCel(layerTop, 0), 10, 10, 22, 22, [240, 200, 20, 255]);
  fillRect(engine.getOrCreateCel(layerBottom, 0), 10, 10, 22, 22, [80, 40, 200, 255]);

  const layers: LayerCompositingInfo[] = [
    { id: layerTop, kind: "raster", visible: true, opacity: 100, blendMode: "Normal" },
    { id: layerBottom, kind: "raster", visible: true, opacity: 100, blendMode: "Normal" },
  ];

  const b1 = engine.rig.addBone({
    name: "TopBone",
    parentId: null,
    localX: 16,
    localY: 16,
    length: 6,
    rotationDeg: 0,
    boundLayerId: layerTop,
  });
  engine.rig.addBone({
    name: "BottomBone",
    parentId: null,
    localX: 16,
    localY: 16,
    length: 6,
    rotationDeg: 0,
    boundLayerId: layerBottom,
  });

  engine.rig.setPoseOverride(b1.id, { rotationDeg: 25 }, 0);

  const withAutoSort = new Uint8ClampedArray(
    engine.compositeRigFrame(layers, 0, { pixelSnap: true, rotSprite: false, autoZSort: true })
  );
  const withoutAutoSort = new Uint8ClampedArray(
    engine.compositeRigFrame(layers, 0, { pixelSnap: true, rotSprite: false, autoZSort: false })
  );

  assert.deepEqual(withAutoSort, withoutAutoSort);
  // Top layer (yellow) remains on top of bottom layer (purple)
  assert.deepEqual(getPixelRgba(withAutoSort, 32, 16, 16), [240, 200, 20, 255]);
});

