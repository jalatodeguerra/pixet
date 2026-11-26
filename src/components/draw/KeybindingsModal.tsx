import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Keyboard, RotateCcw, X } from "lucide-react";
import {
  commandRegistry,
  describeChordScope,
  type CommandDef,
} from "../../engine/config/commands";
import {
  formatChordForDisplay,
  formatEventToChord,
} from "../../engine/config/keybindings";
import { useEditorStore } from "../../store/editorStore";
import { ensureCommandsRegistered } from "../commands/appCommands";

export function KeybindingsModal() {
  const open = useEditorStore((s) => s.keybindingsModalOpen);
  const setOpen = useEditorStore((s) => s.setKeybindingsModalOpen);
  const keybindings = useEditorStore((s) => s.keybindings);
  const setKeybinding = useEditorStore((s) => s.setKeybinding);
  const applyKeybindingPreset = useEditorStore((s) => s.applyKeybindingPreset);
  const importKeybindingsJson = useEditorStore((s) => s.importKeybindingsJson);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setRecordingId(null);
      setShowJson(false);
      setJsonError(null);
      return;
    }
    setSearchQuery("");
    setJsonText(JSON.stringify(keybindings, null, 2));
  }, [open]);

  useEffect(() => {
    if (showJson) {
      setJsonText(JSON.stringify(keybindings, null, 2));
    }
  }, [keybindings, showJson]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (recordingId) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          setRecordingId(null);
          return;
        }
        if (e.key === "Backspace" || e.key === "Delete") {
          setKeybinding(recordingId, "");
          setRecordingId(null);
          return;
        }
        const chord = formatEventToChord(e);
        if (!chord) return;
        setKeybinding(recordingId, chord);
        setRecordingId(null);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, recordingId, setKeybinding, setOpen]);

  ensureCommandsRegistered();

  // Conflicts are per workspace scope: the same chord in two different
  // workspaces is fine, the same chord twice in one workspace is not.
  const conflicts = useMemo(
    () => commandRegistry.findConflicts(keybindings),
    [keybindings]
  );

  const conflictActionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conflicts) {
      for (const id of c.commandIds) ids.add(id);
    }
    return ids;
  }, [conflicts]);

  const groupedActions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const all = commandRegistry.all().filter((a) => {
      if (!q) return true;
      const chord = commandRegistry.displayChord(a, keybindings);
      return (
        a.title.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        chord.toLowerCase().includes(q)
      );
    });
    const order: string[] = [];
    const byCat = new Map<string, CommandDef[]>();
    for (const a of all) {
      const list = byCat.get(a.category);
      if (list) list.push(a);
      else {
        byCat.set(a.category, [a]);
        order.push(a.category);
      }
    }
    return order.map((category) => ({
      category,
      items: byCat.get(category) ?? [],
    }));
  }, [searchQuery, keybindings]);

  if (!open) return null;

  const handleImport = () => {
    const ok = importKeybindingsJson(jsonText);
    if (!ok) {
      setJsonError("Invalid JSON keybindings object.");
      return;
    }
    setJsonError(null);
    setStatusMessage("Imported custom keybindings");
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="modal-card draw-keybinds-modal-card"
        role="dialog"
        aria-label="Customizable Keybindings"
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Keyboard size={14} />
            <span>Keybindings</span>
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

        <div className="modal-body">
          <div className="draw-keybinds-toolbar">
            <input
              type="text"
              className="draw-keybinds-search"
              placeholder="Filter actions or chords..."
              aria-label="Filter keybindings"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              type="button"
              className="mini-btn"
              onClick={() => {
                applyKeybindingPreset("pixet");
                setRecordingId(null);
                setStatusMessage("Applied Pixet Default keybindings");
              }}
            >
              <RotateCcw size={11} />
              <span>Pixet Default</span>
            </button>
            <button
              type="button"
              className="mini-btn"
              onClick={() => {
                applyKeybindingPreset("aseprite");
                setRecordingId(null);
                setStatusMessage("Applied Aseprite keybinding preset");
              }}
            >
              <span>Aseprite</span>
            </button>
            <button
              type="button"
              className={`toggle-chip ${showJson ? "active" : ""}`}
              onClick={() => {
                setShowJson((v) => !v);
                setJsonError(null);
              }}
            >
              <span>JSON</span>
            </button>
          </div>

          {conflicts.length > 0 && (
            <div className="draw-keybinds-conflict-banner" role="alert">
              <AlertTriangle size={12} />
              <span>
                {conflicts.length} shortcut conflict
                {conflicts.length === 1 ? "" : "s"}:{" "}
                {conflicts
                  .map(
                    (c) =>
                      `${formatChordForDisplay(c.chord)} (${c.commandIds.length})`
                  )
                  .join(", ")}
              </span>
            </div>
          )}

          {showJson && (
            <div className="draw-keybinds-json-box">
              <textarea
                className="draw-keybinds-json-area"
                aria-label="Keybindings JSON"
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setJsonError(null);
                }}
                rows={7}
              />
              <div className="draw-keybinds-json-actions">
                {jsonError ? (
                  <span className="draw-keybinds-json-err">{jsonError}</span>
                ) : (
                  <span className="draw-keybinds-hint">
                    Copy to export or paste JSON and click Import.
                  </span>
                )}
                <button
                  type="button"
                  className="mini-btn"
                  onClick={handleImport}
                >
                  Import JSON
                </button>
              </div>
            </div>
          )}

          <div className="draw-keybinds-list">
            {groupedActions.map((group) => (
              <div key={group.category} role="group" aria-label={group.category}>
                <div className="draw-keybinds-group">{group.category}</div>
                {group.items.map((act) => {
                  const chord = commandRegistry.effectiveChord(act, keybindings);
                  const display = commandRegistry.displayChord(act, keybindings);
                  const fixedOnly = !chord && display !== "";
                  const isRecording = recordingId === act.id;
                  const hasConflict = conflictActionIds.has(act.id);
                  return (
                    <div
                      key={act.id}
                      className={`draw-keybinds-row ${hasConflict ? "conflict" : ""}`}
                    >
                      <div className="draw-keybinds-meta">
                        <span className="draw-keybinds-cat">
                          {describeChordScope(act)}
                        </span>
                        <span className="draw-keybinds-label">{act.title}</span>
                      </div>
                      <div className="draw-keybinds-controls">
                        {hasConflict && (
                          <span
                            className="draw-keybinds-conflict-badge"
                            title="Shortcut conflict in this workspace"
                          >
                            Conflict
                          </span>
                        )}
                        <button
                          type="button"
                          className={`draw-keybinds-chord-btn ${isRecording ? "recording" : ""}`}
                          title="Click then press shortcut (Backspace to clear, Esc to cancel)"
                          onClick={() =>
                            setRecordingId(isRecording ? null : act.id)
                          }
                        >
                          {isRecording
                            ? "Press key..."
                            : chord
                              ? formatChordForDisplay(chord)
                              : fixedOnly
                                ? `${display} (fixed)`
                                : "Unbound"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="modal-footer">
            <span className="draw-keybinds-hint" style={{ marginRight: "auto" }}>
              Click a shortcut to rebind · Backspace clears · Esc cancels
            </span>
            <button
              type="button"
              className="mini-btn"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
