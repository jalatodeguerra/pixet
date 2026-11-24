import { useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Image as ImageIcon,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";

export function ReferencePanel() {
  const referenceImage = useEditorStore((s) => s.referenceImage);
  const setReferenceImage = useEditorStore((s) => s.setReferenceImage);
  const updateReferenceImage = useEditorStore((s) => s.updateReferenceImage);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLoadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        setStatusMessage(`Failed to read reference image ${file.name}`);
        return;
      }

      const img = new window.Image();
      img.onload = () => {
        setReferenceImage({
          dataUrl,
          width: Math.max(1, img.naturalWidth),
          height: Math.max(1, img.naturalHeight),
          visible: true,
          opacity: 50,
          scale: 100,
          offsetX: 0,
          offsetY: 0,
          behindCanvas: true,
          locked: true,
        });
        setOpen(true);
        setStatusMessage(
          `Loaded reference (${img.naturalWidth}×${img.naturalHeight})`
        );
      };
      img.onerror = () => {
        setStatusMessage(`Invalid image file ${file.name}`);
      };
      img.src = dataUrl;
    };
    reader.onerror = () => {
      setStatusMessage(`Failed to load ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  return (
    <section className="panel-section">
      <div className="panel-header">
        <button
          type="button"
          className="panel-collapse-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <ImageIcon size={11} />
          <span>Reference</span>
        </button>
        {referenceImage && (
          <span
            className="mono-value"
            style={{ fontSize: 10, color: "var(--text-muted)" }}
          >
            {referenceImage.width}×{referenceImage.height}
          </span>
        )}
      </div>

      {open && (
        <div className="panel-body">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleLoadFile}
          />

          <div className="draw-action-row">
            <button
              type="button"
              className="toggle-chip draw-chip-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={12} />
              <span>Load Reference</span>
            </button>
            <button
              type="button"
              className="toggle-chip draw-chip-btn"
              disabled={!referenceImage}
              onClick={() => setReferenceImage(null)}
            >
              <Trash2 size={12} />
              <span>Clear</span>
            </button>
          </div>

          {referenceImage && (
            <>
              <div className="draw-action-row">
                <button
                  type="button"
                  className={`toggle-chip draw-chip-btn ${referenceImage.visible ? "active" : ""}`}
                  onClick={() =>
                    updateReferenceImage({ visible: !referenceImage.visible })
                  }
                >
                  {referenceImage.visible ? (
                    <Eye size={12} />
                  ) : (
                    <EyeOff size={12} />
                  )}
                  <span>{referenceImage.visible ? "Visible" : "Hidden"}</span>
                </button>

                <button
                  type="button"
                  className={`toggle-chip draw-chip-btn ${referenceImage.behindCanvas ? "active" : ""}`}
                  onClick={() =>
                    updateReferenceImage({
                      behindCanvas: !referenceImage.behindCanvas,
                    })
                  }
                >
                  <span>
                    {referenceImage.behindCanvas
                      ? "Behind Canvas"
                      : "Over Canvas"}
                  </span>
                </button>
              </div>

              <div className="draw-slider-list">
                <label className="draw-slider-row">
                  <span>Opacity</span>
                  <input
                    type="range"
                    className="compact-range draw-range"
                    min={10}
                    max={100}
                    value={referenceImage.opacity}
                    onChange={(e) =>
                      updateReferenceImage({
                        opacity: Math.max(
                          10,
                          Math.min(100, Number(e.target.value))
                        ),
                      })
                    }
                  />
                  <span className="mono-value draw-val">
                    {referenceImage.opacity}%
                  </span>
                </label>

                <label className="draw-slider-row">
                  <span>Scale</span>
                  <input
                    type="range"
                    className="compact-range draw-range"
                    min={25}
                    max={400}
                    value={referenceImage.scale}
                    onChange={(e) =>
                      updateReferenceImage({
                        scale: Math.max(
                          25,
                          Math.min(400, Number(e.target.value))
                        ),
                      })
                    }
                  />
                  <span className="mono-value draw-val">
                    {referenceImage.scale}%
                  </span>
                </label>
              </div>

              <div className="draw-num-grid">
                <label className="draw-num-field">
                  <span>X</span>
                  <input
                    type="number"
                    className="draw-num-input"
                    value={referenceImage.offsetX}
                    onChange={(e) =>
                      updateReferenceImage({
                        offsetX: Number(e.target.value) || 0,
                      })
                    }
                  />
                </label>
                <label className="draw-num-field">
                  <span>Y</span>
                  <input
                    type="number"
                    className="draw-num-input"
                    value={referenceImage.offsetY}
                    onChange={(e) =>
                      updateReferenceImage({
                        offsetY: Number(e.target.value) || 0,
                      })
                    }
                  />
                </label>
              </div>

              <button
                type="button"
                className="toggle-chip draw-chip-btn"
                onClick={() =>
                  updateReferenceImage({
                    scale: 100,
                    offsetX: 0,
                    offsetY: 0,
                  })
                }
              >
                <RotateCcw size={12} />
                <span>Reset Position</span>
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
