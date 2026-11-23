export type KeybindingPreset = "pixet" | "aseprite";
export type KeybindingMap = Record<string, string>;

export interface KeybindingActionDef {
  id: string;
  label: string;
  category: string;
}

export const KEYBINDING_ACTIONS: KeybindingActionDef[] = [
  // Draw Tools
  { id: "tool.pencil", label: "Pencil", category: "Draw Tools" },
  { id: "tool.fillBrush", label: "Fill Brush", category: "Draw Tools" },
  { id: "tool.ditherBrush", label: "Dither Brush", category: "Draw Tools" },
  { id: "tool.shading", label: "Shading", category: "Draw Tools" },
  { id: "tool.spray", label: "Spray", category: "Draw Tools" },
  { id: "tool.jumble", label: "Jumble", category: "Draw Tools" },
  { id: "tool.eraser", label: "Eraser", category: "Draw Tools" },
  { id: "tool.rect", label: "Rectangle", category: "Draw Tools" },
  { id: "tool.ellipse", label: "Ellipse", category: "Draw Tools" },
  { id: "tool.line", label: "Line", category: "Draw Tools" },
  { id: "tool.curve", label: "Curve (Bezier)", category: "Draw Tools" },
  { id: "tool.polygon", label: "Polygon", category: "Draw Tools" },
  { id: "tool.isoBox", label: "Iso Box (2:1)", category: "Draw Tools" },
  { id: "tool.fill", label: "Paint Bucket", category: "Draw Tools" },
  { id: "tool.gradient", label: "Gradient", category: "Draw Tools" },
  { id: "tool.eyedropper", label: "Eyedropper", category: "Draw Tools" },
  { id: "tool.marquee", label: "Rect Marquee", category: "Draw Tools" },
  { id: "tool.ellipseMarquee", label: "Ellipse Marquee", category: "Draw Tools" },
  { id: "tool.lasso", label: "Lasso Select", category: "Draw Tools" },
  { id: "tool.polyLasso", label: "Poly Lasso", category: "Draw Tools" },
  { id: "tool.wand", label: "Magic Wand", category: "Draw Tools" },
  { id: "tool.move", label: "Move", category: "Draw Tools" },
  { id: "tool.tileStamp", label: "Tile Stamp", category: "Draw Tools" },

  // Commands
  { id: "view.flipH", label: "Flip View Horizontal", category: "View" },
  { id: "view.flipV", label: "Flip View Vertical", category: "View" },
  { id: "view.commandPalette", label: "Command Palette", category: "View" },
  { id: "edit.freeTransform", label: "Free Transform", category: "Edit" },
  { id: "edit.captureBrush", label: "Capture Custom Brush", category: "Edit" },
  { id: "layer.mergeDown", label: "Merge Down Layer", category: "Layer" },
];

export const PIXET_DEFAULT_KEYBINDINGS: KeybindingMap = {
  "tool.pencil": "b",
  "tool.fillBrush": "f",
  "tool.ditherBrush": "d",
  "tool.shading": "j",
  "tool.spray": "s",
  "tool.jumble": "shift+s",
  "tool.eraser": "e",
  "tool.rect": "u",
  "tool.ellipse": "o",
  "tool.line": "l",
  "tool.curve": "c",
  "tool.polygon": "p",
  "tool.isoBox": "k",
  "tool.fill": "g",
  "tool.gradient": "shift+g",
  "tool.eyedropper": "i",
  "tool.marquee": "m",
  "tool.ellipseMarquee": "",
  "tool.lasso": "",
  "tool.polyLasso": "",
  "tool.wand": "w",
  "tool.move": "v",
  "tool.tileStamp": "t",

  "view.flipH": "h",
  "view.flipV": "shift+h",
  "view.commandPalette": "ctrl+k",
  "edit.freeTransform": "ctrl+t",
  "edit.captureBrush": "ctrl+b",
  "layer.mergeDown": "ctrl+m",
};

export const ASEPRITE_KEYBINDINGS: KeybindingMap = {
  "tool.pencil": "b",
  "tool.fillBrush": "shift+b",
  "tool.ditherBrush": "d",
  "tool.shading": "j",
  "tool.spray": "shift+s",
  "tool.jumble": "r",
  "tool.eraser": "e",
  "tool.rect": "u",
  "tool.ellipse": "shift+u",
  "tool.line": "l",
  "tool.curve": "shift+l",
  "tool.polygon": "p",
  "tool.isoBox": "k",
  "tool.fill": "g",
  "tool.gradient": "shift+g",
  "tool.eyedropper": "i",
  "tool.marquee": "m",
  "tool.ellipseMarquee": "shift+m",
  "tool.lasso": "q",
  "tool.polyLasso": "shift+q",
  "tool.wand": "w",
  "tool.move": "v",
  "tool.tileStamp": "t",

  "view.flipH": "h",
  "view.flipV": "shift+h",
  "view.commandPalette": "ctrl+k",
  "edit.freeTransform": "ctrl+t",
  "edit.captureBrush": "ctrl+b",
  "layer.mergeDown": "ctrl+m",
};

const MODIFIER_ONLY_KEYS = new Set([
  "control",
  "ctrl",
  "shift",
  "alt",
  "meta",
  "os",
  "altgraph",
]);

function normalizeKeyName(rawKey: string): string {
  if (rawKey === " ") return "space";
  const lower = rawKey.trim().toLowerCase();
  if (!lower) return "";
  if (lower === "spacebar") return "space";
  if (lower === "esc") return "escape";
  if (lower === "del") return "delete";
  return lower;
}

export function normalizeChordString(chord: string): string {
  const parts = chord
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return "";

  let hasCtrl = false;
  let hasShift = false;
  let hasAlt = false;
  let key = "";

  for (const part of parts) {
    if (part === "ctrl" || part === "control" || part === "cmd" || part === "meta") {
      hasCtrl = true;
    } else if (part === "shift") {
      hasShift = true;
    } else if (part === "alt" || part === "option") {
      hasAlt = true;
    } else {
      key = normalizeKeyName(part);
    }
  }

  if (!key || MODIFIER_ONLY_KEYS.has(key)) return "";
  const out: string[] = [];
  if (hasCtrl) out.push("ctrl");
  if (hasShift) out.push("shift");
  if (hasAlt) out.push("alt");
  out.push(key);
  return out.join("+");
}

export function formatEventToChord(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): string {
  const key = normalizeKeyName(e.key);
  if (!key || MODIFIER_ONLY_KEYS.has(key)) {
    return "";
  }
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(key);
  return parts.join("+");
}

export function formatChordForDisplay(chord: string): string {
  const norm = normalizeChordString(chord);
  if (!norm) return "";
  return norm
    .split("+")
    .map((part) => {
      if (part === "ctrl") return "Ctrl";
      if (part === "shift") return "Shift";
      if (part === "alt") return "Alt";
      if (part.length === 1) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("+");
}

export function findKeybindingConflicts(
  map: KeybindingMap
): Array<{ chord: string; actionIds: string[] }> {
  const byChord = new Map<string, string[]>();
  for (const [actionId, rawChord] of Object.entries(map)) {
    const chord = normalizeChordString(rawChord);
    if (!chord) continue;
    const list = byChord.get(chord);
    if (list) {
      list.push(actionId);
    } else {
      byChord.set(chord, [actionId]);
    }
  }
  const conflicts: Array<{ chord: string; actionIds: string[] }> = [];
  for (const [chord, actionIds] of byChord.entries()) {
    if (actionIds.length > 1) {
      conflicts.push({ chord, actionIds });
    }
  }
  return conflicts;
}

export function resolveActionForChord(
  chord: string,
  map: KeybindingMap
): string | null {
  const target = normalizeChordString(chord);
  if (!target) return null;
  for (const [actionId, bound] of Object.entries(map)) {
    if (normalizeChordString(bound) === target) {
      return actionId;
    }
  }
  return null;
}

export function getPresetKeybindings(preset: KeybindingPreset): KeybindingMap {
  return preset === "aseprite"
    ? { ...ASEPRITE_KEYBINDINGS }
    : { ...PIXET_DEFAULT_KEYBINDINGS };
}
