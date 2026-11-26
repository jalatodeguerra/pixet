import { useEffect, useState } from "react";
import { FilePlus2, X } from "lucide-react";
import { createNewDocument } from "../engine/io/newDocument";
import { confirmDiscardChanges } from "../engine/io/unsavedChanges";
import { useEditorStore } from "../store/editorStore";

type BgFill = "transparent" | "secondary" | "white";

const SIZE_PRESETS = [16, 32, 64, 128, 256];

export function NewSpriteModal() {
  const open = useEditorStore((s) => s.newSpriteModalOpen);
  const setOpen = useEditorStore((s) => s.setNewSpriteModalOpen);

  const [name, setName] = useState("untitled.pixet");
  const [width, setWidth] = useState(32);
  const [height, setHeight] = useState(32);
  const [colorMode, setColorMode] = useState<"RGBA" | "Indexed">("RGBA");
  const [bgFill, setBgFill] = useState<BgFill>("transparent");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(await confirmDiscardChanges())) return;
    createNewDocument({
      name,
      width,
      height,
      colorMode,
      background: bgFill,
    });
    setOpen(false);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="modal-card" role="dialog" aria-label="New Sprite">
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FilePlus2 size={14} />
            <span>New Sprite</span>
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

        <form className="modal-body" onSubmit={handleSubmit}>
          <label className="modal-field">
            <span>File Name</span>
            <input
              type="text"
              className="palette-select"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <div className="modal-grid-2">
            <label className="modal-field">
              <span>Width (px)</span>
              <input
                type="number"
                min={1}
                max={1024}
                className="palette-select"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </label>
            <label className="modal-field">
              <span>Height (px)</span>
              <input
                type="number"
                min={1}
                max={1024}
                className="palette-select"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="rotate3d-presets">
            {SIZE_PRESETS.map((sz) => (
              <button
                key={sz}
                type="button"
                className={`mini-btn ${width === sz && height === sz ? "active" : ""}`}
                onClick={() => {
                  setWidth(sz);
                  setHeight(sz);
                }}
              >
                {sz}×{sz}
              </button>
            ))}
          </div>

          <div className="modal-grid-2">
            <label className="modal-field">
              <span>Color Mode</span>
              <select
                className="palette-select"
                value={colorMode}
                onChange={(e) =>
                  setColorMode(e.target.value as "RGBA" | "Indexed")
                }
              >
                <option value="RGBA">RGBA (Full Color)</option>
                <option value="Indexed">Indexed (Palette)</option>
              </select>
            </label>

            <label className="modal-field">
              <span>Background</span>
              <select
                className="palette-select"
                value={bgFill}
                onChange={(e) => setBgFill(e.target.value as BgFill)}
              >
                <option value="transparent">Transparent</option>
                <option value="secondary">Secondary Color</option>
                <option value="white">White</option>
              </select>
            </label>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="mini-btn"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="export-cta">
              <FilePlus2 size={13} />
              <span>Create Sprite</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
