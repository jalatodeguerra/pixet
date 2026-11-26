/**
 * Crash-recovery storage: the latest autosave of the open document lives in
 * IndexedDB (db "pixet", store "recovery", key "autosave"). The storage is
 * behind a tiny interface so tests can fake it. Nothing here may throw into
 * callers: failures are reported via the returned values.
 */

export const RECOVERY_DB = "pixet";
export const RECOVERY_STORE = "recovery";
export const RECOVERY_KEY = "autosave";
export const RECOVERY_VERSION = 1;

export interface RecoveryEntry<T = unknown> {
  version: 1;
  savedAt: number;
  documentName: string;
  filePath: string | null;
  transfer: T;
}

export interface RecoveryStorage {
  get(): Promise<unknown>;
  put(entry: RecoveryEntry): Promise<void>;
  clear(): Promise<void>;
}

export function buildRecoveryEntry<T>(
  documentName: string,
  filePath: string | null,
  transfer: T,
  now: number = Date.now()
): RecoveryEntry<T> {
  return {
    version: RECOVERY_VERSION,
    savedAt: now,
    documentName,
    filePath,
    transfer,
  };
}

/** Validates an untrusted stored value; returns null when unusable. */
export function parseRecoveryEntry(raw: unknown): RecoveryEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== RECOVERY_VERSION) return null;
  if (typeof r.savedAt !== "number" || !Number.isFinite(r.savedAt)) return null;
  if (typeof r.documentName !== "string") return null;
  if (r.filePath !== null && typeof r.filePath !== "string") return null;
  if (typeof r.transfer !== "object" || r.transfer === null) return null;
  const doc = (r.transfer as Record<string, unknown>).document;
  if (typeof doc !== "object" || doc === null) return null;
  return {
    version: RECOVERY_VERSION,
    savedAt: r.savedAt,
    documentName: r.documentName,
    filePath: r.filePath as string | null,
    transfer: r.transfer,
  };
}

export function formatRelativeTime(savedAt: number, now: number = Date.now()): string {
  const sec = Math.max(0, Math.round((now - savedAt) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(RECOVERY_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(RECOVERY_STORE)) {
        req.result.createObjectStore(RECOVERY_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(RECOVERY_STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx aborted"));
    });
    const result = await reqToPromise(run(tx.objectStore(RECOVERY_STORE)));
    await done;
    return result;
  } finally {
    db.close();
  }
}

export const indexedDbRecoveryStorage: RecoveryStorage = {
  get: () => withStore("readonly", (s) => s.get(RECOVERY_KEY)),
  put: async (entry) => {
    await withStore("readwrite", (s) => s.put(entry, RECOVERY_KEY));
  },
  clear: async () => {
    await withStore("readwrite", (s) => s.delete(RECOVERY_KEY));
  },
};

/** Reads and validates the stored entry. Never throws. */
export async function loadRecoveryEntry(
  storage: RecoveryStorage = indexedDbRecoveryStorage
): Promise<RecoveryEntry | null> {
  try {
    return parseRecoveryEntry(await storage.get());
  } catch (err) {
    console.warn("[pixet] recovery read failed", err);
    return null;
  }
}

/** Deletes the stored entry. Never throws; returns success. */
export async function clearRecoveryEntry(
  storage: RecoveryStorage = indexedDbRecoveryStorage
): Promise<boolean> {
  try {
    await storage.clear();
    return true;
  } catch (err) {
    console.warn("[pixet] recovery clear failed", err);
    return false;
  }
}

/** Writes an entry. Never throws; returns success. */
export async function writeRecoveryEntry(
  entry: RecoveryEntry,
  storage: RecoveryStorage = indexedDbRecoveryStorage
): Promise<boolean> {
  try {
    await storage.put(entry);
    return true;
  } catch (err) {
    console.warn("[pixet] autosave failed", err);
    return false;
  }
}
