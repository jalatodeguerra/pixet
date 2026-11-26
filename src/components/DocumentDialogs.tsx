import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import {
  discardRecovery,
  findRecoverableWork,
  recoverWork,
} from "../engine/io/documentLifecycle";
import { formatRelativeTime, type RecoveryEntry } from "../engine/io/recovery";
import {
  type DiscardChoice,
  registerDiscardPresenter,
} from "../engine/io/unsavedChanges";
import { useEditorStore } from "../store/editorStore";

interface PendingPrompt {
  resolve: (choice: DiscardChoice) => void;
}

/** Unsaved-changes prompt and launch-time crash-recovery prompt. */
export function DocumentDialogs() {
  const documentName = useEditorStore((s) => s.documentName);
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null);
  const [recovery, setRecovery] = useState<RecoveryEntry | null>(null);
  const promptRef = useRef<PendingPrompt | null>(null);

  useEffect(() => {
    registerDiscardPresenter(
      () =>
        new Promise<DiscardChoice>((resolve) => {
          const next = { resolve };
          promptRef.current = next;
          setPrompt(next);
        })
    );
    return () => registerDiscardPresenter(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void findRecoverableWork().then((entry) => {
      if (!cancelled && entry) setRecovery(entry);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const answer = useCallback((choice: DiscardChoice) => {
    const current = promptRef.current;
    promptRef.current = null;
    setPrompt(null);
    current?.resolve(choice);
  }, []);

  const recover = useCallback(() => {
    if (!recovery) return;
    const ok = recoverWork(recovery);
    if (!ok) void discardRecovery();
    setRecovery(null);
  }, [recovery]);

  const discard = useCallback(() => {
    void discardRecovery();
    setRecovery(null);
  }, []);

  useEffect(() => {
    if (!prompt && !recovery) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (prompt) answer("cancel");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [prompt, recovery, answer]);

  if (prompt) {
    return (
      <div className="modal-backdrop doc-dialog-backdrop">
        <div
          className="modal-card doc-dialog-card"
          role="alertdialog"
          aria-label="Unsaved changes"
        >
          <div className="modal-header">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} />
              <span>Unsaved Changes</span>
            </div>
          </div>
          <div className="modal-body">
            <p className="doc-dialog-text">Save changes to {documentName}?</p>
            <p className="doc-dialog-hint">
              Your changes will be lost if you don&apos;t save them.
            </p>
            <div className="modal-footer">
              <button
                type="button"
                className="mini-btn"
                onClick={() => answer("cancel")}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mini-btn"
                onClick={() => answer("discard")}
              >
                Don&apos;t Save
              </button>
              <button
                type="button"
                className="export-cta"
                autoFocus
                onClick={() => answer("save")}
              >
                <span>Save</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (recovery) {
    return (
      <div className="modal-backdrop doc-dialog-backdrop">
        <div
          className="modal-card doc-dialog-card"
          role="alertdialog"
          aria-label="Recover unsaved work"
        >
          <div className="modal-header">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <RotateCcw size={14} />
              <span>Recover Unsaved Work?</span>
            </div>
          </div>
          <div className="modal-body">
            <p className="doc-dialog-text">{recovery.documentName}</p>
            <p className="doc-dialog-hint">
              Autosaved {formatRelativeTime(recovery.savedAt)}
            </p>
            <div className="modal-footer">
              <button type="button" className="mini-btn" onClick={discard}>
                Discard
              </button>
              <button
                type="button"
                className="export-cta"
                autoFocus
                onClick={recover}
              >
                <span>Recover</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
