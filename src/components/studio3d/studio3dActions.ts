import { hexToRgba, PixelBuffer } from "../../engine/document/PixelBuffer";
import {
  type LayerCompositingInfo,
  pixelEngine,
} from "../../engine/document/PixelEngine";
import { commitFloatingSelection } from "../../engine/document/selectionActions";
import { syncTimelineCels } from "../../engine/document/timelineActions";
import { bakeRigTurntable } from "../../engine/rig/export/bake";
import type { PixelCleanupOptions } from "../../engine/rig/pixelCleanup";
import {
  bakeTurntableFrames,
  computeTurntableAngleOffset,
  render25DSprite,
  renderSpriteStack,
  ROTATE3D_CAMERA_PRESETS,
  type Rotate25DOptions,
  type Rotate3DCameraPreset,
  type SpriteStackOptions,
} from "../../engine/tools/rotate3d";
import type { Scene3DGridMode } from "../../engine/tools/scene3d";
import {
  isLayerEffectivelyLocked,
  type Studio3DState,
  useEditorStore,
} from "../../store/editorStore";

export const STUDIO3D_SIDE_PRESET: Rotate3DCameraPreset = {
  id: "side",
  label: "Side",
  yawDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
};

export interface Studio3DSources {
  singleSource: PixelBuffer;
  backSourceBuffer: PixelBuffer | null;
  heightMapBuffer: PixelBuffer | null;
  stackSlices: PixelBuffer[];
  timelineSourceFrames: PixelBuffer[];
  timelineBackFrames: PixelBuffer[] | undefined;
}

export function resolveStudio3DPivot(
  s: Studio3DState,
  canvasWidth: number,
  canvasHeight: number
): { pivotX: number | undefined; pivotY: number | undefined; floorY: number } {
  if (s.pivotMode === "bottom") {
    return {
      pivotX: (canvasWidth - 1) / 2,
      pivotY: canvasHeight - 1,
      floorY: 0.5,
    };
  }
  if (s.pivotMode === "custom") {
    return {
      pivotX: s.customPivotX,
      pivotY: s.customPivotY,
      floorY: canvasHeight - 0.5 - s.customPivotY,
    };
  }
  return {
    pivotX: undefined,
    pivotY: undefined,
    floorY: canvasHeight / 2,
  };
}

export function collectStudio3DSources(
  s: Studio3DState,
  layers: readonly LayerCompositingInfo[],
  activeLayerId: string,
  currentFrame: number,
  frameCount: number,
  canvasWidth: number,
  canvasHeight: number
): Studio3DSources {
  const visibleRasterLayers = layers.filter(
    (l) => l.kind === "raster" && l.visible
  );

  let singleSource: PixelBuffer;
  if (s.sourceScope === "visible") {
    const composited = pixelEngine.compositeFrame(layers, currentFrame);
    singleSource = new PixelBuffer(canvasWidth, canvasHeight, composited);
  } else {
    const cel = pixelEngine.getCel(activeLayerId, currentFrame);
    singleSource = cel
      ? cel.clone()
      : new PixelBuffer(canvasWidth, canvasHeight);
  }

  const isCustomBackLayer =
    s.backFaceChoice !== "none" &&
    s.backFaceChoice !== "mirror" &&
    visibleRasterLayers.some((l) => l.id === s.backFaceChoice);

  let backSourceBuffer: PixelBuffer | null = null;
  if (isCustomBackLayer) {
    const backCel = pixelEngine.getCel(s.backFaceChoice, currentFrame);
    backSourceBuffer = backCel
      ? backCel.clone()
      : new PixelBuffer(canvasWidth, canvasHeight);
  }

  let heightMapBuffer: PixelBuffer | null = null;
  if (s.depthProfile === "heightmap" && s.heightMapLayerId) {
    const hmCel = pixelEngine.getCel(s.heightMapLayerId, currentFrame);
    if (hmCel) heightMapBuffer = hmCel.clone();
  }

  const stackSlices: PixelBuffer[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.kind !== "raster" || !layer.visible) continue;
    const cel = pixelEngine.getCel(layer.id, currentFrame);
    if (cel && !cel.isEmpty()) {
      stackSlices.push(cel.clone());
    }
  }

  const timelineSourceFrames: PixelBuffer[] = [];
  let timelineBackFrames: PixelBuffer[] | undefined;
  if (s.mode === "extruded" && s.spinTimelineFrames && frameCount > 1) {
    for (let f = 0; f < frameCount; f++) {
      if (s.sourceScope === "visible") {
        const comp = pixelEngine.compositeFrame(layers, f);
        timelineSourceFrames.push(new PixelBuffer(canvasWidth, canvasHeight, comp));
      } else {
        const cel = pixelEngine.getCel(activeLayerId, f);
        timelineSourceFrames.push(
          cel ? cel.clone() : new PixelBuffer(canvasWidth, canvasHeight)
        );
      }
    }
    if (isCustomBackLayer) {
      timelineBackFrames = [];
      for (let f = 0; f < frameCount; f++) {
        const backCel = pixelEngine.getCel(s.backFaceChoice, f);
        timelineBackFrames.push(
          backCel ? backCel.clone() : new PixelBuffer(canvasWidth, canvasHeight)
        );
      }
    }
  }

  return {
    singleSource,
    backSourceBuffer,
    heightMapBuffer,
    stackSlices,
    timelineSourceFrames,
    timelineBackFrames,
  };
}

export function buildStudio3DCleanup(
  s: Studio3DState
): PixelCleanupOptions | null {
  if (!s.paletteLock && !s.removeOrphans && !s.fillHoles) return null;
  return {
    paletteLock: s.paletteLock,
    removeOrphans: s.removeOrphans,
    fillHoles: s.fillHoles,
    preserveOutline: false,
  };
}

export function computeStudio3DAngles(s: Studio3DState): {
  previewYaw: number;
  previewPitch: number;
  previewRoll: number;
  turntableAngleOffset: number;
  previewRigFrame: number;
  effectiveScrubberTotal: number;
  clampedScrubberFrame: number;
} {
  const activeRigClip = pixelEngine.rig.getActiveClip();
  const rigClipFrameCount = Math.max(1, activeRigClip?.frameCount ?? 1);
  const totalRigBakeFrames =
    s.rigBakeMode === "multidir"
      ? s.rigDirections * rigClipFrameCount
      : s.rigDirections;
  const effectiveScrubberTotal =
    s.mode === "rig" ? totalRigBakeFrames : s.bakeFrameCount;
  const clampedScrubberFrame = Math.max(
    0,
    Math.min(effectiveScrubberTotal - 1, s.scrubberFrame)
  );

  let turntableAngleOffset = 0;
  if (s.previewMode === "turntable") {
    if (s.mode === "rig") {
      const dirIdx =
        s.rigBakeMode === "multidir"
          ? Math.floor(clampedScrubberFrame / rigClipFrameCount)
          : clampedScrubberFrame;
      turntableAngleOffset =
        s.bakeStartDeg +
        (s.bakeSweepDeg * dirIdx) / Math.max(2, s.rigDirections);
    } else {
      turntableAngleOffset = computeTurntableAngleOffset(
        clampedScrubberFrame,
        s.bakeFrameCount,
        {
          startDeg: s.bakeStartDeg,
          sweepDeg: s.bakeSweepDeg,
          pingPong: s.bakePingPong,
          easing: s.bakeEasing,
        }
      );
    }
  }

  const currentFrame = useEditorStore.getState().currentFrame;
  const previewRigFrame =
    s.mode === "rig" &&
    s.previewMode === "turntable" &&
    s.rigBakeMode === "multidir"
      ? clampedScrubberFrame % rigClipFrameCount
      : currentFrame;

  const basePitch = s.mode === "stack" ? s.stackPitchDeg : s.pitchDeg;
  const previewYaw =
    s.mode === "rig" && s.previewMode === "turntable"
      ? turntableAngleOffset
      : s.previewMode === "turntable" && s.spinAxis === "yaw"
        ? s.yawDeg + turntableAngleOffset
        : s.yawDeg;
  const previewPitch =
    s.mode !== "rig" && s.previewMode === "turntable" && s.spinAxis === "pitch"
      ? basePitch + turntableAngleOffset
      : basePitch;
  const previewRoll =
    s.mode !== "rig" && s.previewMode === "turntable" && s.spinAxis === "roll"
      ? s.rollDeg + turntableAngleOffset
      : s.rollDeg;

  return {
    previewYaw,
    previewPitch,
    previewRoll,
    turntableAngleOffset,
    previewRigFrame,
    effectiveScrubberTotal,
    clampedScrubberFrame,
  };
}

export function renderStudio3DPreviewBuffer(
  s: Studio3DState,
  sources: Studio3DSources,
  layers: readonly LayerCompositingInfo[],
  canvasWidth: number,
  canvasHeight: number,
  rigPixelSnap: boolean,
  rigRotSprite: boolean
): PixelBuffer {
  const angles = computeStudio3DAngles(s);
  const effectivePerspective = s.gridMode === "isometric" ? 0 : s.perspective;

  if (s.mode === "rig" && pixelEngine.rig.bones.length > 0) {
    const originX = (canvasWidth - 1) / 2;
    const originY = (canvasHeight - 1) / 2;
    const composited = pixelEngine.compositeRigFrame(
      layers,
      angles.previewRigFrame,
      {
        pixelSnap: rigPixelSnap,
        rotSprite: rigRotSprite,
        mode: "pose",
        autoZSort: s.rigAutoZSort,
        perspective3d: effectivePerspective,
        directionalLighting: s.directionalLighting,
        lightAzimuthDeg: s.lightAzimuthDeg,
        lightElevationDeg: s.lightElevationDeg,
        rootOrbit: {
          yawDeg: angles.previewYaw,
          pitchDeg: angles.previewPitch,
          rollDeg: angles.previewRoll,
          originX,
          originY,
        },
      },
      true
    );
    return new PixelBuffer(canvasWidth, canvasHeight, composited);
  }

  const outlineColor = s.outlineEnabled ? hexToRgba(s.outlineHex, 255) : null;
  const cleanup = buildStudio3DCleanup(s);

  if (s.mode === "stack") {
    const slices =
      sources.stackSlices.length > 0
        ? sources.stackSlices
        : [sources.singleSource];
    const optsStack: SpriteStackOptions = {
      yawDeg: angles.previewYaw,
      pitchDeg: angles.previewPitch,
      rollDeg: angles.previewRoll,
      perspective: effectivePerspective,
      sliceSpacing: s.sliceSpacing,
      sliceThickness: s.sliceThickness,
      reverseOrder: s.reverseOrder,
      depthShading: s.shadeDepth,
      directionalLighting: s.directionalLighting,
      lightAzimuthDeg: s.lightAzimuthDeg,
      lightElevationDeg: s.lightElevationDeg,
      ambient: s.ambient,
      autoFitBounds: s.autoFitBounds,
      outlineColor,
      cleanup,
    };
    return renderSpriteStack(slices, optsStack);
  }

  const pivot = resolveStudio3DPivot(s, canvasWidth, canvasHeight);
  const useTimelineInPreview =
    s.previewMode === "turntable" &&
    s.spinTimelineFrames &&
    sources.timelineSourceFrames.length > 1;
  const src = useTimelineInPreview
    ? sources.timelineSourceFrames[
        angles.clampedScrubberFrame % sources.timelineSourceFrames.length
      ]
    : sources.singleSource;
  const backSrc =
    useTimelineInPreview &&
    sources.timelineBackFrames &&
    sources.timelineBackFrames.length > 0
      ? sources.timelineBackFrames[
          angles.clampedScrubberFrame % sources.timelineBackFrames.length
        ]
      : sources.backSourceBuffer;

  const opts25d: Rotate25DOptions = {
    pitchDeg: angles.previewPitch,
    yawDeg: angles.previewYaw,
    rollDeg: angles.previewRoll,
    extrudeDepth: s.extrudeDepth,
    perspective: effectivePerspective,
    shadeDepth: s.shadeDepth,
    supersample: s.supersample,
    outlineColor,
    pivotX: pivot.pivotX,
    pivotY: pivot.pivotY,
    autoFitBounds: s.autoFitBounds,
    depthProfile: s.depthProfile,
    heightMap: sources.heightMapBuffer,
    directionalLighting: s.directionalLighting,
    lightAzimuthDeg: s.lightAzimuthDeg,
    lightElevationDeg: s.lightElevationDeg,
    ambient: s.ambient,
    rimStrength: s.rimStrength,
    backSource: backSrc,
    mirrorBack: s.backFaceChoice === "mirror",
    preScaleEPX: s.preScaleEPX,
    cleanup,
  };
  return render25DSprite(src, opts25d);
}

export function applyStudio3DCameraPreset(preset: Rotate3DCameraPreset): void {
  const st = useEditorStore.getState();
  const patch: Partial<Studio3DState> = {
    autoSpin: false,
    yawDeg: preset.yawDeg,
    rollDeg: preset.rollDeg,
  };
  if (st.studio3d.mode === "stack") {
    patch.stackPitchDeg = Math.max(
      0,
      Math.min(75, Math.abs(preset.pitchDeg))
    );
  } else {
    patch.pitchDeg = preset.pitchDeg;
  }
  if (preset.id === ROTATE3D_CAMERA_PRESETS.iso2to1.id) {
    patch.gridMode = "isometric";
    patch.perspective = 0;
  }
  st.patchStudio3D(patch);
}

export function setStudio3DGridMode(gridMode: Scene3DGridMode): void {
  const st = useEditorStore.getState();
  const cur = st.studio3d;
  const patch: Partial<Studio3DState> = { gridMode };
  if (gridMode === "isometric") {
    if (cur.perspective > 0) patch.perspective = 0;
    if (cur.yawDeg === 0 && cur.pitchDeg === 0) {
      patch.yawDeg = 45;
      patch.pitchDeg = 30;
    }
  } else if (gridMode === "perspective") {
    if (cur.perspective === 0) {
      patch.perspective = 0.35;
    }
  }
  st.patchStudio3D(patch);
}

export function applyStudio3DToCurrentFrameAction(): void {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const s = state.studio3d;
  const sources = collectStudio3DSources(
    s,
    state.layers,
    state.activeLayerId,
    state.currentFrame,
    state.frames.length,
    state.canvasWidth,
    state.canvasHeight
  );
  const rendered = renderStudio3DPreviewBuffer(
    s,
    sources,
    state.layers,
    state.canvasWidth,
    state.canvasHeight,
    state.rigPixelSnap,
    state.rigRotSprite
  );

  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  let targetLayerId = activeLayer?.id ?? "";
  if (
    !activeLayer ||
    activeLayer.kind !== "raster" ||
    isLayerEffectivelyLocked(state.layers, activeLayer.id)
  ) {
    targetLayerId = state.addNamedLayer(
      s.mode === "rig" ? "Rig 3D Sprite" : "3D Sprite"
    );
  }

  const frameIdx = state.currentFrame;
  const cel = pixelEngine.getOrCreateCel(targetLayerId, frameIdx);
  pixelEngine.history.beginTransaction(
    targetLayerId,
    frameIdx,
    s.mode === "rig" ? "Rig 3D Render" : "3D Rotate"
  );
  pixelEngine.history.captureAllTiles(cel);
  cel.data.set(rendered.data);
  cel.markAllDirty();
  pixelEngine.history.commitTransaction(cel);

  state.setHistoryFlags(
    pixelEngine.history.canUndo,
    pixelEngine.history.canRedo
  );
  syncTimelineCels();
  pixelEngine.emitChange();
  state.setStatusMessage(
    s.mode === "rig"
      ? "Applied Rig 3D render to current frame"
      : "Applied 3D rotation to current frame"
  );
}

export function bakeStudio3DTurntableAction(): void {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const s = state.studio3d;
  const effectivePerspective = s.gridMode === "isometric" ? 0 : s.perspective;

  if (s.mode === "rig" && pixelEngine.rig.bones.length > 0) {
    const originX = (state.canvasWidth - 1) / 2;
    const originY = (state.canvasHeight - 1) / 2;
    const result = bakeRigTurntable(pixelEngine, state.layers, {
      mode: s.rigBakeMode,
      directions: s.rigDirections,
      startYawDeg: s.bakeStartDeg,
      sweepDeg: s.bakeSweepDeg,
      pitchDeg: s.pitchDeg,
      rollDeg: s.rollDeg,
      sourceFrame: state.currentFrame,
      renderOptions: {
        pixelSnap: state.rigPixelSnap,
        rotSprite: state.rigRotSprite,
        mode: "pose",
        autoZSort: s.rigAutoZSort,
        perspective3d: effectivePerspective,
        directionalLighting: s.directionalLighting,
        lightAzimuthDeg: s.lightAzimuthDeg,
        lightElevationDeg: s.lightElevationDeg,
      },
      originX,
      originY,
    });

    const newLayerId = state.addNamedLayer(
      s.rigBakeMode === "multidir" ? "Rig Multi-Dir" : "Rig 3D Turntable"
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

    if (s.rigBakeMode === "multidir") {
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
        s.rigBakeMode === "multidir"
          ? `Baked ${result.frames.length}-frame Rig multi-dir (${result.tags.length} tags)`
          : `Baked ${result.frames.length}-frame Rig 3D turntable`
      );
    return;
  }

  const sources = collectStudio3DSources(
    s,
    state.layers,
    state.activeLayerId,
    state.currentFrame,
    state.frames.length,
    state.canvasWidth,
    state.canvasHeight
  );
  const slices =
    sources.stackSlices.length > 0
      ? sources.stackSlices
      : [sources.singleSource];
  const useTimeline =
    s.mode === "extruded" &&
    s.spinTimelineFrames &&
    sources.timelineSourceFrames.length > 1;
  const outlineColor = s.outlineEnabled ? hexToRgba(s.outlineHex, 255) : null;
  const cleanup = buildStudio3DCleanup(s);
  const pivot = resolveStudio3DPivot(s, state.canvasWidth, state.canvasHeight);

  const opts25d: Rotate25DOptions = {
    pitchDeg: s.pitchDeg,
    yawDeg: s.yawDeg,
    rollDeg: s.rollDeg,
    extrudeDepth: s.extrudeDepth,
    perspective: effectivePerspective,
    shadeDepth: s.shadeDepth,
    supersample: s.supersample,
    outlineColor,
    pivotX: pivot.pivotX,
    pivotY: pivot.pivotY,
    autoFitBounds: s.autoFitBounds,
    depthProfile: s.depthProfile,
    heightMap: sources.heightMapBuffer,
    directionalLighting: s.directionalLighting,
    lightAzimuthDeg: s.lightAzimuthDeg,
    lightElevationDeg: s.lightElevationDeg,
    ambient: s.ambient,
    rimStrength: s.rimStrength,
    backSource: sources.backSourceBuffer,
    mirrorBack: s.backFaceChoice === "mirror",
    preScaleEPX: s.preScaleEPX,
    cleanup,
  };

  const optsStack: SpriteStackOptions = {
    yawDeg: s.yawDeg,
    pitchDeg: s.stackPitchDeg,
    rollDeg: s.rollDeg,
    perspective: effectivePerspective,
    sliceSpacing: s.sliceSpacing,
    sliceThickness: s.sliceThickness,
    reverseOrder: s.reverseOrder,
    depthShading: s.shadeDepth,
    directionalLighting: s.directionalLighting,
    lightAzimuthDeg: s.lightAzimuthDeg,
    lightElevationDeg: s.lightElevationDeg,
    ambient: s.ambient,
    autoFitBounds: s.autoFitBounds,
    outlineColor,
    cleanup,
  };

  const baked = bakeTurntableFrames({
    mode: s.mode === "stack" ? "stack" : "extruded",
    frameCount: s.bakeFrameCount,
    spinAxis: s.spinAxis,
    startDeg: s.bakeStartDeg,
    sweepDeg: s.bakeSweepDeg,
    pingPong: s.bakePingPong,
    easing: s.bakeEasing,
    source: sources.singleSource,
    slices,
    sourceFrames: useTimeline ? sources.timelineSourceFrames : undefined,
    backFrames: useTimeline ? sources.timelineBackFrames : undefined,
    opts25d,
    optsStack,
  });

  const newLayerId = state.addNamedLayer(
    s.mode === "stack" ? "3D Stack Spin" : "3D Turntable"
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
}
