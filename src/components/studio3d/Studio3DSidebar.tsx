import { useEffect, useMemo } from "react";
import { Download, Film, Layers, Paintbrush, Plus, RotateCcw, Sparkles } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import type {
  DepthMapMode,
  HeightMapSource,
  NormalConvention,
} from "../../engine/gamedev/pbrMaps";
import type { RigTurntableMode } from "../../engine/rig/export/bake";
import {
  ROTATE3D_CAMERA_PRESETS,
  TURNTABLE_PRESETS,
  type DepthProfile,
  type Light3DType,
  type Render3DPass,
  type SpinAxis,
  type TurntableEasing,
  type TurntablePreset,
} from "../../engine/tools/rotate3d";
import {
  useEditorStore,
  type Studio3DPivotMode,
  type Studio3DSourceScope,
} from "../../store/editorStore";
import {
  applyStudio3DCameraPreset,
  applyStudio3DToCurrentFrameAction,
  bakeStudio3DTurntableAction,
  createCustom3DFaceLayerAction,
  editCustom3DFaceLayerAction,
  exportStudio3DPassPngAction,
  generateAllStudio3DMapsAction,
  generateStudio3DMapLayerAction,
} from "./studio3dActions";

const TURNTABLE_PRESET_LIST: readonly TurntablePreset[] = [
  TURNTABLE_PRESETS.dir4,
  TURNTABLE_PRESETS.dir8,
  TURNTABLE_PRESETS.dir16,
  TURNTABLE_PRESETS.sway,
];

const FRAME_COUNT_OPTIONS = [4, 6, 8, 12, 16, 24, 32] as const;
const RIG_DIRECTION_OPTIONS = [4, 8, 12, 16] as const;

export function Studio3DSidebar() {
  const studio3d = useEditorStore((s) => s.studio3d);
  const patchStudio3D = useEditorStore((s) => s.patchStudio3D);
  const layers = useEditorStore((s) => s.layers);
  const frames = useEditorStore((s) => s.frames);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const rigVersion = useEditorStore((s) => s.rigVersion);
  void rigVersion;

  const allRasterLayers = useMemo(
    () => layers.filter((l) => l.kind === "raster"),
    [layers]
  );

  const boneCount = pixelEngine.rig.bones.length;
  const activeRigClip = pixelEngine.rig.getActiveClip();
  const rigClipFrameCount = Math.max(1, activeRigClip?.frameCount ?? 1);
  const totalRigBakeFrames =
    studio3d.rigBakeMode === "multidir"
      ? studio3d.rigDirections * rigClipFrameCount
      : studio3d.rigDirections;

  useEffect(() => {
    if (studio3d.mode === "rig" && boneCount === 0) {
      patchStudio3D({ mode: "extruded" });
    }
  }, [studio3d.mode, boneCount, patchStudio3D]);

  const stackSliceCount = useMemo(
    () =>
      layers.filter(
        (l) =>
          l.kind === "raster" &&
          l.visible &&
          Boolean(pixelEngine.getCel(l.id, 0)?.isEmpty() === false)
      ).length,
    [layers]
  );

  const canSpinTimeline = studio3d.mode === "extruded" && frames.length > 1;

  const applyTurntablePreset = (preset: TurntablePreset) => {
    patchStudio3D({
      bakeFrameCount: preset.frameCount,
      bakeStartDeg: preset.startDeg,
      bakeSweepDeg: preset.sweepDeg,
      bakePingPong: preset.pingPong,
      bakeEasing: preset.easing,
      scrubberFrame: 0,
    });
  };

  return (
    <div className="studio3d-sidebar">
      <div className="studio3d-sidebar-scroll">
        {/* Group 1: Source & Faces / Stack / Rig 3D */}
        {studio3d.mode === "extruded" ? (
          <div className="rotate3d-group">
            <div className="rotate3d-group-title">Source &amp; Faces</div>
            <div className="rotate3d-grid-2">
              <label className="modal-field">
                <span>Source</span>
                <select
                  className="palette-select"
                  value={studio3d.sourceScope}
                  onChange={(e) =>
                    patchStudio3D({
                      sourceScope: e.target.value as Studio3DSourceScope,
                    })
                  }
                >
                  <option value="visible">All Visible Layers</option>
                  <option value="active">Active Layer Only</option>
                </select>
              </label>
              <div className="modal-field">
                <span>Back-Face</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <select
                    className="palette-select"
                    style={{ flex: 1, minWidth: 0 }}
                    value={studio3d.backFaceChoice}
                    onChange={(e) =>
                      patchStudio3D({ backFaceChoice: e.target.value })
                    }
                  >
                    <option value="none">None</option>
                    <option value="mirror">Mirror Front</option>
                    {allRasterLayers.map((layer) => (
                      <option key={layer.id} value={layer.id}>
                        {layer.name}
                        {layer.visible ? "" : " (hidden)"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-action-btn"
                    title="Create new Back layer"
                    onClick={() => createCustom3DFaceLayerAction("back")}
                  >
                    <Plus size={11} />
                  </button>
                  {allRasterLayers.some(
                    (l) => l.id === studio3d.backFaceChoice
                  ) && (
                    <button
                      type="button"
                      className="icon-action-btn"
                      title="Paint Back layer in Draw mode"
                      onClick={() =>
                        editCustom3DFaceLayerAction(studio3d.backFaceChoice)
                      }
                    >
                      <Paintbrush size={11} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="rotate3d-subpanel" style={{ marginTop: 6 }}>
              <div className="rotate3d-group-title" style={{ marginBottom: 4 }}>
                <span>Custom Sides</span>
                <input
                  type="color"
                  className="rotate3d-color-input"
                  value={studio3d.sideColorHex}
                  title="Solid Side Color"
                  onChange={(e) =>
                    patchStudio3D({ sideColorHex: e.target.value })
                  }
                />
              </div>

              {(
                [
                  {
                    key: "left",
                    label: "Left",
                    value: studio3d.leftSideChoice,
                    field: "leftSideChoice",
                    allowMirrorLeft: false,
                  },
                  {
                    key: "right",
                    label: "Right",
                    value: studio3d.rightSideChoice,
                    field: "rightSideChoice",
                    allowMirrorLeft: true,
                  },
                  {
                    key: "top",
                    label: "Top",
                    value: studio3d.topSideChoice,
                    field: "topSideChoice",
                    allowMirrorLeft: false,
                  },
                  {
                    key: "bottom",
                    label: "Bottom",
                    value: studio3d.bottomSideChoice,
                    field: "bottomSideChoice",
                    allowMirrorLeft: false,
                  },
                ] as const
              ).map((side) => {
                const isLayer = allRasterLayers.some((l) => l.id === side.value);
                return (
                  <div
                    key={side.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        width: 44,
                        fontSize: 11,
                        color: "var(--text-secondary)",
                        flexShrink: 0,
                      }}
                    >
                      {side.label}
                    </span>
                    <select
                      className="palette-select"
                      style={{ flex: 1, minWidth: 0 }}
                      value={side.value}
                      onChange={(e) =>
                        patchStudio3D({ [side.field]: e.target.value })
                      }
                    >
                      <option value="none">Auto (Edge)</option>
                      {side.allowMirrorLeft && (
                        <option value="mirrorLeft">Mirror Left</option>
                      )}
                      <option value="solid">Solid Color</option>
                      {allRasterLayers.map((layer) => (
                        <option key={layer.id} value={layer.id}>
                          {layer.name}
                          {layer.visible ? "" : " (hidden)"}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="icon-action-btn"
                      title={`Create new ${side.label} side layer`}
                      onClick={() => createCustom3DFaceLayerAction(side.key)}
                    >
                      <Plus size={11} />
                    </button>
                    {isLayer && (
                      <button
                        type="button"
                        className="icon-action-btn"
                        title={`Paint ${side.label} layer in Draw mode`}
                        onClick={() => editCustom3DFaceLayerAction(side.value)}
                      >
                        <Paintbrush size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="rotate3d-pivot-row">
              <label className="modal-field" style={{ flex: 1 }}>
                <span>Pivot</span>
                <select
                  className="palette-select"
                  value={studio3d.pivotMode}
                  onChange={(e) =>
                    patchStudio3D({
                      pivotMode: e.target.value as Studio3DPivotMode,
                    })
                  }
                >
                  <option value="center">Center</option>
                  <option value="bottom">Bottom (Floor)</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {studio3d.pivotMode === "custom" && (
                <>
                  <label className="modal-field rotate3d-pivot-coord">
                    <span>X</span>
                    <input
                      type="number"
                      className="rotate3d-num-input"
                      min={0}
                      max={Math.max(0, canvasWidth - 1)}
                      value={studio3d.customPivotX}
                      onChange={(e) =>
                        patchStudio3D({
                          customPivotX: Number(e.target.value) || 0,
                        })
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
                      value={studio3d.customPivotY}
                      onChange={(e) =>
                        patchStudio3D({
                          customPivotY: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        ) : studio3d.mode === "stack" ? (
          <div className="rotate3d-stack-note">
            Stacks {stackSliceCount} visible raster layer
            {stackSliceCount === 1 ? "" : "s"} bottom-to-top.
            {stackSliceCount <= 1 &&
              " Add more layers for taller voxel-style stacks."}
          </div>
        ) : (
          <div className="rotate3d-group">
            <div className="rotate3d-group-title">Rig 3D ({boneCount} bones)</div>
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={studio3d.rigAutoZSort}
                onChange={(e) =>
                  patchStudio3D({ rigAutoZSort: e.target.checked })
                }
              />
              <span>Auto Z-Sort Limbs</span>
            </label>

            <label className="modal-field">
              <span>Bake Mode</span>
              <select
                className="palette-select"
                value={studio3d.rigBakeMode}
                onChange={(e) =>
                  patchStudio3D({
                    rigBakeMode: e.target.value as RigTurntableMode,
                    scrubberFrame: 0,
                  })
                }
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
                    className={`mini-btn ${studio3d.rigDirections === dir ? "active" : ""}`}
                    onClick={() =>
                      patchStudio3D({ rigDirections: dir, scrubberFrame: 0 })
                    }
                  >
                    {dir}-Dir
                  </button>
                ))}
              </div>
            </div>

            <div className="rotate3d-stack-note">
              {studio3d.rigBakeMode === "multidir"
                ? `Bakes "${activeRigClip?.name ?? "Clip"}" (${rigClipFrameCount}f) × ${studio3d.rigDirections} dirs = ${totalRigBakeFrames} frames + ${studio3d.rigDirections} auto tags.`
                : `Spins current rig pose across ${studio3d.rigDirections} angles (${totalRigBakeFrames} frames).`}
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
                applyStudio3DCameraPreset(ROTATE3D_CAMERA_PRESETS.front)
              }
            >
              <RotateCcw size={10} />
              <span>Reset</span>
            </button>
          </div>

          <label className="rotate3d-slider-row">
            <span>Yaw (Y)</span>
            <input
              type="range"
              min={-180}
              max={180}
              value={studio3d.yawDeg}
              onChange={(e) =>
                patchStudio3D({ yawDeg: Number(e.target.value) })
              }
            />
            <span className="rotate3d-val">{studio3d.yawDeg}°</span>
          </label>

          {studio3d.mode !== "stack" ? (
            <label className="rotate3d-slider-row">
              <span>Pitch (X)</span>
              <input
                type="range"
                min={-85}
                max={85}
                value={studio3d.pitchDeg}
                onChange={(e) =>
                  patchStudio3D({ pitchDeg: Number(e.target.value) })
                }
              />
              <span className="rotate3d-val">{studio3d.pitchDeg}°</span>
            </label>
          ) : (
            <label className="rotate3d-slider-row">
              <span>Tilt (X)</span>
              <input
                type="range"
                min={0}
                max={75}
                value={studio3d.stackPitchDeg}
                onChange={(e) =>
                  patchStudio3D({ stackPitchDeg: Number(e.target.value) })
                }
              />
              <span className="rotate3d-val">{studio3d.stackPitchDeg}°</span>
            </label>
          )}

          <label className="rotate3d-slider-row">
            <span>Roll (Z)</span>
            <input
              type="range"
              min={-180}
              max={180}
              value={studio3d.rollDeg}
              onChange={(e) =>
                patchStudio3D({ rollDeg: Number(e.target.value) })
              }
            />
            <span className="rotate3d-val">{studio3d.rollDeg}°</span>
          </label>

          <label className="rotate3d-slider-row">
            <span>Perspective</span>
            <input
              type="range"
              min={0}
              max={100}
              disabled={studio3d.gridMode === "isometric"}
              value={
                studio3d.gridMode === "isometric"
                  ? 0
                  : Math.round(studio3d.perspective * 100)
              }
              onChange={(e) =>
                patchStudio3D({ perspective: Number(e.target.value) / 100 })
              }
            />
            <span className="rotate3d-val">
              {studio3d.gridMode === "isometric"
                ? "Iso"
                : `${Math.round(studio3d.perspective * 100)}%`}
            </span>
          </label>

          {studio3d.mode !== "rig" && (
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={studio3d.autoFitBounds}
                onChange={(e) =>
                  patchStudio3D({ autoFitBounds: e.target.checked })
                }
              />
              <span>Safe Auto-Fit</span>
            </label>
          )}
        </div>

        {/* Group 3: Extrusion / Stack */}
        {studio3d.mode !== "rig" && (
          <div className="rotate3d-group">
            <div className="rotate3d-group-title">
              {studio3d.mode === "extruded" ? "Extrusion" : "Sprite Stack"}
            </div>

            {studio3d.mode === "extruded" ? (
              <>
                <label className="modal-field">
                  <span>Depth Profile</span>
                  <select
                    className="palette-select"
                    value={studio3d.depthProfile}
                    onChange={(e) =>
                      patchStudio3D({
                        depthProfile: e.target.value as DepthProfile,
                      })
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
                    value={studio3d.extrudeDepth}
                    onChange={(e) =>
                      patchStudio3D({ extrudeDepth: Number(e.target.value) })
                    }
                  />
                  <span className="rotate3d-val">{studio3d.extrudeDepth}px</span>
                </label>

                {studio3d.depthProfile === "heightmap" && (
                  <label className="modal-field">
                    <span>Height-Map Layer</span>
                    <select
                      className="palette-select"
                      value={studio3d.heightMapLayerId}
                      onChange={(e) =>
                        patchStudio3D({ heightMapLayerId: e.target.value })
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
                    value={studio3d.sliceSpacing}
                    onChange={(e) =>
                      patchStudio3D({ sliceSpacing: Number(e.target.value) })
                    }
                  />
                  <span className="rotate3d-val">{studio3d.sliceSpacing}px</span>
                </label>

                <label className="rotate3d-slider-row">
                  <span>Slice Thick</span>
                  <input
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.25}
                    value={studio3d.sliceThickness}
                    onChange={(e) =>
                      patchStudio3D({ sliceThickness: Number(e.target.value) })
                    }
                  />
                  <span className="rotate3d-val">
                    {studio3d.sliceThickness}×
                  </span>
                </label>

                <label className="modal-checkbox">
                  <input
                    type="checkbox"
                    checked={studio3d.reverseOrder}
                    onChange={(e) =>
                      patchStudio3D({ reverseOrder: e.target.checked })
                    }
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
            {studio3d.mode === "rig"
              ? "3D Lighting"
              : "Lighting & Pixel Quality"}
          </div>

          <div className="rotate3d-toggles">
            {studio3d.mode !== "rig" && (
              <label className="modal-checkbox">
                <input
                  type="checkbox"
                  checked={studio3d.shadeDepth}
                  onChange={(e) =>
                    patchStudio3D({ shadeDepth: e.target.checked })
                  }
                />
                <span>Depth Shading</span>
              </label>
            )}

            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={studio3d.directionalLighting}
                onChange={(e) =>
                  patchStudio3D({ directionalLighting: e.target.checked })
                }
              />
              <span>Directional Lighting</span>
            </label>
          </div>

          {studio3d.directionalLighting && (
            <div className="rotate3d-subpanel">
              {studio3d.mode !== "rig" ? (
                <>
                  <div className="mode-hint" style={{ marginBottom: 4 }}>
                    Drag 3D light bulb or X/Y/Z arrows (or Shift+Drag) to move in 3D
                  </div>
                  <div className="rotate3d-btn-row" style={{ marginBottom: 4 }}>
                    {(["point", "spot", "sun"] as readonly Light3DType[]).map((lt) => (
                      <button
                        key={lt}
                        type="button"
                        className={`mini-btn ${studio3d.lightType === lt ? "active" : ""}`}
                        onClick={() => patchStudio3D({ lightType: lt })}
                      >
                        {lt === "point" ? "Point" : lt === "spot" ? "Spot" : "Sun"}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="mini-btn"
                      title="Reset 3D Light Position"
                      onClick={() =>
                        patchStudio3D({
                          lightPosX: -18,
                          lightPosY: -20,
                          lightPosZ: 24,
                        })
                      }
                    >
                      <RotateCcw size={10} />
                    </button>
                  </div>
                  <label className="modal-checkbox" style={{ marginBottom: 4 }}>
                    <input
                      type="checkbox"
                      checked={studio3d.showLightGizmo}
                      onChange={(e) =>
                        patchStudio3D({ showLightGizmo: e.target.checked })
                      }
                    />
                    <span>Show 3D Light Gizmo</span>
                  </label>
                </>
              ) : null}

              <div className="rotate3d-grid-2">
                <label className="modal-field">
                  <span>Light Color</span>
                  <input
                    type="color"
                    className="rotate3d-color-input"
                    value={studio3d.lightColor}
                    onChange={(e) =>
                      patchStudio3D({ lightColor: e.target.value })
                    }
                  />
                </label>
                <label className="modal-field">
                  <span>Ambient Color</span>
                  <input
                    type="color"
                    className="rotate3d-color-input"
                    value={studio3d.ambientColor}
                    onChange={(e) =>
                      patchStudio3D({ ambientColor: e.target.value })
                    }
                  />
                </label>
              </div>

              {studio3d.mode === "rig" ? (
                <>
                  <label className="rotate3d-slider-row">
                    <span>Azimuth</span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      value={studio3d.lightAzimuthDeg}
                      onChange={(e) =>
                        patchStudio3D({ lightAzimuthDeg: Number(e.target.value) })
                      }
                    />
                    <span className="rotate3d-val">
                      {studio3d.lightAzimuthDeg}°
                    </span>
                  </label>

                  <label className="rotate3d-slider-row">
                    <span>Elevation</span>
                    <input
                      type="range"
                      min={0}
                      max={90}
                      value={studio3d.lightElevationDeg}
                      onChange={(e) =>
                        patchStudio3D({ lightElevationDeg: Number(e.target.value) })
                      }
                    />
                    <span className="rotate3d-val">
                      {studio3d.lightElevationDeg}°
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <label className="rotate3d-slider-row">
                    <span>Pos X</span>
                    <input
                      type="range"
                      min={-80}
                      max={80}
                      value={studio3d.lightPosX}
                      onChange={(e) =>
                        patchStudio3D({ lightPosX: Number(e.target.value) })
                      }
                    />
                    <span className="rotate3d-val">{studio3d.lightPosX}</span>
                  </label>

                  <label className="rotate3d-slider-row">
                    <span>Height Y</span>
                    <input
                      type="range"
                      min={-80}
                      max={80}
                      value={-studio3d.lightPosY}
                      onChange={(e) =>
                        patchStudio3D({ lightPosY: -Number(e.target.value) })
                      }
                    />
                    <span className="rotate3d-val">{-studio3d.lightPosY}</span>
                  </label>

                  <label className="rotate3d-slider-row">
                    <span>Depth Z</span>
                    <input
                      type="range"
                      min={-80}
                      max={80}
                      value={studio3d.lightPosZ}
                      onChange={(e) =>
                        patchStudio3D({ lightPosZ: Number(e.target.value) })
                      }
                    />
                    <span className="rotate3d-val">{studio3d.lightPosZ}</span>
                  </label>

                  {studio3d.lightType !== "sun" && (
                    <label className="rotate3d-slider-row">
                      <span>Range</span>
                      <input
                        type="range"
                        min={8}
                        max={120}
                        value={studio3d.lightRadius}
                        onChange={(e) =>
                          patchStudio3D({ lightRadius: Number(e.target.value) })
                        }
                      />
                      <span className="rotate3d-val">{studio3d.lightRadius}</span>
                    </label>
                  )}

                  {studio3d.lightType === "spot" && (
                    <>
                      <label className="rotate3d-slider-row">
                        <span>Cone</span>
                        <input
                          type="range"
                          min={15}
                          max={120}
                          value={studio3d.spotAngleDeg}
                          onChange={(e) =>
                            patchStudio3D({
                              spotAngleDeg: Number(e.target.value),
                            })
                          }
                        />
                        <span className="rotate3d-val">
                          {studio3d.spotAngleDeg}°
                        </span>
                      </label>

                      <label className="rotate3d-slider-row">
                        <span>Softness</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(studio3d.spotSoftness * 100)}
                          onChange={(e) =>
                            patchStudio3D({
                              spotSoftness: Number(e.target.value) / 100,
                            })
                          }
                        />
                        <span className="rotate3d-val">
                          {Math.round(studio3d.spotSoftness * 100)}%
                        </span>
                      </label>
                    </>
                  )}
                </>
              )}

              {studio3d.mode !== "rig" && (
                <>
                  <label className="rotate3d-slider-row">
                    <span>Intensity</span>
                    <input
                      type="range"
                      min={0}
                      max={250}
                      value={Math.round(studio3d.lightIntensity * 100)}
                      onChange={(e) =>
                        patchStudio3D({
                          lightIntensity: Number(e.target.value) / 100,
                        })
                      }
                    />
                    <span className="rotate3d-val">
                      {studio3d.lightIntensity.toFixed(1)}
                    </span>
                  </label>

                  <label className="rotate3d-slider-row">
                    <span>Ambient</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(studio3d.ambient * 100)}
                      onChange={(e) =>
                        patchStudio3D({ ambient: Number(e.target.value) / 100 })
                      }
                    />
                    <span className="rotate3d-val">
                      {Math.round(studio3d.ambient * 100)}%
                    </span>
                  </label>

                  <label className="rotate3d-slider-row">
                    <span>Specular</span>
                    <input
                      type="range"
                      min={0}
                      max={150}
                      value={Math.round(studio3d.specularStrength * 100)}
                      onChange={(e) =>
                        patchStudio3D({
                          specularStrength: Number(e.target.value) / 100,
                        })
                      }
                    />
                    <span className="rotate3d-val">
                      {Math.round(studio3d.specularStrength * 100)}%
                    </span>
                  </label>

                  <label className="rotate3d-slider-row">
                    <span>Shininess</span>
                    <input
                      type="range"
                      min={4}
                      max={128}
                      value={studio3d.shininess}
                      onChange={(e) =>
                        patchStudio3D({ shininess: Number(e.target.value) })
                      }
                    />
                    <span className="rotate3d-val">{studio3d.shininess}</span>
                  </label>

                  <label className="modal-field">
                    <span>Cel Shading</span>
                    <select
                      className="palette-select"
                      value={studio3d.celSteps}
                      onChange={(e) =>
                        patchStudio3D({ celSteps: Number(e.target.value) })
                      }
                    >
                      <option value={0}>Smooth</option>
                      <option value={2}>2-Band Toon</option>
                      <option value={3}>3-Band Toon</option>
                      <option value={4}>4-Band Toon</option>
                      <option value={6}>6-Band Toon</option>
                    </select>
                  </label>
                </>
              )}

              {studio3d.mode === "extruded" && (
                <>
                  <div className="rotate3d-outline-row">
                    <label className="rotate3d-slider-row" style={{ flex: 1 }}>
                      <span>Rim</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(studio3d.rimStrength * 100)}
                        onChange={(e) =>
                          patchStudio3D({
                            rimStrength: Number(e.target.value) / 100,
                          })
                        }
                      />
                      <span className="rotate3d-val">
                        {Math.round(studio3d.rimStrength * 100)}%
                      </span>
                    </label>
                    <input
                      type="color"
                      className="rotate3d-color-input"
                      value={studio3d.rimColor}
                      title="Rim Light Color"
                      onChange={(e) =>
                        patchStudio3D({ rimColor: e.target.value })
                      }
                    />
                  </div>
                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={studio3d.useNormalLayer}
                      onChange={(e) =>
                        patchStudio3D({ useNormalLayer: e.target.checked })
                      }
                    />
                    <span>Use Normal Map Layer</span>
                  </label>
                </>
              )}
            </div>
          )}

          {studio3d.mode !== "rig" && (
            <div className="rotate3d-toggles">
              {studio3d.mode === "extruded" && (
                <>
                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={studio3d.supersample}
                      onChange={(e) =>
                        patchStudio3D({ supersample: e.target.checked })
                      }
                    />
                    <span>Clean 2× Sample</span>
                  </label>

                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={studio3d.preScaleEPX}
                      onChange={(e) =>
                        patchStudio3D({ preScaleEPX: e.target.checked })
                      }
                    />
                    <span>EPX Pre-Scale</span>
                  </label>
                </>
              )}

              <label className="modal-checkbox">
                <input
                  type="checkbox"
                  checked={studio3d.paletteLock}
                  onChange={(e) =>
                    patchStudio3D({ paletteLock: e.target.checked })
                  }
                />
                <span>Palette Lock</span>
              </label>

              <label className="modal-checkbox">
                <input
                  type="checkbox"
                  checked={studio3d.removeOrphans}
                  onChange={(e) =>
                    patchStudio3D({ removeOrphans: e.target.checked })
                  }
                />
                <span>Orphans</span>
              </label>

              <label className="modal-checkbox">
                <input
                  type="checkbox"
                  checked={studio3d.fillHoles}
                  onChange={(e) =>
                    patchStudio3D({ fillHoles: e.target.checked })
                  }
                />
                <span>Fill Holes</span>
              </label>

              <div className="rotate3d-outline-row">
                <label className="modal-checkbox">
                  <input
                    type="checkbox"
                    checked={studio3d.outlineEnabled}
                    onChange={(e) =>
                      patchStudio3D({ outlineEnabled: e.target.checked })
                    }
                  />
                  <span>1px Outline</span>
                </label>
                {studio3d.outlineEnabled && (
                  <input
                    type="color"
                    value={studio3d.outlineHex}
                    onChange={(e) =>
                      patchStudio3D({ outlineHex: e.target.value })
                    }
                    className="rotate3d-color-input"
                    title="Outline Color"
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Group 4b: PBR Map Generation */}
        <div className="rotate3d-group">
          <div className="rotate3d-group-title">
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Layers size={11} />
              <span>Map Generation</span>
            </span>
          </div>

          <label className="modal-field">
            <span>Preview Pass</span>
            <select
              className="palette-select"
              value={studio3d.renderPass}
              onChange={(e) =>
                patchStudio3D({ renderPass: e.target.value as Render3DPass })
              }
            >
              <option value="lit">Lit 3D</option>
              <option value="normal">Normal Map</option>
              <option value="height">Height / Displacement</option>
              <option value="depth">Depth Map</option>
            </select>
          </label>

          <div className="rotate3d-grid-2">
            <label className="modal-field">
              <span>Normal Format</span>
              <select
                className="palette-select"
                value={studio3d.normalConvention}
                onChange={(e) =>
                  patchStudio3D({
                    normalConvention: e.target.value as NormalConvention,
                  })
                }
              >
                <option value="opengl">OpenGL (+Y)</option>
                <option value="directx">DirectX (-Y)</option>
              </select>
            </label>

            <label className="modal-field">
              <span>Height Source</span>
              <select
                className="palette-select"
                value={studio3d.heightSource}
                onChange={(e) =>
                  patchStudio3D({
                    heightSource: e.target.value as HeightMapSource,
                  })
                }
              >
                <option value="hybrid">Hybrid</option>
                <option value="luminance">Luminance</option>
                <option value="bevel">Bevel</option>
                <option value="pillow">Pillow</option>
              </select>
            </label>
          </div>

          <label className="rotate3d-slider-row">
            <span>Normal Str</span>
            <input
              type="range"
              min={5}
              max={60}
              value={Math.round(studio3d.normalStrength * 10)}
              onChange={(e) =>
                patchStudio3D({ normalStrength: Number(e.target.value) / 10 })
              }
            />
            <span className="rotate3d-val">
              {studio3d.normalStrength.toFixed(1)}
            </span>
          </label>

          <label className="rotate3d-slider-row">
            <span>Contrast</span>
            <input
              type="range"
              min={40}
              max={250}
              value={Math.round(studio3d.heightContrast * 100)}
              onChange={(e) =>
                patchStudio3D({ heightContrast: Number(e.target.value) / 100 })
              }
            />
            <span className="rotate3d-val">
              {studio3d.heightContrast.toFixed(1)}×
            </span>
          </label>

          <label className="rotate3d-slider-row">
            <span>Smooth</span>
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={studio3d.heightBlur}
              onChange={(e) =>
                patchStudio3D({ heightBlur: Number(e.target.value) })
              }
            />
            <span className="rotate3d-val">{studio3d.heightBlur}px</span>
          </label>

          <div className="rotate3d-grid-2">
            <label className="modal-field">
              <span>Depth Mode</span>
              <select
                className="palette-select"
                value={studio3d.depthMode}
                onChange={(e) =>
                  patchStudio3D({
                    depthMode: e.target.value as DepthMapMode,
                  })
                }
              >
                <option value="volume">Volume</option>
                <option value="topDown">Top-Down</option>
                <option value="isometric">Isometric</option>
                <option value="radial">Radial</option>
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
                  checked={studio3d.depthInvert}
                  onChange={(e) =>
                    patchStudio3D({ depthInvert: e.target.checked })
                  }
                />
                <span>Invert Depth</span>
              </label>
            </div>
          </div>

          <div className="rotate3d-btn-row">
            <button
              type="button"
              className="mini-btn"
              onClick={() => generateStudio3DMapLayerAction("normal")}
            >
              → Normal
            </button>
            <button
              type="button"
              className="mini-btn"
              onClick={() => generateStudio3DMapLayerAction("height")}
            >
              → Height
            </button>
            <button
              type="button"
              className="mini-btn"
              onClick={() => generateStudio3DMapLayerAction("depth")}
            >
              → Depth
            </button>
          </div>

          <div className="rotate3d-btn-row">
            <button
              type="button"
              className="mini-btn"
              style={{ flex: 1, justifyContent: "center" }}
              onClick={generateAllStudio3DMapsAction}
            >
              <Sparkles size={11} />
              <span>Gen All 3 Maps</span>
            </button>
            <button
              type="button"
              className="mini-btn"
              title="Export current preview pass as PNG"
              onClick={exportStudio3DPassPngAction}
            >
              <Download size={11} />
              <span>PNG</span>
            </button>
          </div>
        </div>

        {/* Group 5: Turntable Baker */}
        <div className="rotate3d-group">
          <div className="rotate3d-group-title">
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Film size={11} />
              <span>Turntable Baker</span>
            </span>
          </div>

          {studio3d.mode !== "rig" && (
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
                    value={studio3d.bakeFrameCount}
                    onChange={(e) => {
                      const nextCount = Number(e.target.value);
                      patchStudio3D({
                        bakeFrameCount: nextCount,
                        scrubberFrame: Math.min(
                          studio3d.scrubberFrame,
                          nextCount - 1
                        ),
                      });
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
                    value={studio3d.spinAxis}
                    onChange={(e) =>
                      patchStudio3D({ spinAxis: e.target.value as SpinAxis })
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
                value={studio3d.bakeStartDeg}
                onChange={(e) =>
                  patchStudio3D({ bakeStartDeg: Number(e.target.value) || 0 })
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
                value={studio3d.bakeSweepDeg}
                onChange={(e) =>
                  patchStudio3D({ bakeSweepDeg: Number(e.target.value) || 0 })
                }
              />
            </label>
          </div>

          {studio3d.mode !== "rig" && (
            <>
              <div className="rotate3d-grid-2">
                <label className="modal-field">
                  <span>Easing</span>
                  <select
                    className="palette-select"
                    value={studio3d.bakeEasing}
                    onChange={(e) =>
                      patchStudio3D({
                        bakeEasing: e.target.value as TurntableEasing,
                      })
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
                      checked={studio3d.bakePingPong}
                      onChange={(e) =>
                        patchStudio3D({ bakePingPong: e.target.checked })
                      }
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
                  checked={canSpinTimeline && studio3d.spinTimelineFrames}
                  onChange={(e) =>
                    patchStudio3D({ spinTimelineFrames: e.target.checked })
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

      <div className="studio3d-sidebar-footer">
        <button
          type="button"
          className="mini-btn"
          style={{ flex: 1, justifyContent: "center" }}
          onClick={applyStudio3DToCurrentFrameAction}
        >
          <Sparkles size={12} />
          <span>Apply Frame</span>
        </button>
        <button
          type="button"
          className="export-cta"
          style={{ flex: 1, justifyContent: "center" }}
          onClick={bakeStudio3DTurntableAction}
        >
          <Film size={12} />
          <span>
            {studio3d.mode === "rig"
              ? studio3d.rigBakeMode === "multidir"
                ? `Bake (${totalRigBakeFrames}f)`
                : `Bake (${totalRigBakeFrames}f)`
              : `Bake (${studio3d.bakeFrameCount}f)`}
          </span>
        </button>
      </div>
    </div>
  );
}
