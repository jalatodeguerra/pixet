/**
 * Dirty-state tracking for the open document. React-free: the UI mirrors the
 * flag through `subscribeDirty` (see documentLifecycle.ts).
 *
 * The flag is deliberately conservative (false positives are fine, false
 * negatives are not). To kill false positives we keep a cheap hash of the
 * serialized document as of the last save/open; `verifyDirty()` re-serializes
 * on demand and treats an identical hash as clean.
 */

/** cyrb53: fast 53-bit string hash, returned as a hex string. */
export function hashString(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

type DirtyListener = (dirty: boolean) => void;

let dirty = false;
let editVersion = 0;
let savedSignature: string | null = null;
let computeSignature: (() => string) | null = null;
const listeners = new Set<DirtyListener>();

function setDirty(next: boolean): void {
  if (dirty === next) return;
  dirty = next;
  for (const l of listeners) l(next);
}

/** Injects the function that hashes the current document state. */
export function setSignatureProvider(fn: (() => string) | null): void {
  computeSignature = fn;
}

export function markDirty(): void {
  editVersion++;
  setDirty(true);
}

/**
 * Marks the document clean and remembers its signature. When `sinceVersion`
 * (from `getEditVersion()` taken before an async save) no longer matches, an
 * edit happened meanwhile: the signature is stored but the flag stays set.
 */
export function markClean(
  signature: string | null,
  sinceVersion?: number
): void {
  savedSignature = signature;
  if (sinceVersion !== undefined && sinceVersion !== editVersion) return;
  setDirty(false);
}

export function isDirty(): boolean {
  return dirty;
}

export function getEditVersion(): number {
  return editVersion;
}

export function getSavedSignature(): string | null {
  return savedSignature;
}

export function subscribeDirty(listener: DirtyListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Authoritative dirty check. Cheap when the flag is clear; when set, compares
 * a fresh signature to the last saved one and clears the flag if equal.
 */
export function verifyDirty(): boolean {
  if (!dirty) return false;
  if (savedSignature === null || computeSignature === null) return true;
  let current: string;
  try {
    current = computeSignature();
  } catch {
    return true;
  }
  if (current === savedSignature) {
    setDirty(false);
    return false;
  }
  return true;
}

let autosaveHandler: (() => Promise<boolean>) | null = null;

/** Registered by documentLifecycle.ts once the app is wired up. */
export function setAutosaveHandler(fn: (() => Promise<boolean>) | null): void {
  autosaveHandler = fn;
}

/**
 * Requests an immediate recovery autosave (no-op until the app registered a
 * handler). Never throws; resolves true when an entry was written.
 */
export async function autosaveNow(): Promise<boolean> {
  try {
    return autosaveHandler ? await autosaveHandler() : false;
  } catch {
    return false;
  }
}

/** Test helper. */
export function resetDocumentStateForTests(): void {
  dirty = false;
  editVersion = 0;
  savedSignature = null;
  computeSignature = null;
  autosaveHandler = null;
  listeners.clear();
}
