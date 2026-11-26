// Flat 3D Studio mode switcher: one list of entries, each mapping to the
// (workspaceKind, sprite view mode | low-poly sub-mode) pair kept in the store.
// Pure and React-free so it can be unit tested with `node --test`.
import type { Model3DSubMode, Studio3DWorkspaceKind } from "./types.ts";

export type Studio3DSpriteMode = "extruded" | "stack" | "rig";

export type Studio3DFlatMode =
  | "extrude"
  | "stack"
  | "rigPreview"
  | "model"
  | "tile"
  | "uv"
  | "paint"
  | "animate"
  | "bake";

export interface Studio3DModeFields {
  workspaceKind: Studio3DWorkspaceKind;
  mode: Studio3DSpriteMode;
  subMode: Model3DSubMode;
}

export interface Studio3DFlatModeEntry {
  id: Studio3DFlatMode;
  label: string;
  hint: string;
  kind: Studio3DWorkspaceKind;
  /** Set when kind is "sprite25d". */
  spriteMode?: Studio3DSpriteMode;
  /** Set when kind is "lowpoly3d". */
  subMode?: Model3DSubMode;
}

export const STUDIO3D_FLAT_MODES: readonly Studio3DFlatModeEntry[] = [
  {
    id: "extrude",
    label: "Sprite Extrude",
    hint: "Extruded 2.5D sprite with volumetric side walls",
    kind: "sprite25d",
    spriteMode: "extruded",
  },
  {
    id: "stack",
    label: "Sprite Stack",
    hint: "Sprite stacking, bottom-to-top layers",
    kind: "sprite25d",
    spriteMode: "stack",
  },
  {
    id: "rigPreview",
    label: "Rig Preview",
    hint: "Orbit and bake the rigged 3D skeleton",
    kind: "sprite25d",
    spriteMode: "rig",
  },
  { id: "model", label: "Model", hint: "Low-poly modeling", kind: "lowpoly3d", subMode: "model" },
  { id: "tile", label: "Tile", hint: "Low-poly tile building", kind: "lowpoly3d", subMode: "tile" },
  { id: "uv", label: "UV", hint: "Low-poly UV editing", kind: "lowpoly3d", subMode: "uv" },
  { id: "paint", label: "Paint", hint: "Low-poly texture painting", kind: "lowpoly3d", subMode: "paint" },
  { id: "animate", label: "Animate", hint: "Low-poly keyframe animation", kind: "lowpoly3d", subMode: "animate" },
  { id: "bake", label: "Bake", hint: "Low-poly baking and export", kind: "lowpoly3d", subMode: "bake" },
];

export function getStudio3DFlatMode(s: Studio3DModeFields): Studio3DFlatMode {
  if (s.workspaceKind === "lowpoly3d") return s.subMode;
  if (s.mode === "stack") return "stack";
  if (s.mode === "rig") return "rigPreview";
  return "extrude";
}

/** The store patch that selects a flat mode. Fields not owned by the mode are left alone. */
export function studio3DFlatModePatch(
  id: Studio3DFlatMode
): Pick<Studio3DModeFields, "workspaceKind"> &
  Partial<Pick<Studio3DModeFields, "mode" | "subMode">> {
  const entry = STUDIO3D_FLAT_MODES.find((e) => e.id === id);
  if (!entry) return { workspaceKind: "sprite25d", mode: "extruded" };
  if (entry.kind === "lowpoly3d" && entry.subMode) {
    return { workspaceKind: "lowpoly3d", subMode: entry.subMode };
  }
  return { workspaceKind: "sprite25d", mode: entry.spriteMode ?? "extruded" };
}

/** Timeline is hidden in low-poly 3D except the Animate mode. */
export function studio3DFlatModeShowsTimeline(id: Studio3DFlatMode): boolean {
  const entry = STUDIO3D_FLAT_MODES.find((e) => e.id === id);
  return !(entry?.kind === "lowpoly3d" && entry.subMode !== "animate");
}
