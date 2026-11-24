import test from "node:test";
import assert from "node:assert/strict";
import {
  RigState,
  type RigOrbit3D,
} from "../src/engine/rig/RigEngine.ts";
import {
  applyPose,
  capturePose,
  copyKeyframes,
  pasteKeyframes,
  pasteMirroredPose,
} from "../src/engine/rig/animationTools.ts";

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
