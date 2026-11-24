import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Film,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { hexToRgba, PixelBuffer } from "../engine/document/PixelBuffer";
import { pixelEngine } from "../engine/document/PixelEngine";
import { commitFloatingSelection } from "../engine/document/selectionActions";
import { syncTimelineCels } from "../engine/document/timelineActions";
import {
  bakeRigTurntable,
  type RigTurntableMode,
} from "../engine/rig/export/bake";
import type { PixelCleanupOptions } from "../engine/rig/pixelCleanup";
import { mat3FromEulerDeg, mat3MulVec } from "../engine/tools/math3d";
import {
  bakeTurntableFrames,
  computeTurntableAngleOffset,
  render25DSprite,
  renderSpriteStack,
  ROTATE3D_CAMERA_PRESETS,
  TURNTABLE_PRESETS,
  type DepthProfile,
  type Rotate25DOptions,
  type Rotate3DCameraPreset,
  type Rotate3DMode,
  type SpinAxis,
  type SpriteStackOptions,
  type TurntableEasing,
  type TurntablePreset,
} from "../engine/tools/rotate3d";
import {
  isLayerEffectivelyLocked,
  useEditorStore,
} from "../store/editorStore";

type StudioMode = Rotate3DMode | "rig";
type SourceScope = "visible" | "active";
type PivotMode = "center" | "bottom" | "custom";
type PreviewMode = "orbit" | "turntable";
type PreviewZoom = "auto" | 2 | 4 | 6;

const CAMERA_PRESET_LIST: readonly Rotate3DCameraPreset[] = [
  ROTATE3D_CAMERA_PRESETS.front,
  ROTATE3D_CAMERA_PRESETS.threeQuarterL,
  ROTATE3D_CAMERA_PRESETS.threeQuarterR,
  ROTATE3D_CAMERA_PRESETS.iso2to1,
  ROTATE3D_CAMERA_PRESETS.topDown,
];

const TURNTABLE_PRESET_LIST: readonly TurntablePreset[] = [
  TURNTABLE_PRESETS.dir4,
  TURNTABLE_PRESETS.dir8,
  TURNTABLE_PRESETS.dir16,
  TURNTABLE_PRESETS.sway,
];

const FRAME_COUNT_OPTIONS = [4, 6, 8, 12, 16, 24, 32] as const;
const RIG_DIRECTION_OPTIONS = [4, 8, 12, 16] as const;
const ZOOM_OPTIONS: readonly PreviewZoom[] = ["auto", 2, 4, 6];

function normalizeDeg(deg: number): number {
  let d = (((deg + 180) % 360) + 360) % 360 - 180;
  if (d === -180 && deg > 0) d = 180;
  return Math.round(d);
}

interface AxisGizmoProps {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

function AxisGizmo({ yawDeg, pitchDeg, rollDeg }: AxisGizmoProps) {
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

  // Draw far-to-near so front-facing axis renders on top
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

export function Rotate3DModal() {
  const open = useEditorStore((s) => s.rotate3dModalOpen);
  const setOpen = useEditorStore((s) => s.setRotate3dModalOpen);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const frames = useEditorStore((s) => s.frames);
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigPixelSnap = useEditorStore((s) => s.rigPixelSnap);
  const rigRotSprite = useEditorStore((s) => s.rigRotSprite);

  // Mode & Source
  const [mode, setMode] = useState<StudioMode>("extruded");
  const [sourceScope, setSourceScope] = useState<SourceScope>("visible");
  const [backFaceChoice, setBackFaceChoice] = useState<string>("none");
  const [pivotMode, setPivotMode] = useState<PivotMode>("center");
  const [customPivotX, setCustomPivotX] = useState(() =>
    Math.floor(canvasWidth / 2)
  );
  const [customPivotY, setCustomPivotY] = useState(() =>
    Math.floor(canvasHeight / 2)
  );

  // Rig 3D controls
  const [rigAutoZSort, setRigAutoZSort] = useState(true);
  const [rigBakeMode, setRigBakeMode] = useState<RigTurntableMode>("pose");
  const [rigDirections, setRigDirections] = useState(8);

  // Transform controls
  const [yawDeg, setYawDeg] = useState(28);
  const [pitchDeg, setPitchDeg] = useState(18);
  const [rollDeg, setRollDeg] = useState(0);
  const [perspective, setPerspective] = useState(0.35);
  const [autoFitBounds, setAutoFitBounds] = useState(false);

  // Extrusion controls
  const [depthProfile, setDepthProfile] = useState<DepthProfile>("slab");
  const [extrudeDepth, setExtrudeDepth] = useState(4);
  const [heightMapLayerId, setHeightMapLayerId] = useState<string>("");

  // Sprite stacking controls
  const [stackPitchDeg, setStackPitchDeg] = useState(42);
  const [sliceSpacing, setSliceSpacing] = useState(1.5);
  const [sliceThickness, setSliceThickness] = useState(1);
  const [reverseOrder, setReverseOrder] = useState(false);

  // Lighting & Pixel Quality controls
  const [shadeDepth, setShadeDepth] = useState(true);
  const [directionalLighting, setDirectionalLighting] = useState(false);
  const [lightAzimuthDeg, setLightAzimuthDeg] = useState(-35);
  const [lightElevationDeg, setLightElevationDeg] = useState(45);
  const [ambient, setAmbient] = useState(0.45);
  const [rimStrength, setRimStrength] = useState(0);

  const [supersample, setSupersample] = useState(true);
  const [preScaleEPX, setPreScaleEPX] = useState(false);
  const [paletteLock, setPaletteLock] = useState(false);
  const [removeOrphans, setRemoveOrphans] = useState(false);
  const [fillHoles, setFillHoles] = useState(false);
  const [outlineEnabled, setOutlineEnabled] = useState(false);
  const [outlineHex, setOutlineHex] = useState("#0f0f17");

  // Preview stage controls
  const [previewMode, setPreviewMode] = useState<PreviewMode>("orbit");
  const [previewZoom, setPreviewZoom] = useState<PreviewZoom>("auto");
  const [autoSpin, setAutoSpin] = useState(false);
  const [scrubberFrame, setScrubberFrame] = useState(0);
  const [scrubberPlaying, setScrubberPlaying] = useState(false);

  // Turntable Baker controls
  const [bakeFrameCount, setBakeFrameCount] = useState(8);
  const [spinAxis, setSpinAxis] = useState<SpinAxis>("yaw");
  const [bakeStartDeg, setBakeStartDeg] = useState(0);
  const [bakeSweepDeg, setBakeSweepDeg] = useState(360);
  const [bakePingPong, setBakePingPong] = useState(false);
  const [bakeEasing, setBakeEasing] = useState<TurntableEasing>("linear");
  const [spinTimelineFrames, setSpinTimelineFrames] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  } | null>(null);

  const visibleRasterLayers = useMemo(
    () => layers.filter((l) => l.kind === "raster" && l.visible),
    [layers]
  );

  const allRasterLayers = useMemo(
    () => layers.filter((l) => l.kind === "raster"),
    [layers]
  );

  const boneCount = open ? pixelEngine.rig.bones.length : 0;
  const activeRigClip = open ? pixelEngine.rig.getActiveClip() : null;
  const rigClipFrameCount = Math.max(1, activeRigClip?.frameCount ?? 1);
  const totalRigBakeFrames =
    rigBakeMode === "multidir"
      ? rigDirections * rigClipFrameCount
      : rigDirections;
  const effectiveScrubberTotal =
    mode === "rig" ? totalRigBakeFrames : bakeFrameCount;

  const clampedScrubberFrame = Math.max(
    0,
    Math.min(effectiveScrubberTotal - 1, scrubberFrame)
  );

  // Fall back to extruded mode if rig loses all bones while modal is open
  useEffect(() => {
    if (open && mode === "rig" && boneCount === 0) {
      setMode("extruded");
    }
  }, [open, mode, boneCount]);

  // Escape key & close cleanup
  useEffect(() => {
    if (!open) {
      setAutoSpin(false);
      setScrubberPlaying(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  // Smooth auto-spin preview animation (Orbit mode)
  useEffect(() => {
    if (!open || previewMode !== "orbit" || !autoSpin) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setYawDeg((prev) => normalizeDeg(prev + dt * 90));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, previewMode, autoSpin]);

  // Live Turntable Scrubber playback
  useEffect(() => {
    if (!open || previewMode !== "turntable" || !scrubberPlaying) return;
    const id = window.setInterval(() => {
      setScrubberFrame(
        (prev) => (prev + 1) % Math.max(1, effectiveScrubberTotal)
      );
    }, 150);
    return () => window.clearInterval(id);
  }, [open, previewMode, scrubberPlaying, effectiveScrubberTotal]);

  // Gather source buffers, back-face buffer, height-map buffer, and slice stack
  const {
    singleSource,
    backSourceBuffer,
    heightMapBuffer,
    stackSlices,
    timelineSourceFrames,
    timelineBackFrames,
  } = useMemo(() => {
    if (!open) {
      return {
        singleSource: new PixelBuffer(1, 1),
        backSourceBuffer: null as PixelBuffer | null,
        heightMapBuffer: null as PixelBuffer | null,
        stackSlices: [] as PixelBuffer[],
        timelineSourceFrames: [] as PixelBuffer[],
        timelineBackFrames: undefined as PixelBuffer[] | undefined,
      };
    }

    let single: PixelBuffer;
    if (sourceScope === "visible") {
      const composited = pixelEngine.compositeFrame(layers, currentFrame);
      single = new PixelBuffer(canvasWidth, canvasHeight, composited);
    } else {
      const cel = pixelEngine.getCel(activeLayerId, currentFrame);
      single = cel ? cel.clone() : new PixelBuffer(canvasWidth, canvasHeight);
    }

    const isCustomBackLayer =
      backFaceChoice !== "none" &&
      backFaceChoice !== "mirror" &&
      visibleRasterLayers.some((l) => l.id === backFaceChoice);

    let backBuf: PixelBuffer | null = null;
    if (isCustomBackLayer) {
      const backCel = pixelEngine.getCel(backFaceChoice, currentFrame);
      backBuf = backCel
        ? backCel.clone()
        : new PixelBuffer(canvasWidth, canvasHeight);
    }

    let hmBuf: PixelBuffer | null = null;
    if (depthProfile === "heightmap" && heightMapLayerId) {
      const hmCel = pixelEngine.getCel(heightMapLayerId, currentFrame);
      if (hmCel) hmBuf = hmCel.clone();
    }

    const slices: PixelBuffer[] = [];
    // `layers` is ordered top-to-bottom; reverse for bottom-to-top stacking
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (layer.kind !== "raster" || !layer.visible) continue;
      const cel = pixelEngine.getCel(layer.id, currentFrame);
      if (cel && !cel.isEmpty()) {
        slices.push(cel.clone());
      }
    }

    const tlSources: PixelBuffer[] = [];
    let tlBacks: PixelBuffer[] | undefined;
    if (mode === "extruded" && spinTimelineFrames && frames.length > 1) {
      for (let f = 0; f < frames.length; f++) {
        if (sourceScope === "visible") {
          const comp = pixelEngine.compositeFrame(layers, f);
          tlSources.push(new PixelBuffer(canvasWidth, canvasHeight, comp));
        } else {
          const cel = pixelEngine.getCel(activeLayerId, f);
          tlSources.push(
            cel ? cel.clone() : new PixelBuffer(canvasWidth, canvasHeight)
          );
        }
      }
      if (isCustomBackLayer) {
        tlBacks = [];
        for (let f = 0; f < frames.length; f++) {
          const backCel = pixelEngine.getCel(backFaceChoice, f);
          tlBacks.push(
            backCel
              ? backCel.clone()
              : new PixelBuffer(canvasWidth, canvasHeight)
          );
        }
      }
    }

    return {
      singleSource: single,
      backSourceBuffer: backBuf,
      heightMapBuffer: hmBuf,
      stackSlices: slices,
      timelineSourceFrames: tlSources,
      timelineBackFrames: tlBacks,
    };
  }, [
    open,
    sourceScope,
    layers,
    activeLayerId,
    currentFrame,
    canvasWidth,
    canvasHeight,
    backFaceChoice,
    visibleRasterLayers,
    depthProfile,
    heightMapLayerId,
    mode,
    spinTimelineFrames,
    frames.length,
  ]);

  const outlineColor = useMemo(
    () => (outlineEnabled ? hexToRgba(outlineHex, 255) : null),
    [outlineEnabled, outlineHex]
  );

  const cleanupOptions = useMemo<PixelCleanupOptions | null>(() => {
    if (!paletteLock && !removeOrphans && !fillHoles) return null;
    return {
      paletteLock,
      removeOrphans,
      fillHoles,
      preserveOutline: false,
    };
  }, [paletteLock, removeOrphans, fillHoles]);

  const resolvedPivot = useMemo(() => {
    if (pivotMode === "bottom") {
      return {
        pivotX: (canvasWidth - 1) / 2,
        pivotY: canvasHeight - 1,
      };
    }
    if (pivotMode === "custom") {
      return {
        pivotX: customPivotX,
        pivotY: customPivotY,
      };
    }
    return {
      pivotX: undefined as number | undefined,
      pivotY: undefined as number | undefined,
    };
  }, [pivotMode, canvasWidth, canvasHeight, customPivotX, customPivotY]);

  const turntableAngleOffset = useMemo(() => {
    if (previewMode !== "turntable") return 0;
    if (mode === "rig") {
      const dirIdx =
        rigBakeMode === "multidir"
          ? Math.floor(clampedScrubberFrame / rigClipFrameCount)
          : clampedScrubberFrame;
      return bakeStartDeg + (bakeSweepDeg * dirIdx) / Math.max(2, rigDirections);
    }
    return computeTurntableAngleOffset(clampedScrubberFrame, bakeFrameCount, {
      startDeg: bakeStartDeg,
      sweepDeg: bakeSweepDeg,
      pingPong: bakePingPong,
      easing: bakeEasing,
    });
  }, [
    previewMode,
    mode,
    rigBakeMode,
    clampedScrubberFrame,
    rigClipFrameCount,
    rigDirections,
    bakeFrameCount,
    bakeStartDeg,
    bakeSweepDeg,
    bakePingPong,
    bakeEasing,
  ]);

  const previewRigFrame =
    mode === "rig" && previewMode === "turntable" && rigBakeMode === "multidir"
      ? clampedScrubberFrame % rigClipFrameCount
      : currentFrame;

  const basePitch = mode === "stack" ? stackPitchDeg : pitchDeg;
  const previewYaw =
    mode === "rig" && previewMode === "turntable"
      ? turntableAngleOffset
      : previewMode === "turntable" && spinAxis === "yaw"
        ? yawDeg + turntableAngleOffset
        : yawDeg;
  const previewPitch =
    mode !== "rig" && previewMode === "turntable" && spinAxis === "pitch"
      ? basePitch + turntableAngleOffset
      : basePitch;
  const previewRoll =
    mode !== "rig" && previewMode === "turntable" && spinAxis === "roll"
      ? rollDeg + turntableAngleOffset
      : rollDeg;

  const baseOpts25d = useMemo<Rotate25DOptions>(
    () => ({
      pitchDeg,
      yawDeg,
      rollDeg,
      extrudeDepth,
      perspective,
      shadeDepth,
      supersample,
      outlineColor,
      pivotX: resolvedPivot.pivotX,
      pivotY: resolvedPivot.pivotY,
      autoFitBounds,
      depthProfile,
      heightMap: heightMapBuffer,
      directionalLighting,
      lightAzimuthDeg,
      lightElevationDeg,
      ambient,
      rimStrength,
      backSource: backSourceBuffer,
      mirrorBack: backFaceChoice === "mirror",
      preScaleEPX,
      cleanup: cleanupOptions,
    }),
    [
      pitchDeg,
      yawDeg,
      rollDeg,
      extrudeDepth,
      perspective,
      shadeDepth,
      supersample,
      outlineColor,
      resolvedPivot.pivotX,
      resolvedPivot.pivotY,
      autoFitBounds,
      depthProfile,
      heightMapBuffer,
      directionalLighting,
      lightAzimuthDeg,
      lightElevationDeg,
      ambient,
      rimStrength,
      backSourceBuffer,
      backFaceChoice,
      preScaleEPX,
      cleanupOptions,
    ]
  );

  const baseOptsStack = useMemo<SpriteStackOptions>(
    () => ({
      yawDeg,
      pitchDeg: stackPitchDeg,
      rollDeg,
      perspective,
      sliceSpacing,
      sliceThickness,
      reverseOrder,
      depthShading: shadeDepth,
      directionalLighting,
      lightAzimuthDeg,
      lightElevationDeg,
      ambient,
      autoFitBounds,
      outlineColor,
      cleanup: cleanupOptions,
    }),
    [
      yawDeg,
      stackPitchDeg,
      rollDeg,
      perspective,
      sliceSpacing,
      sliceThickness,
      reverseOrder,
      shadeDepth,
      directionalLighting,
      lightAzimuthDeg,
      lightElevationDeg,
      ambient,
      autoFitBounds,
      outlineColor,
      cleanupOptions,
    ]
  );

  // Render preview buffer whenever options change
  const renderedPreview = useMemo(() => {
    void rigVersion;
    if (!open) return null;
    if (mode === "rig") {
      const originX = (canvasWidth - 1) / 2;
      const originY = (canvasHeight - 1) / 2;
      const composited = pixelEngine.compositeRigFrame(
        layers,
        previewRigFrame,
        {
          pixelSnap: rigPixelSnap,
          rotSprite: rigRotSprite,
          mode: "pose",
          autoZSort: rigAutoZSort,
          perspective3d: perspective,
          directionalLighting,
          lightAzimuthDeg,
          lightElevationDeg,
          rootOrbit: {
            yawDeg: previewYaw,
            pitchDeg: previewPitch,
            rollDeg: previewRoll,
            originX,
            originY,
          },
        },
        true
      );
      return new PixelBuffer(canvasWidth, canvasHeight, composited);
    }

    if (mode === "stack") {
      const slices = stackSlices.length > 0 ? stackSlices : [singleSource];
      return renderSpriteStack(slices, {
        ...baseOptsStack,
        yawDeg: previewYaw,
        pitchDeg: previewPitch,
        rollDeg: previewRoll,
      });
    }

    const useTimelineInPreview =
      previewMode === "turntable" &&
      spinTimelineFrames &&
      timelineSourceFrames.length > 1;
    const src = useTimelineInPreview
      ? timelineSourceFrames[clampedScrubberFrame % timelineSourceFrames.length]
      : singleSource;
    const backSrc =
      useTimelineInPreview && timelineBackFrames && timelineBackFrames.length > 0
        ? timelineBackFrames[clampedScrubberFrame % timelineBackFrames.length]
        : baseOpts25d.backSource;

    return render25DSprite(src, {
      ...baseOpts25d,
      backSource: backSrc,
      yawDeg: previewYaw,
      pitchDeg: previewPitch,
      rollDeg: previewRoll,
    });
  }, [
    open,
    mode,
    rigVersion,
    layers,
    canvasWidth,
    canvasHeight,
    previewRigFrame,
    rigPixelSnap,
    rigRotSprite,
    rigAutoZSort,
    perspective,
    directionalLighting,
    lightAzimuthDeg,
    lightElevationDeg,
    stackSlices,
    singleSource,
    baseOptsStack,
    baseOpts25d,
    previewYaw,
    previewPitch,
    previewRoll,
    previewMode,
    spinTimelineFrames,
    timelineSourceFrames,
    timelineBackFrames,
    clampedScrubberFrame,
  ]);

  // Blit preview PixelBuffer onto modal canvas
  useEffect(() => {
    if (!open || !renderedPreview) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new ImageData(
      new Uint8ClampedArray(renderedPreview.data),
      renderedPreview.width,
      renderedPreview.height
    );
    ctx.putImageData(img, 0, 0);
  }, [open, renderedPreview]);

  if (!open) return null;

  const autoScale = Math.max(
    1,
    Math.min(10, Math.floor(236 / Math.max(canvasWidth, canvasHeight)))
  );
  const previewScale = previewZoom === "auto" ? autoScale : previewZoom;

  const closeModal = () => {
    setAutoSpin(false);
    setScrubberPlaying(false);
    setOpen(false);
  };

  const applyCameraPreset = (preset: Rotate3DCameraPreset) => {
    setAutoSpin(false);
    setYawDeg(preset.yawDeg);
    if (mode === "stack") {
      setStackPitchDeg(Math.max(0, Math.min(75, Math.abs(preset.pitchDeg))));
      setRollDeg(preset.rollDeg);
    } else {
      setPitchDeg(preset.pitchDeg);
      setRollDeg(preset.rollDeg);
    }
  };

  const applyTurntablePreset = (preset: TurntablePreset) => {
    setBakeFrameCount(preset.frameCount);
    setBakeStartDeg(preset.startDeg);
    setBakeSweepDeg(preset.sweepDeg);
    setBakePingPong(preset.pingPong);
    setBakeEasing(preset.easing);
    setScrubberFrame(0);
  };

  const handleApplyCurrentFrame = () => {
    if (!renderedPreview) return;
    commitFloatingSelection();
    const state = useEditorStore.getState();
    const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
    let targetLayerId = activeLayer?.id ?? "";

    if (
      !activeLayer ||
      activeLayer.kind !== "raster" ||
      isLayerEffectivelyLocked(state.layers, activeLayer.id)
    ) {
      targetLayerId = state.addNamedLayer(
        mode === "rig" ? "Rig 3D Sprite" : "3D Sprite"
      );
    }

    const frameIdx = state.currentFrame;
    const cel = pixelEngine.getOrCreateCel(targetLayerId, frameIdx);
    pixelEngine.history.beginTransaction(
      targetLayerId,
      frameIdx,
      mode === "rig" ? "Rig 3D Render" : "3D Rotate"
    );
    pixelEngine.history.captureAllTiles(cel);
    cel.data.set(renderedPreview.data);
    cel.markAllDirty();
    pixelEngine.history.commitTransaction(cel);

    state.setHistoryFlags(
      pixelEngine.history.canUndo,
      pixelEngine.history.canRedo
    );
    syncTimelineCels();
    pixelEngine.emitChange();
    state.setStatusMessage(
      mode === "rig"
        ? "Applied Rig 3D render to current frame"
        : "Applied 3D rotation to current frame"
    );
    closeModal();
  };

  const handleBakeTurntable = () => {
    commitFloatingSelection();
    const state = useEditorStore.getState();

    if (mode === "rig") {
      const originX = (canvasWidth - 1) / 2;
      const originY = (canvasHeight - 1) / 2;
      const result = bakeRigTurntable(pixelEngine, state.layers, {
        mode: rigBakeMode,
        directions: rigDirections,
        startYawDeg: bakeStartDeg,
        sweepDeg: bakeSweepDeg,
        pitchDeg,
        rollDeg,
        sourceFrame: state.currentFrame,
        renderOptions: {
          pixelSnap: state.rigPixelSnap,
          rotSprite: state.rigRotSprite,
          mode: "pose",
          autoZSort: rigAutoZSort,
          perspective3d: perspective,
          directionalLighting,
          lightAzimuthDeg,
          lightElevationDeg,
        },
        originX,
        originY,
      });

      const newLayerId = state.addNamedLayer(
        rigBakeMode === "multidir" ? "Rig Multi-Dir" : "Rig 3D Turntable"
      );

      const addedFrames = result.frames.length > state.frames.length;
      while (useEditorStore.getState().frames.length < result.frames.length) {
        const count = useEditorStore.getState().frames.length;
        pixelEngine.insertEmptyFrame(count, count);
        useEditorStore.getState().insertFrameMetadata(count);
      }

      for (let i = 0; i < result.frames.length; i++) {
        const cel = pixelEngine.getOrCreateCel(newLayerId, i);
        cel.data.set(result.frames[i].data);
        cel.markAllDirty();
      }

      if (rigBakeMode === "multidir") {
        const store = useEditorStore.getState();
        for (const tag of result.tags) {
          store.addTag(tag.name, tag.fromFrame, tag.toFrame, tag.color);
        }
      }

      if (addedFrames) {
        pixelEngine.history.clear();
        useEditorStore.getState().setHistoryFlags(false, false);
      }

      syncTimelineCels();
      useEditorStore.getState().setCurrentFrame(0);
      useEditorStore.getState().setIsPlaying(true);
      pixelEngine.emitChange();
      useEditorStore
        .getState()
        .setStatusMessage(
          rigBakeMode === "multidir"
            ? `Baked ${result.frames.length}-frame Rig multi-dir (${result.tags.length} tags)`
            : `Baked ${result.frames.length}-frame Rig 3D turntable`
        );
      closeModal();
      return;
    }

    const slices = stackSlices.length > 0 ? stackSlices : [singleSource];
    const useTimeline =
      mode === "extruded" && spinTimelineFrames && timelineSourceFrames.length > 1;

    const baked = bakeTurntableFrames({
      mode,
      frameCount: bakeFrameCount,
      spinAxis,
      startDeg: bakeStartDeg,
      sweepDeg: bakeSweepDeg,
      pingPong: bakePingPong,
      easing: bakeEasing,
      source: singleSource,
      slices,
      sourceFrames: useTimeline ? timelineSourceFrames : undefined,
      backFrames: useTimeline ? timelineBackFrames : undefined,
      opts25d: baseOpts25d,
      optsStack: baseOptsStack,
    });

    const newLayerId = state.addNamedLayer(
      mode === "stack" ? "3D Stack Spin" : "3D Turntable"
    );

    const addedFrames = baked.length > state.frames.length;
    while (useEditorStore.getState().frames.length < baked.length) {
      const count = useEditorStore.getState().frames.length;
      pixelEngine.insertEmptyFrame(count, count);
      useEditorStore.getState().insertFrameMetadata(count);
    }

    for (let i = 0; i < baked.length; i++) {
      const cel = pixelEngine.getOrCreateCel(newLayerId, i);
      cel.data.set(baked[i].data);
      cel.markAllDirty();
    }

    if (addedFrames) {
      pixelEngine.history.clear();
      useEditorStore.getState().setHistoryFlags(false, false);
    }

    syncTimelineCels();
    useEditorStore.getState().setCurrentFrame(0);
    useEditorStore.getState().setIsPlaying(true);
    pixelEngine.emitChange();
    useEditorStore
      .getState()
      .setStatusMessage(`Baked ${baked.length}-frame 3D turntable`);
    closeModal();
  };

  const canSpinTimeline = mode === "extruded" && frames.length > 1;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        className="modal-card rotate3d-modal-card"
        role="dialog"
        aria-label="3D Rotate and Turntable"
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Box size={14} />
            <span>3D Studio &amp; Turntable</span>
          </div>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            onClick={closeModal}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>

        <div className="modal-body">
          <div className="rotate3d-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "extruded"}
              className={`rotate3d-tab ${mode === "extruded" ? "active" : ""}`}
              onClick={() => setMode("extruded")}
            >
              2.5D Extruded Spin
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "stack"}
              className={`rotate3d-tab ${mode === "stack" ? "active" : ""}`}
              onClick={() => setMode("stack")}
            >
              Sprite Stacking ({stackSlices.length} slices)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "rig"}
              className={`rotate3d-tab ${mode === "rig" ? "active" : ""}`}
              disabled={boneCount === 0}
              title={
                boneCount === 0
                  ? "Add bones in the Rig workspace to enable Rig 3D"
                  : `Orbit and bake rigged character (${boneCount} bones)`
              }
              onClick={() => setMode("rig")}
            >
              Rig 3D ({boneCount} bones)
            </button>
          </div>

          <div className="rotate3d-layout">
            {/* Left column: interactive preview stage, zoom & turntable scrubber */}
            <div className="rotate3d-preview-pane">
              <div
                className="rotate3d-preview-stage"
                onMouseDown={(e) => {
                  setAutoSpin(false);
                  setScrubberPlaying(false);
                  dragRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    yaw: yawDeg,
                    pitch: mode === "stack" ? stackPitchDeg : pitchDeg,
                  };
                }}
                onMouseMove={(e) => {
                  const drag = dragRef.current;
                  if (!drag) return;
                  const dx = e.clientX - drag.x;
                  const dy = e.clientY - drag.y;
                  setYawDeg(normalizeDeg(drag.yaw + dx * 0.9));
                  if (mode === "stack") {
                    setStackPitchDeg(
                      Math.max(
                        0,
                        Math.min(75, Math.round(drag.pitch + dy * 0.6))
                      )
                    );
                  } else {
                    setPitchDeg(
                      Math.max(
                        -85,
                        Math.min(85, Math.round(drag.pitch + dy * 0.8))
                      )
                    );
                  }
                }}
                onMouseUp={() => {
                  dragRef.current = null;
                }}
                onMouseLeave={() => {
                  dragRef.current = null;
                }}
                title="Drag to orbit 3D angle"
              >
                <canvas
                  ref={canvasRef}
                  width={canvasWidth}
                  height={canvasHeight}
                  className="rotate3d-canvas"
                  style={{
                    width: canvasWidth * previewScale,
                    height: canvasHeight * previewScale,
                  }}
                />
                <AxisGizmo
                  yawDeg={previewYaw}
                  pitchDeg={previewPitch}
                  rollDeg={previewRoll}
                />
              </div>

              {/* Preview zoom row */}
              <div className="rotate3d-preview-bar">
                <div className="rotate3d-btn-row">
                  {ZOOM_OPTIONS.map((z) => (
                    <button
                      key={String(z)}
                      type="button"
                      className={`mini-btn ${previewZoom === z ? "active" : ""}`}
                      onClick={() => setPreviewZoom(z)}
                    >
                      {z === "auto" ? "Auto" : `${z}×`}
                    </button>
                  ))}
                </div>
                <span className="rotate3d-hint">{previewScale}×</span>
              </div>

              {/* Orbit vs Turntable Preview mode switch */}
              <div className="rotate3d-mode-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode === "orbit"}
                  className={`rotate3d-tab ${previewMode === "orbit" ? "active" : ""}`}
                  onClick={() => {
                    setScrubberPlaying(false);
                    setPreviewMode("orbit");
                  }}
                >
                  Orbit
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode === "turntable"}
                  className={`rotate3d-tab ${previewMode === "turntable" ? "active" : ""}`}
                  onClick={() => {
                    setAutoSpin(false);
                    setPreviewMode("turntable");
                  }}
                >
                  Turntable Preview
                </button>
              </div>

              {previewMode === "orbit" ? (
                <div className="rotate3d-preview-bar">
                  <button
                    type="button"
                    className={`mini-btn ${autoSpin ? "active" : ""}`}
                    onClick={() => setAutoSpin((v) => !v)}
                  >
                    {autoSpin ? <Square size={11} /> : <Play size={11} />}
                    <span>{autoSpin ? "Stop Spin" : "Auto-Spin"}</span>
                  </button>
                  <span className="rotate3d-hint">Drag stage to orbit</span>
                </div>
              ) : (
                <div className="rotate3d-scrubber-box">
                  <div className="rotate3d-preview-bar">
                    <button
                      type="button"
                      className={`mini-btn ${scrubberPlaying ? "active" : ""}`}
                      onClick={() => setScrubberPlaying((v) => !v)}
                    >
                      {scrubberPlaying ? (
                        <Pause size={11} />
                      ) : (
                        <Play size={11} />
                      )}
                      <span>{scrubberPlaying ? "Pause" : "Play"}</span>
                    </button>
                    <span className="rotate3d-val">
                      {clampedScrubberFrame + 1}/{effectiveScrubberTotal} (
                      {Math.round(turntableAngleOffset)}°)
                    </span>
                  </div>
                  <input
                    type="range"
                    className="rotate3d-scrubber-range"
                    min={1}
                    max={effectiveScrubberTotal}
                    value={clampedScrubberFrame + 1}
                    onChange={(e) => {
                      setScrubberPlaying(false);
                      setScrubberFrame(Number(e.target.value) - 1);
                    }}
                    aria-label="Turntable preview frame"
                  />
                </div>
              )}
            </div>

            {/* Right column: compact scrollable organized control groups */}
            <div className="rotate3d-controls">
              {/* Group 1: Source & Faces / Stack Note / Rig 3D */}
              {mode === "extruded" ? (
                <div className="rotate3d-group">
                  <div className="rotate3d-group-title">Source &amp; Faces</div>
                  <div className="rotate3d-grid-2">
                    <label className="modal-field">
                      <span>Source</span>
                      <select
                        className="palette-select"
                        value={sourceScope}
                        onChange={(e) =>
                          setSourceScope(e.target.value as SourceScope)
                        }
                      >
                        <option value="visible">All Visible Layers</option>
                        <option value="active">Active Layer Only</option>
                      </select>
                    </label>
                    <label className="modal-field">
                      <span>Back-Face</span>
                      <select
                        className="palette-select"
                        value={backFaceChoice}
                        onChange={(e) => setBackFaceChoice(e.target.value)}
                      >
                        <option value="none">None</option>
                        <option value="mirror">Mirror Front</option>
                        {visibleRasterLayers.map((layer) => (
                          <option key={layer.id} value={layer.id}>
                            {layer.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="rotate3d-pivot-row">
                    <label className="modal-field" style={{ flex: 1 }}>
                      <span>Pivot</span>
                      <select
                        className="palette-select"
                        value={pivotMode}
                        onChange={(e) =>
                          setPivotMode(e.target.value as PivotMode)
                        }
                      >
                        <option value="center">Center</option>
                        <option value="bottom">Bottom</option>
                        <option value="custom">Custom</option>
                      </select>
                    </label>
                    {pivotMode === "custom" && (
                      <>
                        <label className="modal-field rotate3d-pivot-coord">
                          <span>X</span>
                          <input
                            type="number"
                            className="rotate3d-num-input"
                            min={0}
                            max={Math.max(0, canvasWidth - 1)}
                            value={customPivotX}
                            onChange={(e) =>
                              setCustomPivotX(Number(e.target.value) || 0)
                            }
                          />
                        </label>
                        <label className="modal-field rotate3d-pivot-coord">
                          <span>Y</span>
                          <input
                            type="number"
                            className="rotate3d-num-input"
                            min={0}
                            max={Math.max(0, canvasHeight - 1)}
                            value={customPivotY}
                            onChange={(e) =>
                              setCustomPivotY(Number(e.target.value) || 0)
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>
                </div>
              ) : mode === "stack" ? (
                <div className="rotate3d-stack-note">
                  Stacks {stackSlices.length} visible raster layer
                  {stackSlices.length === 1 ? "" : "s"} bottom-to-top.
                  {stackSlices.length <= 1 &&
                    " Add more layers for taller voxel-style stacks."}
                </div>
              ) : (
                <div className="rotate3d-group">
                  <div className="rotate3d-group-title">Rig 3D</div>

                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={rigAutoZSort}
                      onChange={(e) => setRigAutoZSort(e.target.checked)}
                    />
                    <span>Auto Z-Sort Limbs</span>
                  </label>

                  <label className="modal-field">
                    <span>Bake Mode</span>
                    <select
                      className="palette-select"
                      value={rigBakeMode}
                      onChange={(e) => {
                        setRigBakeMode(e.target.value as RigTurntableMode);
                        setScrubberFrame(0);
                      }}
                    >
                      <option value="pose">Current Pose Turntable</option>
                      <option value="multidir">Multi-Dir Clip Bake</option>
                    </select>
                  </label>

                  <div className="modal-field">
                    <span>Directions</span>
                    <div className="rotate3d-btn-row">
                      {RIG_DIRECTION_OPTIONS.map((dir) => (
                        <button
                          key={dir}
                          type="button"
                          className={`mini-btn ${rigDirections === dir ? "active" : ""}`}
                          onClick={() => {
                            setRigDirections(dir);
                            setScrubberFrame(0);
                          }}
                        >
                          {dir}-Dir
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rotate3d-stack-note">
                    {rigBakeMode === "multidir"
                      ? `Bakes "${activeRigClip?.name ?? "Clip"}" (${rigClipFrameCount}f) × ${rigDirections} dirs = ${totalRigBakeFrames} frames + ${rigDirections} auto tags.`
                      : `Spins current rig pose across ${rigDirections} angles (${totalRigBakeFrames} frames).`}
                  </div>
                </div>
              )}

              {/* Group 2: Transform */}
              <div className="rotate3d-group">
                <div className="rotate3d-group-title">
                  <span>Transform</span>
                  <button
                    type="button"
                    className="mini-btn"
                    title="Reset Angles"
                    onClick={() =>
                      applyCameraPreset(ROTATE3D_CAMERA_PRESETS.front)
                    }
                  >
                    <RotateCcw size={10} />
                    <span>Reset</span>
                  </button>
                </div>

                <div className="rotate3d-btn-row">
                  {CAMERA_PRESET_LIST.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="mini-btn"
                      onClick={() => applyCameraPreset(preset)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <label className="rotate3d-slider-row">
                  <span>Yaw (Y)</span>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={yawDeg}
                    onChange={(e) => setYawDeg(Number(e.target.value))}
                  />
                  <span className="rotate3d-val">{yawDeg}°</span>
                </label>

                {mode !== "stack" ? (
                  <label className="rotate3d-slider-row">
                    <span>Pitch (X)</span>
                    <input
                      type="range"
                      min={-85}
                      max={85}
                      value={pitchDeg}
                      onChange={(e) => setPitchDeg(Number(e.target.value))}
                    />
                    <span className="rotate3d-val">{pitchDeg}°</span>
                  </label>
                ) : (
                  <label className="rotate3d-slider-row">
                    <span>Tilt (X)</span>
                    <input
                      type="range"
                      min={0}
                      max={75}
                      value={stackPitchDeg}
                      onChange={(e) => setStackPitchDeg(Number(e.target.value))}
                    />
                    <span className="rotate3d-val">{stackPitchDeg}°</span>
                  </label>
                )}

                <label className="rotate3d-slider-row">
                  <span>Roll (Z)</span>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={rollDeg}
                    onChange={(e) => setRollDeg(Number(e.target.value))}
                  />
                  <span className="rotate3d-val">{rollDeg}°</span>
                </label>

                <label className="rotate3d-slider-row">
                  <span>Perspective</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(perspective * 100)}
                    onChange={(e) =>
                      setPerspective(Number(e.target.value) / 100)
                    }
                  />
                  <span className="rotate3d-val">
                    {Math.round(perspective * 100)}%
                  </span>
                </label>

                {mode !== "rig" && (
                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={autoFitBounds}
                      onChange={(e) => setAutoFitBounds(e.target.checked)}
                    />
                    <span>Safe Auto-Fit</span>
                  </label>
                )}
              </div>

              {/* Group 3: Extrusion / Stack */}
              {mode !== "rig" && (
                <div className="rotate3d-group">
                  <div className="rotate3d-group-title">
                    {mode === "extruded" ? "Extrusion" : "Sprite Stack"}
                  </div>

                  {mode === "extruded" ? (
                    <>
                      <label className="modal-field">
                        <span>Depth Profile</span>
                        <select
                          className="palette-select"
                          value={depthProfile}
                          onChange={(e) =>
                            setDepthProfile(e.target.value as DepthProfile)
                          }
                        >
                          <option value="slab">Slab</option>
                          <option value="bevel">Bevel</option>
                          <option value="pillow">Pillow</option>
                          <option value="heightmap">Height-Map</option>
                        </select>
                      </label>

                      <label className="rotate3d-slider-row">
                        <span>Thickness</span>
                        <input
                          type="range"
                          min={0}
                          max={16}
                          step={1}
                          value={extrudeDepth}
                          onChange={(e) =>
                            setExtrudeDepth(Number(e.target.value))
                          }
                        />
                        <span className="rotate3d-val">{extrudeDepth}px</span>
                      </label>

                      {depthProfile === "heightmap" && (
                        <label className="modal-field">
                          <span>Height-Map Layer</span>
                          <select
                            className="palette-select"
                            value={heightMapLayerId}
                            onChange={(e) =>
                              setHeightMapLayerId(e.target.value)
                            }
                          >
                            <option value="">None (Uniform Slab)</option>
                            {allRasterLayers.map((layer) => (
                              <option key={layer.id} value={layer.id}>
                                {layer.name}
                                {layer.visible ? "" : " (hidden)"}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </>
                  ) : (
                    <>
                      <label className="rotate3d-slider-row">
                        <span>Slice Step</span>
                        <input
                          type="range"
                          min={0.25}
                          max={3}
                          step={0.25}
                          value={sliceSpacing}
                          onChange={(e) =>
                            setSliceSpacing(Number(e.target.value))
                          }
                        />
                        <span className="rotate3d-val">{sliceSpacing}px</span>
                      </label>

                      <label className="rotate3d-slider-row">
                        <span>Slice Thick</span>
                        <input
                          type="range"
                          min={0.5}
                          max={3}
                          step={0.25}
                          value={sliceThickness}
                          onChange={(e) =>
                            setSliceThickness(Number(e.target.value))
                          }
                        />
                        <span className="rotate3d-val">{sliceThickness}×</span>
                      </label>

                      <label className="modal-checkbox">
                        <input
                          type="checkbox"
                          checked={reverseOrder}
                          onChange={(e) => setReverseOrder(e.target.checked)}
                        />
                        <span>Reverse Order (Top-to-Bottom)</span>
                      </label>
                    </>
                  )}
                </div>
              )}

              {/* Group 4: Lighting & Pixel Quality */}
              <div className="rotate3d-group">
                <div className="rotate3d-group-title">
                  {mode === "rig" ? "3D Lighting" : "Lighting & Pixel Quality"}
                </div>

                <div className="rotate3d-toggles">
                  {mode !== "rig" && (
                    <label className="modal-checkbox">
                      <input
                        type="checkbox"
                        checked={shadeDepth}
                        onChange={(e) => setShadeDepth(e.target.checked)}
                      />
                      <span>Depth Shading</span>
                    </label>
                  )}

                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={directionalLighting}
                      onChange={(e) =>
                        setDirectionalLighting(e.target.checked)
                      }
                    />
                    <span>Directional Lighting</span>
                  </label>
                </div>

                {directionalLighting && (
                  <div className="rotate3d-subpanel">
                    <label className="rotate3d-slider-row">
                      <span>Azimuth</span>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        value={lightAzimuthDeg}
                        onChange={(e) =>
                          setLightAzimuthDeg(Number(e.target.value))
                        }
                      />
                      <span className="rotate3d-val">{lightAzimuthDeg}°</span>
                    </label>

                    <label className="rotate3d-slider-row">
                      <span>Elevation</span>
                      <input
                        type="range"
                        min={0}
                        max={90}
                        value={lightElevationDeg}
                        onChange={(e) =>
                          setLightElevationDeg(Number(e.target.value))
                        }
                      />
                      <span className="rotate3d-val">{lightElevationDeg}°</span>
                    </label>

                    {mode !== "rig" && (
                      <label className="rotate3d-slider-row">
                        <span>Ambient</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(ambient * 100)}
                          onChange={(e) =>
                            setAmbient(Number(e.target.value) / 100)
                          }
                        />
                        <span className="rotate3d-val">
                          {Math.round(ambient * 100)}%
                        </span>
                      </label>
                    )}

                    {mode === "extruded" && (
                      <label className="rotate3d-slider-row">
                        <span>Rim</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(rimStrength * 100)}
                          onChange={(e) =>
                            setRimStrength(Number(e.target.value) / 100)
                          }
                        />
                        <span className="rotate3d-val">
                          {Math.round(rimStrength * 100)}%
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {mode !== "rig" && (
                  <div className="rotate3d-toggles">
                    {mode === "extruded" && (
                      <>
                        <label className="modal-checkbox">
                          <input
                            type="checkbox"
                            checked={supersample}
                            onChange={(e) => setSupersample(e.target.checked)}
                          />
                          <span>Clean 2× Sample</span>
                        </label>

                        <label className="modal-checkbox">
                          <input
                            type="checkbox"
                            checked={preScaleEPX}
                            onChange={(e) => setPreScaleEPX(e.target.checked)}
                          />
                          <span>EPX Pre-Scale</span>
                        </label>
                      </>
                    )}

                    <label className="modal-checkbox">
                      <input
                        type="checkbox"
                        checked={paletteLock}
                        onChange={(e) => setPaletteLock(e.target.checked)}
                      />
                      <span>Palette Lock</span>
                    </label>

                    <label className="modal-checkbox">
                      <input
                        type="checkbox"
                        checked={removeOrphans}
                        onChange={(e) => setRemoveOrphans(e.target.checked)}
                      />
                      <span>Orphans</span>
                    </label>

                    <label className="modal-checkbox">
                      <input
                        type="checkbox"
                        checked={fillHoles}
                        onChange={(e) => setFillHoles(e.target.checked)}
                      />
                      <span>Fill Holes</span>
                    </label>

                    <div className="rotate3d-outline-row">
                      <label className="modal-checkbox">
                        <input
                          type="checkbox"
                          checked={outlineEnabled}
                          onChange={(e) => setOutlineEnabled(e.target.checked)}
                        />
                        <span>1px Outline</span>
                      </label>
                      {outlineEnabled && (
                        <input
                          type="color"
                          value={outlineHex}
                          onChange={(e) => setOutlineHex(e.target.value)}
                          className="rotate3d-color-input"
                          title="Outline Color"
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Group 5: Turntable Baker */}
              <div className="rotate3d-group">
                <div className="rotate3d-group-title">
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <Film size={11} />
                    <span>Turntable Baker</span>
                  </span>
                </div>

                {mode !== "rig" && (
                  <>
                    <div className="rotate3d-btn-row">
                      {TURNTABLE_PRESET_LIST.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className="mini-btn"
                          onClick={() => applyTurntablePreset(preset)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <div className="rotate3d-grid-2">
                      <label className="modal-field">
                        <span>Frames</span>
                        <select
                          className="palette-select"
                          value={bakeFrameCount}
                          onChange={(e) => {
                            const nextCount = Number(e.target.value);
                            setBakeFrameCount(nextCount);
                            setScrubberFrame((f) => Math.min(f, nextCount - 1));
                          }}
                        >
                          {FRAME_COUNT_OPTIONS.map((count) => (
                            <option key={count} value={count}>
                              {count} frames
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="modal-field">
                        <span>Spin Axis</span>
                        <select
                          className="palette-select"
                          value={spinAxis}
                          onChange={(e) =>
                            setSpinAxis(e.target.value as SpinAxis)
                          }
                        >
                          <option value="yaw">Yaw (Turntable)</option>
                          <option value="pitch">Pitch (Tumble)</option>
                          <option value="roll">Roll (Wheel)</option>
                        </select>
                      </label>
                    </div>
                  </>
                )}

                <div className="rotate3d-grid-2">
                  <label className="modal-field">
                    <span>Start°</span>
                    <input
                      type="number"
                      className="rotate3d-num-input"
                      min={-180}
                      max={180}
                      value={bakeStartDeg}
                      onChange={(e) =>
                        setBakeStartDeg(Number(e.target.value) || 0)
                      }
                    />
                  </label>

                  <label className="modal-field">
                    <span>Sweep°</span>
                    <input
                      type="number"
                      className="rotate3d-num-input"
                      min={-360}
                      max={360}
                      value={bakeSweepDeg}
                      onChange={(e) =>
                        setBakeSweepDeg(Number(e.target.value) || 0)
                      }
                    />
                  </label>
                </div>

                {mode !== "rig" && (
                  <>
                    <div className="rotate3d-grid-2">
                      <label className="modal-field">
                        <span>Easing</span>
                        <select
                          className="palette-select"
                          value={bakeEasing}
                          onChange={(e) =>
                            setBakeEasing(e.target.value as TurntableEasing)
                          }
                        >
                          <option value="linear">Linear</option>
                          <option value="easeInOut">Ease In-Out</option>
                          <option value="easeIn">Ease In</option>
                          <option value="easeOut">Ease Out</option>
                        </select>
                      </label>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-end",
                          paddingBottom: 3,
                        }}
                      >
                        <label className="modal-checkbox">
                          <input
                            type="checkbox"
                            checked={bakePingPong}
                            onChange={(e) => setBakePingPong(e.target.checked)}
                          />
                          <span>Ping-Pong</span>
                        </label>
                      </div>
                    </div>

                    <label
                      className="modal-checkbox"
                      style={{ opacity: canSpinTimeline ? 1 : 0.5 }}
                    >
                      <input
                        type="checkbox"
                        disabled={!canSpinTimeline}
                        checked={canSpinTimeline && spinTimelineFrames}
                        onChange={(e) =>
                          setSpinTimelineFrames(e.target.checked)
                        }
                      />
                      <span>
                        Spin Across Timeline Frames
                        {frames.length > 1 ? ` (${frames.length}f)` : ""}
                      </span>
                    </label>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="mini-btn" onClick={closeModal}>
              Cancel
            </button>
            <button
              type="button"
              className="mini-btn"
              onClick={handleApplyCurrentFrame}
            >
              <Sparkles size={12} />
              <span>Apply to Frame</span>
            </button>
            <button
              type="button"
              className="export-cta"
              onClick={handleBakeTurntable}
            >
              <Film size={13} />
              <span>
                {mode === "rig"
                  ? rigBakeMode === "multidir"
                    ? `Bake Multi-Dir (${totalRigBakeFrames}f)`
                    : `Bake Turntable (${totalRigBakeFrames}f)`
                  : `Bake Turntable (${bakeFrameCount}f)`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
