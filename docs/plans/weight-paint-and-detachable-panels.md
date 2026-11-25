# Pixet — Advanced Weight Painting, Smart Auto-Weights & Detachable Panels: Implementation Plan

> Hand-off document for an implementing agent. Read **§0 Context & Rules** fully before touching code.
> Work milestone by milestone (`P0`, `W0` → `W2`). Each milestone must end green (all checks in §0.4) and be committed separately on `main`.

---

## 0. Context & Rules

### 0.1 Project
- **Pixet** (`e:\desarrollo\pixet`): pixel-art editor for game devs.
- Stack: **Tauri v2** + Rust workspace (`crates/pixet-core`, `crates/pixet-cli`, `src-tauri`) + **Vite + React 18 + TypeScript (strict) + Zustand + lucide-react**.
- Remote: `origin` → https://github.com/jalatodeguerra/pixet.

### 0.2 Existing Code (read these first)
| File | What it contains today |
|---|---|
| `src/engine/rig/skinning.ts` | `MAX_WEIGHT_INFLUENCES = 4`, `WeightBrushMode` (`add \| subtract \| smooth \| replace`), `WeightFalloff` (`hard \| linear`), `paintWeightBrush` (single dab, no interpolation/locking), `autoAssignWeights` (pure Euclidean point-to-segment `1/(d+0.5)^p`), `normalizeInfluences`, `setBoneWeightNormalized`, `skinLayerPixels` (inverse-triangle LBS). |
| `src/engine/rig/RigEngine.ts` | `RigState`, `Bone`, `BoneWeights`, `paintBoneWeights`, `autoAssignBoneWeights`, `clearBoneMask`, `renderBoneInfluenceOverlay`, `toSnapshot` / `fromSnapshot` (v2). |
| `src/components/rig/WeightsPanel.tsx` | Right-sidebar Weights section (`Auto-Weight`, `Clear`, `Heatmap`/`Colors` overlay toggle, Brush size 1–12, Strength 0–100%, Mode `Add`/`Sub`/`Smooth`/`Replace`, Falloff `Hard`/`Linear`). |
| `src/components/rig/useRigPointer.ts` | Pointer handling for `weightPaint` tool (calls `rig.paintBoneWeights` per pointer move without dab interpolation or stroke cap). |
| `src/components/rig/RigOverlay.tsx` | SVG bone gizmos + hover highlight. |
| `src/components/rig/RigToolOptionsBar.tsx` | Top options bar for rig tools including `weightPaint` controls. |
| `src/components/rig/RigPanelSection.tsx` | Collapsible `<section className="panel-section">` wrapper used by all rig panels. |
| `src/components/rig/RigSidebar.tsx` | Mounts `BoneTreePanel`, `BonePropertiesPanel`, `ConstraintsPanel`, `SlotsPanel`, `WeightsPanel`, `ClipsPosesPanel`, `RigRenderPanel`, `BoundLayersPanel`. |
| `src/components/RightSidebar.tsx` | Right inspector sidebar: mounts Draw (`Color & Palette`, `Layers`), `TilesSidebar`, `RigSidebar`, `GameDataPanel`. |
| `src/components/tiles/TilesSidebar.tsx` | Mounts `TilesetBrowserPanel`, `TilePropertiesPanel`, `TerrainPanel`, `TileLayersPanel`, `MapPropertiesPanel`. |
| `src/components/FloatingPreview.tsx` | Reference pattern for draggable floating panel clamped to parent bounds (`dragRef`, `GripVertical`, collapse, close). |
| `src/store/editorStore.ts` | Zustand store (`workspaceMode`, `rigTool`, `rigBrushSize`, `rigWeightStrength`, `rigWeightMode`, `rigWeightFalloff`, `rigWeightOverlay`, etc.). |
| `src/styles/layout.css` | Shared flat panel/sidebar/floating styles (`panel-section`, `panel-header`, `floating-preview`, etc.). |

### 0.3 Hard Rules
1. **UI style (user-enforced):** flat neutral dark-gray (`#141414`, `#1a1a1a`, `#202020`, `#272727`, `#303030`, accent `#4c8bf5`). **0px border-radius, no `box-shadow`, no `text-shadow`, no `backdrop-filter`, no decorative gradients, no glows.** Reuse existing classes in `src/styles/layout.css`. Any falloff curve or heatmap legend preview must be drawn on `<canvas>`, never via CSS gradients.
2. **Engine purity:** everything under `src/engine/**` must be React-free and import relatives **with explicit `.ts` extensions** (required by `node --test`).
3. **TypeScript:** `strict`, `noUnusedLocals`, `noUnusedParameters`. No `any`.
4. **Backward compatibility:** existing `.pixet` files (v1 and v2 rig snapshots) must load without breaking; new optional fields (`Bone.weightLocked`, `Bone.envelopeRadius`) default cleanly (`false`, `undefined`).
5. **Pixel-art correctness:** all weight-painted deformation stays nearest-neighbor, palette-preserving, and respects `rigPixelSnap`.

### 0.4 Definition of Done (run after every milestone)
```powershell
rg -n "box-shadow|text-shadow|backdrop-filter|border-radius:\s*[1-9]" src/styles/   # must print nothing
node --test tests/engine.test.ts                                                     # all pass
npx tsc --noEmit                                                                     # 0 errors
npx vite build                                                                       # 0 errors
cargo test --workspace                                                               # all pass
git add <explicit milestone files>; git commit -m "feat(...): <milestone summary>"
```
Add **new unit tests** in `tests/engine.test.ts` (or `tests/weights.test.ts` added to the test command) for every new engine function.

---

## P0 — Detachable, Draggable & Reorderable Right-Panel Sections

**Goal:** Every right-sidebar section (across Draw, Tiles, Rig, and Data workspaces) can be dragged to reorder within the sidebar, detached into a floating window, dragged/resized freely over the workspace, pinned across workspace switches, or re-docked back into the sidebar.

### 1. Panel Registry & Store State (`src/store/editorStore.ts`)
Define `PanelId`:
- **Draw:** `"color-palette"`, `"layers"`
- **Tiles:** `"tiles-browser"`, `"tiles-props"`, `"tiles-terrain"`, `"tiles-layers"`, `"tiles-map-props"`
- **Rig:** `"rig-bone-tree"`, `"rig-bone-props"`, `"rig-constraints"`, `"rig-slots"`, `"rig-weights"`, `"rig-clips-poses"`, `"rig-render"`, `"rig-bound-layers"`
- **Data:** `"game-data"`

Add to `EditorState`:
```ts
export interface FloatingPanelRect {
  x: number;
  y: number;
  width: number;
  height: number | null; // null = auto height
  collapsed: boolean;
  pinned: boolean;       // stays visible when switching workspaceMode
  zOrder: number;
}

detachedPanels: Partial<Record<PanelId, FloatingPanelRect>>;
dockedPanelOrder: Record<WorkspaceMode, PanelId[]>;
activePanelDropIndex: number | null; // visual drop-slot highlight while dragging over RightSidebar
```
Actions:
- `detachPanel(id: PanelId, initialPos?: { x: number; y: number; width?: number })`
- `dockPanel(id: PanelId, targetIndex?: number)`
- `dockAllPanels()`
- `updateFloatingPanelRect(id: PanelId, patch: Partial<FloatingPanelRect>)`
- `toggleFloatingPanelCollapsed(id: PanelId)`
- `toggleFloatingPanelPinned(id: PanelId)`
- `bringFloatingPanelToFront(id: PanelId)`
- `reorderDockedPanel(mode: WorkspaceMode, id: PanelId, toIndex: number)`
- `resetPanelLayout()`

**Persistence:** Save/hydrate `detachedPanels` and `dockedPanelOrder` to `localStorage` under `"pixet.panelLayout.v1"` (guarded for SSR/Node test environments).

### 2. Unified `<DockablePanelSection>` (`src/components/DockablePanelSection.tsx`)
- Props: `id: PanelId`, `title: string`, `icon?: ReactNode`, `actions?: ReactNode`, `defaultOpen?: boolean`, `children: ReactNode`.
- `RigPanelSection` becomes a thin wrapper around `DockablePanelSection` (or delegates to it directly).
- **When docked in `RightSidebar`:**
  - Header shows: `GripVertical` drag handle · Collapse chevron + icon + title · `actions` · `Detach` (`PictureInPicture2` 11px icon button).
  - Dragging the header vertically reorders sections in `RightSidebar` (shows a flat 2px `#4c8bf5` insertion line between sections).
  - Dragging the header **horizontally > 24px left of `RightSidebar`** immediately detaches the panel into floating mode and continues tracking the pointer seamlessly!
- **When rendered inside `FloatingPanelsLayer`:**
  - Renders the same `children` inside a flat floating window frame instead of `RightSidebar`.

### 3. Floating Window Host (`src/components/FloatingPanelsLayer.tsx`)
- Mounted in `src/App.tsx` inside `.workspace-middle` (same positioning parent as `FloatingPreview`).
- Renders every panel in `detachedPanels` that belongs to the current `workspaceMode` **or** has `pinned: true`.
- **Flat Window Chrome (`src/styles/layout.css`):**
  - `background: var(--bg-panel)`, `border: 1px solid var(--border-strong)`, `border-radius: 0`, **no `box-shadow`**.
  - Top-most (`max zOrder`) panel gets `border-color: #4c8bf5`.
  - Header: `GripVertical` + title + `Pin` (`Pin` icon toggle) + `Collapse` + `Dock` (`PanelRightClose` / `ArrowRightToLine`) button.
  - Dragging header moves `(x, y)` clamped to `.workspace-middle` bounds.
  - Right & bottom edge/corner resize handles (`minWidth: 200, maxWidth: 460`, `minHeight: 100`).
  - **Drag-to-Dock:** If a floating panel is dragged back over `RightSidebar`'s bounding box, `RightSidebar` displays a flat 2px `#4c8bf5` drop-slot indicator and releasing re-docks the panel at that index.
- **Registry Map (`src/components/panelRegistry.tsx`):** Maps each `PanelId` to `{ title, icon, workspaceMode, render() }` so both `RightSidebar` (iterating `dockedPanelOrder[workspaceMode]` excluding detached IDs) and `FloatingPanelsLayer` render the exact same live React panel components without duplicating JSX.
- **Menus (`TopBar.tsx`):** Add `View → Dock All Panels` and `View → Reset Panel Layout`.

**Tests:** Store unit tests for `detachPanel`, `dockPanel`, `reorderDockedPanel`, `dockAllPanels`, `bringFloatingPanelToFront`, and `resetPanelLayout`.

---

## W0 — Smart Auto-Weighting v2 (`src/engine/rig/autoWeights.ts` & `skinning.ts`)

**Goal:** Replace naive Euclidean distance with pixel-art-aware solvers that respect silhouettes, disconnected limbs, color plates, and user bone envelopes.

### 1. New Auto-Weight Methods (`src/engine/rig/autoWeights.ts`)
Export `AutoWeightMethod = "geodesic" | "heat" | "envelope" | "rigid" | "euclidean"`:
```ts
export interface AutoWeightV2Options {
  method: AutoWeightMethod;
  maxInfluences?: number;        // default 4
  falloffPower?: number;         // default 2 (0.5..6)
  iterations?: number;           // heat diffusion steps, default 20 (5..60)
  colorPenalty?: number;         // 0..1 extra cost across color edges, default 0.35
  onlySelectedBones?: boolean;   // compute only for selected/target boneIds
  respectSelectionMask?: boolean;// restrict to pixelEngine.selection if non-empty
  respectLockedBones?: boolean;  // preserve existing weights on Bone.weightLocked
  lockedWeights?: BoneWeights | null;
}
```
1. **Geodesic (Silhouette-Constrained Dijkstra) — new default:**
   - Run a multi-source Dijkstra (binary min-heap) per bone (or combined sparse frontier) through **8-connected opaque pixels** (`alpha > 0`).
   - Orthogonal step cost = `1.0`, diagonal step cost = `Math.SQRT2`.
   - **Color-Boundary Affinity:** add `colorPenalty * (colorDist / 441.67) * 4.0` to step cost so sharp palette edges (e.g., arm sleeve vs torso) resist bleeding.
   - **Disconnected Island Fallback:** if an opaque pixel is unreachable from any bone within the same connected component, fall back to Euclidean distance to the nearest bone segment so detached floating pixels (e.g., floating pauldrons/particles) still deform cleanly.
   - Convert geodesic distance $d_i$ to weight $w_i = 1 / (d_i + 0.5)^p$, keep top `maxInfluences`, normalize.
2. **Harmonic Heat Diffusion (`"heat"`):**
   - Seed pixels intersecting each bone's segment (distance $\le 1.0\text{ px}$) with fixed Dirichlet boundary `w = 1` for that bone.
   - Run `iterations` (default 20) of 4/8-neighbor Laplacian relaxation over opaque pixels (weighted by `1 / (1 + colorPenalty * edgeDelta)`), then normalize top `maxInfluences`. Produces ultra-smooth organic joint blends across wide torsos/capes.
3. **Bone Envelope Capsules (`"envelope"`):**
   - Add optional `envelopeRadius?: number` (default `Math.max(3, bone.length * 0.35)`) to `Bone` in `RigEngine.ts`.
   - Weight decays smoothly (`smoothstep`) from `1` inside `dist <= r * 0.35` to `0` at `dist >= r`, falling back to nearest bone for pixels outside all capsules.
   - Render dashed capsule outline around the selected bone in `RigOverlay.tsx` when `method === "envelope"` or `weightPaint` is active, with a `Radius` slider in `BonePropertiesPanel` / `WeightsPanel`.
4. **Rigid / Island Auto-Weights (`"rigid"`):**
   - Flood-fill 8-connected opaque components; assign each island 100% (`w = 1`) to the single bone whose segment has the closest centroid/median distance. Keeps `weightsAreHard(...) === true` so segmented pixel-art sprites use the crisp RotSprite warp fast-path!

### 2. Integration (`RigEngine.ts` & `WeightsPanel.tsx`)
- Update `RigState.autoAssignBoneWeights(src, frame, opts?: AutoWeightV2Options)` (preserving default behavior when called with no `opts`, or defaulting to `"geodesic"`).
- When `respectLockedBones` is true, preserve locked bones' weights on each pixel and distribute `1 - lockedSum` across unlocked bones (see W1).
- In `WeightsPanel.tsx`: add `Method` selector (`Geodesic`, `Heat`, `Envelope`, `Rigid`, `Euclidean`), `Smoothness` (`falloffPower`), `Edge Respect` (`colorPenalty`), and `Selected Only` / `Selection Mask` toggles.

**Tests:**
- Geodesic separates two parallel limbs separated by a 1px transparent gap (no cross-gap bleed).
- Heat diffusion produces monotonically decreasing weights away from bone segment and sums to 1.
- Rigid assigns uniform `w = 1` per disconnected opaque island (`weightsAreHard === true`).
- Color penalty reduces weight bleeding across a high-contrast 2-color boundary.
- `respectLockedBones` preserves locked bone weights exactly.

---

## W1 — Weight Locking, Continuous Strokes & New Brush Modes

**Goal:** Make manual weight painting feel responsive, controllable, and non-destructive.

### 1. Bone Weight Lock (`RigEngine.ts` & `skinning.ts`)
- Add `weightLocked?: boolean` to `Bone` (persisted in v2 snapshot, defaults `false`).
- Update `normalizeInfluencesWithLocks(influences, lockedBoneIds)` and `setBoneWeightNormalizedWithLocks(influences, boneId, target, lockedBoneIds)`:
  - Locked bones keep their exact weights (`lockedSum = sum of locked weights`, clamped $\le 1$).
  - Unlocked bones are capped to `MAX_WEIGHT_INFLUENCES - lockedCount` and rescaled so `lockedSum + unlockedSum === 1`.
  - If `boneId` itself is locked, brush/auto-weight operations ignore changes to `boneId`.
- Add lock icon toggle (`Lock` / `Unlock`) per bone in `BoneTreePanel.tsx` and `WeightsPanel.tsx`.

### 2. Continuous Stroke Interpolation & Per-Stroke Accumulation
- In `skinning.ts`: add `paintWeightStroke(weights, boneId, x0, y0, x1, y1, options)` using Bresenham/sub-pixel stepping (step $\le \max(0.5, \text{radius} \times 0.35)$).
- **Per-Stroke Accumulation Map (`strokeVisitedMax`):** during a single pointer drag (when `airbrush === false`, default), track the max falloff reached per pixel so slow dragging doesn't compound to 100% repeatedly; when `airbrush === true`, allow additive build-up on every move.
- Wire `paintWeightStroke` in `useRigPointer.ts`.

### 3. Expanded Brush Modes & Falloffs (`skinning.ts`)
- Extend `WeightBrushMode`: `"add" | "subtract" | "smooth" | "replace" | "sharpen" | "scale"`:
  - **`sharpen`**: pulls the pixel's dominant bone toward `1` and suppresses minor influences (`w_i' = w_i^(1 + strength * falloff * 2)` then normalize) — great for cleaning muddy joints.
  - **`scale`**: multiplies `boneId`'s weight by `(1 + (strength - 0.5) * 2 * falloff)` or scales relative to current weight (`w * (1 - strength * falloff)` on right-drag).
- Extend `WeightFalloff`: `"hard" | "linear" | "smoothstep" | "gaussian"`:
  - `smoothstep`: `t = 1 - d/r; t*t*(3 - 2*t)`
  - `gaussian`: `exp(-((d / r)^2) * 3.0)` (clamped to `0` for `d > r`).
- Draw a compact 48×20 `<canvas>` falloff curve preview next to the Falloff buttons in `WeightsPanel.tsx` (flat `#141414` background, `#4c8bf5` 1px polyline).

### 4. Selection Masking & Posed-Space Painting
- **Clip to Selection (`pixelEngine.selection`):** pass optional `mask?: { contains(x, y): boolean } | null` into `paintWeightBrush` / `paintWeightStroke` / `autoAssignWeights` so artists can use Magic Wand / Lasso / Rect Marquee to isolate a single limb or head before painting weights.
- **Posed-Space Painting (`Animate` mode):** in `useRigPointer.ts`, when `rigMode === "animate"`, map the clicked canvas coordinate `(dx, dy)` back to rest cel coordinate `(sx, sy)` via `invertPosedPoint(dx, dy, restMap, poseMap, weights)` (using the inverse of the deformed lattice triangles from `skinning.ts`) before calling `paintBoneWeights`.

**Tests:**
- Locked bone weight stays invariant under `paintWeightBrush`, `smooth`, and `autoAssignWeights`.
- `sharpen` increases dominant bone share and reduces minor influences.
- `smoothstep` and `gaussian` falloff values at `d=0`, `d=r/2`, `d=r`.
- `paintWeightStroke` with per-stroke cap does not exceed `current + strength` regardless of how many intermediate dabs hit the same pixel.
- Selection mask prevents writes outside `mask.contains(x, y)`.

---

## W2 — New Weight Paint Tools, Symmetry & Global Utilities

**Goal:** Complete the weight-painting toolset with Gradient, Flood Fill, Pixel Inspector, L/R Symmetry, Global Ops, and rich visual feedback.

### 1. Weight Sub-Tools (`rigWeightSubTool: "brush" | "gradient" | "flood" | "inspector"`)
Store `rigWeightSubTool` in `editorStore.ts` (shown as segmented chips in `WeightsPanel.tsx` and `RigToolOptionsBar.tsx` when `rigTool === "weightPaint"`):
1. **Gradient / Linear Ramp (`"gradient"`):**
   - Pure function `applyWeightGradient(weights, src, boneId, x0, y0, x1, y1, opts: { falloff: "linear" | "smoothstep"; strength: number; mask?; lockedBoneIds? })`.
   - Dragging `(x0, y0) -> (x1, y1)` projects each opaque pixel onto the segment axis $t \in [0, 1]$ (`t=0` → `100% * strength`, `t=1` → `0%`) and sets/blends `boneId`'s weight smoothly across joints.
   - `RigOverlay.tsx` renders a flat 1px `#4c8bf5` gradient line with `Start (1.0)` and `End (0.0)` square handles while dragging.
2. **Contiguous Weight Flood Fill (`"flood"`):**
   - Pure function `floodFillWeights(weights, src, boneId, startX, startY, targetWeight, opts: { colorTolerance: number; contiguous: boolean; mask?; lockedBoneIds? })`.
   - 4-connected BFS over opaque pixels within `colorTolerance` (0 = exact palette color, >0 = RGB distance). Instantly paints an entire armor plate, boot, or head to a bone in 1 click!
3. **Pixel Weight Inspector / Eyedropper (`"inspector"` or `Alt+click` in `weightPaint`):**
   - Clicking any pixel sets `inspectedWeightPixel: { x, y }` in `editorStore.ts`.
   - `WeightsPanel.tsx` displays an **Inspected Pixel** card showing `(x, y)` and a row for each influencing bone (`color swatch · bone name · slider 0..100% · exact %`) that edits that pixel's weight directly (via `setBoneWeightNormalizedWithLocks`).
   - `Ctrl+Alt+click` on canvas selects the pixel's dominant bone as `selectedBoneId` (quick bone picker!).

### 2. Symmetry & Mirror Weights (`src/engine/rig/skinning.ts`)
- **Live Mirror Painting (`rigWeightMirrorX` / `rigWeightMirrorY`):**
  - When enabled, every brush dab, gradient, or flood at `(x, y)` for `boneId` also paints at mirrored `(w - 1 - x, y)` (or `(x, h - 1 - y)`) targeting the counterpart bone resolved via `mirrorBoneName` from `src/engine/rig/skeletonTools.ts` (falling back to `boneId` for center bones).
- **One-Click Mirror Copy (`mirrorBoneWeights(weights, bones, direction: "LtoR" | "RtoL", axisX)`):**
  - Copies all weights from L-side bones/pixels to R-side counterparts (or vice versa) in one undoable `mutateRig` action.

### 3. Global Weight Utilities (`src/engine/rig/skinning.ts` & `WeightsPanel.tsx`)
Add pure functions + compact action bar in `WeightsPanel.tsx`:
- **`floodBoneWeights(weights, src, boneId, targetWeight, mask?, lockedBoneIds?)`**: sets all opaque (or selected) pixels to `targetWeight` for the active bone.
- **`smoothAllWeights(weights, src, iterations, strength, mask?, lockedBoneIds?)`**: global Laplacian relax pass across all opaque pixels (smooths seams after rigid/gradient edits).
- **`quantizeWeights(weights, step = 0.25 | 1.0, lockedBoneIds?)`**: snaps weights to `0.25` increments or `1.0` hard-bind (restores RotSprite fast-path!).
- **`pruneWeights(weights, threshold = 0.05, lockedBoneIds?)`**: drops micro-influences below threshold and re-normalizes.
- **`invertBoneWeights(weights, src, boneId, targetBoneId?, lockedBoneIds?)`**: replaces `w(boneId)` with `1 - w(boneId)` (optionally transferring remainder to parent bone).
- **`transferBoneWeights(weights, fromBoneId, toBoneId)`**: transfers all weights from a deleted/merged bone to another bone (prompted/available in `BoneTreePanel` / `WeightsPanel`).

### 4. Upgraded Overlays & Brush Cursor (`RigEngine.ts` & `RigOverlay.tsx`)
- **Brush Cursor:** render a live flat SVG circle (`1px` stroke `#ffffff` / dashed `#4c8bf5` inner falloff ring) at hovered pixel `(px, py)` with radius `rigBrushSize` when `rigTool === "weightPaint"` and `rigWeightSubTool === "brush"`.
- **Multi-Stop Heatmap (`renderBoneInfluenceOverlay`):**
  - Upgrade heatmap from single-color alpha to a crisp 5-stop color ramp (`0.0` dark blue `#1d4ed8` → `0.25` cyan `#06b6d4` → `0.5` green `#22c55e` → `0.75` yellow `#eab308` → `1.0` red `#ef4444`) with a `<canvas>` legend bar in `WeightsPanel.tsx`.
- **Unweighted / Under-weighted Diagnostic Mode (`rigWeightOverlay: "heatmap" | "boneColors" | "unweighted"`):**
  - Highlights opaque pixels with $\sum w < 0.99$ in bright magenta (`#ff2e97`) so artists immediately spot orphaned pixels that won't deform.

**Tests:**
- `applyWeightGradient` produces expected linear ramp from `1.0` at `(x0,y0)` to `0.0` at `(x1,y1)` and respects opaque/selection bounds.
- `floodFillWeights` fills contiguous same-color region without leaking across different colors.
- `mirrorBoneWeights` swaps `Arm_L` ↔ `Arm_R` weights accurately across `axisX`.
- `quantizeWeights(..., 1.0)` makes `weightsAreHard(...) === true`.
- `pruneWeights` removes influences `< 0.05` and keeps sum `=== 1`.
- `transferBoneWeights` moves all influences cleanly.

---

## Suggested Order & Sizing
| Milestone | Depends on | Size |
|---|---|---|
| `P0` Detachable, draggable & reorderable right-panel sections | — | M/L |
| `W0` Smart auto-weighting v2 (geodesic, heat, envelope, rigid, color affinity) | — | L |
| `W1` Weight locking, continuous strokes, sharpen/scale modes, posed painting | W0 | M |
| `W2` Gradient, flood fill, pixel inspector, symmetry/mirror, global ops & overlays | W1 | L |

## Guidance for the implementing agent
- Re-read target files before each milestone; line numbers in existing files may shift.
- Keep `src/engine/rig/*` React-free with explicit `.ts` relative imports so `node --test` runs directly.
- Every UI weight mutation must go through `mutateRig` / `beginRigGesture` / `endRigGesture` so `RigHistory` Ctrl+Z undo works for every brush stroke, gradient, flood fill, and auto-weight pass.
- Enforce §0.3 flat UI rules strictly: `0px` border-radius, no `box-shadow`, `text-shadow`, `backdrop-filter`, or CSS gradients.
