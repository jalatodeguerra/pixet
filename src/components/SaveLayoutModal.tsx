import { useEffect, useRef, useState } from "react";
import { LayoutPanelLeft, X } from "lucide-react";
import {
  MAX_LAYOUT_NAME_LENGTH,
  normalizeLayoutName,
} from "../engine/ui/panelLayout";
import { useEditorStore } from "../store/editorStore";

export function SaveLayoutModal() {
  const open = useEditorStore((s) => s.saveLayoutModalOpen);
  const setOpen = useEditorStore((s) => s.setSaveLayoutModalOpen);
  const saveCurrentLayout = useEditorStore((s) => s.saveCurrentLayout);
  const savedLayouts = useEditorStore((s) => s.savedLayouts);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    inputRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  if (!open) return null;

  const clean = normalizeLayoutName(name);
  const overwrites = savedLayouts.some(
    (l) => l.name.toLowerCase() === clean.toLowerCase()
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clean) return;
    saveCurrentLayout(clean);
    setStatusMessage(`Saved layout "${clean}"`);
    setOpen(false);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="modal-card" role="dialog" aria-label="Save Layout">
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <LayoutPanelLeft size={14} />
            <span>Save Layout</span>
          </div>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => setOpen(false)}
          >
            <X size={13} />
          </button>
        </div>
        <form className="modal-body" onSubmit={submit}>
          <label className="modal-field">
            <span>Layout Name</span>
            <input
              ref={inputRef}
              type="text"
              className="palette-select"
              maxLength={MAX_LAYOUT_NAME_LENGTH}
              placeholder="e.g. Animation"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Saves panel positions, dock sides, hidden panels and panel sizes.
            {overwrites && " A layout with this name will be replaced."}
          </div>
          <div className="modal-footer">
            <button type="button" className="mini-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="export-cta" disabled={!clean}>
              <span>{overwrites ? "Replace Layout" : "Save Layout"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
