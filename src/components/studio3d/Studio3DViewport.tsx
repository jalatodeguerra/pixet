import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import {
  mat3FromEulerDeg,
  mat3MulVec,
  mat3TransposeMulVec,
} from "../../engine/tools/math3d";
import {
  buildFloorShadowEllipse,
  buildSceneGridLines,
  buildTurntableRing,
  projectScenePoint,
  type Scene3DCamera,
} from "../../engine/tools/scene3d";
import { useEditorStore, type Studio3DZoom } from "../../store/editorStore";
import {
  collectStudio3DSources,
  computeStudio3DAngles,
  renderStudio3DPreviewBuffer,
  resolveStudio3DPivot,
} from "./studio3dActions";

const ZOOM_CYCLE: readonly Studio3DZoom[] = ["auto", 2, 4, 6, 8];

function normalizeDeg(deg: number): number {
  let d = (((deg + 180) % 360) + 360) % 360 - 180;
  if (d === -180 && deg > 0) d = 180;
  return Math.round(d);
}

function AxisGizmo({
  yawDeg,
  pitchDeg,
  rollDeg,
}: {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}) {
  const m = mat3FromEulerDeg(yawDeg, pitchDeg, rollDeg);
  const cx = 24;
  const cy = 24;
  const len = 14;
  const labelDist = 19;

  const axes: Array<{
    label: string;
    color: string;
    vec: [number, number, number];
  }> = [
    { label: "X", color: "#e05555", vec: mat3MulVec(m, 1, 0, 0) },
    { label: "Y", color: "#4db86a", vec: mat3MulVec(m, 0, 1, 0) },
    { label: "Z", color: "#4c8bf5", vec: mat3MulVec(m, 0, 0, 1) },
  ];
  axes.sort((a, b) => a.vec[2] - b.vec[2]);

  return (
    <svg className="rotate3d-gizmo" viewBox="0 0 48 48" aria-hidden="true">
      {axes.map(({ label, color, vec }) => {
        const [vx, vy] = vec;
        const x2 = cx + vx * len;
        const y2 = cy + vy * len;
        const lx = cx + vx * labelDist;
        const ly = cy + vy * labelDist;
        return (
          <g key={label}>
            <line
              x1={cx}
              y1={cy}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={1.5}
            />
            <circle cx={x2} cy={y2} r={1.8} fill={color} />
            <text
              x={lx}
              y={ly}
              fill={color}
              fontSize={7.5}
              fontFamily="var(--font-mono)"
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {label}
            </text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={1.5} fill="#b8b8b8" />
    </svg>
  );
}

export function Studio3DViewport() {
  const studio3d = useEditorStore((s) => s.studio3d);
  const patchStudio3D = useEditorStore((s) => s.patchStudio3D);
  const resetStudio3DCamera = useEditorStore((s) => s.resetStudio3DCamera);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const frames = useEditorStore((s) => s.frames);
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigPixelSnap = useEditorStore((s) => s.rigPixelSnap);
  const rigRotSprite = useEditorStore((s) => s.rigRotSprite);

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{
    mode: "camera" | "lightFree" | "lightX" | "lightY" | "lightZ";
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    lightPosX: number;
    lightPosY: number;
    lightPosZ: number;
    axisScreenX: number;
    axisScreenY: number;
    axisWorldLen: number;
  } | null>(null);
  const gizmoHitRef = useRef<{
    center: { sx: number; sy: number };
    tipX: { sx: number; sy: number } | null;
    tipY: { sx: number; sy: number } | null;
    tipZ: { sx: number; sy: number } | null;
    axisLen: number;
  } | null>(null);

  const [viewSize, setViewSize] = useState({ width: 640, height: 480 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewSize({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Stop playback/spin on unmount
  useEffect(() => {
    return () => {
      const st = useEditorStore.getState();
      if (st.studio3d.autoSpin || st.studio3d.scrubberPlaying) {
        st.patchStudio3D({ autoSpin: false, scrubberPlaying: false });
      }
    };
  }, []);

  // Smooth auto-spin animation in Orbit mode
  useEffect(() => {
    if (studio3d.previewMode !== "orbit" || !studio3d.autoSpin) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cur = useEditorStore.getState().studio3d.yawDeg;
      patchStudio3D({ yawDeg: normalizeDeg(cur + dt * 90) });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [studio3d.previewMode, studio3d.autoSpin, patchStudio3D]);

  // Turntable scrubber playback
  const angles = useMemo(
    () => {
      void rigVersion;
      void currentFrame;
      return computeStudio3DAngles(studio3d);
    },
    [studio3d, rigVersion, currentFrame]
  );

  useEffect(() => {
    if (studio3d.previewMode !== "turntable" || !studio3d.scrubberPlaying) {
      return;
    }
    const total = Math.max(1, angles.effectiveScrubberTotal);
    const id = window.setInterval(() => {
      const cur = useEditorStore.getState().studio3d.scrubberFrame;
      patchStudio3D({ scrubberFrame: (cur + 1) % total });
    }, 150);
    return () => window.clearInterval(id);
  }, [
    studio3d.previewMode,
    studio3d.scrubberPlaying,
    angles.effectiveScrubberTotal,
    patchStudio3D,
  ]);

  const sources = useMemo(
    () =>
      collectStudio3DSources(
        studio3d,
        layers,
        activeLayerId,
        currentFrame,
        frames.length,
        canvasWidth,
        canvasHeight
      ),
    [
      studio3d,
      layers,
      activeLayerId,
      currentFrame,
      frames.length,
      canvasWidth,
      canvasHeight,
    ]
  );

  const renderedPreview = useMemo(() => {
    void rigVersion;
    return renderStudio3DPreviewBuffer(
      studio3d,
      sources,
      layers,
      canvasWidth,
      canvasHeight,
      rigPixelSnap,
      rigRotSprite
    );
  }, [
    studio3d,
    sources,
    layers,
    canvasWidth,
    canvasHeight,
    rigPixelSnap,
    rigRotSprite,
    rigVersion,
  ]);

  const autoScale = Math.max(
    2,
    Math.min(
      12,
      Math.floor(
        Math.min(viewSize.width * 0.45, viewSize.height * 0.48) /
          Math.max(1, canvasWidth, canvasHeight)
      )
    )
  );
  const pixelScale =
    studio3d.previewZoom === "auto" ? autoScale : studio3d.previewZoom;

  // Draw the full 3D Scene (backdrop, perspective/isometric grid, turntable stage, shadow, sprite)
  useEffect(() => {
    const canvas = sceneCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const vw = viewSize.width;
    const vh = viewSize.height;
    if (canvas.width !== Math.round(vw * dpr) || canvas.height !== Math.round(vh * dpr)) {
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Studio 3D Backdrop gradient
    const bgGrad = ctx.createRadialGradient(
      vw * 0.5,
      vh * 0.46,
      20,
      vw * 0.5,
      vh * 0.5,
      Math.max(vw, vh) * 0.72
    );
    bgGrad.addColorStop(0, "#1d212c");
    bgGrad.addColorStop(0.65, "#13161e");
    bgGrad.addColorStop(1, "#0b0d12");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, vw, vh);

    const pivot = resolveStudio3DPivot(studio3d, canvasWidth, canvasHeight);
    const pivotX = pivot.pivotX ?? (canvasWidth - 1) / 2;
    const pivotY = pivot.pivotY ?? (canvasHeight - 1) / 2;

    const cam: Scene3DCamera = {
      yawDeg: angles.previewYaw,
      pitchDeg: angles.previewPitch,
      rollDeg: angles.previewRoll,
      perspective: studio3d.perspective,
      canvasWidth,
      canvasHeight,
      floorY: pivot.floorY,
      viewWidth: vw,
      viewHeight: vh,
      pixelScale,
      gridMode: studio3d.gridMode,
    };

    // 2. 3D Floor Grid & Axes
    const gridLines = buildSceneGridLines(cam, {
      showAxes: studio3d.showAxes,
    });
    for (const line of gridLines) {
      ctx.beginPath();
      ctx.moveTo(line.x1, line.y1);
      ctx.lineTo(line.x2, line.y2);
      if (line.kind === "axisX") {
        ctx.strokeStyle = `rgba(224, 85, 85, ${line.alpha})`;
        ctx.lineWidth = 1.5;
      } else if (line.kind === "axisY") {
        ctx.strokeStyle = `rgba(77, 184, 106, ${line.alpha})`;
        ctx.lineWidth = 1.5;
      } else if (line.kind === "axisZ") {
        ctx.strokeStyle = `rgba(76, 139, 245, ${line.alpha})`;
        ctx.lineWidth = 1.5;
      } else if (line.kind === "isoFootprint") {
        ctx.strokeStyle = `rgba(78, 201, 176, ${line.alpha})`;
        ctx.lineWidth = 1.6;
      } else if (line.kind === "major") {
        ctx.strokeStyle = `rgba(148, 163, 198, ${line.alpha})`;
        ctx.lineWidth = 1.1;
      } else {
        ctx.strokeStyle = `rgba(110, 124, 156, ${line.alpha})`;
        ctx.lineWidth = 0.8;
      }
      ctx.stroke();
    }

    // 3. Optional Turntable Stage Ring + Ground Contact Shadow
    if (studio3d.showFloorStage) {
      const stageR = Math.max(canvasWidth, canvasHeight) * 0.65;
      const ring = buildTurntableRing(cam, stageR);
      if (ring.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(ring.points[0].sx, ring.points[0].sy);
        for (let i = 1; i < ring.points.length; i++) {
          ctx.lineTo(ring.points[i].sx, ring.points[i].sy);
        }
        ctx.strokeStyle = "rgba(96, 152, 245, 0.42)";
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }

      ctx.font = "600 10px var(--font-mono, monospace)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const tick of ring.ticks) {
        ctx.beginPath();
        ctx.moveTo(tick.x1, tick.y1);
        ctx.lineTo(tick.x2, tick.y2);
        ctx.strokeStyle = tick.label
          ? "rgba(130, 180, 255, 0.72)"
          : "rgba(130, 180, 255, 0.35)";
        ctx.lineWidth = tick.label ? 1.4 : 1;
        ctx.stroke();
        if (tick.label && tick.lx !== undefined && tick.ly !== undefined) {
          ctx.fillStyle = "rgba(186, 204, 238, 0.75)";
          ctx.fillText(tick.label, tick.lx, tick.ly);
        }
      }

      const shadowPts = buildFloorShadowEllipse(
        cam,
        canvasWidth * 0.28,
        Math.max(4, studio3d.extrudeDepth * 0.6 + canvasWidth * 0.16)
      );
      if (shadowPts.length > 2) {
        ctx.beginPath();
        ctx.moveTo(shadowPts[0].sx, shadowPts[0].sy);
        for (let i = 1; i < shadowPts.length; i++) {
          ctx.lineTo(shadowPts[i].sx, shadowPts[i].sy);
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(0, 0, 0, 0.36)";
        ctx.fill();
      }
    }

    // 4. Crisp 3D Pixel Sprite aligned to scene pivot (0, 0, 0)
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement("canvas");
    }
    const off = offscreenRef.current;
    if (
      off.width !== renderedPreview.width ||
      off.height !== renderedPreview.height
    ) {
      off.width = renderedPreview.width;
      off.height = renderedPreview.height;
    }
    const octx = off.getContext("2d");
    if (octx) {
      octx.putImageData(
        new ImageData(
          new Uint8ClampedArray(renderedPreview.data),
          renderedPreview.width,
          renderedPreview.height
        ),
        0,
        0
      );
      ctx.imageSmoothingEnabled = false;
      const drawX = Math.round(vw / 2 - (pivotX + 0.5) * pixelScale);
      const drawY = Math.round(vh / 2 - (pivotY + 0.5) * pixelScale);
      ctx.drawImage(
        off,
        drawX,
        drawY,
        renderedPreview.width * pixelScale,
        renderedPreview.height * pixelScale
      );
    }

    // 5. Blender-Style Interactive 3D Light Object & XYZ Gizmo
    if (studio3d.directionalLighting && studio3d.showLightGizmo && studio3d.mode !== "rig") {
      const lx = studio3d.lightPosX;
      const ly = studio3d.lightPosY;
      const lz = studio3d.lightPosZ;
      const lp = projectScenePoint(lx, ly, lz, cam);
      const fp = projectScenePoint(lx, cam.floorY, lz, cam);
      const originPt = projectScenePoint(0, 0, 0, cam);

      if (lp.visible) {
        ctx.save();

        // Vertical drop-line to floor plane (Blender spatial reference)
        if (fp.visible) {
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(lp.sx, lp.sy);
          ctx.lineTo(fp.sx, fp.sy);
          ctx.strokeStyle = "rgba(255, 224, 130, 0.35)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.beginPath();
          ctx.ellipse(fp.sx, fp.sy, 5, 2.5, 0, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255, 224, 130, 0.45)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Light-type specific 3D visualization
        if (studio3d.lightType === "spot") {
          const halfRad = (Math.max(5, Math.min(170, studio3d.spotAngleDeg)) * Math.PI) / 360;
          const distToOrigin = Math.max(8, Math.hypot(lx, ly, lz));
          const coneR = Math.tan(halfRad) * distToOrigin * 0.55;
          const coneOffsets: Array<[number, number, number]> = [
            [coneR, 0, 0],
            [-coneR, 0, 0],
            [0, coneR, 0],
            [0, -coneR, 0],
          ];
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = "rgba(255, 220, 120, 0.42)";
          ctx.lineWidth = 1;
          for (const [ox, oy, oz] of coneOffsets) {
            const tp = projectScenePoint(ox * 0.5, oy * 0.5, oz * 0.5, cam);
            if (tp.visible) {
              ctx.beginPath();
              ctx.moveTo(lp.sx, lp.sy);
              ctx.lineTo(tp.sx, tp.sy);
              ctx.stroke();
            }
          }
          ctx.setLineDash([]);
        } else if (studio3d.lightType === "sun") {
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(lp.sx, lp.sy);
          ctx.lineTo(
            originPt.visible ? originPt.sx : vw / 2,
            originPt.visible ? originPt.sy : vh / 2
          );
          ctx.strokeStyle = "rgba(255, 226, 140, 0.55)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.setLineDash([]);
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(lp.sx + Math.cos(a) * 9, lp.sy + Math.sin(a) * 9);
            ctx.lineTo(lp.sx + Math.cos(a) * 14, lp.sy + Math.sin(a) * 14);
            ctx.strokeStyle = "rgba(255, 230, 150, 0.7)";
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        } else {
          // Point light dashed range halo
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.arc(lp.sx, lp.sy, 14, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255, 226, 140, 0.5)";
          ctx.lineWidth = 1.1;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // 3D XYZ Translation Gizmo Arrows anchored at light position
        const axisLen = Math.max(8, Math.max(canvasWidth, canvasHeight) * 0.32);
        const tipX = projectScenePoint(lx + axisLen, ly, lz, cam);
        const tipY = projectScenePoint(lx, ly - axisLen, lz, cam);
        const tipZ = projectScenePoint(lx, ly, lz + axisLen, cam);

        const drawAxis = (
          tip: { sx: number; sy: number; visible: boolean },
          color: string,
          label: string
        ) => {
          if (!tip.visible) return;
          ctx.beginPath();
          ctx.moveTo(lp.sx, lp.sy);
          ctx.lineTo(tip.sx, tip.sy);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(tip.sx, tip.sy, 4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();

          const dxA = tip.sx - lp.sx;
          const dyA = tip.sy - lp.sy;
          const lenA = Math.max(1, Math.hypot(dxA, dyA));
          ctx.font = "700 9px var(--font-mono, monospace)";
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            label,
            tip.sx + (dxA / lenA) * 9,
            tip.sy + (dyA / lenA) * 9
          );
        };

        drawAxis(tipX, "#ef5350", "X");
        drawAxis(tipY, "#52c46d", "Y");
        drawAxis(tipZ, "#4c8bf5", "Z");

        // Central Light Bulb
        ctx.beginPath();
        ctx.arc(lp.sx, lp.sy, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = studio3d.lightColor || "#fff4d6";
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        gizmoHitRef.current = {
          center: { sx: lp.sx, sy: lp.sy },
          tipX: tipX.visible ? { sx: tipX.sx, sy: tipX.sy } : null,
          tipY: tipY.visible ? { sx: tipY.sx, sy: tipY.sy } : null,
          tipZ: tipZ.visible ? { sx: tipZ.sx, sy: tipZ.sy } : null,
          axisLen,
        };
        ctx.restore();
      } else {
        gizmoHitRef.current = null;
      }
    } else {
      gizmoHitRef.current = null;
    }

    ctx.restore();
  }, [
    viewSize,
    studio3d,
    angles.previewYaw,
    angles.previewPitch,
    angles.previewRoll,
    canvasWidth,
    canvasHeight,
    pixelScale,
    renderedPreview,
  ]);

  const modeLabel =
    studio3d.mode === "rig"
      ? "Rig 3D"
      : studio3d.mode === "stack"
        ? "Sprite Stack"
        : "2.5D Extruded";
  const gridLabel =
    studio3d.gridMode === "isometric"
      ? "Isometric Grid"
      : studio3d.gridMode === "perspective"
        ? "3D Perspective Grid"
        : "Grid Off";

  const passLabel =
    studio3d.renderPass === "normal"
      ? "Normal Map"
      : studio3d.renderPass === "height"
        ? "Height Map"
        : studio3d.renderPass === "depth"
          ? "Depth Map"
          : "Lit 3D";

  return (
    <div
      ref={containerRef}
      className="studio3d-viewport"
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        patchStudio3D({ autoSpin: false, scrubberPlaying: false });
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;
        const gz = gizmoHitRef.current;

        let mode: "camera" | "lightFree" | "lightX" | "lightY" | "lightZ" = "camera";
        let axisScreenX = 0;
        let axisScreenY = 0;

        if (studio3d.directionalLighting && gz && studio3d.mode !== "rig") {
          const distToTip = (tip: { sx: number; sy: number } | null) =>
            tip ? Math.hypot(localX - tip.sx, localY - tip.sy) : Infinity;
          const dX = distToTip(gz.tipX);
          const dY = distToTip(gz.tipY);
          const dZ = distToTip(gz.tipZ);
          const minAxisDist = Math.min(dX, dY, dZ);

          if (minAxisDist <= 13) {
            if (minAxisDist === dX && gz.tipX) {
              mode = "lightX";
              axisScreenX = gz.tipX.sx - gz.center.sx;
              axisScreenY = gz.tipX.sy - gz.center.sy;
            } else if (minAxisDist === dY && gz.tipY) {
              mode = "lightY";
              axisScreenX = gz.tipY.sx - gz.center.sx;
              axisScreenY = gz.tipY.sy - gz.center.sy;
            } else if (gz.tipZ) {
              mode = "lightZ";
              axisScreenX = gz.tipZ.sx - gz.center.sx;
              axisScreenY = gz.tipZ.sy - gz.center.sy;
            }
          } else if (
            e.shiftKey ||
            Math.hypot(localX - gz.center.sx, localY - gz.center.sy) <= 16
          ) {
            mode = "lightFree";
          }
        } else if (e.shiftKey && studio3d.mode !== "rig") {
          mode = "lightFree";
        }

        dragRef.current = {
          mode,
          x: e.clientX,
          y: e.clientY,
          yaw: studio3d.yawDeg,
          pitch:
            studio3d.mode === "stack"
              ? studio3d.stackPitchDeg
              : studio3d.pitchDeg,
          lightPosX: studio3d.lightPosX,
          lightPosY: studio3d.lightPosY,
          lightPosZ: studio3d.lightPosZ,
          axisScreenX,
          axisScreenY,
          axisWorldLen: gz?.axisLen ?? 12,
        };
      }}
      onMouseMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        const clampPos = (v: number) => Math.max(-120, Math.min(120, Math.round(v)));

        if (drag.mode === "lightX" || drag.mode === "lightY" || drag.mode === "lightZ") {
          const lenSq = Math.max(
            1e-4,
            drag.axisScreenX * drag.axisScreenX + drag.axisScreenY * drag.axisScreenY
          );
          const delta =
            ((dx * drag.axisScreenX + dy * drag.axisScreenY) / lenSq) *
            drag.axisWorldLen;
          if (drag.mode === "lightX") {
            patchStudio3D({ lightPosX: clampPos(drag.lightPosX + delta) });
          } else if (drag.mode === "lightY") {
            // Green Y arrow points UP (-Y in scene space)
            patchStudio3D({ lightPosY: clampPos(drag.lightPosY - delta) });
          } else {
            patchStudio3D({ lightPosZ: clampPos(drag.lightPosZ + delta) });
          }
          return;
        }

        if (drag.mode === "lightFree") {
          const R = mat3FromEulerDeg(
            angles.previewYaw,
            angles.previewPitch,
            angles.previewRoll
          );
          const [dlx, dly, dlz] = mat3TransposeMulVec(
            R,
            dx / Math.max(1, pixelScale),
            dy / Math.max(1, pixelScale),
            0
          );
          patchStudio3D({
            directionalLighting: true,
            lightPosX: clampPos(drag.lightPosX + dlx),
            lightPosY: clampPos(drag.lightPosY + dly),
            lightPosZ: clampPos(drag.lightPosZ + dlz),
          });
          return;
        }
        const nextYaw = normalizeDeg(drag.yaw + dx * 0.75);
        if (studio3d.mode === "stack") {
          patchStudio3D({
            yawDeg: nextYaw,
            stackPitchDeg: Math.max(
              0,
              Math.min(75, Math.round(drag.pitch + dy * 0.55))
            ),
          });
        } else {
          patchStudio3D({
            yawDeg: nextYaw,
            pitchDeg: Math.max(
              -85,
              Math.min(85, Math.round(drag.pitch + dy * 0.65))
            ),
          });
        }
      }}
      onMouseUp={() => {
        dragRef.current = null;
      }}
      onMouseLeave={() => {
        dragRef.current = null;
      }}
      onDoubleClick={() => resetStudio3DCamera()}
      onWheel={(e) => {
        e.preventDefault();
        const idx = ZOOM_CYCLE.indexOf(studio3d.previewZoom);
        const dir = e.deltaY < 0 ? 1 : -1;
        const nextIdx = Math.max(
          0,
          Math.min(ZOOM_CYCLE.length - 1, (idx === -1 ? 0 : idx) + dir)
        );
        patchStudio3D({ previewZoom: ZOOM_CYCLE[nextIdx] });
      }}
      title="Drag to orbit 3D scene · Drag Light orb (or Shift+Drag) to move light · Scroll to zoom · Double-click to reset camera"
    >
      <canvas ref={sceneCanvasRef} className="studio3d-scene-canvas" />

      <div className="studio3d-hud-top-left">
        <span className="studio3d-badge">{modeLabel}</span>
        <span className="studio3d-badge">{passLabel}</span>
        <span className="studio3d-badge studio3d-badge-muted">{gridLabel}</span>
        <span className="studio3d-badge studio3d-badge-mono">
          Y {Math.round(angles.previewYaw)}° · P {Math.round(angles.previewPitch)}° · R{" "}
          {Math.round(angles.previewRoll)}° · {pixelScale}×
        </span>
      </div>

      <AxisGizmo
        yawDeg={angles.previewYaw}
        pitchDeg={angles.previewPitch}
        rollDeg={angles.previewRoll}
      />

      <div
        className="studio3d-hud-bottom"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="rotate3d-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={studio3d.previewMode === "orbit"}
            className={`rotate3d-tab ${studio3d.previewMode === "orbit" ? "active" : ""}`}
            onClick={() =>
              patchStudio3D({ scrubberPlaying: false, previewMode: "orbit" })
            }
          >
            Orbit Scene
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={studio3d.previewMode === "turntable"}
            className={`rotate3d-tab ${studio3d.previewMode === "turntable" ? "active" : ""}`}
            onClick={() =>
              patchStudio3D({ autoSpin: false, previewMode: "turntable" })
            }
          >
            Turntable Preview
          </button>
        </div>

        {studio3d.previewMode === "orbit" ? (
          <div className="rotate3d-preview-bar">
            <button
              type="button"
              className={`mini-btn ${studio3d.autoSpin ? "active" : ""}`}
              onClick={() => patchStudio3D({ autoSpin: !studio3d.autoSpin })}
            >
              {studio3d.autoSpin ? <Square size={11} /> : <Play size={11} />}
              <span>{studio3d.autoSpin ? "Stop Spin" : "Auto-Spin"}</span>
            </button>
            <span className="rotate3d-hint">
              Drag scene to orbit · Double-click to reset
            </span>
          </div>
        ) : (
          <div className="studio3d-scrubber-row">
            <button
              type="button"
              className={`mini-btn ${studio3d.scrubberPlaying ? "active" : ""}`}
              onClick={() =>
                patchStudio3D({ scrubberPlaying: !studio3d.scrubberPlaying })
              }
            >
              {studio3d.scrubberPlaying ? (
                <Pause size={11} />
              ) : (
                <Play size={11} />
              )}
              <span>{studio3d.scrubberPlaying ? "Pause" : "Play"}</span>
            </button>
            <input
              type="range"
              className="rotate3d-scrubber-range"
              min={1}
              max={angles.effectiveScrubberTotal}
              value={angles.clampedScrubberFrame + 1}
              onChange={(e) =>
                patchStudio3D({
                  scrubberPlaying: false,
                  scrubberFrame: Number(e.target.value) - 1,
                })
              }
              aria-label="Turntable preview frame"
            />
            <span className="rotate3d-val" style={{ minWidth: 74 }}>
              {angles.clampedScrubberFrame + 1}/{angles.effectiveScrubberTotal} (
              {Math.round(angles.turntableAngleOffset)}°)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
