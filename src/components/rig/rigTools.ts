import {
  Bone,
  Crosshair,
  Grid3x3,
  Link2,
  MousePointer2,
  Move,
  Paintbrush,
  Pin,
  Scaling,
} from "lucide-react";
import type { RigMode, RigTool } from "../../store/editorStore";

/**
 * Single source of truth for the focused rig tool rail, its keyboard
 * shortcuts and the tools that are still owned by a later milestone.
 */
export interface RigToolDef {
  id: RigTool;
  label: string;
  shortcut: string;
  icon: typeof MousePointer2;
  /** Only meaningful while editing the bind pose. */
  setupOnly?: boolean;
  /** Milestone that will implement the tool's behaviour. */
  milestone?: string;
  /** Overrides the default "coming in <milestone>" disabled tooltip. */
  note?: string;
}

export const RIG_TOOL_DEFS: RigToolDef[] = [
  { id: "select", label: "Select / Rotate", shortcut: "V", icon: MousePointer2 },
  { id: "translate", label: "Translate", shortcut: "G", icon: Move },
  { id: "scale", label: "Scale", shortcut: "S", icon: Scaling },
  {
    id: "addBone",
    label: "Add Bone",
    shortcut: "B",
    icon: Bone,
    setupOnly: true,
  },
  {
    id: "chain",
    label: "Chain",
    shortcut: "C",
    icon: Link2,
    setupOnly: true,
  },
  { id: "ik", label: "IK Target", shortcut: "K", icon: Crosshair },
  {
    id: "pin",
    label: "Pin IK Constraint",
    shortcut: "P",
    icon: Pin,
  },
  { id: "weightPaint", label: "Weight Paint", shortcut: "W", icon: Paintbrush },
  {
    id: "meshEdit",
    label: "Mesh Edit",
    shortcut: "M",
    icon: Grid3x3,
    milestone: "R6",
    note: "mesh UI not wired yet",
  },
];

export const RIG_TOOL_BY_ID = new Map<RigTool, RigToolDef>(
  RIG_TOOL_DEFS.map((def) => [def.id, def])
);

/** Keyboard key (lowercase) -> rig tool. Only active in Rig workspace mode. */
export const RIG_TOOL_SHORTCUTS: Record<string, RigTool> = {};
for (const def of RIG_TOOL_DEFS) {
  RIG_TOOL_SHORTCUTS[def.shortcut.toLowerCase()] = def.id;
}

/** Groups drawn with a separator between them in the rail. */
export const RIG_TOOL_GROUPS: { ids: RigTool[]; dividerAfter?: boolean }[] = [
  { ids: ["select", "translate", "scale"], dividerAfter: true },
  { ids: ["addBone", "chain"], dividerAfter: true },
  { ids: ["ik", "weightPaint", "meshEdit", "pin"] },
];

/** Human readable reason why a tool is not usable yet, or null. */
export function rigToolDisabledReason(
  def: RigToolDef,
  rigMode: RigMode
): string | null {
  if (def.note) return def.note;
  if (def.milestone) return `coming in ${def.milestone}`;
  if (def.setupOnly && rigMode !== "setup") return "available in Setup mode";
  return null;
}

export function rigToolTitle(def: RigToolDef, rigMode: RigMode): string {
  const reason = rigToolDisabledReason(def, rigMode);
  const base = `${def.label} (${def.shortcut})`;
  return reason ? `${base} · ${reason}` : base;
}
