import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { commandRegistry, type CommandDef } from "../engine/config/commands";
import {
  fuzzyMatchCommands,
  type CommandEntry,
} from "../engine/tools/commandMatcher";
import { useEditorStore } from "../store/editorStore";
import {
  currentCommandContext,
  ensureCommandsRegistered,
} from "./commands/appCommands";

interface ActionCommandEntry extends CommandEntry {
  run: () => void;
}

type PaletteRow =
  | { kind: "header"; category: string }
  | { kind: "item"; cmd: ActionCommandEntry; index: number };

/** Commands usable in the current workspace (plus global ones), with chords. */
function collectCommands(): ActionCommandEntry[] {
  ensureCommandsRegistered();
  const ctx = currentCommandContext();
  const overrides = useEditorStore.getState().keybindings;
  return commandRegistry
    .forContext(ctx)
    .filter((c: CommandDef) => commandRegistry.isEnabled(c))
    .map((c) => ({
      id: c.id,
      label: c.title,
      category: c.category,
      shortcut: commandRegistry.displayChordIn(c, overrides, ctx) || undefined,
      keywords: c.keywords ? [...c.keywords] : undefined,
      run: c.run,
    }));
}

export function CommandPalette() {
  const open = useEditorStore((s) => s.commandPaletteOpen);
  const setOpen = useEditorStore((s) => s.setCommandPaletteOpen);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const tilesMode = useEditorStore((s) => s.tilesMode);
  const keybindings = useEditorStore((s) => s.keybindings);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Recomputed on open and whenever the workspace or bindings change, so the
  // list always matches what is available right now.
  const commands = useMemo<ActionCommandEntry[]>(
    () => (open ? collectCommands() : []),
    [open, workspaceMode, tilesMode, keybindings]
  );

  const results = useMemo(
    () => fuzzyMatchCommands(query, commands),
    [query, commands]
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [open]);

  // With no query the list is grouped by category; with a query it stays in
  // relevance order (each row still shows its category).
  const rows = useMemo<PaletteRow[]>(() => {
    if (query.trim().length > 0) {
      return results.map((cmd, index) => ({ kind: "item", cmd, index }));
    }
    const order: string[] = [];
    const byCategory = new Map<string, ActionCommandEntry[]>();
    for (const cmd of results) {
      const cat = cmd.category ?? "Other";
      const list = byCategory.get(cat);
      if (list) list.push(cmd);
      else {
        byCategory.set(cat, [cmd]);
        order.push(cat);
      }
    }
    const out: PaletteRow[] = [];
    for (const cat of order) {
      out.push({ kind: "header", category: cat });
      for (const cmd of byCategory.get(cat) ?? []) {
        out.push({ kind: "item", cmd, index: -1 });
      }
    }
    return out;
  }, [results, query]);

  // Grouped order differs from `results` order, so navigate the visible order.
  const visible = useMemo(
    () =>
      rows
        .filter((r): r is Extract<PaletteRow, { kind: "item" }> => r.kind === "item")
        .map((r) => r.cmd),
    [rows]
  );

  useEffect(() => {
    setSelectedIndex((prev) => {
      if (visible.length === 0) return 0;
      return Math.max(0, Math.min(visible.length - 1, prev));
    });
  }, [visible.length]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(
      '[aria-selected="true"]'
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  if (!open) return null;

  const execute = (cmd: ActionCommandEntry | undefined) => {
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (visible.length > 0) {
        setSelectedIndex((i) => (i + 1) % visible.length);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (visible.length > 0) {
        setSelectedIndex((i) => (i - 1 + visible.length) % visible.length);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      execute(visible[selectedIndex]);
    }
  };

  return (
    <div
      className="modal-backdrop draw-cmd-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="draw-cmd-modal"
        role="dialog"
        aria-label="Command Palette"
      >
        <div className="draw-cmd-search-row">
          <Search size={14} className="draw-cmd-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="draw-cmd-input"
            placeholder="Type a command, tool, or view check..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => setOpen(false)}
            title="Close (Esc)"
          >
            <X size={13} />
          </button>
        </div>

        <div ref={listRef} className="draw-cmd-list" role="listbox">
          {visible.length === 0 ? (
            <div className="draw-cmd-empty">No matching commands</div>
          ) : (
            rows.map((row) => {
              if (row.kind === "header") {
                return (
                  <div key={`h-${row.category}`} className="draw-cmd-group">
                    {row.category}
                  </div>
                );
              }
              const cmd = row.cmd;
              const idx = visible.indexOf(cmd);
              const active = idx === selectedIndex;
              return (
                <button
                  key={cmd.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`draw-cmd-item ${active ? "active" : ""}`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => execute(cmd)}
                >
                  <span className="draw-cmd-item-main">
                    {cmd.category && (
                      <span className="draw-cmd-category">{cmd.category}</span>
                    )}
                    <span className="draw-cmd-label">{cmd.label}</span>
                  </span>
                  {cmd.shortcut && (
                    <span className="draw-cmd-shortcut">{cmd.shortcut}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
