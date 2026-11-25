# Pixet — Advanced Rig Workspace: Implementation Plan

> Hand-off document for an implementing agent. Read **§0 Context & Rules** fully before touching code.
> Work milestone by milestone (R0 → R7). Each milestone must end green (all checks in §0.4) and be committed separately on `main`.

---

## 0. Context & Rules

### 0.1 Project
- **Pixet** (`e:\desarrollo\pixet`): pixel-art editor for game devs.
- Stack: **Tauri v2** + Rust workspace (`crates/pixet-core`, `crates/pixet-cli`, `src-tauri`) + **Vite + React 18 + TypeScript (strict) + Zustand + lucide-react**.
- Remote: `origin` → https://github.com/jalatodeguerra/pixet (commit email is already configured repo-locally as the GitHub noreply address; do not change it).

### 0.2 Existing rig code (read these first)
| File | What it contains today |
|---|---|
| `src/engine/rig/RigEngine.ts` | `RigState` class: `bones`, `clips` (`RigClip { id, name, frameCount, tracks: Record<boneId, BoneKeyframe[]> }`), `activeClipId`, `currentPoseOverrides`, `boneMasks` (hard 0/1 `Uint8Array` per bone). Methods: `addBone/updateBone/removeBone`, `computeWorldTransforms(frame, "rest"\|"pose", useOverrides)`, `getBonePoseAtFrame`, `setPoseOverride`, `setKeyframe/deleteKeyframe/hasKeyframe`, `applyTwoBoneIK`, `paintBoneMask`, `autoAssignBoneMasks`, `seedStarterRig`, `serializeRuntimeJson`, `toSnapshot/fromSnapshot`. Free functions: `solveTwoBoneIK`, `warpLayerByBone` (pixel-snap + RotSprite-style 3×3 majority sampling), `renderBoneInfluenceOverlay`, `getBoneInfluenceColor`, `lerpAngleDeg`, `evaluateEasing` (`linear`/`step`/`easeInOut`). |
| `src/engine/document/PixelEngine.ts` | `pixelEngine.rig` (singleton `RigState`), `compositeRigFrame(layers, frame, opts)` (warps bound layers + masked regions per bone), `compositeFrameWithShaderPreview(...)` (used by Viewport & FloatingPreview, calls rig compositing when `useRig`). |
| `src/components/RigPanel.tsx` | Right-sidebar rig inspector (bone list, properties, keyframe buttons, bake-to-frames, `.rig.json` export, weight paint options). |
| `src/components/Viewport.tsx` | SVG bone gizmo overlay, `rigDragRef` pointer logic for rig tools `select` / `addBone` / `ik` / `weightPaint`. **Caution:** many short code fragments repeat in this ~2400-line file — always include surrounding function context when editing. |
| `src/components/Timeline.tsx` | Rig dope sheet rows (bone rows + gold keyframe diamonds) shown when `workspaceMode === "rig"`. |
| `src/components/ToolRail.tsx` | Left tool rail with click-and-hold tool groups (drawing tools). |
| `src/components/TopBar.tsx` | Menus + workspace mode tabs (`draw` / `tiles` / `rig` / `data`). |
| `src/components/RightSidebar.tsx` | Mounts `RigPanel` when `workspaceMode === "rig"` *above* the always-visible Color & Palette and Layers sections. |
| `src/store/editorStore.ts` | `workspaceMode`, `rigTool: "select" \| "addBone" \| "ik" \| "weightPaint"`, `selectedBoneId`, `rigPixelSnap`, `rigRotSprite`, `rigShowBones`, `rigShowInfluence`, `rigBrushSize`, `rigVersion` + `bumpRigVersion()`. |
| `src/engine/io/projectBridge.ts` | `.pixet` save/load: `document.rig = pixelEngine.rig.toSnapshot()` / `pixelEngine.rig.fromSnapshot(doc.rig)`. Rust stores it as opaque `Option<serde_json::Value>` (`crates/pixet-core/src/document.rs`) — **no Rust change needed for rig schema changes**. |
| `tests/engine.test.ts` | Node native TS tests (`node --test`). Existing rig tests: FK, 2-bone IK, keyframe interpolation, warp, influence painting, snapshot round-trip. |

### 0.3 Hard rules
1. **UI style (user-enforced):** flat neutral dark-gray (`#141414`, `#1a1a1a`, `#202020`, `#272727`, `#303030`, accent `#4c8bf5`). **0px border-radius, no `box-shadow`, no `text-shadow`, no `backdrop-filter`, no decorative gradients, no glows.** Reuse existing classes in `src/styles/layout.css` (`panel-section`, `panel-header`, `panel-collapse-btn`, `panel-body`, `mini-btn`, `icon-action-btn`, `hsv-row`/`hsv-range`, `rig-*`, `timeline-*`). Gradients for color pickers/curves must be drawn on `<canvas>`, never CSS.
2. **Engine purity:** everything under `src/engine/**` must be React-free and import relatives **with explicit `.ts` extensions** (required by `node --test`).
3. **TypeScript:** `strict`, `noUnusedLocals`, `noUnusedParameters` are on. No `any`.
4. **Backward compatibility:** old `.pixet` files (rig snapshot without `version`) must still load. Bump snapshot to `version: 2` and write a migration in `fromSnapshot`.
5. **Pixel-art correctness:** all deformation output must stay nearest-neighbor, palette-preserving (never invent new colors via interpolation), and optionally pixel-snapped.
6. Keep `Viewport.tsx` from growing further: put new rig pointer logic in a new module (see R1).

### 0.4 Definition of done (run after every milestone)
```powershell
rg -n "box-shadow|text-shadow|backdrop-filter|border-radius:\s*[1-9]" src/styles/   # must print nothing
node --test tests/engine.test.ts                                                     # all pass
pnpm run build                                                                        # tsc && vite build, 0 errors
cargo test --workspace                                                                # all pass
git add -A; git commit -m "feat(rig): <milestone summary>"
```
Add **new unit tests** for every new engine function (pure math is easy to test — do it).

---

## R0 — Rig Data Model v2, Evaluation Pipeline & Rig Undo

**Goal:** a single extensible data model and deterministic evaluation order that every later milestone plugs into.

### Data model changes (`src/engine/rig/RigEngine.ts`, or split into `src/engine/rig/types.ts`)
```ts
interface Bone {
  id; name; parentId; localX; localY; length; rotationDeg; boundLayerId;   // existing
  scaleX?: number; scaleY?: number;        // default 1
  color?: string;                          // UI tag color
  hidden?: boolean; locked?: boolean;      // editor-only
  minAngleDeg?: number; maxAngleDeg?: number; // rotation limits (local)
}
interface BoneKeyframe {
  frame; rotationDeg; localX?; localY?; easing?;   // existing
  scaleX?: number; scaleY?: number;
  attachment?: string | null;              // sprite swap key (R5); step-interpolated
  curve?: [number, number, number, number]; // cubic-bezier handles for easing "bezier" (R4)
}
type EasingMode = "linear" | "step" | "easeInOut" | "easeIn" | "easeOut" | "bezier";

type RigConstraint =
  | { id; type: "ik"; name; enabled; boneIds: string[]; targetX; targetY; bendSign: 1 | -1; mix: number }
  | { id; type: "aim"; name; enabled; boneId; targetX; targetY; offsetDeg; mix }
  | { id; type: "copyRotation" | "copyTransform"; name; enabled; boneId; sourceBoneId; mix }
  | { id; type: "spring"; name; enabled; boneId; stiffness; damping; gravity };
// Constraint targets (targetX/targetY) are keyable: store per-clip tracks under clip.constraintTracks[constraintId].

interface RigSlot { id; name; boneId; layerId: string | null; attachments: Record<string, { layerId: string; frame: number }>; defaultAttachment: string | null }   // R5
interface RigPose { id; name; bones: Record<boneId, { rotationDeg; localX; localY; scaleX?; scaleY? }> } // R4
interface RigClip { id; name; frameCount; tracks; constraintTracks?: Record<string, {frame; targetX; targetY; easing?}[]>; loop?: boolean }

interface BoneWeights {   // replaces hard masks (R6); keep boneMasks reading for migration
  width; height;
  // sparse per-pixel influences, max 4 per pixel
  entries: Map<number /*pixelIndex*/, Array<{ boneId: string; w: number /*0..1*/ }>>;
}
```
- `RigSnapshot` gains `version: 2`, `constraints`, `slots`, `poses`, `weights` (sparse JSON: `[{ i, b: [boneId, w][] }]`). `fromSnapshot` migrates v1 (`masks` → hard weights `w=1`).

### Evaluation pipeline (new `RigState.evaluate(frame, opts): Map<boneId, BoneWorldTransform>`)
1. Local pose per bone = override ?? clip track interpolation (rotation, translation, scale, attachment).
2. Forward kinematics → world transforms (include scale in the parent→child transform).
3. Apply enabled constraints **in list order**, each re-running FK for the affected subtree, blended by `mix`.
4. Clamp rotation limits after each constraint.
5. Spring constraints are evaluated by **deterministic simulation from frame 0 to `frame`** (fixed timestep, cached per clip+version) so scrubbing is stable.
- `computeWorldTransforms(frame, "pose")` becomes a thin wrapper over `evaluate` so existing callers keep working. `"rest"` stays pure FK on bind values.

### Rig undo (new `src/engine/rig/RigHistory.ts`)
- Snapshot-based stack (`toSnapshot()` JSON strings, cap 100). API: `push(label)`, `undo(rig)`, `redo(rig)`, `canUndo/canRedo`.
- In `historyActions.ts` `performUndo/performRedo`: if `workspaceMode === "rig"` and rig history has entries, undo/redo the rig instead of pixels, then `bumpRigVersion()` + `emitChange()`.
- Every rig mutation from UI calls `rigHistory.push(label)` *before* mutating (wrap in a helper `mutateRig(label, fn)` in `src/engine/rig/rigActions.ts`).

**Tests:** v1→v2 migration; scale in FK; evaluate == old computeWorldTransforms when no constraints; rig undo/redo round-trip.

---

## R1 — Focused Rig Workspace Layout

**Goal:** entering Rig mode turns Pixet into a dedicated rigging app.

1. **Setup / Animate sub-mode** — store `rigMode: "setup" | "animate"` (default `setup`), segmented toggle in the top bar next to the workspace tabs when in rig mode.
   - *Setup:* edits bind pose (`updateBone`), bone creation, weights, slots, constraints definition. Timeline keyframes hidden/disabled.
   - *Animate:* edits pose overrides + keyframes; bone creation disabled; bind values read-only.
   - Visual cue: thin 2px top border on the viewport (`#4c8bf5` setup, `#eab308` animate) — flat, no glow.
2. **Rig tool rail** — `ToolRail.tsx` renders a different tool set when `workspaceMode === "rig"`:
   `Select/Rotate (V)`, `Translate (G)`, `Scale (S)`, `Add Bone (B)`, `Chain (C)`, `IK Target (K)`, `Weight Paint (W)`, `Mesh Edit (M)` (R6), `Pin (P)` (creates IK constraint on click). Extend `RigTool` union accordingly. Keyboard shortcuts only active in rig mode.
3. **Rig sidebar** — when `workspaceMode === "rig"`, `RightSidebar.tsx` shows **only** rig sections (hide Color & Palette; collapse Layers to a compact "Bound Layers" list):
   - Bone Tree (R2) · Bone Properties · Constraints (R3) · Slots/Attachments (R5) · Weights (R6) · Clips & Poses (R4) · Render options (Pixel Snap, RotSprite, cleanup).
   - Split the current `RigPanel.tsx` into `src/components/rig/` (`BoneTreePanel.tsx`, `BonePropertiesPanel.tsx`, `ConstraintsPanel.tsx`, `SlotsPanel.tsx`, `WeightsPanel.tsx`, `ClipsPosesPanel.tsx`, `RigRenderPanel.tsx`). Each is a collapsible `panel-section`.
4. **Viewport refactor** — move rig pointer handling out of `Viewport.tsx` into `src/components/rig/useRigPointer.ts` (a hook returning `onPointerDown/Move/Up` handlers + overlay draft state) and the SVG gizmo rendering into `src/components/rig/RigOverlay.tsx`. Viewport delegates when `workspaceMode === "rig"`.
5. **Gizmo upgrade** — selected bone shows rotate ring handle, translate handle at joint, scale handle at tip; hovering a bone highlights it; hidden bones not drawn; locked bones not pickable.
6. **Rig status bar info** — bone name, local angle, world position, active constraint count.

**Acceptance:** switching to Rig shows only rig tools/panels; switching back to Draw restores the previous layout exactly; no regressions in existing rig features.

---

## R2 — Bone Tree & Skeleton Tools

1. **Bone Tree panel** — hierarchical, indented, expand/collapse, drag-and-drop reparent (reuse layer DnD before/after/inside pattern from `RightSidebar.tsx`), inline rename (double-click), eye (hidden) + lock toggles, color swatch, search filter. Selection syncs with viewport & timeline. Multi-select with Shift/Ctrl (store `selectedBoneIds: string[]`, keep `selectedBoneId` as primary).
   - Reparenting must preserve world transform (recompute local from world).
2. **Chain tool** — click to place joints successively; each click creates a child bone; `Enter`/right-click/`Esc` finishes. Live dashed draft (existing `.rig-bone-draft`).
3. **Mirror** — `Mirror Bones` action: duplicates selected subtree across a vertical axis (default canvas center, editable X), renames `L↔R` (`.L/.R`, `_l/_r`, `Left/Right`), mirrors angles (`180 - a`), and optionally mirrors keyframes of the active clip. Also `Mirror Pose` (copy pose from L side to R side) used in R4.
4. **Snapping** — while dragging: `Shift` snaps angle to 22.5° steps (pixel-art friendly: 0/22.5/45/67.5/90…), lengths snap to integers, joints snap to pixel centers when Pixel Snap is on.
5. **Bone properties panel** — numeric fields for X/Y/length/rotation/scale, parent dropdown, bound layer dropdown, color, angle limits (min/max with enable checkbox).
6. **Context menu on bones** (viewport + tree, reuse `openContextMenu`): Rename, Add Child, Mirror, Select Children, Reset Pose, Delete (with "keep children" behavior already in `removeBone`).

**Tests:** reparent preserves world transform; mirror naming + angle math; chain creation builds correct parent links.

---

## R3 — Constraints & Advanced IK

New module `src/engine/rig/constraints.ts` (pure, tested).

1. **FABRIK N-bone IK** — `solveFabrik(chainWorldPoints, lengths, target, iterations=12, tolerance=0.01)` → joint positions → convert to local rotations. Respect per-bone angle limits (clamp each iteration). Keep `solveTwoBoneIK` as fast path for 2-bone chains with `bendSign`.
2. **IK constraint** — chain = ordered `boneIds` (root→tip); target is a draggable viewport handle (crosshair square). `mix` 0..1 blends FK↔IK. **Pin tool** creates a 1-target IK on the clicked bone chain (auto-detect chain length = up to 2 ancestors, editable).
3. **Aim/LookAt** — rotates bone so its +X axis points at target, plus offset.
4. **Copy Rotation / Copy Transform** — with `mix`.
5. **Spring (secondary motion)** — per-bone angular spring toward animated pose: `angle'' = -k(angle - target) - d·angle' + gravity term`; deterministic from frame 0 (see R0 step 5). Great for tails/hair/capes.
6. **Constraints panel** — list with enable checkbox, type icon, name, reorder (up/down), delete; per-type property editor; "Key Target" button in Animate mode (writes `constraintTracks`).
7. **Viewport** — draw constraint targets and a thin dashed line from chain tip to target; IK chains tinted.

**Tests:** FABRIK reaches reachable target within tolerance; clamps unreachable target along straight line; angle limits respected; aim produces correct angle; spring is deterministic (same frame → same result) and settles toward target.

---

## R4 — Animation Workflow

1. **Multiple clips UI** (`ClipsPosesPanel.tsx`) — list clips, add/rename/duplicate/delete, set active, frame count, loop flag. Link option: "Sync clip length to timeline tag" (map clip ↔ existing `AnimationTag` by name).
2. **Auto-Key** — toggle (store `rigAutoKey`); in Animate mode any pose change on a bone writes a keyframe at the current frame for the touched channels.
3. **Keyable channels** — rotation, translation, scale, attachment (step), constraint targets. Dope sheet (`Timeline.tsx`) shows per-bone row; expand arrow reveals per-channel sub-rows.
4. **Dope sheet editing** — box-select keys, drag to retime (snap to frames), `Ctrl+C/V` copy/paste keys, `Delete`, right-click easing presets. Keys of selected bones highlighted.
5. **Curve editor** — new `src/components/rig/CurveEditor.tsx` (canvas-drawn, flat): toggle in timeline toolbar to switch dope sheet ↔ curves for the selected bone's rotation/x/y/scale. Edit `curve` bezier handles; `evaluateEasing` gains `easeIn`, `easeOut`, `bezier` (cubic-bezier solver via Newton/bisection, unit-tested).
6. **Pose library** — save current pose (selected bones or all) as named `RigPose`; apply (sets overrides, or keys if Auto-Key), blend slider (0..1) between current and pose; Copy Pose / Paste Pose / Paste Mirrored Pose (uses R2 mirror mapping).
7. **Bone onion skin** — when timeline onion skin is on in rig mode, draw skeleton ghosts (prev frames reddish, next bluish, low opacity) in `RigOverlay.tsx`.
8. **Playback** — rig preview respects clip `loop` and per-frame durations; FloatingPreview plays the active clip.

**Tests:** bezier easing endpoints/monotonic; auto-key writes only touched channels; pose apply/blend math; key retime keeps sorted tracks.

---

## R5 — Sprite Swapping (Slots & Attachments)

The most pixel-art-native rig feature: swap hand shapes, eyes, mouths per keyframe.

1. **Slots** — a slot belongs to a bone; it has named **attachments**, each pointing to a raster source (`layerId` + source `frame`) drawn in the bone's rest space.
   - Create from UI: "Make Slot from Layer" (selected layer → slot on selected bone), "Add Attachment from Frame N" (captures that layer/frame cel as an attachment variant), or "Add Attachments from Layer frames" bulk.
2. **Rendering** — in `PixelEngine.compositeRigFrame`, for each slot resolve active attachment (`attachment` channel step-interpolated, else `defaultAttachment`), fetch the source cel, warp it with the slot's bone (existing `warpLayerByBone`), composite in slot draw order. Slot layers themselves are excluded from normal compositing in rig mode.
3. **Slots panel** — list slots per bone, attachment thumbnails (reuse `LayerThumbnail` pattern), click to set at current frame (keys `attachment` in Animate mode), draw-order up/down.
4. **Dope sheet** — attachment keys shown as small square markers with attachment name tooltip.

**Tests:** attachment step interpolation; slot draw order; snapshot round-trip including slots.

---

## R6 — Smooth Weights, Mesh Deformation & Pixel Cleanup

New modules `src/engine/rig/skinning.ts`, `src/engine/rig/mesh.ts`, `src/engine/rig/pixelCleanup.ts`.

1. **Smooth weights** — Weight Paint tool gains: brush strength (0..1), modes Add / Subtract / Smooth / Replace, falloff (hard / linear). Auto-weights: distance-to-bone-segment with smooth falloff (top-4 bones, normalized). Overlay shows the selected bone's weight as heatmap alpha (keep existing color-per-bone view as alternate).
2. **Pixel skinning (LBS) without holes** — per-pixel linear blend skinning of positions. Because forward-mapping creates holes, use:
   - **Inverse mapping per destination pixel** using a coarse inverse displacement field: forward-map a sparse lattice (every 2–4 px) with LBS, build triangles, and for each destination pixel find its source via barycentric interpolation in the deformed triangle → nearest-neighbor sample. (Shares code with mesh deformation below.)
   - Fallback when weights are hard (single bone ≥ 0.99 everywhere): keep current per-bone `warpLayerByBone` path (fast, RotSprite quality).
3. **Mesh deformation** — `Mesh Edit` tool: auto-generate a grid mesh (configurable cell size) over the opaque bounds of a bound layer/slot; vertices weighted by bones (from the weight map) and optionally manually draggable as **FFD keyable vertex offsets** (`clip.meshTracks[meshId]`). Render via the same inverse-triangle sampler. Pixel Snap rounds vertex positions.
4. **Pixel cleanup pass** (toggle in Rig Render panel; applied after deformation):
   - Remove orphan single pixels whose 8 neighbors are all transparent (optional).
   - Fill 1-px holes surrounded on ≥3 orthogonal sides by the same color.
   - **Palette lock:** snap every output color to the nearest color present in the source cel (guarantees no new colors).
   - **Outline preservation (optional):** re-apply a 1px outline using the dominant darkest source color (reuse `applyPixelOutline` from `src/engine/tools/rotate3d.ts`).
5. **Performance** — cache deformed results per `(frame, rigVersion, layerVersion)`; target < 8 ms for a 128×128 sprite with 10 bones in the preview. Measure with a simple benchmark test (log only, don't fail CI on timing).

**Tests:** weights normalize to 1; inverse-triangle sampler maps identity mesh to identical image; palette lock never introduces new colors; hole fill fixes a known 1-px gap.

---

## R7 — Export & Bake

1. **Bake per clip** — extend existing bake: choose clips → writes frames into the timeline (new frames or replace range) and creates an `AnimationTag` per clip; options: include cleanup pass, onion off, pixel snap.
2. **Spine-compatible JSON** (`src/engine/rig/export/spine.ts`) — skeleton, bones (Spine Y-up conversion: flip Y and negate rotation), slots, region attachments (export each attachment/bound layer as PNG into an atlas via existing packing or individual PNGs + `.atlas` text), animations (rotate/translate/scale/attachment timelines with curves). Target Spine 4.x JSON schema basics; document unsupported features (mesh FFD → baked or skipped) in a `warnings[]` list shown to the user.
3. **Godot 4 export** (`src/engine/rig/export/godot.ts`) — `.tscn` with `Skeleton2D` + `Bone2D` hierarchy (rest transforms), `Sprite2D` per bound layer/slot parented to bones, and an `AnimationPlayer` with an `AnimationLibrary` (rotation/position tracks per bone, attachment → `texture` swap or `visible` tracks). Also export required PNGs.
4. **Runtime `.rig.json` v2** — update `serializeRuntimeJson` to include constraints, slots, and curves (`schema: "pixet-rig-v2"`).
5. **UI** — "Export Rig…" dialog (flat modal, reuse `ExportModal` styling) with format radio (Pixet JSON / Spine JSON / Godot Scene / Bake to Frames). In Tauri use existing dialog plugin + a small new Rust command `write_text_and_pngs(out_dir, files: Vec<{name, base64|text}>)` in `src-tauri/src/lib.rs` (or reuse an existing write helper if present); in browser mode download a ZIP or individual files.
6. **CLI (optional stretch)** — `pixet rig-export <file.pixet> --format spine|godot --out dir` by moving exporters to Rust later; **not required** for this plan.

**Tests:** Spine export coordinate conversion for a known bone; Godot `.tscn` contains expected node paths and track count; bake creates N frames + tag per clip.

---

## Suggested Order & Sizing
| Milestone | Depends on | Size |
|---|---|---|
| R0 Data model v2 + pipeline + rig undo | — | M |
| R1 Focused workspace layout | R0 | L |
| R2 Bone tree & skeleton tools | R1 | M |
| R3 Constraints & FABRIK IK | R0, R2 | L |
| R4 Animation workflow + curve editor | R0, R1 | L |
| R5 Sprite swapping | R0, R4 | M |
| R6 Smooth weights, mesh, cleanup | R0 | XL |
| R7 Export & bake | R3–R6 | L |

## Guidance for the implementing agent
- Before each milestone, re-read the files you will touch; line numbers in this doc are not guaranteed.
- Prefer small pure functions in `src/engine/rig/*` with tests, then thin React wiring.
- After every rig mutation in UI: `bumpRigVersion()` and `pixelEngine.emitChange()` (existing convention), and push to rig history (R0).
- Never break: `.pixet` loading of older files, existing rig tests, Draw/Tiles/Data workspaces.
- If a design decision isn't covered here, choose the simplest option consistent with §0.3 and note it in the commit message.
