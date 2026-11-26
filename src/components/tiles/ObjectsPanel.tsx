import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  deleteObject,
  type ObjectPatch,
  removeObjectProperty,
  renameObjectProperty,
  setObjectProperty,
  updateObject,
} from "../../engine/document/objectActions";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  isRectObject,
  parsePropertyValue,
} from "../../engine/tiles/objects";
import { useEditorStore } from "../../store/editorStore";
import { DockablePanelSection } from "../DockablePanelSection";

/** Text/number input that commits on blur or Enter (one undo step per edit). */
function CommitInput({
  value,
  onCommit,
  type = "text",
  title,
  placeholder,
  testId,
}: {
  value: string;
  onCommit: (v: string) => void;
  type?: "text" | "number";
  title?: string;
  placeholder?: string;
  testId?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      type={type}
      className="tiles-text-input"
      value={draft}
      title={title}
      placeholder={placeholder}
      data-testid={testId}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
        e.stopPropagation();
      }}
    />
  );
}

export function ObjectsPanel() {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const setSelectedObjectId = useEditorStore((s) => s.setSelectedObjectId);
  const addObjectLayer = useEditorStore((s) => s.addObjectLayer);
  const setTileTool = useEditorStore((s) => s.setTileTool);
  const [, setRev] = useState(0);
  useEffect(() => pixelEngine.subscribe(() => setRev((r) => r + 1)), []);

  const layer = layers.find((l) => l.id === activeLayerId);
  const isObjectLayer = layer?.kind === "object";
  const objects = isObjectLayer ? pixelEngine.getObjects(layer.id) : [];
  const selected = objects.find((o) => o.id === selectedObjectId) ?? null;

  const num = (v: string): number => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : 0;
  };

  const patch = (p: ObjectPatch) => {
    if (layer && selected) updateObject(layer.id, selected.id, p);
  };

  return (
    <DockablePanelSection
      id="tiles-objects"
      title={isObjectLayer ? `Objects (${objects.length})` : "Objects"}
      actions={
        <button
          type="button"
          className="icon-action-btn"
          style={{ width: 22, height: 22 }}
          title="New Object Layer"
          onClick={() => {
            addObjectLayer();
            setTileTool("object");
          }}
        >
          <Plus size={12} />
        </button>
      }
    >
      {!isObjectLayer ? (
        <div className="mode-hint">
          Select an Object layer (or click + to add one), then use the Object
          tool (O) to place points and rects.
        </div>
      ) : (
        <>
          {objects.length === 0 && (
            <div className="mode-hint">
              Object tool (O): click for a point, drag for a rect.
            </div>
          )}
          <div className="tiles-object-list">
            {objects.map((o) => (
              <div
                key={o.id}
                className={`tiles-layer-row ${o.id === selectedObjectId ? "active" : ""}`}
                onClick={() => setSelectedObjectId(o.id)}
              >
                <span className="tiles-layer-name">
                  {o.name || "(unnamed)"}
                  {o.type ? ` [${o.type}]` : ""}
                </span>
                <span className="mono-value" style={{ fontSize: 10 }}>
                  {isRectObject(o) ? "rect" : "point"}
                </span>
              </div>
            ))}
          </div>

          {selected && layer && (
            <div data-testid="object-editor">
              <div className="tiles-prop-row" style={{ marginTop: 6 }}>
                <span className="tiles-prop-label">Name</span>
                <CommitInput
                  value={selected.name}
                  testId="object-name"
                  onCommit={(v) => patch({ name: v })}
                />
              </div>
              <div className="tiles-prop-row">
                <span className="tiles-prop-label">Type</span>
                <CommitInput
                  value={selected.type}
                  testId="object-type"
                  placeholder="e.g. spawn, door"
                  onCommit={(v) => patch({ type: v })}
                />
              </div>
              <div className="tiles-object-grid">
                <label>
                  x
                  <CommitInput
                    type="number"
                    value={String(selected.x)}
                    onCommit={(v) => patch({ x: num(v) })}
                  />
                </label>
                <label>
                  y
                  <CommitInput
                    type="number"
                    value={String(selected.y)}
                    onCommit={(v) => patch({ y: num(v) })}
                  />
                </label>
                {isRectObject(selected) && (
                  <>
                    <label>
                      w
                      <CommitInput
                        type="number"
                        value={String(selected.w)}
                        onCommit={(v) => patch({ w: Math.max(1, num(v)) })}
                      />
                    </label>
                    <label>
                      h
                      <CommitInput
                        type="number"
                        value={String(selected.h)}
                        onCommit={(v) => patch({ h: Math.max(1, num(v)) })}
                      />
                    </label>
                  </>
                )}
              </div>

              <div className="tiles-anim-row">
                <span className="tiles-prop-label">
                  Props ({Object.keys(selected.properties).length})
                </span>
                <button
                  type="button"
                  className="mini-btn"
                  style={{ fontSize: 10 }}
                  onClick={() => {
                    let n = 1;
                    while (`prop${n}` in selected.properties) n++;
                    setObjectProperty(layer.id, selected.id, `prop${n}`, "");
                  }}
                >
                  <Plus size={10} />
                  <span>Property</span>
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  style={{ fontSize: 10, marginLeft: "auto" }}
                  title="Delete object (Del)"
                  onClick={() => deleteObject(layer.id, selected.id)}
                >
                  <Trash2 size={10} />
                  <span>Delete</span>
                </button>
              </div>
              {Object.entries(selected.properties).map(([k, v]) => (
                <div key={k} className="tiles-kv-row">
                  <CommitInput
                    value={k}
                    title="Key"
                    onCommit={(nk) =>
                      renameObjectProperty(layer.id, selected.id, k, nk.trim())
                    }
                  />
                  <CommitInput
                    value={String(v)}
                    title="Value (true/false and numbers are typed)"
                    onCommit={(nv) =>
                      setObjectProperty(
                        layer.id,
                        selected.id,
                        k,
                        parsePropertyValue(nv)
                      )
                    }
                  />
                  <button
                    type="button"
                    className="icon-action-btn"
                    style={{ width: 20, height: 20 }}
                    onClick={() =>
                      removeObjectProperty(layer.id, selected.id, k)
                    }
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </DockablePanelSection>
  );
}
