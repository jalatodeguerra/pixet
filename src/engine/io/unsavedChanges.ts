/**
 * Promise-based "Save changes?" gate. React-free: a UI component registers a
 * presenter that shows the modal; the save handler is registered by
 * documentLifecycle.ts (avoids an import cycle with projectBridge).
 */
import { verifyDirty } from "./documentState.ts";

export type DiscardChoice = "save" | "discard" | "cancel";
export type DiscardPresenter = () => Promise<DiscardChoice>;
export type SaveHandler = () => Promise<boolean>;

let presenter: DiscardPresenter | null = null;
let saveHandler: SaveHandler | null = null;
let pending: Promise<boolean> | null = null;

export function registerDiscardPresenter(p: DiscardPresenter | null): void {
  presenter = p;
}

export function registerSaveHandler(h: SaveHandler | null): void {
  saveHandler = h;
}

/**
 * Resolves true when it is safe to replace/close the document: it is clean,
 * the user chose Don't Save, or Save succeeded. Resolves false on Cancel, on a
 * failed/cancelled save, or when no UI is available to ask.
 */
export function confirmDiscardChanges(): Promise<boolean> {
  if (!verifyDirty()) return Promise.resolve(true);
  if (pending) return pending;
  const run = async (): Promise<boolean> => {
    if (!presenter) return false;
    const choice = await presenter();
    if (choice === "cancel") return false;
    if (choice === "discard") return true;
    if (!saveHandler) return false;
    try {
      return await saveHandler();
    } catch {
      return false;
    }
  };
  pending = run().finally(() => {
    pending = null;
  });
  return pending;
}
