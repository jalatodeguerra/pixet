import { useEffect, useState } from "react";
import {
  Clock,
  FilePlus2,
  FolderOpen,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { SAMPLES } from "../engine/document/samples";
import { loadSampleDocument, createNewDocument } from "../engine/io/newDocument";
import {
  isTauriRuntime,
  openProjectAction,
  openProjectFromPath,
} from "../engine/io/projectBridge";
import {
  loadRecentFiles,
  loadShowOnStartup,
  saveShowOnStartup,
} from "../engine/io/recentFiles";
import { confirmDiscardChanges } from "../engine/io/unsavedChanges";
import { useEditorStore } from "../store/editorStore";

interface Preset {
  id: string;
  label: string;
  hint: string;
  name: string;
  width: number;
  height: number;
}

const PRESETS: Preset[] = [
  { id: "char32", label: "Character 32×32", hint: "Small hero or enemy", name: "character-32", width: 32, height: 32 },
  { id: "char64", label: "Character 64×64", hint: "Detailed character", name: "character-64", width: 64, height: 64 },
  { id: "tile16", label: "Tile 16×16", hint: "Tileset building block", name: "tile-16", width: 16, height: 16 },
];

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : "";
}

function keyLabel(map: Record<string, string>, id: string, fallback: string): string {
  const v = map[id];
  return (v && v.length > 0 ? v : fallback)
    .split("+")
    .map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join("+");
}

/** Launch / welcome overlay: new sprite presets, open, recents, samples, quick start. */
export function StartScreen() {
  const open = useEditorStore((s) => s.startScreenOpen);
  const setOpen = useEditorStore((s) => s.setStartScreenOpen);
  const setNewSpriteModalOpen = useEditorStore((s) => s.setNewSpriteModalOpen);
  const keybindings = useEditorStore((s) => s.keybindings);

  const [showOnStartup, setShowOnStartup] = useState(loadShowOnStartup);
  const [recent, setRecent] = useState<string[]>([]);
  const desktop = isTauriRuntime();

  useEffect(() => {
    if (!open) return;
    setShowOnStartup(loadShowOnStartup());
    setRecent(desktop ? loadRecentFiles() : []);
  }, [open, desktop]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (useEditorStore.getState().newSpriteModalOpen) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  if (!open) return null;

  const close = () => setOpen(false);

  const startPreset = async (p: Preset) => {
    if (!(await confirmDiscardChanges())) return;
    createNewDocument({
      name: p.name,
      width: p.width,
      height: p.height,
      colorMode: "RGBA",
      background: "transparent",
    });
    close();
  };

  const startSample = async (id: string) => {
    const entry = SAMPLES.find((s) => s.id === id);
    if (!entry) return;
    if (!(await confirmDiscardChanges())) return;
    loadSampleDocument(entry.generate());
    close();
  };

  const openRecent = async (path: string) => {
    if (await openProjectFromPath(path)) {
      close();
    } else {
      setRecent(loadRecentFiles());
    }
  };

  const pencil = keyLabel(keybindings, "tool.pencil", "b");
  const eraser = keyLabel(keybindings, "tool.eraser", "e");
  const bucket = keyLabel(keybindings, "tool.fill", "g");

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-card start-card" role="dialog" aria-label="Welcome to Pixet">
        <div className="modal-header">
          <div className="start-title">
            <Sparkles size={14} />
            <span>Welcome to Pixet</span>
          </div>
          <button
            type="button"
            className="icon-action-btn start-close"
            aria-label="Close welcome screen"
            title="Close (Esc)"
            onClick={close}
          >
            <X size={13} />
          </button>
        </div>

        <div className="start-body">
          <div className="start-columns">
            <section className="start-col" aria-label="New sprite">
              <h3 className="start-heading">New sprite</h3>
              <div className="start-list">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="start-item"
                    onClick={() => void startPreset(p)}
                  >
                    <FilePlus2 size={13} />
                    <span className="start-item-main">
                      <span className="start-item-label">{p.label}</span>
                      <span className="start-item-hint">{p.hint}</span>
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="start-item"
                  onClick={() => {
                    close();
                    setNewSpriteModalOpen(true);
                  }}
                >
                  <FilePlus2 size={13} />
                  <span className="start-item-main">
                    <span className="start-item-label">Custom…</span>
                    <span className="start-item-hint">Choose size, color mode, background</span>
                  </span>
                </button>
              </div>

              <h3 className="start-heading">Open</h3>
              <div className="start-list">
                <button
                  type="button"
                  className="start-item"
                  onClick={() => {
                    close();
                    void openProjectAction();
                  }}
                >
                  <FolderOpen size={13} />
                  <span className="start-item-main">
                    <span className="start-item-label">Open…</span>
                    <span className="start-item-hint">
                      {desktop ? "A .pixet project" : "A .pixet.json project"}
                    </span>
                  </span>
                </button>
              </div>
            </section>

            <section className="start-col" aria-label="Samples and recent files">
              <h3 className="start-heading">Samples</h3>
              <div className="start-list">
                {SAMPLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="start-item"
                    onClick={() => void startSample(s.id)}
                  >
                    <Play size={13} />
                    <span className="start-item-main">
                      <span className="start-item-label">{s.label}</span>
                      <span className="start-item-hint">{s.description}</span>
                    </span>
                  </button>
                ))}
              </div>

              {desktop && (
                <>
                  <h3 className="start-heading">Recent</h3>
                  <div className="start-list">
                    {recent.length === 0 && (
                      <span className="start-empty">No recent files yet</span>
                    )}
                    {recent.map((path) => (
                      <button
                        key={path}
                        type="button"
                        className="start-item"
                        title={path}
                        onClick={() => void openRecent(path)}
                      >
                        <Clock size={13} />
                        <span className="start-item-main">
                          <span className="start-item-label">{basename(path)}</span>
                          <span className="start-item-hint">{dirname(path)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

          <div className="start-quick" aria-label="Quick start">
            <div className="start-step">
              <span className="start-step-num">1</span>
              <div>
                <strong>Draw</strong>
                <p>
                  <kbd>{pencil}</kbd> pencil, <kbd>{eraser}</kbd> eraser,{" "}
                  <kbd>{bucket}</kbd> paint bucket.
                </p>
              </div>
            </div>
            <div className="start-step">
              <span className="start-step-num">2</span>
              <div>
                <strong>Animate</strong>
                <p>
                  Add frames in the timeline, tag them with <em>+ Tag</em>, press{" "}
                  <kbd>Enter</kbd> to play.
                </p>
              </div>
            </div>
            <div className="start-step">
              <span className="start-step-num">3</span>
              <div>
                <strong>Export to Godot</strong>
                <p>
                  File › Export Spritesheet…, then choose{" "}
                  <em>Godot 4 SpriteFrames</em>.
                </p>
              </div>
            </div>
          </div>

          <div className="start-footer">
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={showOnStartup}
                onChange={(e) => {
                  setShowOnStartup(e.target.checked);
                  saveShowOnStartup(e.target.checked);
                }}
              />
              <span>Show on startup</span>
            </label>
            <button type="button" className="mini-btn" onClick={close}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
