import {
  deselectAllElements,
  invertElementSelection,
  isEditMode,
  loopCutOrSubdivide,
  mergeSelectedAtCenter,
  selectAllElements,
  setEditGranularity,
  toggleEditMode,
  deleteSelectedMeshElements,
  type EditGranularity,
} from "../../engine/model3d/editMode";
import { useEditorStore } from "../../store/editorStore";
import {
  requestBoxSelect,
  requestModal,
  type ModalRequestKind,
} from "./three/modalBridge";

const DIGIT_GRANULARITY: Record<string, EditGranularity> = {
  "1": "vertex",
  "2": "edge",
  "3": "face",
};

function say(message: string): void {
  useEditorStore.getState().setStatusMessage(message);
}

function start(kind: ModalRequestKind): void {
  const reason = requestModal(kind);
  if (reason) say(reason);
}

/**
 * Blender-style keymap for the Model sub-mode (Object Mode / Edit Mode).
 * Called from App.tsx's global keydown before the generic 3D shortcuts.
 * Returns true when the key was consumed. Text inputs are filtered by the caller.
 *
 *   Tab           Object <-> Edit Mode          1 / 2 / 3   vertex / edge / face (enters Edit Mode)
 *   G / R / S     modal grab / rotate / scale   B           box select
 *   E / I         extrude / inset faces         Ctrl+B      bevel
 *   Ctrl+R        loop cut / subdivide          M           merge at center
 *   A / Alt+A     select all / none             Ctrl+I      invert selection
 *   X             delete elements
 */
export function handleModelModeKeyDown(e: KeyboardEvent): boolean {
  const ctrl = e.ctrlKey || e.metaKey;
  const edit = isEditMode();

  if (e.key === "Tab" && !ctrl && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    if (!e.repeat) toggleEditMode();
    return true;
  }

  // Alt+A uses e.code because Alt composes a different e.key on some layouts.
  if (e.altKey && !ctrl && !e.shiftKey && e.code === "KeyA") {
    e.preventDefault();
    if (!e.repeat) deselectAllElements();
    return true;
  }

  if (e.altKey || e.shiftKey) return false;

  const key = e.key.toLowerCase();

  if (ctrl) {
    if (!edit) {
      // Ctrl+R is loop cut in Edit Mode; in Object Mode swallow it so muscle memory
      // never reloads the page.
      if (key === "r") {
        e.preventDefault();
        say("Loop cut works in Edit Mode — press Tab first");
        return true;
      }
      return false;
    }
    if (key === "b") {
      e.preventDefault();
      if (!e.repeat) start("bevel");
      return true;
    }
    if (key === "r") {
      e.preventDefault();
      if (!e.repeat) loopCutOrSubdivide();
      return true;
    }
    if (key === "i") {
      e.preventDefault();
      if (!e.repeat) invertElementSelection();
      return true;
    }
    return false;
  }

  const granularity = DIGIT_GRANULARITY[e.key];
  if (granularity) {
    e.preventDefault();
    if (!e.repeat) setEditGranularity(granularity);
    return true;
  }
  // "4" used to be Face select; Face is 3 now. Swallow it so it never reaches Draw shortcuts.
  if (e.key === "4") {
    e.preventDefault();
    return true;
  }

  switch (key) {
    case "g":
    case "r":
    case "s": {
      e.preventDefault();
      if (!e.repeat) start(key === "g" ? "grab" : key === "r" ? "rotate" : "scale");
      return true;
    }
    case "b": {
      e.preventDefault();
      if (!e.repeat) {
        const reason = requestBoxSelect();
        if (reason) say(reason);
      }
      return true;
    }
    case "a": {
      e.preventDefault();
      if (!e.repeat) selectAllElements();
      return true;
    }
    default:
      break;
  }

  if (!edit) {
    // E / I / M / X only act on geometry; in Object Mode they must not trigger gizmo or Draw shortcuts.
    if (key === "e" || key === "i" || key === "m" || key === "x") {
      e.preventDefault();
      return true;
    }
    return false;
  }

  switch (key) {
    case "e":
      e.preventDefault();
      if (!e.repeat) start("extrude");
      return true;
    case "i":
      e.preventDefault();
      if (!e.repeat) start("inset");
      return true;
    case "m":
      e.preventDefault();
      if (!e.repeat) mergeSelectedAtCenter();
      return true;
    case "x":
      e.preventDefault();
      if (!e.repeat && !deleteSelectedMeshElements()) say("Nothing selected to delete");
      return true;
    default:
      return false;
  }
}
