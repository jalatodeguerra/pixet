import test from "node:test";
import assert from "node:assert/strict";

import {
  getEditVersion,
  getSavedSignature,
  hashString,
  isDirty,
  markClean,
  markDirty,
  resetDocumentStateForTests,
  setSignatureProvider,
  subscribeDirty,
  verifyDirty,
  autosaveNow,
  setAutosaveHandler,
} from "../src/engine/io/documentState.ts";
import {
  buildRecoveryEntry,
  clearRecoveryEntry,
  formatRelativeTime,
  loadRecoveryEntry,
  parseRecoveryEntry,
  type RecoveryStorage,
  writeRecoveryEntry,
} from "../src/engine/io/recovery.ts";
import { confirmDiscardChanges, registerDiscardPresenter, registerSaveHandler } from "../src/engine/io/unsavedChanges.ts";

function fakeStorage(initial: unknown = undefined, failing = false) {
  let value: unknown = initial;
  const storage: RecoveryStorage = {
    get: async () => {
      if (failing) throw new Error("boom");
      return value;
    },
    put: async (entry) => {
      if (failing) throw new Error("boom");
      value = structuredClone(entry);
    },
    clear: async () => {
      if (failing) throw new Error("boom");
      value = undefined;
    },
  };
  return { storage, peek: () => value };
}

const transfer = { document: { name: "a.pixet" }, cels: {} };

test("hashString is deterministic and discriminating", () => {
  assert.equal(hashString("abc"), hashString("abc"));
  assert.notEqual(hashString("abc"), hashString("abd"));
  assert.notEqual(hashString(""), hashString("a"));
  assert.match(hashString("x".repeat(1000)), /^[0-9a-f]{14}$/);
});

test("dirty flag toggles and notifies once per transition", () => {
  resetDocumentStateForTests();
  const seen: boolean[] = [];
  const off = subscribeDirty((d) => seen.push(d));
  assert.equal(isDirty(), false);
  markDirty();
  markDirty();
  assert.equal(isDirty(), true);
  markClean("sig");
  assert.equal(isDirty(), false);
  assert.deepEqual(seen, [true, false]);
  assert.equal(getSavedSignature(), "sig");
  off();
  markDirty();
  assert.deepEqual(seen, [true, false]);
});

test("verifyDirty clears false positives via signature", () => {
  resetDocumentStateForTests();
  let current = "A";
  setSignatureProvider(() => current);
  markClean("A");
  markDirty();
  assert.equal(verifyDirty(), false);
  assert.equal(isDirty(), false);
  markDirty();
  current = "B";
  assert.equal(verifyDirty(), true);
  assert.equal(isDirty(), true);
});

test("verifyDirty stays dirty without baseline or when provider throws", () => {
  resetDocumentStateForTests();
  setSignatureProvider(() => "A");
  markClean(null);
  markDirty();
  assert.equal(verifyDirty(), true);
  markClean("A");
  markDirty();
  setSignatureProvider(() => {
    throw new Error("x");
  });
  assert.equal(verifyDirty(), true);
});

test("an edit during an async save keeps the document dirty", () => {
  resetDocumentStateForTests();
  markDirty();
  const version = getEditVersion();
  markDirty(); // edit while save in flight
  markClean("saved", version);
  assert.equal(isDirty(), true);
  assert.equal(getSavedSignature(), "saved");
  const v2 = getEditVersion();
  markClean("saved2", v2);
  assert.equal(isDirty(), false);
});

test("autosaveNow delegates to the registered handler and never throws", async () => {
  resetDocumentStateForTests();
  assert.equal(await autosaveNow(), false);
  setAutosaveHandler(async () => true);
  assert.equal(await autosaveNow(), true);
  setAutosaveHandler(async () => {
    throw new Error("nope");
  });
  assert.equal(await autosaveNow(), false);
});

test("recovery entry shape and validation", () => {
  const entry = buildRecoveryEntry("a.pixet", "/x/a.pixet", transfer, 1234);
  assert.deepEqual(Object.keys(entry).sort(), [
    "documentName",
    "filePath",
    "savedAt",
    "transfer",
    "version",
  ]);
  assert.equal(entry.version, 1);
  assert.equal(entry.savedAt, 1234);
  assert.deepEqual(parseRecoveryEntry(JSON.parse(JSON.stringify(entry))), entry);
  assert.equal(parseRecoveryEntry(null), null);
  assert.equal(parseRecoveryEntry({ ...entry, version: 2 }), null);
  assert.equal(parseRecoveryEntry({ ...entry, transfer: {} }), null);
  assert.equal(parseRecoveryEntry({ ...entry, filePath: 5 }), null);
  assert.equal(parseRecoveryEntry({ ...entry, savedAt: "now" }), null);
});

test("recovery storage round trip, clear and failure tolerance", async () => {
  const { storage, peek } = fakeStorage();
  assert.equal(await loadRecoveryEntry(storage), null);
  const entry = buildRecoveryEntry("a.pixet", null, transfer, 1);
  assert.equal(await writeRecoveryEntry(entry, storage), true);
  assert.deepEqual(await loadRecoveryEntry(storage), entry);
  assert.equal(await clearRecoveryEntry(storage), true);
  assert.equal(peek(), undefined);

  const bad = fakeStorage(undefined, true).storage;
  assert.equal(await writeRecoveryEntry(entry, bad), false);
  assert.equal(await clearRecoveryEntry(bad), false);
  assert.equal(await loadRecoveryEntry(bad), null);
  const junk = fakeStorage({ nonsense: true }).storage;
  assert.equal(await loadRecoveryEntry(junk), null);
});

test("formatRelativeTime", () => {
  const now = 10_000_000;
  assert.equal(formatRelativeTime(now - 5_000, now), "just now");
  assert.equal(formatRelativeTime(now - 60_000, now), "1 minute ago");
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), "5 minutes ago");
  assert.equal(formatRelativeTime(now - 2 * 3600_000, now), "2 hours ago");
  assert.equal(formatRelativeTime(now - 3 * 86400_000, now), "3 days ago");
  assert.equal(formatRelativeTime(now + 5000, now), "just now");
});

test("confirmDiscardChanges gate", async () => {
  resetDocumentStateForTests();
  let saves = 0;
  let saveOk = true;
  registerSaveHandler(async () => {
    saves++;
    return saveOk;
  });
  let choice: "save" | "discard" | "cancel" = "cancel";
  let prompts = 0;
  registerDiscardPresenter(async () => {
    prompts++;
    return choice;
  });

  assert.equal(await confirmDiscardChanges(), true); // clean: no prompt
  assert.equal(prompts, 0);

  markClean("A");
  setSignatureProvider(() => "A");
  markDirty();
  assert.equal(await confirmDiscardChanges(), true); // false positive
  assert.equal(prompts, 0);

  setSignatureProvider(() => "B");
  markDirty();
  choice = "cancel";
  assert.equal(await confirmDiscardChanges(), false);
  choice = "discard";
  assert.equal(await confirmDiscardChanges(), true);
  assert.equal(saves, 0);
  choice = "save";
  saveOk = false;
  assert.equal(await confirmDiscardChanges(), false);
  saveOk = true;
  assert.equal(await confirmDiscardChanges(), true);
  assert.equal(saves, 2);

  registerDiscardPresenter(null);
  assert.equal(await confirmDiscardChanges(), false); // no UI: be safe
  registerSaveHandler(null);
  resetDocumentStateForTests();
});

