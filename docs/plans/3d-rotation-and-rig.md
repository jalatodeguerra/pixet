# Pixet — 3D Rotation v2 & Full 3D Bone/Rig Integration: Implementation Plan

> Orchestrated milestone hand-off plan. Read **§0 Context & Hard Rules** before touching code.
> Execute milestone by milestone (`R3D-0` → `R3D-6`). Each milestone must end green on all verification checks in **§0.4**, be reviewed by the orchestrator, and be committed cleanly before starting the next.

---

## 0. Context & Hard Rules

### 0.1 Project & Relevant Files
- **Pixet**: Tauri v2 + Rust (`crates/pixet-core`, `crates/pixet-cli`, `src-tauri`) + Vite + React 18 + TypeScript (`strict`) + Zustand + `lucide-react`.
- **Current 3D & Rig codebase**:
  | File | Current Role |
  |---|---|
  | `src/engine/tools/rotate3d.ts` | `render25DSprite`, `renderSpriteStack`, `bakeTurntableFrames`, `applyPixelOutline` (uniform slab ray-march, fixed center pivot, flat depth shading, 2-axis stack). |
  | `src/components/Rotate3DModal.tsx` | Modal UI for 2.5D Extruded Spin & Sprite Stacking, orbit drag, presets, apply-to-frame, turntable bake. |
  | `src/engine/rig/pixelCleanup.ts` | `applyPixelCleanup` (orphan removal, 1px hole fill, outline preservation, palette lock), `collectPalette`. |
  | `src/engine/tools/rotsprite.ts` | `scale2xEPX`, `rotSpriteRotate`. |
  | `src/engine/rig/RigEngine.ts` | `Bone`, `BonePose`, `BoneKeyframe`, `BoneWorldTransform`, `RigClip`, `RigSlot`, `RigSnapshot`, `computeFk`, `computeWorldTransform`, `warpLayerByBone`, `toSnapshot`/`fromSnapshot`. |
  | `src/engine/document/PixelEngine.ts` | `compositeRigFrame` (layer compositing, mesh/LBS/mask/rigid bone warp, slot compositing, post-deform pixel cleanup, `rigDeformCache`). |
  | `src/components/rig/rigTools.ts` | Rig tool definitions & shortcuts (`RIG_TOOL_DEFS`, `RIG_TOOL_GROUPS`). |
  | `src/components/rig/rigGizmo.ts` | `buildRigBoneShapes`, gizmo hit-testing (`translate`, `rotate`, `scale`, `body`). |
  | `src/components/rig/RigOverlay.tsx` | SVG/Canvas bone & gizmo overlay in viewport. |
  | `src/components/rig/useRigPointer.ts` | Rig pointer interactions & gesture undo (`beginRigGesture`/`endRigGesture`). |
  | `src/components/rig/BonePropertiesPanel.tsx` | Selected bone transform & property editor. |
  | `src/components/rig/CurveEditor.tsx` | Keyframe curve editor (`CurveChannel`). |
  | `src/components/rig/RigRenderPanel.tsx` | Pixel-Snap, RotSprite Clean, Pixel Cleanup toggles, Bake Frames, Export Rig. |
  | `src/engine/rig/export/bake.ts` | `bakeRigClips` multi-clip rig baker. |
  | `src/store/editorStore.ts` | Zustand editor store (`RigTool`, rig render flags, `rotate3dModalOpen`). |

### 0.2 Architectural Principles
1. **Zero-overhead 2D fast path**: Any bone with `yawDeg === 0`, `pitchDeg === 0`, `localZ === 0`, and `extrudeDepth === 0` (and 2D-only ancestors) MUST produce bit-identical results to the existing 2D rig math and rasterizer.
2. **Shared 3D math core**: Put pure 3×3 matrix / Euler / projection helpers in `src/engine/tools/rotate3d.ts` (or a dedicated `src/engine/tools/math3d.ts` imported with `.ts` extension) so both `rotate3d.ts` and `RigEngine.ts` share one exact rotation convention: `R = Rz(roll) * Rx(pitch) * Ry(yaw)`.
3. **Backward compatibility**: Old `.pixet` files (v2 `RigSnapshot` without 3D fields) MUST load unchanged with safe defaults (`yawDeg = 0`, `pitchDeg = 0`, `localZ = 0`, `extrudeDepth = 0`, `depthProfile = "slab"`, `backLayerId = null`).
4. **Pixel-art correctness**: Nearest-neighbor crisp output by default; EPX/RotSprite pre-scaling and post-deform pixel cleanup (`applyPixelCleanup`) are opt-in and palette-safe.

### 0.3 Hard Rules
1. **UI style (strictly enforced)**: Flat neutral dark-gray (`#141414`, `#1a1a1a`, `#202020`, `#272727`, `#303030`, accent `#4c8bf5`). **0px border-radius, no `box-shadow`, no `text-shadow`, no `backdrop-filter`, no decorative gradients, no glows.** Reuse classes in `src/styles/layout.css` (`modal-card`, `rotate3d-*`, `panel-section`, `mini-btn`, `icon-action-btn`, `palette-select`, `modal-checkbox`).
2. **Engine purity**: Everything under `src/engine/**` is React-free and uses **explicit `.ts` relative imports** (required by `node --test`).
3. **TypeScript**: `strict`, `noUnusedLocals`, `noUnusedParameters`, **no `any`**.
4. **Do not break existing tests**: Keep `tests/engine.test.ts`, `tests/draw.test.ts`, `tests/tiles.test.ts`, `tests/weights.test.ts`, `tests/panelLayout.test.ts` green without weakening assertions. Add dedicated unit test suites in `tests/rotate3d.test.ts` and `tests/rig3d.test.ts`.

### 0.4 Definition of Done (every milestone)
```bash
rg -n "box-shadow|text-shadow|backdrop-filter|border-radius:\s*[1-9]" src/styles/   # must print nothing
node --test tests/engine.test.ts tests/rotate3d.test.ts tests/rig3d.test.ts           # all pass (as files exist)
pnpm run build                                                                         # tsc && vite build, 0 errors
```
At the final milestone (`R3D-6`), also run the full test suite (`node --test tests/*.test.ts`) and `cargo test --workspace`.

---

## Milestone Plan (`R3D-0` → `R3D-6`)

### Milestone `R3D-0` — 3D Engine Core v2: Math, Lighting, Depth Profiles, Back-Face & Pixel Cleanup
**Goal**: Upgrade `src/engine/tools/rotate3d.ts` into a production-grade pixel-art 2.5D renderer while preserving 100% compatibility with existing `Rotate25DOptions` callers.

**Deliverables**:
1. **Shared 3D Math** (`src/engine/tools/math3d.ts` or exported from `rotate3d.ts`):
   - `Mat3` (9-tuple or flat struct) with `mat3Identity`, `mat3FromEulerDeg(yaw, pitch, roll)` using `Rz * Rx * Ry`, `mat3Mul(a, b)`, `mat3MulVec(m, x, y, z)`, `mat3TransposeMulVec(m, x, y, z)`, `mat3ExtractEulerDeg(m)`, and `mat3FacingZ(m)` (`r22`).
2. **Extended `Rotate25DOptions`** (all new fields optional with safe defaults):
   - **Pivot**: `pivotX?: number`, `pivotY?: number` (default center `(w - 1) / 2`, `(h - 1) / 2`).
   - **Safe Non-Clipping Bounds**: `autoFitBounds?: boolean` (computes projected 3D AABB of the sprite box so corners don't clip, returning a tightly padded buffer or recentered canvas-sized output with `fitScale` option).
   - **Depth Profiles**:
     - `depthProfile?: "slab" | "bevel" | "pillow" | "heightmap"` (default `"slab"`).
     - `heightMap?: PixelBuffer | null` (grayscale luminance `0..1` scales per-pixel local half-thickness; transparent = 0).
     - For `"bevel"` / `"pillow"`, compute a fast 2D chamfer/distance-to-transparent map from `src` alpha so edges taper linearly (`bevel`) or smoothly (`sqrt(1 - (1 - d)^2)` for `pillow`).
   - **Directional Lighting & Shading**:
     - `lightAzimuthDeg?: number` (default `-35`), `lightElevationDeg?: number` (default `45`), `ambient?: number` (default `0.45`), `directionalLighting?: boolean` (default `false` for backward compat when omitted), `rimStrength?: number` (default `0`).
     - Compute surface normal: front/back faces derive tilted normal from depth-profile gradient `(dh/dx, dh/dy, ±1)`, extruded side walls use 2D silhouette edge normal `(nx, ny, 0)`, rotated by `R` into world space and dotted with the normalized light vector.
   - **Front + Back Face Support**:
     - `backSource?: PixelBuffer | null` — when the ray hits a back-facing surface (`zSlice < 0` or `facingZ < 0` on a thin card), sample `backSource` (horizontally mirrored in local space so the back texture reads correctly from behind!).
     - `mirrorBack?: boolean` — when `backSource` is null and `mirrorBack` is true, mirror `src` horizontally on the back face.
   - **Pixel-Art Quality**:
     - `preScaleEPX?: boolean` — upscale `src` (and `backSource`) 2× via `scale2xEPX` from `rotsprite.ts` before ray sampling for cleaner diagonal edges.
     - `cleanup?: PixelCleanupOptions | null` — run `applyPixelCleanup` after rendering (orphans, hole fill, Palette Lock against source+back palette, outline).
3. **Tests (`tests/rotate3d.test.ts`)**:
   - Mat3 composition & identity/euler round-trip tests.
   - Pivot offset test (rotating around bottom-center keeps base anchored).
   - Depth profile tests (`bevel`/`pillow` thinner at edges than center; `heightmap` respects luminance).
   - Directional lighting test (lit side brighter than shadowed side; rim increases edge brightness).
   - Front/back face test (180° yaw shows `backSource` pixel color).
   - Palette lock & `autoFitBounds` tests (no new colors outside palette; 45° rotated full-canvas square does not lose corners when `autoFitBounds` is enabled).

---

### Milestone `R3D-1` — Sprite Stacking v2 & Advanced Turntable Engine
**Goal**: Upgrade `renderSpriteStack` and `bakeTurntableFrames` for 3-axis stacking, lighting, custom sweep/sway, easing, and animated-sprite turntables.

**Deliverables**:
1. **Sprite Stacking v2 (`SpriteStackOptions`)**:
   - Optional `rollDeg?: number` (default `0`), `perspective?: number` (default `0`), `sliceThickness?: number` (default `1`, sub-voxel repeat multiplier), `reverseOrder?: boolean` (flip bottom↔top), `directionalLighting?: boolean`, `lightAzimuthDeg?: number`, `lightElevationDeg?: number`, `ambient?: number`, `autoFitBounds?: boolean`, `cleanup?: PixelCleanupOptions | null`.
   - Maintain exact existing behavior when all new fields are omitted/default.
2. **Turntable Engine v2 (`BakeTurntableOptions`)**:
   - `startDeg?: number` (default `0`), `sweepDeg?: number` (default `360`), `pingPong?: boolean` (default `false`), `easing?: "linear" | "easeInOut" | "easeIn" | "easeOut"` (default `"linear"`).
   - `sourceFrames?: readonly PixelBuffer[]` — when provided with length > 1, frame `i` samples `sourceFrames[i % sourceFrames.length]` while advancing the 3D angle, enabling spinning animations!
   - `backFrames?: readonly PixelBuffer[]` — matching animated back-face frames when `backSource` is animated.
   - Export reusable camera & turntable presets (`ROTATE3D_CAMERA_PRESETS`: Front, 3/4 L, 3/4 R, True Pixel Iso 2:1, Top-Down, Coin Flip; `TURNTABLE_PRESETS`: 4-Dir, 8-Dir, 16-Dir, Sway ±35°).
3. **Tests (`tests/rotate3d.test.ts`)**:
   - Sprite Stack roll, perspective, reverseOrder, and lighting tests.
   - Turntable sweep/ping-pong/easing angle progression tests.
   - Animated-sprite turntable (`sourceFrames`) test confirming each baked frame combines the corresponding animation frame with its rotation step.

---

### Milestone `R3D-2` — 3D Studio Modal v2 UI
**Goal**: Upgrade `src/components/Rotate3DModal.tsx` and `src/styles/layout.css` to expose all `R3D-0` / `R3D-1` capabilities with a clean, compact, flat-dark studio layout.

**Deliverables**:
1. **Interactive Preview Stage**:
   - **3D XYZ Axis Gizmo** drawn over the preview corner (shows live rotated X=red, Y=green, Z=blue axes).
   - **Preview Zoom** controls (`Auto`, `2×`, `4×`, `6×`) + checkerboard backdrop.
   - **Live Turntable Scrubber**: Toggle between *Orbit Mode* and *Turntable Preview* (play/pause + frame slider `0..N-1` showing the exact baked frames before committing).
2. **Organized Control Groups** (scrollable right column, zero visual clutter):
   - **Source & Faces**: Source Scope (Visible / Active), Back-Face Layer selector (None / Mirror / Specific Raster Layer), Pivot (Center / Bottom-Center / Custom X,Y).
   - **Transform**: Yaw, Pitch, Roll, Perspective, Safe Auto-Fit toggle, Camera Presets (Front, 3/4 L/R, True Iso 2:1, Top-Down).
   - **Extrusion / Stack**:
     - Extruded mode: Depth Profile (`Slab` / `Bevel` / `Pillow` / `Height-Map`), Thickness (`0..16px`), Height-Map Layer picker (when `Height-Map` selected).
     - Stack mode: Tilt, Roll, Slice Step, Slice Thickness, Perspective, Reverse Order.
   - **Lighting & Pixel Quality**:
     - Directional Lighting toggle + Light Azimuth/Elevation + Ambient + Rim Highlight; Depth Shading toggle.
     - EPX Pre-Scale, 2× Supersample, Palette Lock, Orphan Removal, Fill Holes, 1px Outline + color picker.
   - **Turntable Baker**:
     - Presets (`4-Dir`, `8-Dir`, `16-Dir`, `Sway`), Frame Count (`4..32`), Spin Axis, Sweep (`-360°..360°`), Ping-Pong, Easing, **"Spin Across Timeline Frames"** checkbox (uses all timeline frames when `frames.length > 1`).
3. **Undo-Safe Apply & Bake**:
   - Applying to current frame uses existing `pixelEngine.history` transaction.
   - Baking onto a new layer when `baked.length <= state.frames.length` preserves undo history cleanly.

---

### Milestone `R3D-3` — 3D Bone Model, Hierarchical 3D FK, Keyframes & Serialization
**Goal**: Add optional 3D channels (`yawDeg`, `pitchDeg`, `localZ`) and per-bone 3D render settings to `RigEngine.ts` with full 3×3 hierarchical FK and backward-compatible serialization.

**Deliverables**:
1. **Data Model Extensions (`src/engine/rig/RigEngine.ts`)**:
   - On `Bone`:
     - `yawDeg?: number` (default `0`)
     - `pitchDeg?: number` (default `0`)
     - `localZ?: number` (default `0`)
     - `extrudeDepth?: number` (default `0`)
     - `depthProfile?: DepthProfile` (default `"slab"`)
     - `backLayerId?: string | null` (default `null`)
   - On `BonePose`, `BoneKeyframe`, `RigPoseBone`:
     - `yawDeg?: number`, `pitchDeg?: number`, `localZ?: number` (interpolated with the keyframe's `easing` / `curve` and angle-normalized like `rotationDeg`).
   - On `BoneWorldTransform`:
     - `z: number` (world Z coordinate; `0` in pure 2D)
     - `tipZ: number`
     - `worldYawDeg: number`
     - `worldPitchDeg: number`
     - `worldMatrix: Mat3` (full 3×3 orientation)
     - `facingZ: number` (`worldMatrix[8]`, `> 0` front-facing, `< 0` back-facing)
2. **Hierarchical 3D FK (`computeWorldTransform`)**:
   - Fast path: if bone and parent both have `yawDeg === 0 && pitchDeg === 0 && localZ === 0` (and parent has identity 3D tilt), run exact existing 2D math and set `z = 0`, `tipZ = 0`, `worldYawDeg = 0`, `worldPitchDeg = 0`, `facingZ = 1`.
   - 3D path:
     - `R_local = mat3FromEulerDeg(local.yawDeg, local.pitchDeg, local.rotationDeg)`
     - `R_world = parent ? mat3Mul(parent.worldMatrix, R_local) : R_local`
     - Offset `[localX * parent.worldScaleX, localY * parent.worldScaleY, localZ]` rotated by `parent.worldMatrix` and added to `(parent.x, parent.y, parent.z)`.
     - Tip = `worldPos + R_world * [bone.length * worldScaleX, 0, 0]`.
     - Extract `worldRotationDeg`, `worldYawDeg`, `worldPitchDeg` consistently; `facingZ = R_world[8]`.
   - Support an optional **Virtual Root 3D Orbit** parameter on `computeWorldTransforms` / `evaluate` (e.g., `orbit?: { yawDeg: number; pitchDeg: number; rollDeg: number; originX: number; originY: number }`) so Milestone `R3D-6` can spin the entire skeleton cleanly without mutating bone data!
3. **Animation & Pose Tools (`src/engine/rig/animationTools.ts`)**:
   - `capturePose`, `applyPose`, `pasteMirroredPose` (mirrors `yawDeg` sign when mirroring left↔right!), `copyKeyframes`, `pasteKeyframes` all preserve `yawDeg`, `pitchDeg`, `localZ`.
4. **Serialization**:
   - `toSnapshot()` / `fromSnapshot()` and `serializeRuntimeJson()` round-trip all 3D fields; missing fields default safely to `0` / `"slab"` / `null`.
5. **Tests (`tests/rig3d.test.ts`)**:
   - Pure 2D regression test (exact match with prior behavior).
   - 3D parent yaw rotates child `(x, z)` in a circle (`90°` yaw moves child from `+X` to `-Z`; `180°` flips child to `-X` and `facingZ < 0`).
   - Keyframe interpolation & easing for `yawDeg`, `pitchDeg`, `localZ`.
   - Snapshot round-trip & legacy v2 snapshot load compatibility.
   - Virtual root orbit test.

---

### Milestone `R3D-4` — Per-Bone 2.5D Rasterization & Dynamic Z-Sorting in Rig Compositor
**Goal**: Wire 3D bone transforms into [`warpLayerByBone`](file:///home/antigravity/jalatodeguerra/pixet/src/engine/rig/RigEngine.ts#L455-L495) and [`compositeRigFrame`](file:///home/antigravity/jalatodeguerra/pixet/src/engine/document/PixelEngine.ts#L1005-L1297) so rotating bones in 3D visibly deforms, extrudes, swaps back faces, and dynamically depth-sorts limbs.

**Deliverables**:
1. **Per-Bone 2.5D Rasterizer (`warpLayerByBone3D` in `RigEngine.ts`)**:
   - Checks if bone has non-zero 3D rotation (`Math.abs(posed.worldYawDeg - rest.worldYawDeg) > 0.05 || Math.abs(posed.worldPitchDeg - rest.worldPitchDeg) > 0.05`) or `extrudeDepth > 0`.
   - If flat 2D → delegates directly to existing 2D `warpLayerByBone` (zero perf impact).
   - If 3D → computes relative rotation matrix `R_delta = posed.worldMatrix * transpose(rest.worldMatrix)`, extracts relative Euler angles, and renders `src` (plus optional `backSource` from `bone.backLayerId`) via `render25DSprite` pivoted at `(rest.x, rest.y)` and translated to `(posed.x, posed.y)` with `scaleX`/`scaleY`, `extrudeDepth`, `depthProfile`, and optional rig lighting settings from `RigRenderOptions`.
2. **Dynamic Z-Sorting in `compositeRigFrame` (`PixelEngine.ts`)**:
   - Extend `RigRenderOptions` with `autoZSort?: boolean` (default `true`), `perspective3d?: number`, `directionalLighting?: boolean`, `lightAzimuthDeg?: number`, `lightElevationDeg?: number`, and `rootOrbit?: RigOrbit3D | null`.
   - Collect renderable items (bound raster layers, masked bone slices, unmasked base, slots) with their `(zDepth, originalDrawOrder)` tuple.
   - When `autoZSort !== false` and any bone has non-zero world `z`, sort items ascending by `zDepth` (far-to-near), using `originalDrawOrder` as deterministic tie-breaker.
   - Update `deformKey` in `rigDeformCache` to include 3D options & `rootOrbit` so cached buffers invalidate accurately.
3. **Tests (`tests/rig3d.test.ts`)**:
   - Per-bone yaw/pitch narrows/tilts bound layer pixels and activates `backLayerId` when `facingZ < 0`.
   - Dynamic Z-sorting test: two bones with different `localZ` (or parent yawed `180°`) swap compositing order so the closer limb draws on top.
   - 2D rig compositing remains identical when all bones have `z = 0`.

---

### Milestone `R3D-5` — Rig 3D Gizmo, Properties Panel, Curve Editor & Timeline
**Goal**: Make 3D bone rotation intuitive and tactile directly in the Rig workspace viewport and sidebars.

**Deliverables**:
1. **Rig 3D Rotate Tool & Gizmo**:
   - Add `"rotate3d"` tool to `RigTool` in `src/store/editorStore.ts` and `src/components/rig/rigTools.ts` (shortcut `R`, icon `Rotate3d` from `lucide-react`, placed in the primary transform group `["select", "translate", "scale", "rotate3d"]`).
   - Also allow **`Alt+Drag`** on a selected bone in `"select"` tool to quickly orbit its `yawDeg` / `pitchDeg`.
   - In `src/components/rig/rigGizmo.ts` & `src/components/rig/RigOverlay.tsx`:
     - Draw a clean 3D orbit ring (dashed/solid ellipse previewing yaw/pitch orientation + Z-depth indicator) around the selected bone when `"rotate3d"` is active or bone has 3D tilt.
     - Visually distinguish back-facing bones (`facingZ < 0`) with a subtle dashed outline in `RigOverlay`.
   - In `src/components/rig/useRigPointer.ts`:
     - Horizontal drag adjusts `yawDeg`, vertical drag adjusts `pitchDeg` (with `Shift` snapping to 15° increments, `Ctrl/Cmd` adjusting `localZ`), wrapped in `beginRigGesture("3D Rotate Bone")` / `endRigGesture()` for single-step undo and auto-keyframe support in Animate mode!
2. **Bone Properties Panel (`src/components/rig/BonePropertiesPanel.tsx`)**:
   - Add a compact **3D Rotation & Depth** section:
     - `Yaw`, `Pitch`, `Z` numeric/slider inputs (setup bind pose in Setup mode; posed/keyframed in Animate mode) + Reset 3D button.
     - `Thickness` (`0..12px`), `Profile` (`Slab` / `Bevel` / `Pillow`), and `Back Layer` dropdown (None / raster layers).
3. **Curve Editor & Timeline (`src/components/rig/CurveEditor.tsx`, `src/components/Timeline.tsx`)**:
   - Add `"yawDeg"`, `"pitchDeg"`, `"localZ"` to `CurveChannel` in `CurveEditor.tsx`.
   - Reflect 3D keyframe edits in Timeline keyframe diamonds.
4. **Rig Render Panel (`src/components/rig/RigRenderPanel.tsx`)**:
   - Add `Auto Z-Sort` toggle and `3D Lighting` toggle + Perspective slider (persisted in `editorStore`).

---

### Milestone `R3D-6` — Rig-Aware 3D Turntable & Multi-Direction Baker
**Goal**: Connect the 3D Studio directly to the Rig workspace so artists can spin a posed or animated rigged character into 4/8/16-direction spritesheets or turntables.

**Deliverables**:
1. **Rig Turntable Engine (`src/engine/rig/export/bake.ts`)**:
   - `bakeRigTurntable(pixelEngine, layers, options)` — supports:
     - **Static Pose Turntable**: spins the current rig pose across `N` angles (`4`, `8`, `12`, `16`, etc.) using `rootOrbit`.
     - **Multi-Direction Animated Clip Baker**: for a selected direction count (e.g., `4-Dir` or `8-Dir`) and active rig clip (`F` frames), renders each direction's full animation cycle (`N * F` frames with auto-generated animation tags like `Walk_S`, `Walk_SW`, `Walk_W`, ... or separate per-direction layers!).
2. **3D Studio Modal — "Rig 3D Turntable" Tab (`src/components/Rotate3DModal.tsx`)**:
   - Add a 3rd tab `"Rig 3D"` (shown/enabled when `pixelEngine.rig.bones.length > 0`).
   - Live interactive orbit preview of the rigged character using `compositeRigFrame` with `rootOrbit` (showing real 3D FK + dynamic Z-sorting + per-bone extrusion!).
   - Mode toggle: *Turntable (Current Pose)* vs. *Multi-Dir Clip Bake (4-Dir / 8-Dir / 16-Dir)* with automatic timeline tags.
3. **Final Verification & Regression Pass**:
   - Run all unit tests (`tests/*.test.ts`), `pnpm run build`, `cargo test --workspace`, and CSS hard-rule audit.

---

## Orchestration & Review Protocol
For each milestone (`R3D-0` through `R3D-6`):
1. **Dispatch**: Orchestrator invokes a focused implementing subagent with the exact milestone spec, target files, and hard rules.
2. **Review**: Orchestrator inspects `git diff`, checks strict TS / CSS rules / backward compatibility / edge cases, and runs the milestone's verification commands.
3. **Fix or Commit**: Any review findings are fixed before committing the milestone cleanly (`feat(3d): R3D-X ...`).
