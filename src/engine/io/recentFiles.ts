/** Recently opened/saved project paths (desktop only). React-free. */

export const MAX_RECENT_FILES = 8;
const RECENT_FILES_KEY = "pixet:recentFiles";
const SHOW_ON_STARTUP_KEY = "pixet:showStartScreen";

/** Puts `path` first, drops duplicates and caps the list. */
export function addRecentPath(
  list: readonly string[],
  path: string,
  max = MAX_RECENT_FILES
): string[] {
  const trimmed = path.trim();
  if (!trimmed) return list.slice(0, max);
  return [trimmed, ...list.filter((p) => p !== trimmed)].slice(0, max);
}

export function removeRecentPath(list: readonly string[], path: string): string[] {
  return list.filter((p) => p !== path);
}

/** Tolerant parse of the stored JSON: strings only, deduped, capped. */
export function parseRecentPaths(raw: string | null, max = MAX_RECENT_FILES): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && item.trim() && !out.includes(item)) out.push(item);
      if (out.length >= max) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function loadRecentFiles(): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    return parseRecentPaths(localStorage.getItem(RECENT_FILES_KEY));
  } catch {
    return [];
  }
}

function saveRecentFiles(list: readonly string[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: recents are a convenience only.
  }
}

export function recordRecentFile(path: string): void {
  saveRecentFiles(addRecentPath(loadRecentFiles(), path));
}

export function forgetRecentFile(path: string): void {
  saveRecentFiles(removeRecentPath(loadRecentFiles(), path));
}

/** Start screen on launch: default on, stored as "0" when disabled. */
export function loadShowOnStartup(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(SHOW_ON_STARTUP_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveShowOnStartup(show: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SHOW_ON_STARTUP_KEY, show ? "1" : "0");
  } catch {
    // ignore
  }
}
