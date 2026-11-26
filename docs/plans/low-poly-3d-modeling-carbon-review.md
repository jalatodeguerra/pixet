# Architectural & Product Review — Low-Poly 3D Modeling Workspace

> **Reviewed Target:** `docs/plans/low-poly-3d-modeling-workspace.md`  
> **Outcome:** 5 critical codebase-integration bugs caught, 6 core rendering/math refinements locked, and 11 high-leverage Blockbench / Crocotile 3D / Pixet-synergy features added and folded into **v2** of `docs/plans/low-poly-3d-modeling-workspace.md`.

---

## 1. Critical Issues Caught Against the Real Pixet Codebase (Must-Fix Before `M0`)

### 1.1 `Tileset.ts` Is Per-Tile `PixelBuffer[]` + `uid`, NOT a Static Atlas
- **What the codebase actually does (`src/engine/tiles/Tileset.ts`):**
  - `Tileset` stores individual `tiles: PixelBuffer[]` (1-indexed) and `meta: TileMeta[]` where each tile has a persistent `uid: string` (`tile-...`).
  - `deleteTileWithRemap()` and `reorderTiles()` **shift numeric `tileId` indices**!
- **v1 Plan Flaw:** `PolyFace.tileSource` only stored `tileId: number` and assumed `Tileset` could be bound directly as a single UV sheet. Deleting or reordering a tile in the `Tiles` workspace would silently corrupt every Crocotile-stamped 3D mesh, and unpadded atlas packing would bleed adjacent tiles on grazing angles.
- **v2 Fix:**
  1. Store `tileUid: string` (with `tileId` only as a fast lookup hint resolved via `uid`) in `PolyFace.tileSource`.
  2. Add a pure `buildPaddedTilesetAtlas()` helper (`src/engine/model3d/tilesetAtlas.ts`) that packs `Tileset` tiles into a deterministic RGBA grid with a **1px extruded border gutter around every tile**. This eliminates UV seam bleeding in Three.js *and* in exported `.glb` / `.obj` files.

### 1.2 `UndoCoordinator.ts` & `historyActions.ts` Cross-Engine Undo Trap
- **What the codebase actually does (`src/engine/history/UndoCoordinator.ts` & `src/engine/document/historyActions.ts`):**
  - `UndoKind` is currently `"pixels" | "cells" | "tileset"`.
  - `Rig` bypassed `UndoCoordinator` (`if (store.workspaceMode === "rig") rigHistory.undo(...)`).
- **v1 Plan Flaw:** In Low-Poly 3D, users interleave **3D geometry ops** (`extrude`, `stamp tile`) and **3D viewport paint strokes** (`pixels` on Draw layers or `tileset` edits) within the *same* workspace! If `Model3DHistory` intercepted `studio3d` globally like `Rig` does, pressing `Ctrl+Z` after `[Extrude Face -> Paint 3 Strokes -> Move Vertex]` would undo `Move Vertex` and `Extrude Face` *before* undoing the paint strokes—desyncing geometry and texture!
- **v2 Fix:** Extend `UndoKind = "pixels" | "cells" | "tileset" | "model3d"` directly in `UndoCoordinator.ts` and wire `nextKind === "model3d"` inside `performUndo()`, `performRedo()`, and `jumpToHistoryIndexAction()` (`historyActions.ts`). Geometry edits, 3D Draw painting, and 3D Tileset painting now share one chronological timeline.

### 1.3 `CurveEditor.tsx` & `App.tsx` Playback Coupling
- **What the codebase actually does (`src/components/rig/CurveEditor.tsx`, `src/App.tsx`):**
  - `CurveEditor.tsx` directly imports `pixelEngine.rig` and hardcodes 2D `Bone` channels (`rotationDeg`, `localX`, `localY`, etc.).
  - `App.tsx` (`lines 104–116`) only runs clip-length frame advancement for `workspaceMode === "rig" && rigMode === "animate"`.
- **v2 Fix:** Extract shared pure easing helpers (`evaluateEasing`, `CubicBezierHandles`, `EasingMode`) so both `RigEngine` and `Model3DEngine` use them without cross-importing, introduce a thin `CurveTrackSource` adapter prop on `CurveEditor.tsx` (`posX/Y/Z`, `rotX/Y/Z`, `scaleX/Y/Z`), and add the `studio3d` (`Low-Poly 3D -> Animate`) branch in `App.tsx`'s playback timer.

### 1.4 Clean Pivot-to-glTF Hierarchy Math & Quaternion SLERP
- **v1 Plan Flaw:** Storing cuboid `from/to` and mesh `vertices` in arbitrary space alongside `transform.pivot` forces exporters to emit ugly `Node` + `Node_pivot_offset` double-node hierarchies in `.glb`, polluting skeletons in Godot 4, Unity, and Blender. Euler interpolation also risks gimbal flips on 3D limbs.
- **v2 Fix:**
  - Authoring UI shows friendly Blockbench-style world/local pixel coordinates & pivot gizmos, while `sceneSync.ts` and `modelExporter.ts` place each `Object3D` at `(node.pivot - parent.pivot) / pixelsPerUnit` and emit geometry vertices at `(v - node.pivot) / pixelsPerUnit`. **1 `ModelNode` = 1 clean `THREE.Object3D` = 1 clean glTF node/bone.**
  - Authoring inspector edits Euler XYZ degrees, while `animEval.ts` converts keyframe rotations to unit **Quaternions** for SLERP/squad interpolation and glTF `rotation` track export.

### 1.5 Non-Planar Quad Triangulation & Deterministic Face Picking
- **v1 Plan Flaw:** Moving 1 corner of a Crocotile/low-poly quad makes it non-planar. Arbitrary triangulation flips silhouettes and breaks `raycast.faceIndex -> PolyFace` mapping when triangles and quads mix in one `PolyMesh`.
- **v2 Fix:**
  - Add optional `triSplit?: "02" | "13"` on `PolyFace` (defaulting to shortest-diagonal / coplanar heuristic) plus a **`Flip Quad Diagonal` (`Ctrl+T`)** action.
  - Maintain a flat `triToFaceIndex: Uint32Array` lookup table per synced `THREE.Mesh` in `sceneSync.ts` so raycast hits resolve back to exact `PolyFace` IDs and quad corners in `O(1)`.

---

## 2. Technical Refinements (Rendering, Painting & Baking)

1. **WebGL Context Budget (`ThreeStudioRuntime` Singleton):**
   - Keep **one** lazy singleton `THREE.WebGLRenderer` (`antialias: false`, `powerPreference: "high-performance"`) shared between `ThreeViewport.tsx` and `modelSpriteBaker.ts` (which renders into an offscreen `THREE.WebGLRenderTarget` and restores render target state). Total Three.js WebGL contexts = **1** (0 until `Low-Poly 3D` is first opened).
2. **Half-Texel Micro-Inset + 1px Padded Tileset Atlas:**
   - Apply a tiny `1e-4` UV inset toward each face's UV centroid on `draw-canvas` Box-UV/Per-Face islands to prevent float rounding bleed at grazing angles, combined with the 1px border-extruded atlas for `tileset` materials.
3. **Screen-Space Sub-Stepped 3D Painting (Seam-Safe):**
   - Never run blind UV-space Bresenham across different faces (which streaks across unrelated UV islands when crossing a cube edge).
   - Instead, sub-step pointer movement every `2px` in screen space, raycast each sample, and only run pixel Bresenham between consecutive samples that land on the **same `faceId`** (or share an unwrapped UV edge). Include a **"Lock Stroke to Clicked Face"** toggle and coalesce `DataTexture` updates once per `requestAnimationFrame` (`gl.texSubImage2D` on dirty rect when supported).
4. **Crocotile Split-Corner GPU Buffers + Topological Welding:**
   - Keep shared vertex positions in `PolyMeshData.vertices` (so moving 1 vertex deforms connected walls/floors cleanly) while emitting split corner vertices in `THREE.BufferGeometry` for crisp flat normals, hard UV seams, and sharp per-corner vertex colors (`COLOR_0`). Add an optional smooth-shading group toggle (`flatShading: boolean`, default `true`) per node/face.
5. **Anti-"Pixel-Swimming" 3D-to-2D Sprite Baker:**
   - Default to **Orthographic** projection with **Texel-Grid Camera Snapping** (quantizing view-space camera origin to `1 / pixelsPerUnit` increments so rotating or bobbing models don't shimmer cleanly aligned edges).
   - Strict post-process order: `Render 1x Nearest` → `Binary Alpha Cutoff` → `Optional OKLab Palette Quantize / Bayer Dither` → `Optional 1px Pixel Outline` (inner/outer).

---

## 3. High-Impact Feature Additions Added to v2

### Blockbench-Inspired Additions
1. **UV-Lock vs Auto-Resize UV Toggle (`uvLock`):** Choose whether resizing a cuboid updates Box-UV pixel dimensions automatically or keeps existing UVs locked.
2. **Mirror Geometry + Mirror/Share UV:** Live X-symmetry and one-shot Mirror Duplicate with toggleable **Share Source UV** (saves 50% texture space on symmetrical arms/legs/wings) vs **New UV Island**.
3. **Cull Hidden / Internal Coplanar Faces:** One-click cleanup action + per-face visibility toggle to strip unseen interior faces between touching cuboids.
4. **Cross-Billboard Primitive (`X`-Planes):** 1-click intersecting 2-quad cross primitive for low-poly foliage, grass tufts, torches, chains, and particles.
5. **Low-Poly Starter Presets:** `Chibi Character (16px)`, `Retro Humanoid (32px)`, `Weapon / Item Prop`, `Dungeon Room Chunk`.

### Crocotile 3D-Inspired Additions
6. **Interior Room Backface Auto-Hide ("See-Through Walls"):** Viewport toggle (`Cull Backfaces in View`) so orbiting outside an enclosed dungeon room automatically hides near walls/ceilings facing away from the camera while keeping interior tiles clickable!
7. **Sticky Vertex Snap (`V` Hold):** Hold `V` while dragging vertices, gizmos, or the 3D Tile Cursor to snap magnetically to any existing vertex for watertight architecture.
8. **Slope, Wedge & Corner Shapers + 3D Prefab Brushes:** Quick-convert a stamped tile block into a 45° slope/stair/corner wedge, and save selected stamped geometry as a reusable **3D Prefab Stamp** (pillars, arches, crates) inside the project.
9. **Live Animated Tiles in 3D:** Automatically drives UV offsets from `Tileset.ts`'s existing `TileMeta.animation.frames` so animated water, lava, and CRT screens play live in the 3D viewport and during animated turntable bakes!

### Pixet & Game-Engine Synergies
10. **Godot / Unity Collision Suffix & Collider Tagging (`colliderKind`):** Mark any `ModelNode` as a collider (`box` / `convex` / `trimesh`); `.glb` export emits `-col` / `-convcol` naming conventions (or glTF extras) for zero-setup Godot 4 collision import.
11. **Bake 3D Model to `Tileset` Slots (3D → 2D/Iso Tile Bridge):** Render a modeled 3D wall, prop, or corner from 4 orthographic/isometric angles straight into `Tileset` tiles so artists can immediately paint maps with them in Pixet's `Tiles` workspace!

---

## 4. Milestone Sequencing Adjustment (`M0` → `M7`)

- **Move `.obj` + `.glb` static export smoke-test earlier (basic static export in `M2`, full animations + PBR + colliders in `M7`)**? Better yet: keep `M0`–`M7` focused, **but** establish the pivot-relative `sceneSync.ts` convention in **`M1`** and the padded `tilesetAtlas.ts` + `tileUid` binding in **`M2`/`M3`** so zero refactoring is needed when `M6` (Animation) and `M7` (Export & Baking) land.
