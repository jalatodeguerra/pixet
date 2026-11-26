import test from "node:test";
import assert from "node:assert/strict";

import {
  createModelClip,
  deleteModelKeyframe,
  evaluateModelEasing,
  evaluateNodePoseAtFrame,
  evaluateScalarChannel,
  evaluateScenePosesAtFrame,
  evaluateWorldNodeTransforms,
  getKeyframedFramesForNode,
  mirrorClipPoseAtFrameLR,
  recordNodeTransformKeyframes,
  upsertModelKeyframe,
} from "../src/engine/model3d/animEval.ts";
import { Model3DEngine } from "../src/engine/model3d/Model3DEngine.ts";
import { quatRotateVec3 } from "../src/engine/model3d/quatMath.ts";

function assertNear(actual: number, expected: number, eps = 1e-4, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg ? msg + ": " : ""}expected ${expected} ± ${eps}, got ${actual}`
  );
}

test("M6-A easing: linear, step, easeIn, easeOut, easeInOut, and bezier", () => {
  // Endpoints across all modes
  for (const mode of ["linear", "step", "easeIn", "easeOut", "easeInOut", "bezier"] as const) {
    assertNear(evaluateModelEasing(mode, 0), 0, 1e-6, `${mode}(0)`);
    assertNear(evaluateModelEasing(mode, 1), 1, 1e-6, `${mode}(1)`);
  }

  assertNear(evaluateModelEasing("linear", 0.25), 0.25);
  assertNear(evaluateModelEasing("step", 0.5), 0);
  assertNear(evaluateModelEasing("step", 0.999), 0);
  assertNear(evaluateModelEasing("easeIn", 0.5), 0.25);
  assertNear(evaluateModelEasing("easeOut", 0.5), 0.75);
  assertNear(evaluateModelEasing("easeInOut", 0.5), 0.5);
  assertNear(evaluateModelEasing("easeInOut", 0.25), 0.15625);

  // Linear bezier handles [0,0,1,1] should match identity
  assertNear(evaluateModelEasing("bezier", 0.37, [0, 0, 1, 1]), 0.37, 1e-5);
  // Steep ease-out bezier should be strictly above linear at t = 0.25
  const steep = evaluateModelEasing("bezier", 0.25, [0.1, 0.9, 0.2, 1]);
  assert.ok(steep > 0.5 && steep < 1, `expected > 0.5, got ${steep}`);
  // Overshoot bezier handles y > 1 supported cleanly
  const overshoot = evaluateModelEasing("bezier", 0.5, [0.2, 1.5, 0.8, 1.5]);
  assert.ok(overshoot > 1, `expected overshoot > 1, got ${overshoot}`);
});

test("M6-A clip & keyframe CRUD: upsert, delete, recordNodeTransformKeyframes, getKeyframedFramesForNode", () => {
  const engine = new Model3DEngine();
  const arm = engine.addNode({
    kind: "cuboid",
    name: "Arm",
    transform: {
      position: [2, 4, -1],
      rotation: [15, -30, 45],
      scale: [1, 1.5, 1],
      pivot: [4, 12, 0],
    },
  });

  let clip = createModelClip("Walk", 16, 12, true);
  assert.equal(clip.name, "Walk");
  assert.equal(clip.frameCount, 16);
  assert.equal(clip.fps, 12);
  assert.equal(clip.loop, true);
  assert.equal(clip.keyframes.length, 0);

  // Upsert sorts by frame and replaces matching (frame, nodeId, property)
  clip = upsertModelKeyframe(clip, {
    frame: 8,
    nodeId: arm.id,
    property: "posX",
    value: 10,
    easing: "easeInOut",
  });
  clip = upsertModelKeyframe(clip, {
    frame: 0,
    nodeId: arm.id,
    property: "posX",
    value: 0,
    easing: "linear",
  });
  clip = upsertModelKeyframe(clip, {
    frame: 8,
    nodeId: arm.id,
    property: "posX",
    value: 12,
    easing: "easeOut",
  });

  assert.equal(clip.keyframes.length, 2);
  assert.equal(clip.keyframes[0].frame, 0);
  assert.equal(clip.keyframes[1].frame, 8);
  assert.equal(clip.keyframes[1].value, 12);
  assert.equal(clip.keyframes[1].easing, "easeOut");

  // Record all 9 transform channels at frame 4
  clip = recordNodeTransformKeyframes(clip, arm, 4, "easeIn");
  assert.deepEqual(getKeyframedFramesForNode(clip, arm.id), [0, 4, 8]);
  assert.deepEqual(getKeyframedFramesForNode(clip), [0, 4, 8]);

  // Delete single property at frame 4
  clip = deleteModelKeyframe(clip, 4, arm.id, "rotY");
  assert.equal(
    clip.keyframes.some((k) => k.frame === 4 && k.nodeId === arm.id && k.property === "rotY"),
    false
  );
  assert.equal(
    clip.keyframes.some((k) => k.frame === 4 && k.nodeId === arm.id && k.property === "posY"),
    true
  );

  // Delete all properties for node at frame 4
  clip = deleteModelKeyframe(clip, 4, arm.id);
  assert.deepEqual(getKeyframedFramesForNode(clip, arm.id), [0, 8]);

  // Scalar channel evaluation
  assertNear(evaluateScalarChannel(clip.keyframes, arm.id, "posX", 4, 99), 6);
  assertNear(evaluateScalarChannel(clip.keyframes, arm.id, "posY", 4, 99), 99);
});

test("M6-A Quaternion SLERP pose evaluation: compound 90° rotations without gimbal collapse", () => {
  const engine = new Model3DEngine();
  const limb = engine.addNode({
    kind: "cuboid",
    name: "Limb",
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      pivot: [0, 10, 0],
    },
  });

  // Compound multi-axis rotation from [0, 0, 0] at frame 0 to [90, 90, 0] at frame 10
  // Note: pitch=90° is classic Euler gimbal lock where naive per-axis Euler lerping warps!
  let clip = createModelClip("CompoundSpin", 11, 10, false);
  for (const [prop, v0, v1] of [
    ["rotX", 0, 90],
    ["rotY", 0, 90],
    ["rotZ", 0, 0],
    ["posY", 0, 4],
  ] as const) {
    clip = upsertModelKeyframe(clip, {
      frame: 0,
      nodeId: limb.id,
      property: prop,
      value: v0,
      easing: "linear",
    });
    clip = upsertModelKeyframe(clip, {
      frame: 10,
      nodeId: limb.id,
      property: prop,
      value: v1,
      easing: "linear",
    });
  }

  const p0 = evaluateNodePoseAtFrame(limb, clip, 0);
  const pMid = evaluateNodePoseAtFrame(limb, clip, 5);
  const p10 = evaluateNodePoseAtFrame(limb, clip, 10);

  // Unit-norm quaternion check across all samples
  for (const pose of [p0, pMid, p10]) {
    const norm = Math.hypot(...pose.quaternion);
    assertNear(norm, 1, 1e-6, "quaternion unit norm");
  }

  assertNear(pMid.position[1], 2);

  // Verify geodesic midpoint: rotating [0, 0, 1] by p0 -> pMid -> p10 advances smoothly
  const dir0 = quatRotateVec3(p0.quaternion, [0, 0, 1]);
  const dirMid = quatRotateVec3(pMid.quaternion, [0, 0, 1]);
  const dir10 = quatRotateVec3(p10.quaternion, [0, 0, 1]);

  assertNear(dir0[0], 0);
  assertNear(dir0[1], 0);
  assertNear(dir0[2], 1);

  // Under XYZ Euler [90, 90, 0]: Rx(90)*Ry(90)*[0,0,1] = Rx(90)*[1,0,0] = [1,0,0]
  assertNear(dir10[0], 1, 1e-4);
  assertNear(dir10[1], 0, 1e-4);
  assertNear(dir10[2], 0, 1e-4);

  // Geodesic midpoint should have equal angle to start and end (dot(dir0, dirMid) == dot(dirMid, dir10))
  const dotStart = dir0[0] * dirMid[0] + dir0[1] * dirMid[1] + dir0[2] * dirMid[2];
  const dotEnd = dir10[0] * dirMid[0] + dir10[1] * dirMid[1] + dir10[2] * dirMid[2];
  assertNear(dotStart, dotEnd, 1e-4, "SLERP geodesic midpoint symmetry");

  // Scene pose map returns entry for every node
  const scenePoses = evaluateScenePosesAtFrame([limb], clip, 5);
  assert.equal(scenePoses.size, 1);
  assertNear(scenePoses.get(limb.id)!.position[1], 2);
});

test("M6-A hierarchical pivot world transforms: 3-bone Shoulder -> Elbow -> Hand chain", () => {
  const engine = new Model3DEngine();
  // Rest vertical chain going downward along -Y:
  // Shoulder pivot at [0, 20, 0], Elbow pivot at [0, 12, 0] (8px below Shoulder),
  // Hand pivot at [0, 6, 0] (6px below Elbow), fingertip local scene point at [0, 2, 0] (4px below Hand).
  const shoulder = engine.addGroup({
    name: "Shoulder",
    transform: { pivot: [0, 20, 0], rotation: [0, 0, 0] },
  });
  const elbow = engine.addGroup({
    name: "Elbow",
    parentId: shoulder.id,
    transform: { pivot: [0, 12, 0], rotation: [0, 0, 0] },
  });
  const hand = engine.addNode({
    kind: "cuboid",
    name: "Hand",
    parentId: elbow.id,
    transform: { pivot: [0, 6, 0], rotation: [0, 0, 0] },
  });

  // Rotate Shoulder +90° around Z (maps -Y -> +X!)
  // Rotate Elbow +90° around Z (total +180° around Z, maps local -Y -> +Y!)
  // Hand stays 0° local (so Hand world is +180° around Z)
  let clip = createModelClip("Reach", 4, 12, false);
  clip = upsertModelKeyframe(clip, {
    frame: 0,
    nodeId: shoulder.id,
    property: "rotZ",
    value: 90,
    easing: "linear",
  });
  clip = upsertModelKeyframe(clip, {
    frame: 0,
    nodeId: elbow.id,
    property: "rotZ",
    value: 90,
    easing: "linear",
  });

  const poses = evaluateScenePosesAtFrame(engine.nodes, clip, 0);
  const world = evaluateWorldNodeTransforms(engine.nodes, poses);

  const wShoulder = world.get(shoulder.id)!;
  const wElbow = world.get(elbow.id)!;
  const wHand = world.get(hand.id)!;

  // Shoulder pivot stays at [0, 20, 0]
  assertNear(wShoulder.worldPivot[0], 0);
  assertNear(wShoulder.worldPivot[1], 20);
  assertNear(wShoulder.worldPivot[2], 0);

  // Elbow offset from shoulder was [0, -8, 0]; rotated +90° Z => [+8, 0, 0] => world [8, 20, 0]
  assertNear(wElbow.worldPivot[0], 8);
  assertNear(wElbow.worldPivot[1], 20);
  assertNear(wElbow.worldPivot[2], 0);

  // Hand offset from elbow was [0, -6, 0]; rotated +180° Z => [0, +6, 0] => world [8, 26, 0]
  assertNear(wHand.worldPivot[0], 8);
  assertNear(wHand.worldPivot[1], 26);
  assertNear(wHand.worldPivot[2], 0);

  // Fingertip at local scene point [0, 2, 0] is [0, -4, 0] relative to Hand pivot [0, 6, 0]
  // Rotated +180° Z => [0, +4, 0] => world tip [8, 30, 0]
  const worldTip = wHand.transformPoint([0, 2, 0]);
  assertNear(worldTip[0], 8);
  assertNear(worldTip[1], 30);
  assertNear(worldTip[2], 0);

  // Cycle guard verification: artificially cyclic nodes must not infinite-loop
  const cyclicA = { ...shoulder, id: "cyc-a", parentId: "cyc-b" };
  const cyclicB = { ...elbow, id: "cyc-b", parentId: "cyc-a" };
  const cyclicWorld = evaluateWorldNodeTransforms([cyclicA, cyclicB]);
  assert.equal(cyclicWorld.size, 2);
});

test("M6-A mirrorClipPoseAtFrameLR: swaps Arm_L <-> Arm_R and mirrors Torso in place", () => {
  const engine = new Model3DEngine();
  const torso = engine.addGroup({ name: "Torso" });
  const armL = engine.addNode({ kind: "cuboid", name: "Arm_L", parentId: torso.id });
  const armR = engine.addNode({ kind: "cuboid", name: "Arm_R", parentId: torso.id });

  let clip = createModelClip("Wave", 10, 12, true);
  // Frame 2: Arm_L posed, Arm_R posed differently, Torso shifted & twisted
  clip = upsertModelKeyframe(clip, { frame: 2, nodeId: armL.id, property: "posX", value: -4, easing: "linear" });
  clip = upsertModelKeyframe(clip, { frame: 2, nodeId: armL.id, property: "posY", value: 3, easing: "linear" });
  clip = upsertModelKeyframe(clip, { frame: 2, nodeId: armL.id, property: "rotX", value: 25, easing: "linear" });
  clip = upsertModelKeyframe(clip, { frame: 2, nodeId: armL.id, property: "rotY", value: 15, easing: "linear" });
  clip = upsertModelKeyframe(clip, { frame: 2, nodeId: armL.id, property: "rotZ", value: -40, easing: "linear" });

  clip = upsertModelKeyframe(clip, { frame: 2, nodeId: armR.id, property: "posX", value: 6, easing: "linear" });
  clip = upsertModelKeyframe(clip, { frame: 2, nodeId: armR.id, property: "rotZ", value: 10, easing: "linear" });

  clip = upsertModelKeyframe(clip, { frame: 2, nodeId: torso.id, property: "posX", value: 2, easing: "linear" });
  clip = upsertModelKeyframe(clip, { frame: 2, nodeId: torso.id, property: "rotX", value: 12, easing: "linear" });
  clip = upsertModelKeyframe(clip, { frame: 2, nodeId: torso.id, property: "rotY", value: -20, easing: "linear" });
  clip = upsertModelKeyframe(clip, { frame: 2, nodeId: torso.id, property: "rotZ", value: 8, easing: "linear" });

  // Unrelated frame 5 should remain untouched
  clip = upsertModelKeyframe(clip, { frame: 5, nodeId: armL.id, property: "posX", value: -9, easing: "linear" });

  const mirrored = mirrorClipPoseAtFrameLR(clip, engine.nodes, 2);

  // Arm_R now holds mirrored Arm_L pose
  const pArmR = evaluateNodePoseAtFrame(armR, mirrored, 2);
  assertNear(pArmR.position[0], 4);
  assertNear(pArmR.position[1], 3);
  assertNear(pArmR.rotation[0], 25, 1e-3);
  assertNear(pArmR.rotation[1], -15, 1e-3);
  assertNear(pArmR.rotation[2], 40, 1e-3);

  // Arm_L now holds mirrored Arm_R pose
  const pArmL = evaluateNodePoseAtFrame(armL, mirrored, 2);
  assertNear(pArmL.position[0], -6);
  assertNear(pArmL.rotation[2], -10, 1e-3);

  // Torso mirrored in place (-posX, +rotX, -rotY, -rotZ)
  const pTorso = evaluateNodePoseAtFrame(torso, mirrored, 2);
  assertNear(pTorso.position[0], -2);
  assertNear(pTorso.rotation[0], 12, 1e-3);
  assertNear(pTorso.rotation[1], 20, 1e-3);
  assertNear(pTorso.rotation[2], -8, 1e-3);

  // Frame 5 untouched
  assertNear(evaluateScalarChannel(mirrored.keyframes, armL.id, "posX", 5, 0), -9);
});
