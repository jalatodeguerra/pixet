import { hexToRgba, PixelBuffer } from "../../engine/document/PixelBuffer";
import {
  type LayerCompositingInfo,
  pixelEngine,
} from "../../engine/document/PixelEngine";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import { commitFloatingSelection } from "../../engine/document/selectionActions";
import { syncTimelineCels } from "../../engine/document/timelineActions";
import {
  downloadPixelBufferAsPng,
  generateDepthMap,
  generateHeightMap,
  generateNormalMap,
} from "../../engine/gamedev/pbrMaps";
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
  leftSideBuffer: PixelBuffer | null;
  rightSideBuffer: PixelBuffer | null;
  topSideBuffer: PixelBuffer | null;
  bottomSideBuffer: PixelBuffer | null;
  heightMapBuffer: PixelBuffer | null;
  normalMapBuffer: PixelBuffer | null;
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

const FACE_SENTINELS = new Set(["none", "mirror", "mirrorLeft", "solid"]);

export function collectStudio3DSources(
  s: Studio3DState,
  layers: readonly LayerCompositingInfo[],
  activeLayerId: string,
  currentFrame: number,
  frameCount: number,
  canvasWidth: number,
  canvasHeight: number
): Studio3DSources {
  const assignedFaceLayerIds = new Set<string>();
  for (const choice of [
    s.backFaceChoice,
    s.leftSideChoice,
    s.rightSideChoice,
    s.topSideChoice,
    s.bottomSideChoice,
  ]) {
    if (choice && !FACE_SENTINELS.has(choice)) {
      assignedFaceLayerIds.add(choice);
    }
  }

  const visibleAlbedoLayers = layers.filter(
    (l) =>
      !assignedFaceLayerIds.has(l.id) &&
      (l.kind === "group" || !l.mapRole || l.mapRole === "albedo") &&
      (l.kind === "group" || l.visible)
  );
  const allRasterLayers = layers.filter((l) => l.kind === "raster");

  let singleSource: PixelBuffer;
  if (s.sourceScope === "visible") {
    const composited = pixelEngine.compositeFrame(visibleAlbedoLayers, currentFrame);
    singleSource = new PixelBuffer(canvasWidth, canvasHeight, composited);
  } else {
    const cel = pixelEngine.getCel(activeLayerId, currentFrame);
    singleSource = cel
      ? cel.clone()
      : new PixelBuffer(canvasWidth, canvasHeight);
  }

  const resolveFaceBuffer = (choice: string): PixelBuffer | null => {
    if (!choice || FACE_SENTINELS.has(choice)) return null;
    if (!allRasterLayers.some((l) => l.id === choice)) return null;
    const cel = pixelEngine.getCel(choice, currentFrame);
    return cel ? cel.clone() : new PixelBuffer(canvasWidth, canvasHeight);
  };

  const isCustomBackLayer =
    Boolean(s.backFaceChoice) &&
    !FACE_SENTINELS.has(s.backFaceChoice) &&
    allRasterLayers.some((l) => l.id === s.backFaceChoice);

  const backSourceBuffer = resolveFaceBuffer(s.backFaceChoice);
  const leftSideBuffer = resolveFaceBuffer(s.leftSideChoice);
  const rightSideBuffer = resolveFaceBuffer(s.rightSideChoice);
  const topSideBuffer = resolveFaceBuffer(s.topSideChoice);
  const bottomSideBuffer = resolveFaceBuffer(s.bottomSideChoice);

  let heightMapBuffer: PixelBuffer | null = null;
  if (s.depthProfile === "heightmap" && s.heightMapLayerId) {
    const hmCel = pixelEngine.getCel(s.heightMapLayerId, currentFrame);
    if (hmCel) heightMapBuffer = hmCel.clone();
  } else {
    const autoHmLayer = layers.find(
      (l) => l.kind === "raster" && l.visible && l.mapRole === "height"
    );
    if (autoHmLayer) {
      const hmCel = pixelEngine.getCel(autoHmLayer.id, currentFrame);
      if (hmCel && !hmCel.isEmpty()) heightMapBuffer = hmCel.clone();
    }
  }

  let normalMapBuffer: PixelBuffer | null = null;
  if (s.useNormalLayer) {
    const normLayer = layers.find(
      (l) => l.kind === "raster" && l.visible && l.mapRole === "normal"
    );
    if (normLayer) {
      const nCel = pixelEngine.getCel(normLayer.id, currentFrame);
      if (nCel && !nCel.isEmpty()) normalMapBuffer = nCel.clone();
    }
  }

  const stackSlices: PixelBuffer[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (
      layer.kind !== "raster" ||
      !layer.visible ||
      (layer.mapRole && layer.mapRole !== "albedo")
    ) {
      continue;
    }
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
        const comp = pixelEngine.compositeFrame(visibleAlbedoLayers, f);
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
    leftSideBuffer,
    rightSideBuffer,
    topSideBuffer,
    bottomSideBuffer,
    heightMapBuffer,
    normalMapBuffer,
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
    const rigBuf = new PixelBuffer(canvasWidth, canvasHeight, composited);
    if (s.renderPass === "normal") {
      return generateNormalMap(rigBuf, {
        strength: s.normalStrength,
        convention: s.normalConvention,
        blurRadius: s.heightBlur,
      });
    }
    if (s.renderPass === "height") {
      return generateHeightMap(rigBuf, {
        source: s.heightSource,
        bevelWeight: s.heightBevelWeight,
        contrast: s.heightContrast,
        blurRadius: s.heightBlur,
      });
    }
    if (s.renderPass === "depth") {
      return generateDepthMap(rigBuf, {
        mode: s.depthMode,
        invert: s.depthInvert,
      });
    }
    return rigBuf;
  }

  const outlineColor = s.outlineEnabled ? hexToRgba(s.outlineHex, 255) : null;
  const lightColor = hexToRgba(s.lightColor, 255);
  const ambientColor = hexToRgba(s.ambientColor, 255);
  const rimColor = hexToRgba(s.rimColor, 255);
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
      lightType: s.lightType,
      lightPosition: [s.lightPosX, s.lightPosY, s.lightPosZ],
      lightRadius: s.lightRadius,
      spotAngleDeg: s.spotAngleDeg,
      spotSoftness: s.spotSoftness,
      ambient: s.ambient,
      lightColor,
      ambientColor,
      lightIntensity: s.lightIntensity,
      specularStrength: s.specularStrength,
      shininess: s.shininess,
      celSteps: s.celSteps,
      renderPass: s.renderPass,
      normalConvention: s.normalConvention,
      depthInvert: s.depthInvert,
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
    normalMap: sources.normalMapBuffer,
    directionalLighting: s.directionalLighting,
    lightAzimuthDeg: s.lightAzimuthDeg,
    lightElevationDeg: s.lightElevationDeg,
    lightType: s.lightType,
    lightPosition: [s.lightPosX, s.lightPosY, s.lightPosZ],
    lightRadius: s.lightRadius,
    spotAngleDeg: s.spotAngleDeg,
    spotSoftness: s.spotSoftness,
    ambient: s.ambient,
    rimStrength: s.rimStrength,
    lightColor,
    ambientColor,
    lightIntensity: s.lightIntensity,
    specularStrength: s.specularStrength,
    shininess: s.shininess,
    celSteps: s.celSteps,
    rimColor,
    renderPass: s.renderPass,
    normalConvention: s.normalConvention,
    depthInvert: s.depthInvert,
    backSource: backSrc,
    mirrorBack: s.backFaceChoice === "mirror",
    leftSideSource: sources.leftSideBuffer,
    rightSideSource: sources.rightSideBuffer,
    topSideSource: sources.topSideBuffer,
    bottomSideSource: sources.bottomSideBuffer,
    mirrorRightFromLeft: s.rightSideChoice === "mirrorLeft",
    sideColor:
      s.leftSideChoice === "solid" ||
      s.rightSideChoice === "solid" ||
      s.topSideChoice === "solid" ||
      s.bottomSideChoice === "solid"
        ? hexToRgba(s.sideColorHex, 255)
        : null,
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
    lightType: s.lightType,
    lightPosition: [s.lightPosX, s.lightPosY, s.lightPosZ],
    lightRadius: s.lightRadius,
    spotAngleDeg: s.spotAngleDeg,
    spotSoftness: s.spotSoftness,
    ambient: s.ambient,
    rimStrength: s.rimStrength,
    backSource: sources.backSourceBuffer,
    mirrorBack: s.backFaceChoice === "mirror",
    leftSideSource: sources.leftSideBuffer,
    rightSideSource: sources.rightSideBuffer,
    topSideSource: sources.topSideBuffer,
    bottomSideSource: sources.bottomSideBuffer,
    mirrorRightFromLeft: s.rightSideChoice === "mirrorLeft",
    sideColor:
      s.leftSideChoice === "solid" ||
      s.rightSideChoice === "solid" ||
      s.topSideChoice === "solid" ||
      s.bottomSideChoice === "solid"
        ? hexToRgba(s.sideColorHex, 255)
        : null,
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
    lightType: s.lightType,
    lightPosition: [s.lightPosX, s.lightPosY, s.lightPosZ],
    lightRadius: s.lightRadius,
    spotAngleDeg: s.spotAngleDeg,
    spotSoftness: s.spotSoftness,
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

function writeMapBufferToRoleLayer(
  role: "normal" | "height" | "depth",
  buf: PixelBuffer,
  label: string
): void {
  const state = useEditorStore.getState();
  const existing = state.layers.find(
    (l) => l.kind === "raster" && l.mapRole === role
  );
  const targetId =
    existing?.id ??
    state.addMapLayer(
      role,
      role === "normal"
        ? "Normal Map"
        : role === "height"
          ? "Height Map"
          : "Depth Map"
    );

  const frameIdx = useEditorStore.getState().currentFrame;
  const cel = pixelEngine.getOrCreateCel(targetId, frameIdx);
  pixelEngine.history.beginTransaction(targetId, frameIdx, label);
  pixelEngine.history.captureAllTiles(cel);
  cel.data.set(buf.data);
  cel.markAllDirty();
  pixelEngine.history.commitTransaction(cel);
  syncHistoryAndCelState(targetId, frameIdx);
  pixelEngine.emitChange();
}

export function generateStudio3DMapLayerAction(
  kind: "normal" | "height" | "depth"
): void {
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

  const isFlatFront =
    s.mode === "extruded" &&
    s.yawDeg === 0 &&
    s.pitchDeg === 0 &&
    s.rollDeg === 0 &&
    s.depthProfile === "slab";

  let mapBuf: PixelBuffer;
  if (isFlatFront) {
    if (kind === "height") {
      mapBuf = generateHeightMap(sources.singleSource, {
        source: s.heightSource,
        bevelWeight: s.heightBevelWeight,
        contrast: s.heightContrast,
        blurRadius: s.heightBlur,
      });
    } else if (kind === "normal") {
      mapBuf = generateNormalMap(sources.singleSource, {
        strength: s.normalStrength,
        convention: s.normalConvention,
        bevelStrength: s.heightBevelWeight,
        blurRadius: s.heightBlur,
        heightMap: sources.heightMapBuffer,
      });
    } else {
      mapBuf = generateDepthMap(sources.singleSource, {
        mode: s.depthMode,
        invert: s.depthInvert,
        heightMap: sources.heightMapBuffer,
      });
    }
  } else {
    mapBuf = renderStudio3DPreviewBuffer(
      { ...s, renderPass: kind },
      sources,
      state.layers,
      state.canvasWidth,
      state.canvasHeight,
      state.rigPixelSnap,
      state.rigRotSprite
    );
  }

  const label =
    kind === "normal"
      ? "Generate 3D Normal Map"
      : kind === "height"
        ? "Generate 3D Height Map"
        : "Generate 3D Depth Map";
  writeMapBufferToRoleLayer(kind, mapBuf, label);
  useEditorStore
    .getState()
    .setStatusMessage(`${label} on frame ${state.currentFrame + 1}`);
}

export function generateAllStudio3DMapsAction(): void {
  generateStudio3DMapLayerAction("height");
  generateStudio3DMapLayerAction("normal");
  generateStudio3DMapLayerAction("depth");
  useEditorStore
    .getState()
    .setStatusMessage("Generated Normal, Height & Depth Map layers");
}

export function exportStudio3DPassPngAction(): void {
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
  const buf = renderStudio3DPreviewBuffer(
    s,
    sources,
    state.layers,
    state.canvasWidth,
    state.canvasHeight,
    state.rigPixelSnap,
    state.rigRotSprite
  );
  const base = state.documentName.replace(/\.pixet$/i, "") || "sprite";
  const filename = `${base}_${s.renderPass}.png`;
  downloadPixelBufferAsPng(buf, filename);
  state.setStatusMessage(`Exported ${filename}`);
}

export function createCustom3DFaceLayerAction(
  face: "back" | "left" | "right" | "top" | "bottom"
): void {
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

  const w = state.canvasWidth;
  const h = state.canvasHeight;
  const front = sources.singleSource;
  const template = new PixelBuffer(w, h);

  // Find opaque bounds of front sprite for aligned side-strip templates
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (front.data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    minX = Math.floor(w * 0.25);
    maxX = Math.floor(w * 0.75);
    minY = Math.floor(h * 0.25);
    maxY = Math.floor(h * 0.75);
  }

  if (face === "back") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = front.getPixel(w - 1 - x, y);
        if (a > 0) template.setPixel(x, y, r, g, b, a);
      }
    }
  } else {
    const [sr, sg, sb] = hexToRgba(s.sideColorHex, 255);
    const stripSize = Math.max(2, Math.min(16, Math.round(s.extrudeDepth) || 4));
    if (face === "left" || face === "right") {
      const x0 = Math.max(0, Math.floor((w - stripSize) / 2));
      const x1 = Math.min(w - 1, x0 + stripSize - 1);
      for (let y = minY; y <= maxY; y++) {
        for (let x = x0; x <= x1; x++) {
          template.setPixel(x, y, sr, sg, sb, 255);
        }
      }
    } else {
      const y0 = Math.max(0, Math.floor((h - stripSize) / 2));
      const y1 = Math.min(h - 1, y0 + stripSize - 1);
      for (let y = y0; y <= y1; y++) {
        for (let x = minX; x <= maxX; x++) {
          template.setPixel(x, y, sr, sg, sb, 255);
        }
      }
    }
  }

  const faceNames: Record<typeof face, string> = {
    back: "3D Back",
    left: "3D Left Side",
    right: "3D Right Side",
    top: "3D Top",
    bottom: "3D Bottom",
  };
  const newLayerId = state.addNamedLayer(faceNames[face]);
  const cel = pixelEngine.getOrCreateCel(newLayerId, state.currentFrame);
  cel.data.set(template.data);
  cel.markAllDirty();

  const patch: Partial<Studio3DState> = {};
  if (face === "back") patch.backFaceChoice = newLayerId;
  else if (face === "left") patch.leftSideChoice = newLayerId;
  else if (face === "right") patch.rightSideChoice = newLayerId;
  else if (face === "top") patch.topSideChoice = newLayerId;
  else patch.bottomSideChoice = newLayerId;

  useEditorStore.getState().patchStudio3D(patch);
  syncTimelineCels();
  pixelEngine.emitChange();
  useEditorStore
    .getState()
    .setStatusMessage(`Created "${faceNames[face]}" layer & assigned to ${face} face`);
}

export function editCustom3DFaceLayerAction(layerId: string): void {
  const st = useEditorStore.getState();
  const layer = st.layers.find((l) => l.id === layerId && l.kind === "raster");
  if (!layer) return;
  st.selectLayer(layer.id);
  st.setWorkspaceMode("draw");
  st.setStatusMessage(
    `Editing "${layer.name}" — press Ctrl+3 to return to 3D Studio`
  );
}
