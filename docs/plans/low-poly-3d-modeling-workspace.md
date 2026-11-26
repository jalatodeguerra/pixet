# Pixet — Low-Poly 3D Modeling Workspace (Unified 3D Studio v2 Implementation Plan)

> **Status:** Reviewed & Locked Plan (v2 — Post-Architectural & Codebase Review; see `docs/plans/low-poly-3d-modeling-carbon-review.md`).  
> **Hand-off Note:** Read **§0 Context, Hard Rules & Codebase Guardrails** before touching code. Work milestone by milestone (`M0` → `M7`); every milestone must pass all checks in **§0.4** before committing.

---

## 0. Context, Decisions & Codebase Guardrails

### 0.1 Project Context & Existing Reusable Pieces
- **Pixet** is a pixel-art & game-asset authoring suite built on **Tauri v2** + Rust workspace (`crates/pixet-core`, `crates/pixet-cli`, `src-tauri`) + **Vite + React 18 + TypeScript (strict) + Zustand + `lucide-react` + WebGL2**.
- Existing workspaces in `src/components/TopBar.tsx`: `Draw`, `Tiles`, `Rig`, `3D Studio`, and `Data` (plus planned `Nodes` in `docs/plans/node-material-compositor-workspace.md`).
- Existing engine & UI modules to reuse or bridge directly:
  - `src/engine/document/PixelBuffer.ts`, `PixelEngine.ts`, `layerActions.ts`
  - `src/engine/tiles/Tileset.ts` (`tiles: PixelBuffer[]`, persistent `TileMeta.uid`, and `TileMeta.animation`) & `TilemapEngine.ts`
  - `src/engine/gamedev/pbrMaps.ts` & `shaderPreview.ts` (`LayerMapRole = "albedo" | "normal" | "height" | "depth" | "emission"`)
  - `src/engine/tools/rotate3d.ts`, `scene3d.ts`, `dither.ts`, `paletteOps.ts`, `src/utils/color.ts`
  - `src/engine/rig/RigEngine.ts` (`evaluateEasing`, `EasingMode`, `CubicBezierHandles`) & `src/components/rig/CurveEditor.tsx`
  - `src/engine/history/UndoCoordinator.ts` & `src/engine/document/historyActions.ts`
  - `src/components/studio3d/*` (`Studio3DViewport.tsx`, `Studio3DSidebar.tsx`, `Studio3DToolRail.tsx`, `Studio3DToolOptionsBar.tsx`, `studio3dActions.ts`)
  - `src/components/DockablePanelSection.tsx`, `src/engine/ui/panelLayout.ts`, `src/components/CommandPalette.tsx`
  - `crates/pixet-core/src/document.rs` & `src/engine/io/projectBridge.ts`

### 0.2 Architectural Decisions (Locked)
1. **50/50 Hybrid Modeling Paradigm (Blockbench + Crocotile 3D)**:
   - One unified low-poly mesh data model powers **both**:
     - **Blockbench-style modeling**: Parametric cuboids, low-poly primitives (including cross-billboard `X`-planes), vertex/edge/face mesh editing, integer pixel-exact Box-UV & Per-Face UV unwrapping with `uvLock`, mirror-UV symmetry, internal face culling, pivot hierarchies, and direct 3D texture painting.
     - **Crocotile 3D-style scene building**: 3D Tile Cursor snapped to grid, vertices (`V` sticky snap), or existing faces; live picking from Pixet's `Tileset`s (including animated tiles!); stamping/dragging/extruding textured quads & slopes; reusable 3D Prefab Stamps; interior room backface auto-hide ("see-through walls"); and per-corner vertex colors/AO for PS1/N64/DS environments.
2. **Evolve `3D Studio` Into the Unified 3D Workspace**:
   - `workspaceMode === "studio3d"` gains a top-level mode switcher in `Studio3DToolOptionsBar`:
     - **`2.5D Sprite`**: Preserves all existing Extruded / Layer Stack / 2.5D Rig volumetric preview, PBR maps, and turntable baking untouched.
     - **`Low-Poly 3D`**: Sub-modes `Model` | `Tile` | `UV` | `Paint` | `Animate` | `Bake`.
3. **Pure Engine Core + Singleton Thin Three.js Boundary**:
   - **`src/engine/model3d/**`** has **zero `three` or React imports** and is 100% unit-testable via `node --test`.
   - **`src/components/studio3d/three/**`** is the **only** folder importing `three` (`OrbitControls`, `TransformControls`, `GLTFExporter`, `OBJExporter`).
   - **Single WebGL Context (`ThreeStudioRuntime`)**: One lazy singleton `THREE.WebGLRenderer` (`antialias: false`, `powerPreference: "high-performance"`) serves both `ThreeViewport.tsx` and offscreen `THREE.WebGLRenderTarget` passes in `modelSpriteBaker.ts`—never spawning duplicate Three.js WebGL contexts or fighting Draw/Nodes for Chromium's 8–16 WebGL context limit.
4. **True Chronological Cross-Engine Undo (`UndoCoordinator`)**:
   - Do **not** copy `Rig`'s workspace-level undo bypass (`historyActions.ts:38`), which would desync interleaved `[3D Extrude -> 3D Paint Stroke -> 3D Vertex Move]` sequences.
   - Instead, extend `UndoKind = "pixels" | "cells" | "tileset" | "model3d"` in `src/engine/history/UndoCoordinator.ts` and wire `nextKind === "model3d"` into `performUndo()`, `performRedo()`, and `jumpToHistoryIndexAction()` (`src/engine/document/historyActions.ts`).
5. **Pixel-Exact Texels, `tileUid` Binding & 1px Padded Tileset Atlases**:
   - Configurable **Texel Density** (`pixelsPerUnit`, default `16`, presets `8 / 16 / 32`).
   - Because `Tileset.ts` stores individual `PixelBuffer[]` per tile and shifts numeric `tileId`s on `deleteTileWithRemap()` / `reorderTiles()`, `PolyFace.tileSource` binds to persistent **`tileUid: string`** (with `tileId` only as a cached hint).
   - `tilesetAtlas.ts` packs `Tileset` tiles into a deterministic RGBA atlas with a **1px extruded border gutter per tile**, while `draw-canvas` UV islands apply a `1e-4` inward centroid micro-inset—completely eliminating UV seam bleed at grazing angles in both Three.js and exported `.glb`/`.obj` assets.
6. **Clean 1:1 Pivot-to-glTF Hierarchy & Quaternion SLERP**:
   - Authoring UI exposes intuitive Blockbench-style pixel coordinates & pivot gizmos, while `sceneSync.ts` and `modelExporter.ts` position each `THREE.Object3D` at `(node.pivot - parentPivot) / pixelsPerUnit` and emit vertices at `(v - node.pivot) / pixelsPerUnit`. Result: **1 `ModelNode` = 1 clean `Object3D` = 1 clean glTF node/bone** (zero `Node_offset` dummy clutter in Godot/Unity/Blender).
   - Inspector edits Euler XYZ degrees, while `animEval.ts` interpolates rotations via unit **Quaternion SLERP** so 3D limbs never suffer gimbal flips.
7. **Persistence via Opaque `model3d_ext`**:
   - Add `#[serde(default, skip_serializing_if = "Option::is_none")] pub model3d_ext: Option<serde_json::Value>` to `Document` in `crates/pixet-core/src/document.rs`.

### 0.3 Pixet Hard Rules & Keyboard Guardrails
1. **Flat Dark-Gray UI (Zero Exceptions)**:
   - Palette: `#141414`, `#1a1a1a`, `#202020`, `#272727`, `#303030`, borders `#2b2b2b` / `#3d3d3d`, accent `#4c8bf5` (`src/styles/theme.css`).
   - **0px `border-radius`, no `box-shadow`, no `text-shadow`, no `backdrop-filter`, no decorative gradients, no selection glows.**
   - All styles live in `src/styles/model3d.css` (`m3d-` prefix).
2. **Engine Purity & TS Strictness**:
   - Everything under `src/engine/model3d/**` is React-free, Three.js-free, DOM-independent, and uses explicit `.ts` relative imports for `node --test`.
   - `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, zero `any`.
3. **`App.tsx` Keyboard & Playback Isolation**:
   - When `workspaceMode === "studio3d"` and `studio3d.workspaceSubMode === "lowpoly"`, `App.tsx` **must branch early** before Draw shortcuts:
     - `Q` = Select, `W` = Move, `E` = Rotate, `R` = Scale, `Hold V` = Sticky Vertex Snap
     - `1` / `2` / `3` / `4` = Object / Vertex / Edge / Face selection (`Model` sub-mode)
     - `Ctrl+T` = Flip Selected Quad Diagonal (`triSplit`)
     - `WASD` / Arrows = Step 3D Tile Cursor; `R` / `F` / `Shift+F` = Rotate / Flip Tile (`Tile` sub-mode)
     - `B` / `E` / `G` / `I` = Brush / Eraser / Fill Face / Eyedropper (`Paint` sub-mode)
     - `Shift+A` = Quick Add Primitive / Starter Template menu
     - `Ctrl+D` = Duplicate; `Ctrl+M` = Mirror Selection; `Delete`/`Backspace` = Delete via `Model3DHistory`
     - `Numpad 1/3/7/5` (and toolbar buttons for laptop keyboards) = Front / Right / Top / Ortho-Persp toggle.
   - `App.tsx`'s playback timer (`lines 98–120`) adds a branch for `studio3d` (`Low-Poly 3D -> Animate`) advancing `currentFrame` within the active `ModelAnimationClip.frameCount`.

### 0.4 Definition of Done (Run After Every Milestone)
```bash
rg -n "box-shadow|text-shadow|backdrop-filter|border-radius:\s*[1-9]" src/styles/   # must print nothing
node --test tests/engine.test.ts tests/model3d.test.ts                               # all pass
pnpm run build                                                                       # tsc && vite build, 0 errors
cargo test --workspace                                                               # all pass
```

---

## 1. Pixet Ecosystem Bridges

| Pixet System | How Low-Poly 3D Connects |
| :--- | :--- |
| **Draw Workspace** | A model's primary material binds live to the active Draw sprite (or a specific layer) + PBR `map_role` layers (`albedo`, `normal`, `height`, `emission`). Seam-safe 3D face painting writes straight back to Draw layers via `PixelEngine` + `UndoCoordinator`. |
| **Tiles Workspace** | Crocotile **Tile Stamp** mode binds to `TilesetRegistry` via stable `tileUid`s, builds a 1px border-extruded GPU atlas, plays `TileMeta.animation` frames live in 3D, and can **Bake 3D Chunks → Tileset Slots** for 2D/Isometric map painting! |
| **PBR & 3D Studio Lighting** | Shares 3D Studio's interactive 3D light gizmo, floor shadow stage, and render passes (`Unlit`, `Flat Low-Poly`, `PS1 Retro`, `PBR Lit`, `Normal`, `Depth`, `Wireframe`). |
| **Timeline & Curve Editor** | Generalizes `CurveEditor.tsx` via a clean `CurveTrackSource` adapter (`posX/Y/Z`, `rotX/Y/Z`, `scaleX/Y/Z`) and shares `evaluateEasing` so 3D pivot animations use the exact same Timeline & Bezier curves as `Rig`. |
| **Nodes Workspace (Ready)** | `ModelMaterial.source` reserves `{ kind: "node-graph"; graphId: string }` so procedural materials from `Nodes` can feed directly onto 3D meshes in the future without schema changes. |
| **2D Sprite & Turntable Baker** | Renders static or animated 3D models via a **texel-snapped orthographic camera** (eliminating 1px "pixel swimming") into Draw frames/layers across `4/8/12/16` directions with binary alpha cutoff, OKLab palette quantization, and 1px pixel outlines. |

---

## 2. Architecture & Data Model

### 2.1 File Layout

```text
src/
  engine/
    model3d/                          # PURE TS — zero React, zero Three.js
      types.ts                        # Scene, node, cuboid, mesh, UV, cursor, prefab, anim types
      Model3DEngine.ts                # Stateful scene manager + dirty flags + version ticks
      Model3DHistory.ts               # Snapshot/patch history wired into UndoCoordinator ("model3d")
      primitives.ts                   # Cuboid, Plane, Cross-Billboard, Wedge, Prism, Cylinder, Templates
      meshOps.ts                      # Extrude, Inset, Loop Cut, Split, Weld, Flip Quad, Cull Hidden, Mirror
      uvOps.ts                        # Box-UV, Per-Face UV, uvLock resize, Mirror-UV, Shelf Auto-Pack
      tilesetAtlas.ts                 # Deterministic 1px border-extruded RGBA atlas + animated tile UV lookup
      tileStamp.ts                    # Crocotile 3D cursor, stamp, drag-fill, extrude, slope shaper, prefabs
      quatMath.ts                     # Pure Vec3 / Mat4 / Euler <-> Quaternion / SLERP math
      animEval.ts                     # Hierarchical pivot TRS evaluation + clip/curve interpolation
      serialization.ts                # Versioned JSON encode/decode for document.model3d_ext
  components/
    studio3d/
      three/                          # THIN THREE.JS BOUNDARY (only folder importing "three")
        ThreeStudioRuntime.ts         # Lazy singleton WebGLRenderer shared by viewport & sprite baker
        ThreeViewport.tsx             # Viewport mount, Orbit/TransformControls, sticky V-snap, overlays
        sceneSync.ts                  # Pivot-relative BufferGeometry builder + O(1) triToFaceIndex map
        retroMaterials.ts             # Unlit, Flat Low-Poly, PS1 Retro (vertex snap/Bayer), PBR Lit
        paintRaycaster.ts             # Screen-substepped seam-safe UV raycaster + coalesced texSubImage2D
        modelExporter.ts              # GLB / GLTF (9728 nearest samplers, anims, Godot -col) & quad OBJ
        modelSpriteBaker.ts           # Texel-snapped ortho 2D sprite, turntable & Tileset slot baker
      Model3DSidebar.tsx              # Outliner, Transform/Pivot, Material, Tile Stamp/Prefabs, UV, Export
      Model3DToolRail.tsx             # Sub-mode-aware left tool rail
      Model3DToolOptionsBar.tsx       # 2.5D/Low-Poly switcher, sub-modes, snap, culling, shading, camera
      UVEditorDrawer.tsx              # Dockable 2D pixel-UV overlay editor synced with Draw/Tileset
  styles/
    model3d.css                       # Flat dark-gray styles (m3d-* prefix, 0px radius, no shadows)
tests/
  model3d.test.ts                     # Pure Node unit tests for all src/engine/model3d/** modules
```

### 2.2 Core Data Model (`src/engine/model3d/types.ts`)

```ts
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // [x, y, z, w]

export type Studio3DWorkspaceKind = "sprite25d" | "lowpoly3d";
export type Model3DSubMode = "model" | "tile" | "uv" | "paint" | "animate" | "bake";
export type SelectionGranularity = "object" | "vertex" | "edge" | "face";
export type ShadingMode = "unlit" | "flat" | "ps1" | "pbr";
export type ColliderKind = "none" | "box" | "convex" | "trimesh";

export interface Transform3D {
  position: Vec3;   // translation offset in pixel units
  rotation: Vec3;   // Euler XYZ in degrees (interpolated via Quaternion SLERP in animEval)
  scale: Vec3;
  pivot: Vec3;      // node origin in scene pixel units (exported as clean 1:1 Object3D origin)
}

export interface CuboidFaceUV {
  uv: [number, number, number, number]; // [u0, v0, u1, v1] in integer pixels
  rotation: 0 | 90 | 180 | 270;
  flipX?: boolean;
  flipY?: boolean;
  materialId: string;
  hidden?: boolean; // culls unseen interior faces & frees UV budget
}

export interface CuboidData {
  from: Vec3;       // min corner in pixel units
  to: Vec3;         // max corner in pixel units
  inflate: number;  // uniform expansion in pixel units (armor/clothing shells)
  uvMode: "box" | "per-face";
  uvLock: boolean;  // preserves UV placement vs auto-resizing Box-UV when scaling from/to
  mirrorUvX?: boolean;
  boxUvOrigin: Vec2;
  faces: Record<"north" | "south" | "east" | "west" | "up" | "down", CuboidFaceUV>;
}

export interface PolyFace {
  id: string;
  verts: number[];            // 3 (tri) or 4 (quad) indices into PolyMeshData.vertices
  uvs: Vec2[];                // per-corner pixel coordinates [px, py]
  colors?: string[];          // optional per-corner hex/rgba vertex colors (PS1/DS shading & AO)
  triSplit?: "02" | "13";     // deterministic quad diagonal split (flippable via Ctrl+T)
  flatShading?: boolean;      // default true (hard low-poly normals)
  materialId: string;
  tileSource?: {              // metadata when stamped via Crocotile mode
    tilesetId: string;
    tileUid: string;          // stable across tile deletion/reordering in Tileset.ts!
    cachedTileId: number;
    rotation: 0 | 90 | 180 | 270;
    flipX: boolean;
    flipY: boolean;
  };
}

export interface PolyMeshData {
  vertices: Vec3[];           // topological vertices in pixel units
  faces: PolyFace[];
}

export interface ModelNode {
  id: string;
  name: string;
  kind: "group" | "cuboid" | "mesh";
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  colorTag?: string;
  collider: ColliderKind;     // emits Godot -col / -convcol suffixes or glTF collider extras
  transform: Transform3D;
  cuboid?: CuboidData;
  mesh?: PolyMeshData;
}

export interface ModelMaterial {
  id: string;
  name: string;
  source:
    | { kind: "draw-canvas"; layerId?: string }
    | { kind: "tileset"; tilesetId: string }
    | { kind: "node-graph"; graphId: string }
    | { kind: "embedded"; width: number; height: number; pngBase64: string };
  doubleSided: boolean;       // note: viewport also has an editor-only "See-Through Room Walls" override
  alphaTest: number;          // default 0.5 for crisp pixel cutouts
  usePbrMaps: boolean;        // auto-bind Draw normal/height/emission map_roles
}

export interface TilePrefab3D {
  id: string;
  name: string;
  mesh: PolyMeshData;         // reusable stamped structure (pillar, arch, stair, crate)
  sizePx: Vec3;
}
```

---

## 3. Core Modeling Workflows

### 3.1 Blockbench-Style Workflow (`Model` sub-mode)
- **Outliner & Hierarchy**: Nested `Group` (pivot/bone) → `Cuboid` / `Mesh` tree with visibility, lock, color tag, collider badge (`-col`), drag-reparent, duplicate (`Ctrl+D`), and starter rig templates (`Chibi 16px`, `Retro Humanoid 32px`, `Weapon Prop`, `Dungeon Chunk`).
- **Parametric Cuboids**:
  - Interactive handles + numeric inputs for `from`, `to`, `inflate`, and `pivot`.
  - **`uvLock` Toggle**: Choose whether resizing a cuboid dynamically recalculates Box-UV dimensions or keeps current UV coords pinned.
  - **Per-Face Visibility & One-Click `Cull Internal Faces`**: Strips unseen coplanar faces between touching cuboids to save texture space and eliminate Z-fighting.
- **Primitives**: Cuboid, Plane, **Cross-Billboard (`X`-Planes)** for foliage/fire/props, Wedge/Slope, Cylinder/Cone (3–16 sides), Pyramid, Low-Poly Icosphere.
- **Direct Mesh Editing** (`Vertex` / `Edge` / `Face` modes + **`Hold V` Sticky Vertex Snap**):
  - **Extrude Face / Region** (with automatic pixel-density-matched side UVs).
  - **Inset Face**, **Loop Cut / Edge Subdivide**, **Merge / Weld Vertices**.
  - **`Flip Quad Diagonal` (`Ctrl+T`)**: Instant control over how non-planar low-poly quads triangulate.
  - **Mirror & Symmetry (`Ctrl+M` or live X-Symmetry)**: Supports **Share Source UV** (mirrors UVs onto the exact same texture island to cut texture usage in half) or **Separate UV Island**.

### 3.2 Crocotile 3D-Style Workflow (`Tile` sub-mode)
- **3D Tile Cursor**:
  - Snaps to the pixel/tile grid, existing face normals, or magnetic vertices (`Hold V`).
  - `WASD` / Arrows step along active plane (`Floor XZ`, `Wall XY`, `Wall ZY`); `Q`/`E` step depth; `R`/`F`/`Shift+F` rotate/flip the tile preview live on the cursor.
- **Interior Room Backface Auto-Hide ("See-Through Walls")**:
  - One-click viewport toggle forces single-sided `FrontSide` rendering in the editor even for room walls, so orbiting around an interior dungeon automatically hides walls and ceilings blocking the camera while keeping interior faces clickable!
- **Stamping, Shaping & Prefabs**:
  - **Stamp Quad** & **Drag-Fill Plane** (auto-welding shared topological vertices in `PolyMeshData` while keeping split GPU corners for crisp flat normals and tile UVs).
  - **Extrude Tile Block** & **Slope / Wedge / Corner Shapers** (1-click conversion of a tile block into 45° ramps, stairs, or diagonal wall corners).
  - **3D Prefab Stamps (`TilePrefab3D`)**: Capture any selected stamped tiles (e.g., doorway, column, chest) as a reusable 3D stamp brush.
  - **Live Animated Tiles**: Automatically cycles UVs in the 3D viewport and turntable baker when a stamped tile has `TileMeta.animation.frames` in `Tileset.ts`!
  - **Vertex Color & Corner AO**: Paint per-corner tints or apply quick cavity/floor-contact AO presets for authentic PS1/N64/DS lighting.

---

## 4. Seam-Safe UV & Live 3D Painting

### 4.1 UV Workflow (`UV` sub-mode & `UVEditorDrawer`)
- **Integer Pixel UVs** (`1 px` default snap, `0.5 px` optional) + `1e-4` inward centroid micro-inset on GPU upload.
- **Auto Box-UV**, **Per-Face UV** with **Texel Ratio Lock**, **Shelf Auto-Pack** (`0 px` or `1 px` gutter), and **Generate UV Guide Layer in Draw** (writes color-coded face fills + 1px wireframe borders to a helper layer in Draw).

### 4.2 Seam-Safe Live 3D Viewport Painting (`Paint` sub-mode)
- **Screen-Space Sub-Stepped Raycasting**:
  - Pointer movement sub-steps every `2 px` in screen space and raycasts against the `O(1)` `triToFaceIndex` map.
  - Pixel Bresenham only bridges consecutive hits that land on the **same `faceId`** (or a continuous shared UV edge)—completely preventing ugly streaks across unrelated UV islands when painting across cube corners!
  - Includes a **"Lock Stroke to Initial Face"** toggle and **Face-Clipped Brush Mask** so wide brushes (`2px–8px`) never bleed outside the target face's UV polygon.
- **Coalesced GPU Uploads**: Dirty pixel bounds flush once per `requestAnimationFrame` via partial `texSubImage2D` / `DataTexture` update for 60fps painting.
- **Unified Undo**: Commits a single `"pixels"` or `"tileset"` entry into `UndoCoordinator` on pointer-up.

---

## 5. Animation, 3D Export & Anti-Swim 2D Baking

### 5.1 Pivot/Bone Animation (`Animate` sub-mode)
- Generalizes `CurveEditor.tsx` via `CurveTrackSource` (`posX/Y/Z`, `rotX/Y/Z`, `scaleX/Y/Z`) and shares `evaluateEasing` from `RigEngine`.
- Evaluates keyframe rotations via **Quaternion SLERP**, supports **Auto-Key**, **Mirror Pose (L ↔ R)**, and **Onion-Skin Ghost Wireframe**.

### 5.2 Real 3D Game-Engine Export (`modelExporter.ts`)
- **`.glb` / `.gltf` 2.0**:
  - Patches all texture `samplers` to `magFilter: 9728` (`NEAREST`) and `minFilter: 9728` (`NEAREST`).
  - Exports clean 1:1 pivot-centered nodes, `COLOR_0` vertex colors, embedded 1px-padded tileset atlases, PBR maps, quaternion animation clips, and Godot 4 collision suffixes (`-col`, `-convcol`) when `ModelNode.collider !== "none"`.
  - Scale presets: `16 px = 1m` (Godot/Unity default), `1 px = 1m`, or custom.
- **`.obj` + `.mtl` + `.png`**: Preserves clean **quads** (`f v/vt/vn ...` with 4 vertices) unless "Triangulate" is enabled.

### 5.3 Anti-"Pixel-Swimming" 2D Sprite & Tileset Baker (`modelSpriteBaker.ts`)
- Reuses `ThreeStudioRuntime`'s singleton `WebGLRenderer` + offscreen `WebGLRenderTarget` (`NearestFilter`, `antialias: false`).
- **Texel-Snapped Orthographic Stabilization**: Quantizes view-space camera origin to `1 / orthoPixelsPerUnit` increments so rotating or animating models maintain rock-solid pixel edges without shimmering.
- **Strict Post-Process Pipeline**:
  1. `1× Nearest-Neighbor Offscreen Render` (`Lit`, `Unlit`, `PS1 Retro`, `Normal`, or `Depth` pass)
  2. `Binary Alpha Threshold` (`a >= alphaCutoff ? 255 : 0` — zero semi-transparent fringe)
  3. `Optional OKLab Palette Quantization + Ordered Bayer Dither` (locked to active Pixet palette)
  4. `Optional 1px Pixel Outline` (outer or inner)
- **Targets**:
  - **Bake to Draw Frames / Turntable** (`4 / 8 / 12 / 16` directions × static or animated clip)
  - **Bake to `Tileset` Slots** (renders 4 rotations of a 3D wall/corner/prop straight into `Tileset` tiles for map painting in `Tiles`!).

---

## 6. Phased Milestones (`M0` → `M7`)

### Milestone `M0` — Foundation, Cross-Engine Undo, Persistence & Mode Switch
- Install `three` + `@types/three` in `package.json`.
- Add `model3d_ext: Option<serde_json::Value>` to `Document` in `crates/pixet-core/src/document.rs` and wire load/save in `src/engine/io/projectBridge.ts`.
- Extend `UndoCoordinator.ts` (`UndoKind` += `"model3d"`) and `historyActions.ts` (`performUndo`, `performRedo`, `jumpToHistoryIndexAction`).
- Create `src/engine/model3d/types.ts`, `quatMath.ts`, `Model3DEngine.ts`, `Model3DHistory.ts`, `serialization.ts`.
- Add `2.5D Sprite` | `Low-Poly 3D` switcher + sub-mode bar in `Studio3DToolOptionsBar.tsx`, `src/styles/model3d.css`, and `App.tsx` keyboard isolation.
- **Tests**: `tests/model3d.test.ts` (scene CRUD, `quatMath`, serialization round-trip, interleaved cross-engine undo/redo).

### Milestone `M1` — Singleton Three.js Viewport, Outliner, Cuboids & Gizmos
- Build `ThreeStudioRuntime.ts` (singleton `WebGLRenderer`), `ThreeViewport.tsx`, `sceneSync.ts` (pivot-relative 1:1 `Object3D` sync + `triToFaceIndex` map), and `retroMaterials.ts` (`Unlit` + `Flat Low-Poly` + wireframe).
- Orbit/Pan/Zoom, Perspective/Ortho/Isometric toggle, camera presets, pixel-unit 3D grid, and "See-Through Walls" backface toggle.
- `primitives.ts` (Cuboid, Plane, Cross-Billboard, Wedge, Cylinder, Pyramid, Starter Templates), `Model3DSidebar.tsx` Outliner + Transform/Pivot/Collider inspector, and pixel-snapped `TransformControls` + `Hold V` vertex snap.

### Milestone `M2` — Pixel-Exact UVs, Padded Tileset Atlas & Live Material Sync
- Build `uvOps.ts` (Box-UV, Per-Face UV, `uvLock` resize behavior, Mirror-UV, Shelf Auto-Pack, `1e-4` micro-inset) and `tilesetAtlas.ts` (1px border-extruded RGBA atlas + `tileUid` resolution + animated tile UV stepping).
- Live material binding to active Draw canvas (+ PBR `map_role` layers) and `TilesetRegistry`.
- `UVEditorDrawer.tsx` 2D pixel-UV overlay editor + "Generate UV Guide Layer in Draw".
- **Tests**: Box-UV `uvLock` math, shelf auto-packer, `tileUid` remap resilience, and 1px border extrusion tests.

### Milestone `M3` — Crocotile 3D Tile-Stamping, Shapers & Prefabs
- Build `tileStamp.ts` (3D Tile Cursor stepping, face/vertex snap, single stamp, drag-fill plane, extrude tile block, slope/corner shapers, topological auto-weld, and `TilePrefab3D` stamps).
- Render 3D Tile Cursor preview + docked Tileset & Prefab picker in `Model3DSidebar.tsx` + per-corner vertex color / quick AO tint tools.
- **Tests**: Tile stamping, drag-fill topology welding, slope shaper geometry, and `tileUid` persistence.

### Milestone `M4` — Low-Poly Mesh Editing (Blockbench Mesh Mode)
- Build `meshOps.ts`: Cuboid → Mesh conversion, Extrude Face, Inset Face, Loop Cut / Edge Split, Merge/Weld Vertices, `Flip Quad Diagonal` (`Ctrl+T`), `Cull Internal Coplanar Faces`, Flip Normals, and X/Y/Z Mirror Symmetry (shared vs separate UV).
- Vertex / Edge / Face picking (`1`/`2`/`3`/`4`), box-select, and crisp sub-object overlays in `ThreeViewport.tsx`.
- **Tests**: Mesh topology invariants, quad diagonal flipping, internal face culling, and UV preservation.

### Milestone `M5` — Seam-Safe Live 3D Viewport Painting
- Build `paintRaycaster.ts` (screen-space `2px` sub-stepped raycasting, same-face Bresenham guard, face-clipped brush mask, coalesced `rAF` texture upload).
- Tools: Pixel Brush, Eraser, Fill Face, 3D Eyedropper, Vertex Color / Corner AO Brush—committed through `UndoCoordinator` (`"pixels"` / `"tileset"`).

### Milestone `M6` — Quaternion Pivot Animation & Generalized Curve Editor
- Build `animEval.ts` (clip CRUD, hierarchical TRS + Quaternion SLERP evaluation, pose mirroring, onion-skin ghost wireframe).
- Generalize `CurveEditor.tsx` via `CurveTrackSource`, wire `Timeline.tsx` keyframe diamonds, and add `studio3d` clip playback in `App.tsx`.
- **Tests**: Quaternion SLERP interpolation, hierarchical pivot transforms, and clip serialization.

### Milestone `M7` — Game-Engine 3D Export, PS1 Shader & Anti-Swim Sprite/Tileset Baker
- Build `modelExporter.ts`: `.glb` / `.gltf` (`9728` nearest-neighbor samplers, `COLOR_0`, PBR maps, quaternion animations, Godot `-col`/`-convcol` colliders) + quad-preserving `.obj`/`.mtl`.
- Complete `PS1 Retro` shader (vertex grid snapping, ordered Bayer dithering, color depth quantize) & `PBR Lit` pass synced with 3D Studio's 3D light gizmo.
- Build `modelSpriteBaker.ts`: Texel-snapped orthographic 2D sprite & `4/8/12/16`-direction animated turntable baker + **Bake 3D Chunk to `Tileset` Slots**, with binary alpha cutoff, OKLab palette quantization, and 1px pixel outlines.
