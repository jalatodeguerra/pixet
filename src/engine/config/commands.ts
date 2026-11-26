import {
  formatChordForDisplay,
  normalizeChordString,
  type KeybindingMap,
} from "./keybindings.ts";

/**
 * React-free command registry. One list of commands drives the Command
 * Palette, the rebindable Keybindings modal and the global keydown handler.
 */

export type CommandWorkspace =
  | "draw"
  | "tiles"
  | "rig"
  | "studio3d"
  | "nodes"
  | "data";

/**
 * Where a command is available. "tiles.map" / "tiles.tile" narrow "tiles" to
 * one Tiles sub-mode (their keys differ: the map tools replace draw tools).
 */
export type CommandScope =
  | "global"
  | CommandWorkspace
  | "tiles.map"
  | "tiles.tile";

export interface CommandContext {
  workspace: CommandWorkspace;
  /** Tiles sub-mode, only meaningful while workspace === "tiles". */
  tilesMode?: "map" | "tile";
}

export interface CommandDef {
  id: string;
  /** Palette / modal title. */
  title: string;
  category: string;
  /** Palette availability (and chord availability unless `chordScope`). */
  scope: CommandScope | readonly CommandScope[];
  /** Where the chord is active when that differs from `scope`. */
  chordScope?: CommandScope | readonly CommandScope[];
  /** Default rebindable chord, e.g. "ctrl+shift+a". */
  chord?: string;
  /** Extra fixed chords that also trigger the command (not rebindable). */
  aliases?: readonly string[];
  /** Display-only chord for hard-coded shortcuts that are not rebindable. */
  hint?: string;
  keywords?: readonly string[];
  /** Enablement; omitted means always enabled. */
  when?: () => boolean;
  run: () => void;
}

function toList(
  s: CommandScope | readonly CommandScope[]
): readonly CommandScope[] {
  return typeof s === "string" ? [s] : s;
}

const SCOPE_LABELS: Record<CommandScope, string> = {
  global: "Global",
  draw: "Draw",
  tiles: "Tiles",
  "tiles.map": "Tiles Map",
  "tiles.tile": "Tiles Tile",
  rig: "Rig",
  studio3d: "3D Studio",
  nodes: "Nodes",
  data: "Data",
};

/** Short human label for where a command's chord is active. */
export function describeChordScope(def: CommandDef): string {
  const list = toList(def.chordScope ?? def.scope);
  if (list.length >= 4) return "Most workspaces";
  return list.map((s) => SCOPE_LABELS[s]).join(", ");
}

/** Scopes that are currently active for a context (most specific last). */
export function contextScopes(ctx: CommandContext): CommandScope[] {
  const out: CommandScope[] = ["global", ctx.workspace];
  if (ctx.workspace === "tiles") {
    out.push(ctx.tilesMode === "tile" ? "tiles.tile" : "tiles.map");
  }
  return out;
}

export function scopeMatchesContext(
  scope: CommandScope | readonly CommandScope[],
  ctx: CommandContext
): boolean {
  const active = contextScopes(ctx);
  return toList(scope).some((s) => active.includes(s));
}

function entriesOverlap(a: CommandScope, b: CommandScope): boolean {
  if (a === b) return true;
  if (a === "global" || b === "global") return true;
  if (a === "tiles" && (b === "tiles.map" || b === "tiles.tile")) return true;
  if (b === "tiles" && (a === "tiles.map" || a === "tiles.tile")) return true;
  return false;
}

export function scopesOverlap(
  a: CommandScope | readonly CommandScope[],
  b: CommandScope | readonly CommandScope[]
): boolean {
  for (const x of toList(a)) {
    for (const y of toList(b)) {
      if (entriesOverlap(x, y)) return true;
    }
  }
  return false;
}

function specificity(scope: CommandScope | readonly CommandScope[]): number {
  const list = toList(scope);
  if (list.includes("global") && list.length === 1) return 0;
  return list.some((s) => s.includes(".")) ? 2 : 1;
}

/**
 * Renamed command ids. Stored keybinding overrides under an old id move to
 * the new one on load so users keep their custom chords.
 */
export const LEGACY_COMMAND_IDS: Readonly<Record<string, string>> = {
  // The palette and the keybinding list used two ids for the same action.
  "sprite.mergeDown": "layer.mergeDown",
};

/** Moves overrides stored under legacy ids to current ids (explicit wins). */
export function migrateKeybindingIds(
  map: Readonly<Record<string, string>>,
  legacy: Readonly<Record<string, string>> = LEGACY_COMMAND_IDS
): KeybindingMap {
  const out: KeybindingMap = {};
  for (const [id, chord] of Object.entries(map)) {
    if (!(id in legacy)) out[id] = chord;
  }
  for (const [id, chord] of Object.entries(map)) {
    const target = legacy[id];
    if (target !== undefined && !(target in out)) out[target] = chord;
  }
  return out;
}

export interface CommandConflict {
  chord: string;
  commandIds: string[];
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDef>();

  /** Registers (or replaces) a command. Order is palette order. */
  register(def: CommandDef): void {
    this.commands.set(def.id, def);
  }

  registerAll(defs: readonly CommandDef[]): void {
    for (const d of defs) this.register(d);
  }

  clear(): void {
    this.commands.clear();
  }

  get size(): number {
    return this.commands.size;
  }

  get(id: string): CommandDef | undefined {
    return this.commands.get(id);
  }

  all(): CommandDef[] {
    return [...this.commands.values()];
  }

  isEnabled(def: CommandDef): boolean {
    return def.when ? def.when() : true;
  }

  /**
   * Chord currently bound to a command: a stored override (including the
   * explicit empty string for "unbound") wins over the default chord.
   */
  effectiveChord(def: CommandDef, overrides: Readonly<Record<string, string>>): string {
    const own = overrides[def.id];
    const raw = own !== undefined ? own : def.chord ?? "";
    return normalizeChordString(raw);
  }

  /** Chord text for palette/modal display ("Ctrl+B", or the fixed hint). */
  displayChord(def: CommandDef, overrides: Readonly<Record<string, string>>): string {
    const chord = this.effectiveChord(def, overrides);
    if (chord) return formatChordForDisplay(chord);
    return def.hint ?? "";
  }

  /**
   * Like displayChord, but blank when the chord would not fire in `ctx`
   * (e.g. the Draw "B" chord while the Rig workspace is open).
   */
  displayChordIn(
    def: CommandDef,
    overrides: Readonly<Record<string, string>>,
    ctx: CommandContext
  ): string {
    const chord = this.effectiveChord(def, overrides);
    if (chord) {
      return scopeMatchesContext(def.chordScope ?? def.scope, ctx)
        ? formatChordForDisplay(chord)
        : "";
    }
    return def.hint ?? "";
  }

  /**
   * Commands shown in the palette for a workspace: its own plus global ones.
   * Workspace-specific commands come first.
   */
  forContext(ctx: CommandContext): CommandDef[] {
    const all = this.all().filter((c) => scopeMatchesContext(c.scope, ctx));
    const isGlobal = (c: CommandDef) => specificity(c.scope) === 0;
    return [...all.filter((c) => !isGlobal(c)), ...all.filter(isGlobal)];
  }

  /**
   * Finds the command a chord triggers in a context. More specific scopes win
   * over global ones; among equals an enabled command wins.
   * `looseShift` retries without Shift, matching the old single-letter tool
   * maps where Shift+key behaved like the plain key.
   */
  resolve(
    chord: string,
    ctx: CommandContext,
    overrides: Readonly<Record<string, string>>,
    opts: { looseShift?: boolean } = {}
  ): CommandDef | null {
    const target = normalizeChordString(chord);
    if (!target) return null;
    const hit = this.resolveExact(target, ctx, overrides);
    if (hit) return hit;
    if (opts.looseShift && target.includes("shift+")) {
      const loose = normalizeChordString(target.replace("shift+", ""));
      if (loose) return this.resolveExact(loose, ctx, overrides);
    }
    return null;
  }

  private resolveExact(
    target: string,
    ctx: CommandContext,
    overrides: Readonly<Record<string, string>>
  ): CommandDef | null {
    const matches: CommandDef[] = [];
    for (const def of this.commands.values()) {
      const scope = def.chordScope ?? def.scope;
      if (!scopeMatchesContext(scope, ctx)) continue;
      const bound = this.effectiveChord(def, overrides);
      const isAlias =
        def.aliases?.some((a) => normalizeChordString(a) === target) ?? false;
      if (bound === target || isAlias) matches.push(def);
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => {
      const sa = specificity(a.chordScope ?? a.scope);
      const sb = specificity(b.chordScope ?? b.scope);
      if (sa !== sb) return sb - sa;
      const ea = this.isEnabled(a) ? 1 : 0;
      const eb = this.isEnabled(b) ? 1 : 0;
      return eb - ea;
    });
    return matches[0];
  }

  /**
   * Two commands conflict when they share a chord AND their chord scopes
   * overlap. The same chord in different workspaces is fine.
   */
  findConflicts(overrides: Readonly<Record<string, string>>): CommandConflict[] {
    const byChord = new Map<string, CommandDef[]>();
    for (const def of this.commands.values()) {
      const chord = this.effectiveChord(def, overrides);
      if (!chord) continue;
      const list = byChord.get(chord);
      if (list) list.push(def);
      else byChord.set(chord, [def]);
    }
    const out: CommandConflict[] = [];
    for (const [chord, defs] of byChord) {
      const ids = new Set<string>();
      for (let i = 0; i < defs.length; i++) {
        for (let j = i + 1; j < defs.length; j++) {
          if (
            scopesOverlap(
              defs[i].chordScope ?? defs[i].scope,
              defs[j].chordScope ?? defs[j].scope
            )
          ) {
            ids.add(defs[i].id);
            ids.add(defs[j].id);
          }
        }
      }
      if (ids.size > 0) out.push({ chord, commandIds: [...ids] });
    }
    return out;
  }
}

/** Process-wide registry, populated by the app on startup. */
export const commandRegistry = new CommandRegistry();
