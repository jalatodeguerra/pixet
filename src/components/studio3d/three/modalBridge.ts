/**
 * Tiny React-free bridge between global keyboard handling (App.tsx) and the
 * three.js viewport, which owns the camera and therefore the modal operators
 * (G/R/S, E extrude, I inset, Ctrl+B bevel) and box select (B).
 *
 * The viewport registers handlers while mounted. Each start function returns
 * null when the operator started, or a user-facing reason string when it could
 * not (shown in the status bar by the caller).
 */

export type ModalRequestKind =
  | "grab"
  | "rotate"
  | "scale"
  | "inset"
  | "bevel"
  | "extrude";

export interface ModalBridgeHandlers {
  startModal(kind: ModalRequestKind): string | null;
  startBoxSelect(): string | null;
  /** True while a modal operator or box select owns the keyboard and pointer. */
  isActive(): boolean;
}

let handlers: ModalBridgeHandlers | null = null;

/** Registers the viewport's handlers; returns an unregister function. */
export function registerModalBridge(next: ModalBridgeHandlers): () => void {
  handlers = next;
  return () => {
    if (handlers === next) handlers = null;
  };
}

export function requestModal(kind: ModalRequestKind): string | null {
  if (!handlers) return "Open the 3D viewport to use modal tools";
  return handlers.startModal(kind);
}

export function requestBoxSelect(): string | null {
  if (!handlers) return "Open the 3D viewport to use box select";
  return handlers.startBoxSelect();
}

export function isModalActive(): boolean {
  return handlers?.isActive() ?? false;
}
