/**
 * Wires dirty tracking, autosave, crash recovery and window-close guards to
 * the live app. React-free; started once from App via initDocumentLifecycle().
 */
import { useEditorStore } from "../../store/editorStore.ts";
import {
  isDirty,
  markClean,
  markDirty,
  autosaveNow,
  getSavedSignature,
  setAutosaveHandler,
  subscribeDirty,
  verifyDirty,
} from "./documentState.ts";
import {
  buildRecoveryEntry,
  clearRecoveryEntry,
  loadRecoveryEntry,
  type RecoveryEntry,
  writeRecoveryEntry,
} from "./recovery.ts";
import {
  isTauriRuntime,
  loadProjectTransferSafely,
  markCurrentStateClean,
  projectSignature,
  saveProjectAction,
  serializeProjectTransfer,
} from "./projectBridge.ts";
import type { ProjectTransfer } from "./projectBridge.ts";
import {
  confirmDiscardChanges,
  registerSaveHandler,
} from "./unsavedChanges.ts";

export const AUTOSAVE_INTERVAL_MS = 30_000;

let started = false;
let autosaveWarned = false;
/** Serializes IndexedDB writes/clears so a late write cannot undo a clear. */
let storageChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = storageChain.then(job, job);
  storageChain = next.catch(() => undefined);
  return next;
}

/** Clears the recovery entry in order with any in-flight autosave write. */
export function discardRecovery(): Promise<boolean> {
  return enqueue(() => clearRecoveryEntry());
}

/**
 * Writes the current document to the recovery store if there are unsaved
 * changes. Exposed to other modules as `autosaveNow` in documentState.ts; never throws.
 */
async function performAutosave(): Promise<boolean> {
  try {
    if (!isDirty()) return false;
    const transfer = serializeProjectTransfer({ commitFloating: false });
    const signature = projectSignature(transfer);
    if (signature === getSavedSignature()) {
      markClean(signature);
      return false;
    }
    const st = useEditorStore.getState();
    const entry = buildRecoveryEntry(
      st.documentName,
      st.currentFilePath,
      transfer
    );
    const ok = await enqueue(() => writeRecoveryEntry(entry));
    if (!ok && !autosaveWarned) {
      autosaveWarned = true;
      st.setStatusMessage("Autosave unavailable: unsaved work cannot be recovered after a crash");
    }
    return ok;
  } catch (err) {
    console.warn("[pixet] autosave error", err);
    if (!autosaveWarned) {
      autosaveWarned = true;
      useEditorStore
        .getState()
        .setStatusMessage("Autosave failed: save your work manually");
    }
    return false;
  }
}

export function findRecoverableWork(): Promise<RecoveryEntry | null> {
  return enqueue(() => loadRecoveryEntry());
}

/** Loads an autosaved entry as an unsaved document. Returns success. */
export function recoverWork(entry: RecoveryEntry): boolean {
  const ok = loadProjectTransferSafely(
    entry.transfer as ProjectTransfer,
    entry.filePath,
    entry.documentName
  );
  if (!ok) return false;
  // Unsaved by definition: unknown baseline, flag set. The recovery entry is
  // kept until the user saves, so a crash right after recovery loses nothing.
  markClean(null);
  markDirty();
  useEditorStore.getState().setStatusMessage(`Recovered ${entry.documentName}`);
  return true;
}

function titleFor(name: string, dirty: boolean): string {
  return `${dirty ? "• " : ""}${name} — Pixet`;
}

async function setNativeTitle(title: string): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  } catch {
    // Missing capability or non-Tauri host: the document title still updates.
  }
}

function syncTitles(): void {
  const st = useEditorStore.getState();
  const title = titleFor(st.documentName, st.isDocumentDirty);
  document.title = title;
  if (isTauriRuntime()) void setNativeTitle(title);
}

async function registerTauriCloseGuard(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.onCloseRequested(async (event) => {
      if (!verifyDirty()) return;
      event.preventDefault();
      if (await confirmDiscardChanges()) {
        await discardRecovery();
        await win.destroy();
      }
    });
  } catch (err) {
    console.warn("[pixet] close guard unavailable", err);
  }
}

export function initDocumentLifecycle(): void {
  if (started) return;
  started = true;

  registerSaveHandler(() => saveProjectAction(false));
  setAutosaveHandler(performAutosave);

  // The seeded starter document counts as clean.
  try {
    markCurrentStateClean();
  } catch (err) {
    console.warn("[pixet] could not baseline document", err);
  }

  subscribeDirty((dirty) => {
    useEditorStore.getState().setDocumentDirty(dirty);
  });
  useEditorStore.getState().setDocumentDirty(isDirty());

  // Document-slice edits that never touch an undo history.
  useEditorStore.subscribe((s, prev) => {
    if (
      s.layers !== prev.layers ||
      s.frames !== prev.frames ||
      s.tags !== prev.tags ||
      s.palette !== prev.palette ||
      s.paletteName !== prev.paletteName ||
      s.guides !== prev.guides ||
      s.canvasWidth !== prev.canvasWidth ||
      s.canvasHeight !== prev.canvasHeight ||
      s.colorMode !== prev.colorMode
    ) {
      markDirty();
    }
    if (
      s.documentName !== prev.documentName ||
      s.isDocumentDirty !== prev.isDocumentDirty
    ) {
      syncTitles();
    }
  });
  syncTitles();

  window.addEventListener("beforeunload", (e) => {
    if (isTauriRuntime()) return; // handled by onCloseRequested
    if (verifyDirty()) {
      void autosaveNow();
      e.preventDefault();
      e.returnValue = "";
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void autosaveNow();
  });
  window.addEventListener("pagehide", () => {
    void autosaveNow();
  });

  window.setInterval(() => {
    if (isDirty()) void autosaveNow();
  }, AUTOSAVE_INTERVAL_MS);

  if (isTauriRuntime()) void registerTauriCloseGuard();
}
