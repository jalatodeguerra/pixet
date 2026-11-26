import { useEditorStore } from "../../store/editorStore.ts";
import { autosaveNow } from "./documentState.ts";

/** Best-effort autosave on a crash; never throws. */
export function autosaveOnCrash(): void {
  void autosaveNow().catch((err: unknown) => {
    console.error("Crash autosave failed", err);
  });
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

let lastReport = 0;
const THROTTLE_MS = 3000;

/** Logs, shows a status message (throttled) and requests an autosave. */
export function reportCrash(prefix: string, err: unknown): void {
  console.error(prefix, err);
  const now = Date.now();
  if (now - lastReport < THROTTLE_MS) return;
  lastReport = now;
  try {
    useEditorStore
      .getState()
      .setStatusMessage(`Something went wrong: ${messageOf(err)}`);
  } catch {
    /* store itself unavailable; console already has it */
  }
  autosaveOnCrash();
}

export function errorMessageOf(err: unknown): string {
  return messageOf(err);
}

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    // Benign browser warning (often from React Flow / layout observers).
    if (typeof e.message === "string" && e.message.startsWith("ResizeObserver loop")) {
      return;
    }
    reportCrash("Uncaught error", e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    reportCrash("Unhandled promise rejection", e.reason);
  });
}
