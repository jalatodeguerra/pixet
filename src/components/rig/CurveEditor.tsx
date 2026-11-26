import { useEffect, useMemo, useRef, useState } from "react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import {
  createModelClip,
  evaluateModelEasing,
  evaluateScalarChannel,
  upsertModelKeyframe,
} from "../../engine/model3d/animEval";
import { cloneAnimationClip } from "../../engine/model3d/Model3DEngine";
import { mutateModel3D } from "../../engine/model3d/model3dActions";
import type {
  ModelKeyframeEasing,
  ModelKeyframeProperty,
  ModelNode,
} from "../../engine/model3d/types";
import {
  evaluateEasing,
  type Bone,
  type BoneKeyframe,
  type CubicBezierHandles,
  type EasingMode,
} from "../../engine/rig/RigEngine";
import { setKeyframeEasing } from "../../engine/rig/animationTools";
import {
  beginRigGesture,
  endRigGesture,
  mutateRig,
} from "../../engine/rig/rigActions";
import { useEditorStore } from "../../store/editorStore";

type CurveChannel =
  | "rotationDeg"
  | "localX"
  | "localY"
  | "scaleX"
  | "scaleY"
  | "yawDeg"
  | "pitchDeg"
  | "localZ";

const CHANNELS: ReadonlyArray<{ id: CurveChannel; label: string }> = [
  { id: "rotationDeg", label: "Rotation" },
  { id: "localX", label: "Pos X" },
  { id: "localY", label: "Pos Y" },
  { id: "scaleX", label: "Scale X" },
  { id: "scaleY", label: "Scale Y" },
  { id: "yawDeg", label: "Yaw 3D" },
  { id: "pitchDeg", label: "Pitch 3D" },
  { id: "localZ", label: "Depth Z" },
];

const EASINGS: EasingMode[] = [
  "linear",
  "step",
  "easeIn",
  "easeOut",
  "easeInOut",
  "bezier",
];

const MODEL3D_CHANNELS: ReadonlyArray<{
  id: ModelKeyframeProperty;
  label: string;
}> = [
  { id: "posX", label: "Pos X" },
  { id: "posY", label: "Pos Y" },
  { id: "posZ", label: "Pos Z" },
  { id: "rotX", label: "Rot X" },
  { id: "rotY", label: "Rot Y" },
  { id: "rotZ", label: "Rot Z" },
  { id: "scaleX", label: "Scale X" },
  { id: "scaleY", label: "Scale Y" },
  { id: "scaleZ", label: "Scale Z" },
];

const MODEL3D_EASINGS: ModelKeyframeEasing[] = [
  "linear",
  "step",
  "easeIn",
  "easeOut",
  "easeInOut",
];

function getModelRestValue(node: ModelNode, prop: ModelKeyframeProperty): number {
  switch (prop) {
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

function channelValue(
  bone: Bone,
  kf: BoneKeyframe,
  channel: CurveChannel
): number {
  switch (channel) {
    case "rotationDeg":
      return kf.rotationDeg;
    case "localX":
      return kf.localX ?? bone.localX;
    case "localY":
      return kf.localY ?? bone.localY;
    case "scaleX":
      return kf.scaleX ?? bone.scaleX ?? 1;
    case "scaleY":
      return kf.scaleY ?? bone.scaleY ?? 1;
    case "yawDeg":
      return kf.yawDeg ?? bone.yawDeg ?? 0;
    case "pitchDeg":
      return kf.pitchDeg ?? bone.pitchDeg ?? 0;
    case "localZ":
      return kf.localZ ?? bone.localZ ?? 0;
  }
}

export interface CurveEditorProps {
  mode?: "rig" | "model3d";
}

function Model3DCurveEditor() {
  const model3dVersion = useEditorStore((s) => s.model3dVersion);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const setCurrentFrame = useEditorStore((s) => s.setCurrentFrame);
  const frames = useEditorStore((s) => s.frames);
  void model3dVersion;

  const [property, setProperty] = useState<ModelKeyframeProperty>("rotY");
  const [selectedKeyFrame, setSelectedKeyFrame] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 520, h: 120 });
  const dragKeyRef = useRef<{
    frame: number;
    beforeSnap: string;
  } | null>(null);

  const engine = pixelEngine.model3d;
  const activeNode =
    (engine.activeNodeId ? engine.getNode(engine.activeNodeId) : undefined) ??
    engine.nodes[0] ??
    null;
  const activeClip =
    engine.clips.find((c) => c.id === engine.activeClipId) ??
    engine.clips[0] ??
    null;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({
        w: Math.max(200, Math.floor(rect.width)),
        h: Math.max(96, Math.floor(rect.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const track = useMemo(() => {
    if (!activeClip || !activeNode) return [];
    return activeClip.keyframes
      .filter((k) => k.nodeId === activeNode.id && k.property === property)
      .slice()
      .sort((a, b) => a.frame - b.frame);
  }, [activeClip, activeNode, property]);

  const totalFrames = Math.max(
    frames.length,
    activeClip?.frameCount ?? 16,
    2
  );

  const bounds = useMemo(() => {
    if (!activeNode) {
      return { minVal: -90, maxVal: 90 };
    }
    const rest = getModelRestValue(activeNode, property);
    if (track.length === 0) {
      const span = property.startsWith("scale")
        ? 1.5
        : property.startsWith("pos")
          ? 16
          : 90;
      return { minVal: rest - span, maxVal: rest + span };
    }
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const k of track) {
      if (k.value < minVal) minVal = k.value;
      if (k.value > maxVal) maxVal = k.value;
    }
    if (Math.abs(maxVal - minVal) < 1e-3) {
      const span = property.startsWith("scale")
        ? 1
        : property.startsWith("pos")
          ? 8
          : 20;
      minVal -= span;
      maxVal += span;
    } else {
      const pad = (maxVal - minVal) * 0.25;
      minVal -= pad;
      maxVal += pad;
    }
    return { minVal, maxVal };
  }, [activeNode, track, property]);

  const padX = 28;
  const padY = 14;
  const plotW = Math.max(20, size.w - padX * 2);
  const plotH = Math.max(20, size.h - padY * 2);

  const frameToX = (f: number) =>
    padX + (f / Math.max(1, totalFrames - 1)) * plotW;
  const xToFrame = (x: number) =>
    Math.max(
      0,
      Math.min(
        totalFrames - 1,
        Math.round(((x - padX) / Math.max(1, plotW)) * (totalFrames - 1))
      )
    );
  const valToY = (v: number) =>
    padY +
    (1 - (v - bounds.minVal) / Math.max(1e-6, bounds.maxVal - bounds.minVal)) *
      plotH;
  const yToVal = (y: number) => {
    const norm = 1 - (y - padY) / Math.max(1, plotH);
    return bounds.minVal + norm * (bounds.maxVal - bounds.minVal);
  };

  useEffect(() => {
    if (!activeClip) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, size.w, size.h);

    // Grid
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = 1;
    for (let f = 0; f < totalFrames; f++) {
      const x = Math.round(frameToX(f)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, padY);
      ctx.lineTo(x, size.h - padY);
      ctx.stroke();
    }
    for (let g = 0; g <= 4; g++) {
      const y = Math.round(padY + (g / 4) * plotH) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(size.w - padX, y);
      ctx.stroke();
    }

    // Playhead
    const px = Math.round(frameToX(currentFrame)) + 0.5;
    ctx.strokeStyle = "#4c8bf5";
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, size.h);
    ctx.stroke();

    if (!activeNode) return;
    const restVal = getModelRestValue(activeNode, property);

    if (track.length === 0) {
      const ry = valToY(restVal);
      ctx.strokeStyle = "#3d3d3d";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padX, ry);
      ctx.lineTo(size.w - padX, ry);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    // Segments using evaluateModelEasing & evaluateScalarChannel
    for (let i = 0; i < track.length - 1; i++) {
      const a = track[i];
      const b = track[i + 1];
      const isSelectedSeg = selectedKeyFrame === a.frame;
      ctx.strokeStyle = isSelectedSeg ? "#eab308" : "#7aa8f8";
      ctx.lineWidth = isSelectedSeg ? 2 : 1.5;
      ctx.beginPath();
      const steps = 28;
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const f = a.frame + (b.frame - a.frame) * u;
        const eased = evaluateModelEasing(a.easing, u);
        const v = a.value + (b.value - a.value) * eased;
        const sx = frameToX(f);
        const sy = valToY(v);
        if (s === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // Flat tails before first key and evaluated wrap/tail after last key
    const first = track[0];
    if (first.frame > 0) {
      ctx.strokeStyle = "#4c8bf5";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(frameToX(0), valToY(first.value));
      ctx.lineTo(frameToX(first.frame), valToY(first.value));
      ctx.stroke();
    }
    const last = track[track.length - 1];
    if (last.frame < totalFrames - 1) {
      ctx.strokeStyle = "#4c8bf5";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const tailSteps = 16;
      for (let s = 0; s <= tailSteps; s++) {
        const f = last.frame + ((totalFrames - 1 - last.frame) * s) / tailSteps;
        const v = evaluateScalarChannel(
          activeClip.keyframes,
          activeNode.id,
          property,
          f,
          restVal,
          activeClip.frameCount,
          activeClip.loop
        );
        const sx = frameToX(f);
        const sy = valToY(v);
        if (s === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // Keyframe dots
    for (const kf of track) {
      const kx = frameToX(kf.frame);
      const ky = valToY(kf.value);
      ctx.fillStyle = kf.frame === selectedKeyFrame ? "#eab308" : "#fbf236";
      ctx.fillRect(kx - 3.5, ky - 3.5, 7, 7);
      ctx.strokeStyle = "#141414";
      ctx.lineWidth = 1;
      ctx.strokeRect(kx - 3.5, ky - 3.5, 7, 7);
    }
  }, [
    activeClip,
    activeNode,
    track,
    property,
    currentFrame,
    selectedKeyFrame,
    size,
    bounds,
    totalFrames,
  ]);

  if (!activeClip) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          minHeight: 110,
          gap: 8,
          background: "#141414",
        }}
      >
        <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
          No 3D animation clip yet.
        </span>
        <button
          type="button"
          className="m3d-btn m3d-btn-primary"
          onClick={() =>
            mutateModel3D("Create 3D Animation Clip", (eng) => {
              const clip = createModelClip(
                `Clip ${eng.clips.length + 1}`,
                16,
                12,
                true
              );
              eng.clips.push(clip);
              eng.activeClipId = clip.id;
            })
          }
        >
          Create Animation Clip
        </button>
      </div>
    );
  }

  const selectedKey =
    selectedKeyFrame !== null
      ? track.find((k) => k.frame === selectedKeyFrame) ?? null
      : null;

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // 1. Hit-test keyframe dots first for vertical value dragging
    if (activeNode) {
      for (const kf of track) {
        const kx = frameToX(kf.frame);
        const ky = valToY(kf.value);
        if (Math.hypot(mx - kx, my - ky) <= 8) {
          setSelectedKeyFrame(kf.frame);
          setCurrentFrame(kf.frame);
          const beforeSnap = pixelEngine.model3dHistory.captureSnapshot(engine);
          dragKeyRef.current = { frame: kf.frame, beforeSnap };
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }
    }

    // 2. Hit-test segments to select segment easing
    for (let i = 0; i < track.length - 1; i++) {
      const a = track[i];
      const b = track[i + 1];
      const x0 = frameToX(a.frame);
      const x1 = frameToX(b.frame);
      if (mx >= x0 && mx <= x1) {
        setSelectedKeyFrame(a.frame);
        setCurrentFrame(xToFrame(mx));
        return;
      }
    }

    // 3. Otherwise click scrubs currentFrame
    setCurrentFrame(xToFrame(mx));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragKeyRef.current;
    if (!drag || !activeNode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const my = e.clientY - rect.top;
    const rawVal = yToVal(my);
    const nextVal = Math.round(rawVal * 100) / 100;

    const clipIdx = engine.clips.findIndex((c) => c.id === activeClip.id);
    if (clipIdx < 0) return;
    const existing = track.find((k) => k.frame === drag.frame);
    const updatedClip = upsertModelKeyframe(cloneAnimationClip(activeClip), {
      frame: drag.frame,
      nodeId: activeNode.id,
      property,
      value: nextVal,
      easing: existing?.easing ?? "linear",
    });
    engine.clips[clipIdx] = updatedClip;
    useEditorStore.getState().bumpModel3DVersion();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragKeyRef.current;
    if (!drag) return;
    dragKeyRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const afterSnap = pixelEngine.model3dHistory.captureSnapshot(engine);
    if (afterSnap !== drag.beforeSnap) {
      pixelEngine.model3dHistory.pushUndo(
        drag.beforeSnap,
        "Edit 3D Curve Keyframe"
      );
      pixelEngine.undoCoordinator.record("model3d", "Edit 3D Curve Keyframe");
      useEditorStore.getState().bumpModel3DVersion();
      pixelEngine.emitChange();
      syncHistoryAndCelState();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 110 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          fontSize: 11,
        }}
      >
        <span style={{ color: "var(--text-secondary)" }}>
          {activeNode ? activeNode.name : "No node"}
        </span>
        <select
          className="palette-select"
          style={{ width: 92 }}
          value={property}
          onChange={(e) => setProperty(e.target.value as ModelKeyframeProperty)}
        >
          {MODEL3D_CHANNELS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {selectedKey && activeNode && (
          <select
            className="palette-select"
            style={{ width: 92 }}
            value={selectedKey.easing}
            onChange={(e) => {
              const easing = e.target.value as ModelKeyframeEasing;
              mutateModel3D("Set 3D Key Easing", (eng) => {
                const idx = eng.clips.findIndex((c) => c.id === activeClip.id);
                if (idx < 0) return;
                eng.clips[idx] = upsertModelKeyframe(eng.clips[idx], {
                  frame: selectedKey.frame,
                  nodeId: activeNode.id,
                  property,
                  value: selectedKey.value,
                  easing,
                });
              });
            }}
          >
            {MODEL3D_EASINGS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        {selectedKey && (
          <span className="mono-value" style={{ fontSize: 10 }}>
            F{selectedKey.frame + 1}: {selectedKey.value.toFixed(2)}
          </span>
        )}
        <span className="rotate3d-hint" style={{ marginLeft: "auto" }}>
          Drag key vertically · Click segment for easing · Click graph to scrub
        </span>
      </div>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 80, overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          style={{ display: "block", width: "100%", height: "100%" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
    </div>
  );
}

export function CurveEditor({ mode = "rig" }: CurveEditorProps) {
  if (mode === "model3d") {
    return <Model3DCurveEditor />;
  }
  return <RigCurveEditor />;
}

function RigCurveEditor() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const setCurrentFrame = useEditorStore((s) => s.setCurrentFrame);
  const frames = useEditorStore((s) => s.frames);
  void rigVersion;

  const [channel, setChannel] = useState<CurveChannel>("rotationDeg");
  const [selectedSegFrame, setSelectedSegFrame] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 520, h: 120 });
  const dragHandleRef = useRef<{
    frame: number;
    handleIndex: 1 | 2;
  } | null>(null);

  const rig = pixelEngine.rig;
  const bone =
    rig.bones.find((b) => b.id === selectedBoneId) ?? rig.bones[0] ?? null;
  const clip = rig.getActiveClip();
  const track = bone ? (clip.tracks[bone.id] ?? []) : [];
  const totalFrames = Math.max(frames.length, clip.frameCount, 2);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({
        w: Math.max(200, Math.floor(rect.width)),
        h: Math.max(96, Math.floor(rect.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bounds = useMemo(() => {
    if (!bone || track.length === 0) {
      return { minVal: -90, maxVal: 90 };
    }
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const kf of track) {
      const v = channelValue(bone, kf, channel);
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    if (Math.abs(maxVal - minVal) < 1e-3) {
      minVal -= 10;
      maxVal += 10;
    } else {
      const pad = (maxVal - minVal) * 0.2;
      minVal -= pad;
      maxVal += pad;
    }
    return { minVal, maxVal };
  }, [bone, track, channel]);

  const padX = 24;
  const padY = 14;
  const plotW = Math.max(20, size.w - padX * 2);
  const plotH = Math.max(20, size.h - padY * 2);

  const frameToX = (f: number) =>
    padX + (f / Math.max(1, totalFrames - 1)) * plotW;
  const valToY = (v: number) =>
    padY +
    (1 - (v - bounds.minVal) / Math.max(1e-6, bounds.maxVal - bounds.minVal)) *
      plotH;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, size.w, size.h);

    // Grid
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = 1;
    for (let f = 0; f < totalFrames; f++) {
      const x = Math.round(frameToX(f)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, padY);
      ctx.lineTo(x, size.h - padY);
      ctx.stroke();
    }
    for (let g = 0; g <= 4; g++) {
      const y = Math.round(padY + (g / 4) * plotH) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(size.w - padX, y);
      ctx.stroke();
    }

    // Playhead
    const px = Math.round(frameToX(currentFrame)) + 0.5;
    ctx.strokeStyle = "#4c8bf5";
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, size.h);
    ctx.stroke();

    if (!bone || track.length === 0) return;

    // Segments
    for (let i = 0; i < track.length - 1; i++) {
      const a = track[i];
      const b = track[i + 1];
      const va = channelValue(bone, a, channel);
      const vb = channelValue(bone, b, channel);
      const isSelectedSeg = selectedSegFrame === a.frame;

      ctx.strokeStyle = isSelectedSeg ? "#eab308" : "#7aa8f8";
      ctx.lineWidth = isSelectedSeg ? 2 : 1.5;
      ctx.beginPath();
      const steps = 28;
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const eased = evaluateEasing(u, a.easing ?? "linear", a.curve);
        const f = a.frame + (b.frame - a.frame) * u;
        const v = va + (vb - va) * eased;
        const sx = frameToX(f);
        const sy = valToY(v);
        if (s === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();

      // Bezier handles for selected segment
      if (isSelectedSeg) {
        const curve: CubicBezierHandles = a.curve ?? [0.25, 0.1, 0.25, 1];
        const x0 = frameToX(a.frame);
        const y0 = valToY(va);
        const x3 = frameToX(b.frame);
        const y3 = valToY(vb);
        const h1x = x0 + (x3 - x0) * curve[0];
        const h1y = y0 + (y3 - y0) * curve[1];
        const h2x = x0 + (x3 - x0) * curve[2];
        const h2y = y0 + (y3 - y0) * curve[3];

        ctx.strokeStyle = "#888888";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(h1x, h1y);
        ctx.moveTo(x3, y3);
        ctx.lineTo(h2x, h2y);
        ctx.stroke();

        ctx.fillStyle = "#eab308";
        ctx.fillRect(h1x - 3, h1y - 3, 6, 6);
        ctx.fillRect(h2x - 3, h2y - 3, 6, 6);
      }
    }

    // Key nodes
    for (const kf of track) {
      const kx = frameToX(kf.frame);
      const ky = valToY(channelValue(bone, kf, channel));
      ctx.fillStyle = kf.frame === selectedSegFrame ? "#eab308" : "#fbf236";
      ctx.fillRect(kx - 3, ky - 3, 6, 6);
    }
  }, [bone, track, channel, currentFrame, selectedSegFrame, size, bounds, totalFrames]);

  const selectedKey =
    selectedSegFrame !== null
      ? track.find((k) => k.frame === selectedSegFrame) ?? null
      : null;

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bone || track.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check bezier handles of selected segment first
    if (selectedSegFrame !== null) {
      const idx = track.findIndex((k) => k.frame === selectedSegFrame);
      if (idx >= 0 && idx < track.length - 1) {
        const a = track[idx];
        const b = track[idx + 1];
        const curve: CubicBezierHandles = a.curve ?? [0.25, 0.1, 0.25, 1];
        const x0 = frameToX(a.frame);
        const y0 = valToY(channelValue(bone, a, channel));
        const x3 = frameToX(b.frame);
        const y3 = valToY(channelValue(bone, b, channel));
        const h1x = x0 + (x3 - x0) * curve[0];
        const h1y = y0 + (y3 - y0) * curve[1];
        const h2x = x0 + (x3 - x0) * curve[2];
        const h2y = y0 + (y3 - y0) * curve[3];
        if (Math.hypot(mx - h1x, my - h1y) <= 9) {
          dragHandleRef.current = { frame: a.frame, handleIndex: 1 };
          e.currentTarget.setPointerCapture(e.pointerId);
          beginRigGesture("Edit easing curve");
          return;
        }
        if (Math.hypot(mx - h2x, my - h2y) <= 9) {
          dragHandleRef.current = { frame: a.frame, handleIndex: 2 };
          e.currentTarget.setPointerCapture(e.pointerId);
          beginRigGesture("Edit easing curve");
          return;
        }
      }
    }

    // Otherwise select nearest segment/keyframe
    let bestFrame = track[0].frame;
    let bestDist = Infinity;
    for (let i = 0; i < track.length - 1; i++) {
      const a = track[i];
      const b = track[i + 1];
      const midX = (frameToX(a.frame) + frameToX(b.frame)) / 2;
      const d = Math.abs(mx - midX);
      if (d < bestDist) {
        bestDist = d;
        bestFrame = a.frame;
      }
    }
    setSelectedSegFrame(bestFrame);
    setCurrentFrame(bestFrame);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragHandleRef.current;
    if (!drag || !bone) return;
    const idx = track.findIndex((k) => k.frame === drag.frame);
    if (idx < 0 || idx >= track.length - 1) return;
    const a = track[idx];
    const b = track[idx + 1];
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const x0 = frameToX(a.frame);
    const y0 = valToY(channelValue(bone, a, channel));
    const x3 = frameToX(b.frame);
    const y3 = valToY(channelValue(bone, b, channel));
    const nx = Math.max(0.01, Math.min(0.99, (mx - x0) / Math.max(1e-4, x3 - x0)));
    const dy = y3 - y0;
    const ny =
      Math.abs(dy) < 1
        ? 0.5
        : Math.max(-0.5, Math.min(1.5, (my - y0) / dy));

    const prev: CubicBezierHandles = a.curve ?? [0.25, 0.1, 0.25, 1];
    const nextCurve: CubicBezierHandles =
      drag.handleIndex === 1
        ? [nx, ny, prev[2], prev[3]]
        : [prev[0], prev[1], nx, ny];

    mutateRig("Edit easing curve", () => {
      setKeyframeEasing(clip, bone.id, a.frame, "bezier", nextCurve);
      rig.invalidateEvaluation();
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragHandleRef.current) return;
    dragHandleRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    endRigGesture();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 110 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          fontSize: 11,
        }}
      >
        <span style={{ color: "var(--text-secondary)" }}>
          {bone ? bone.name : "No bone"}
        </span>
        <select
          className="palette-select"
          style={{ width: 96 }}
          value={channel}
          onChange={(e) => setChannel(e.target.value as CurveChannel)}
        >
          {CHANNELS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {selectedKey && bone && (
          <select
            className="palette-select"
            style={{ width: 96 }}
            value={selectedKey.easing ?? "linear"}
            onChange={(e) =>
              mutateRig("Change key easing", () => {
                setKeyframeEasing(
                  clip,
                  bone.id,
                  selectedKey.frame,
                  e.target.value as EasingMode
                );
                rig.invalidateEvaluation();
              })
            }
          >
            {EASINGS.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        )}
        <span className="rotate3d-hint" style={{ marginLeft: "auto" }}>
          Click segment to edit bezier handles
        </span>
      </div>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 80, overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          style={{ display: "block", width: "100%", height: "100%" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
    </div>
  );
}
