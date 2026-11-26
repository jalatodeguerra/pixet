import {
  eulerDegToQuat,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  quatSlerp,
  quatToEulerDeg,
  vec3Add,
  vec3Sub,
} from "./quatMath.ts";
import type {
  ModelAnimationClip,
  ModelKeyframe,
  ModelKeyframeEasing,
  ModelKeyframeProperty,
  ModelNode,
  Quat,
  Vec3,
} from "./types.ts";

export type ModelEasingInput = ModelKeyframeEasing | "bezier";

export type ModelBezierHandles = [number, number, number, number];

export interface EvaluatedNodePose {
  position: Vec3;
  rotation: Vec3;
  quaternion: Quat;
  scale: Vec3;
  pivot: Vec3;
}

export interface WorldNodeTransform {
  nodeId: string;
  worldPivot: Vec3;
  worldQuaternion: Quat;
  worldScale: Vec3;
  transformPoint: (localScenePointPx: Vec3) => Vec3;
}

const DEFAULT_BEZIER_HANDLES: ModelBezierHandles = [0.25, 0.1, 0.25, 1];

const ALL_TRANSFORM_PROPERTIES: readonly ModelKeyframeProperty[] = [
  "posX",
  "posY",
  "posZ",
  "rotX",
  "rotY",
  "rotZ",
  "scaleX",
  "scaleY",
  "scaleZ",
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function bezierComponent(u: number, p1: number, p2: number): number {
  const mu = 1 - u;
  return 3 * mu * mu * u * p1 + 3 * mu * u * u * p2 + u * u * u;
}

function bezierDerivative(u: number, p1: number, p2: number): number {
  const mu = 1 - u;
  return 3 * mu * mu * p1 + 6 * mu * u * (p2 - p1) + 3 * u * u * (1 - p2);
}

function cubicBezierEase(
  t: number,
  handles: ModelBezierHandles = DEFAULT_BEZIER_HANDLES
): number {
  const x = clamp01(t);
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const valid =
    Array.isArray(handles) && handles.length === 4
      ? handles
      : DEFAULT_BEZIER_HANDLES;
  const x1 = clamp01(valid[0]);
  const y1 = Number.isFinite(valid[1]) ? valid[1] : DEFAULT_BEZIER_HANDLES[1];
  const x2 = clamp01(valid[2]);
  const y2 = Number.isFinite(valid[3]) ? valid[3] : DEFAULT_BEZIER_HANDLES[3];

  let u = x;
  for (let i = 0; i < 8; i++) {
    const err = bezierComponent(u, x1, x2) - x;
    if (Math.abs(err) < 1e-6) {
      return bezierComponent(u, y1, y2);
    }
    const slope = bezierDerivative(u, x1, x2);
    if (Math.abs(slope) < 1e-6) break;
    const next = u - err / slope;
    if (next < 0 || next > 1) break;
    u = next;
  }

  let lo = 0;
  let hi = 1;
  u = x;
  for (let i = 0; i < 24; i++) {
    const sample = bezierComponent(u, x1, x2);
    if (Math.abs(sample - x) < 1e-7) break;
    if (sample < x) lo = u;
    else hi = u;
    u = (lo + hi) / 2;
  }
  return bezierComponent(u, y1, y2);
}

/**
 * Evaluates a normalized segment parameter `t` in [0, 1] using Pixet's standard
 * easing modes plus optional cubic-bezier handles.
 */
export function evaluateModelEasing(
  mode: ModelEasingInput,
  t: number,
  bezierHandles?: ModelBezierHandles
): number {
  const clamped = clamp01(t);
  switch (mode) {
    case "step":
      return clamped >= 1 ? 1 : 0;
    case "easeIn":
      return clamped * clamped;
    case "easeOut":
      return 1 - (1 - clamped) * (1 - clamped);
    case "easeInOut":
      return clamped * clamped * (3 - 2 * clamped);
    case "bezier":
      return cubicBezierEase(clamped, bezierHandles);
    case "linear":
    default:
      return clamped;
  }
}

let nextGeneratedClipNum = 1;

export function createModelClip(
  name: string,
  frameCount = 24,
  fps = 12,
  loop = true
): ModelAnimationClip {
  const safeName = name.trim() || `Clip ${nextGeneratedClipNum}`;
  const slug = safeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const id = `clip-${slug || "anim"}-${nextGeneratedClipNum++}`;
  return {
    id,
    name: safeName,
    frameCount: Math.max(
      1,
      Math.round(Number.isFinite(frameCount) ? frameCount : 24)
    ),
    fps: Math.max(1, Math.round(Number.isFinite(fps) ? fps : 12)),
    loop,
    keyframes: [],
  };
}

function compareKeyframes(a: ModelKeyframe, b: ModelKeyframe): number {
  if (a.frame !== b.frame) return a.frame - b.frame;
  if (a.nodeId !== b.nodeId) return a.nodeId.localeCompare(b.nodeId);
  return a.property.localeCompare(b.property);
}

export function upsertModelKeyframe(
  clip: ModelAnimationClip,
  kf: ModelKeyframe
): ModelAnimationClip {
  const frame = Math.max(0, Math.round(Number.isFinite(kf.frame) ? kf.frame : 0));
  const normalized: ModelKeyframe = {
    frame,
    nodeId: kf.nodeId,
    property: kf.property,
    value: Number.isFinite(kf.value) ? kf.value : 0,
    easing: kf.easing ?? "linear",
  };

  const nextKeyframes = clip.keyframes
    .filter(
      (existing) =>
        !(
          existing.frame === normalized.frame &&
          existing.nodeId === normalized.nodeId &&
          existing.property === normalized.property
        )
    )
    .map((existing) => ({ ...existing }));

  nextKeyframes.push(normalized);
  nextKeyframes.sort(compareKeyframes);

  return {
    ...clip,
    frameCount: Math.max(clip.frameCount, frame + 1),
    keyframes: nextKeyframes,
  };
}

export function deleteModelKeyframe(
  clip: ModelAnimationClip,
  frame: number,
  nodeId: string,
  property?: ModelKeyframeProperty
): ModelAnimationClip {
  const targetFrame = Math.round(frame);
  const nextKeyframes = clip.keyframes
    .filter((existing) => {
      if (existing.frame !== targetFrame || existing.nodeId !== nodeId) {
        return true;
      }
      if (property === undefined) return false;
      return existing.property !== property;
    })
    .map((existing) => ({ ...existing }));

  return {
    ...clip,
    keyframes: nextKeyframes,
  };
}

function readNodeProperty(
  node: ModelNode,
  property: ModelKeyframeProperty
): number {
  switch (property) {
    case "posX":
      return node.transform.position[0];
    case "posY":
      return node.transform.position[1];
    case "posZ":
      return node.transform.position[2];
    case "rotX":
      return node.transform.rotation[0];
    case "rotY":
      return node.transform.rotation[1];
    case "rotZ":
      return node.transform.rotation[2];
    case "scaleX":
      return node.transform.scale[0];
    case "scaleY":
      return node.transform.scale[1];
    case "scaleZ":
      return node.transform.scale[2];
  }
}

export function recordNodeTransformKeyframes(
  clip: ModelAnimationClip,
  node: ModelNode,
  frame: number,
  easing: ModelKeyframeEasing = "linear"
): ModelAnimationClip {
  let updated = clip;
  for (const prop of ALL_TRANSFORM_PROPERTIES) {
    updated = upsertModelKeyframe(updated, {
      frame,
      nodeId: node.id,
      property: prop,
      value: readNodeProperty(node, prop),
      easing,
    });
  }
  return updated;
}

export function getKeyframedFramesForNode(
  clip: ModelAnimationClip,
  nodeId?: string | null
): number[] {
  const frames = new Set<number>();
  for (const kf of clip.keyframes) {
    if (nodeId && kf.nodeId !== nodeId) continue;
    frames.add(kf.frame);
  }
  return Array.from(frames).sort((a, b) => a - b);
}

function normalizeEvalFrame(
  frame: number,
  clipFrameCount?: number,
  loop?: boolean
): number {
  if (!Number.isFinite(frame)) return 0;
  if (
    loop &&
    clipFrameCount !== undefined &&
    Number.isFinite(clipFrameCount) &&
    clipFrameCount > 0
  ) {
    const len = Math.max(1, clipFrameCount);
    const mod = ((frame % len) + len) % len;
    return mod;
  }
  return Math.max(0, frame);
}

export function evaluateScalarChannel(
  keyframes: ReadonlyArray<ModelKeyframe>,
  nodeId: string,
  property: ModelKeyframeProperty,
  frame: number,
  restValue: number,
  clipFrameCount?: number,
  loop?: boolean
): number {
  const track = keyframes
    .filter((k) => k.nodeId === nodeId && k.property === property)
    .slice()
    .sort((a, b) => a.frame - b.frame);

  if (track.length === 0) return restValue;

  const evalFrame = normalizeEvalFrame(frame, clipFrameCount, loop);

  const first = track[0];
  if (evalFrame <= first.frame) {
    return first.value;
  }

  const last = track[track.length - 1];
  if (evalFrame >= last.frame) {
    if (
      loop &&
      clipFrameCount !== undefined &&
      Number.isFinite(clipFrameCount) &&
      clipFrameCount > last.frame &&
      track.length >= 2
    ) {
      const wrapSpan = clipFrameCount - last.frame + first.frame;
      if (wrapSpan > 0) {
        const rawT = (evalFrame - last.frame) / wrapSpan;
        const t = evaluateModelEasing(last.easing, rawT);
        return lerp(last.value, first.value, t);
      }
    }
    return last.value;
  }

  for (let i = 0; i < track.length - 1; i++) {
    const k0 = track[i];
    const k1 = track[i + 1];
    if (evalFrame >= k0.frame && evalFrame <= k1.frame) {
      const span = k1.frame - k0.frame;
      if (span <= 0) return k1.value;
      const rawT = (evalFrame - k0.frame) / span;
      const t = evaluateModelEasing(k0.easing, rawT);
      return lerp(k0.value, k1.value, t);
    }
  }

  return restValue;
}

const EASING_PRIORITY: readonly ModelKeyframeEasing[] = [
  "easeInOut",
  "easeIn",
  "easeOut",
  "step",
  "linear",
];

function resolveRotationAtKeyframeTimestamp(
  rotKeyframes: ReadonlyArray<ModelKeyframe>,
  nodeId: string,
  targetFrame: number,
  restEuler: Vec3
): { euler: Vec3; easing: ModelKeyframeEasing } {
  const atFrame = rotKeyframes.filter((k) => k.frame === targetFrame);
  const easingAtFrame = (prop: ModelKeyframeProperty): ModelKeyframeEasing | null => {
    const found = atFrame.find((k) => k.property === prop);
    return found ? found.easing : null;
  };

  const rx = evaluateScalarChannel(rotKeyframes, nodeId, "rotX", targetFrame, restEuler[0]);
  const ry = evaluateScalarChannel(rotKeyframes, nodeId, "rotY", targetFrame, restEuler[1]);
  const rz = evaluateScalarChannel(rotKeyframes, nodeId, "rotZ", targetFrame, restEuler[2]);

  // Pick a deterministic segment easing if any channel at targetFrame specifies non-linear
  let chosenEasing: ModelKeyframeEasing = "linear";
  for (const candidate of EASING_PRIORITY) {
    if (
      easingAtFrame("rotX") === candidate ||
      easingAtFrame("rotY") === candidate ||
      easingAtFrame("rotZ") === candidate
    ) {
      chosenEasing = candidate;
      break;
    }
  }

  return {
    euler: [rx, ry, rz],
    easing: chosenEasing,
  };
}

function evaluateNodeRotationSlerp(
  keyframes: ReadonlyArray<ModelKeyframe>,
  nodeId: string,
  restEuler: Vec3,
  frame: number,
  clipFrameCount?: number,
  loop?: boolean
): { rotation: Vec3; quaternion: Quat } {
  const rotKeys = keyframes
    .filter(
      (k) =>
        k.nodeId === nodeId &&
        (k.property === "rotX" || k.property === "rotY" || k.property === "rotZ")
    )
    .slice()
    .sort((a, b) => a.frame - b.frame);

  if (rotKeys.length === 0) {
    const q = eulerDegToQuat(restEuler);
    return {
      rotation: [restEuler[0], restEuler[1], restEuler[2]],
      quaternion: q,
    };
  }

  const uniqueFrames: number[] = [];
  for (const k of rotKeys) {
    if (uniqueFrames.length === 0 || uniqueFrames[uniqueFrames.length - 1] !== k.frame) {
      uniqueFrames.push(k.frame);
    }
  }

  const evalFrame = normalizeEvalFrame(frame, clipFrameCount, loop);
  const firstFrame = uniqueFrames[0];
  const lastFrame = uniqueFrames[uniqueFrames.length - 1];

  if (evalFrame <= firstFrame) {
    const sample = resolveRotationAtKeyframeTimestamp(rotKeys, nodeId, firstFrame, restEuler);
    const q = eulerDegToQuat(sample.euler);
    return {
      rotation: quatToEulerDeg(q),
      quaternion: q,
    };
  }

  if (evalFrame >= lastFrame) {
    if (
      loop &&
      clipFrameCount !== undefined &&
      Number.isFinite(clipFrameCount) &&
      clipFrameCount > lastFrame &&
      uniqueFrames.length >= 2
    ) {
      const wrapSpan = clipFrameCount - lastFrame + firstFrame;
      if (wrapSpan > 0) {
        const startSample = resolveRotationAtKeyframeTimestamp(rotKeys, nodeId, lastFrame, restEuler);
        const endSample = resolveRotationAtKeyframeTimestamp(rotKeys, nodeId, firstFrame, restEuler);
        const rawT = (evalFrame - lastFrame) / wrapSpan;
        const t = evaluateModelEasing(startSample.easing, rawT);
        const q = quatSlerp(
          eulerDegToQuat(startSample.euler),
          eulerDegToQuat(endSample.euler),
          t
        );
        return {
          rotation: quatToEulerDeg(q),
          quaternion: q,
        };
      }
    }
    const sample = resolveRotationAtKeyframeTimestamp(rotKeys, nodeId, lastFrame, restEuler);
    const q = eulerDegToQuat(sample.euler);
    return {
      rotation: quatToEulerDeg(q),
      quaternion: q,
    };
  }

  for (let i = 0; i < uniqueFrames.length - 1; i++) {
    const f0 = uniqueFrames[i];
    const f1 = uniqueFrames[i + 1];
    if (evalFrame >= f0 && evalFrame <= f1) {
      const span = f1 - f0;
      const startSample = resolveRotationAtKeyframeTimestamp(rotKeys, nodeId, f0, restEuler);
      const endSample = resolveRotationAtKeyframeTimestamp(rotKeys, nodeId, f1, restEuler);
      if (span <= 0) {
        const q = eulerDegToQuat(endSample.euler);
        return { rotation: quatToEulerDeg(q), quaternion: q };
      }
      const rawT = (evalFrame - f0) / span;
      const t = evaluateModelEasing(startSample.easing, rawT);
      const q0 = eulerDegToQuat(startSample.euler);
      const q1 = eulerDegToQuat(endSample.euler);
      const q = quatSlerp(q0, q1, t);
      return {
        rotation: quatToEulerDeg(q),
        quaternion: q,
      };
    }
  }

  const q = eulerDegToQuat(restEuler);
  return {
    rotation: [restEuler[0], restEuler[1], restEuler[2]],
    quaternion: q,
  };
}

export function evaluateNodePoseAtFrame(
  node: ModelNode,
  clip: ModelAnimationClip | null | undefined,
  frame: number
): EvaluatedNodePose {
  const rest = node.transform;
  if (!clip || clip.keyframes.length === 0) {
    return {
      position: [rest.position[0], rest.position[1], rest.position[2]],
      rotation: [rest.rotation[0], rest.rotation[1], rest.rotation[2]],
      quaternion: eulerDegToQuat(rest.rotation),
      scale: [rest.scale[0], rest.scale[1], rest.scale[2]],
      pivot: [rest.pivot[0], rest.pivot[1], rest.pivot[2]],
    };
  }

  const keyframes = clip.keyframes;
  const frameCount = clip.frameCount;
  const loop = clip.loop;

  const position: Vec3 = [
    evaluateScalarChannel(keyframes, node.id, "posX", frame, rest.position[0], frameCount, loop),
    evaluateScalarChannel(keyframes, node.id, "posY", frame, rest.position[1], frameCount, loop),
    evaluateScalarChannel(keyframes, node.id, "posZ", frame, rest.position[2], frameCount, loop),
  ];

  const scale: Vec3 = [
    evaluateScalarChannel(keyframes, node.id, "scaleX", frame, rest.scale[0], frameCount, loop),
    evaluateScalarChannel(keyframes, node.id, "scaleY", frame, rest.scale[1], frameCount, loop),
    evaluateScalarChannel(keyframes, node.id, "scaleZ", frame, rest.scale[2], frameCount, loop),
  ];

  const rot = evaluateNodeRotationSlerp(
    keyframes,
    node.id,
    rest.rotation,
    frame,
    frameCount,
    loop
  );

  return {
    position,
    rotation: rot.rotation,
    quaternion: rot.quaternion,
    scale,
    pivot: [rest.pivot[0], rest.pivot[1], rest.pivot[2]],
  };
}

export function evaluateScenePosesAtFrame(
  nodes: ReadonlyArray<ModelNode>,
  clip: ModelAnimationClip | null | undefined,
  frame: number
): Map<string, EvaluatedNodePose> {
  const poses = new Map<string, EvaluatedNodePose>();
  for (const node of nodes) {
    poses.set(node.id, evaluateNodePoseAtFrame(node, clip, frame));
  }
  return poses;
}

function mulVec3Components(a: Vec3, b: Vec3): Vec3 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

export function evaluateWorldNodeTransforms(
  nodes: ReadonlyArray<ModelNode>,
  poses?: ReadonlyMap<string, EvaluatedNodePose>
): Map<string, WorldNodeTransform> {
  const byId = new Map<string, ModelNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }

  const resolved = new Map<string, WorldNodeTransform>();
  const visiting = new Set<string>();

  const resolveNode = (nodeId: string): WorldNodeTransform | null => {
    const cached = resolved.get(nodeId);
    if (cached) return cached;
    if (visiting.has(nodeId)) return null;

    const node = byId.get(nodeId);
    if (!node) return null;

    visiting.add(nodeId);

    const pose = poses?.get(node.id);
    const localPos: Vec3 = pose ? pose.position : node.transform.position;
    const localQuat: Quat = pose
      ? quatNormalize(pose.quaternion)
      : eulerDegToQuat(node.transform.rotation);
    const localScale: Vec3 = pose ? pose.scale : node.transform.scale;
    const nodePivot: Vec3 = pose ? pose.pivot : node.transform.pivot;

    const parentNode =
      node.parentId && node.parentId !== node.id ? byId.get(node.parentId) : undefined;
    const parentWorld = parentNode ? resolveNode(parentNode.id) : null;

    let worldPivot: Vec3;
    let worldQuaternion: Quat;
    let worldScale: Vec3;

    if (parentNode && parentWorld) {
      const parentPose = poses?.get(parentNode.id);
      const parentPivot: Vec3 = parentPose
        ? parentPose.pivot
        : parentNode.transform.pivot;
      const offsetFromParentPivot = vec3Add(
        vec3Sub(nodePivot, parentPivot),
        localPos
      );
      const scaledOffset = mulVec3Components(
        offsetFromParentPivot,
        parentWorld.worldScale
      );
      const rotatedOffset = quatRotateVec3(
        parentWorld.worldQuaternion,
        scaledOffset
      );
      worldPivot = vec3Add(parentWorld.worldPivot, rotatedOffset);
      worldQuaternion = quatNormalize(
        quatMultiply(parentWorld.worldQuaternion, localQuat)
      );
      worldScale = mulVec3Components(parentWorld.worldScale, localScale);
    } else {
      worldPivot = vec3Add(nodePivot, localPos);
      worldQuaternion = localQuat;
      worldScale = [localScale[0], localScale[1], localScale[2]];
    }

    const capturedPivot = worldPivot;
    const capturedQuat = worldQuaternion;
    const capturedScale = worldScale;

    const worldTransform: WorldNodeTransform = {
      nodeId: node.id,
      worldPivot: capturedPivot,
      worldQuaternion: capturedQuat,
      worldScale: capturedScale,
      transformPoint: (localScenePointPx: Vec3): Vec3 => {
        const rel = vec3Sub(localScenePointPx, nodePivot);
        const scaled = mulVec3Components(rel, capturedScale);
        const rotated = quatRotateVec3(capturedQuat, scaled);
        return vec3Add(capturedPivot, rotated);
      },
    };

    visiting.delete(nodeId);
    resolved.set(nodeId, worldTransform);
    return worldTransform;
  };

  for (const node of nodes) {
    resolveNode(node.id);
  }

  return resolved;
}

const MIRROR_SUFFIX_PAIRS: ReadonlyArray<readonly [RegExp, string, RegExp, string]> = [
  [/_L$/, "_R", /_R$/, "_L"],
  [/_l$/, "_r", /_r$/, "_l"],
  [/\.L$/, ".R", /\.R$/, ".L"],
  [/\.l$/, ".r", /\.r$/, ".l"],
  [/Left$/, "Right", /Right$/, "Left"],
  [/left$/, "right", /right$/, "left"],
  [/ L$/, " R", / R$/, " L"],
];

function findMirrorNodeName(name: string): string | null {
  for (const [leftRe, toRight, rightRe, toLeft] of MIRROR_SUFFIX_PAIRS) {
    if (leftRe.test(name)) {
      return name.replace(leftRe, toRight);
    }
    if (rightRe.test(name)) {
      return name.replace(rightRe, toLeft);
    }
  }
  return null;
}

function mirrorPropertyValue(
  property: ModelKeyframeProperty,
  value: number
): number {
  if (property === "posX" || property === "rotY" || property === "rotZ") {
    return value === 0 ? 0 : -value;
  }
  return value;
}

/**
 * Mirrors all keyframes at `frame` across X (`L <-> R` paired nodes swap and mirror
 * `posX`, `rotY`, `rotZ`; centered spine/root nodes mirror in place).
 */
export function mirrorClipPoseAtFrameLR(
  clip: ModelAnimationClip,
  nodes: ReadonlyArray<ModelNode>,
  frame: number
): ModelAnimationClip {
  const targetFrame = Math.round(frame);
  const byName = new Map<string, ModelNode>();
  for (const node of nodes) {
    byName.set(node.name, node);
  }

  const pairPartnerById = new Map<string, string>();
  for (const node of nodes) {
    const partnerName = findMirrorNodeName(node.name);
    if (!partnerName) continue;
    const partner = byName.get(partnerName);
    if (partner && partner.id !== node.id) {
      pairPartnerById.set(node.id, partner.id);
    }
  }

  // Separate keyframes not on targetFrame vs keyframes on targetFrame
  const untouched = clip.keyframes
    .filter((k) => k.frame !== targetFrame)
    .map((k) => ({ ...k }));
  const atFrame = clip.keyframes.filter((k) => k.frame === targetFrame);

  const mirroredAtFrame: ModelKeyframe[] = [];

  for (const kf of atFrame) {
    const partnerId = pairPartnerById.get(kf.nodeId);
    const destNodeId = partnerId ?? kf.nodeId;
    mirroredAtFrame.push({
      frame: kf.frame,
      nodeId: destNodeId,
      property: kf.property,
      value: mirrorPropertyValue(kf.property, kf.value),
      easing: kf.easing,
    });
  }

  // Deduplicate in case unexpected duplicate keys existed, keeping latest
  const deduped = new Map<string, ModelKeyframe>();
  for (const kf of mirroredAtFrame) {
    deduped.set(`${kf.frame}|${kf.nodeId}|${kf.property}`, kf);
  }

  const combined = [...untouched, ...deduped.values()];
  combined.sort(compareKeyframes);

  return {
    ...clip,
    keyframes: combined,
  };
}
