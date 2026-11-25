import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { mat3FromEulerDeg, mat3MulVec } from "../../engine/tools/math3d";
import {
  buildFloorShadowEllipse,
  buildSceneGridLines,
  buildTurntableRing,
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
    x: number;
    y: number;
    yaw: number;
    pitch: number;
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

  return (
    <div
      ref={containerRef}
      className="studio3d-viewport"
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        patchStudio3D({ autoSpin: false, scrubberPlaying: false });
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          yaw: studio3d.yawDeg,
          pitch:
            studio3d.mode === "stack"
              ? studio3d.stackPitchDeg
              : studio3d.pitchDeg,
        };
      }}
      onMouseMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
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
      title="Drag to orbit 3D scene · Scroll to zoom · Double-click to reset camera"
    >
      <canvas ref={sceneCanvasRef} className="studio3d-scene-canvas" />

      <div className="studio3d-hud-top-left">
        <span className="studio3d-badge">{modeLabel}</span>
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
