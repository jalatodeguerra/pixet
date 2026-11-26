import {
  commandRegistry,
  scopeMatchesContext,
  type CommandContext,
  type CommandDef,
  type CommandScope,
  type CommandWorkspace,
} from "../../engine/config/commands";
import {
  STUDIO3D_FLAT_MODES,
  getStudio3DFlatMode,
  studio3DFlatModePatch,
} from "../../engine/model3d/studio3dModes";
import { PIXET_DEFAULT_KEYBINDINGS } from "../../engine/config/keybindings";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { captureCustomBrushFromSelectionAction } from "../../engine/document/selectionActions";
import {
  deleteSelectedNodes,
  duplicateSelectedNodes,
  hasNodeSelection,
  hasSingleNodeSelection,
  openNodeAddMenu,
  selectAllNodes,
  toggleBypassSelectedNodes,
  togglePinSelectedNode,
} from "../../engine/nodes/nodeCommands";
import {
  addRigBoneAction,
  autoWeightRigAction,
  createStarterRigAction,
  keyRigPoseAction,
} from "../../engine/rig/rigCommands";
import {
  flipTileBrushHorizontal,
  flipTileBrushVertical,
  rotateTileBrushClockwise,
} from "../../engine/tiles/tileCommands";
import { useEditorStore, type WorkspaceMode } from "../../store/editorStore";
import { RIG_TOOL_DEFS, rigToolDisabledReason } from "../rig/rigTools";
import { TILE_TOOLS } from "../tiles/tileTools";
import { buildPaletteCommands } from "./paletteCommands";

/** Current workspace/sub-mode as the registry sees it. */
export function currentCommandContext(): CommandContext {
  const s = useEditorStore.getState();
  return { workspace: s.workspaceMode, tilesMode: s.tilesMode };
}

/**
 * Where the draw-tool style chords are live. Rig, Nodes and the Tiles map
 * mode own their letter keys, so draw chords never fire there.
 */
const DRAW_CHORD_SCOPE: readonly CommandScope[] = [
  "draw",
  "tiles.tile",
  "studio3d",
  "data",
];

/** Chords that work in every workspace except Nodes (it isolates its keys). */
const NON_NODES_SCOPE: readonly CommandScope[] = [
  "draw",
  "tiles",
  "rig",
  "studio3d",
  "data",
];

const WORKSPACES: Array<{ id: WorkspaceMode; title: string; hint?: string }> = [
  { id: "draw", title: "Draw" },
  { id: "tiles", title: "Tiles" },
  { id: "rig", title: "Rig" },
  { id: "studio3d", title: "3D Studio", hint: "Ctrl+3" },
  { id: "nodes", title: "Nodes" },
];

function legacyCommands(): CommandDef[] {
  const defaults = PIXET_DEFAULT_KEYBINDINGS;
  const out: CommandDef[] = [];
  for (const c of buildPaletteCommands()) {
    const isTool = c.id.startsWith("tool.");
    const def: CommandDef = {
      id: c.id,
      title: c.label,
      category: c.category,
      scope: "global",
      hint: c.shortcut,
      keywords: c.keywords,
      run: c.run,
    };
    if (c.id in defaults) def.chord = defaults[c.id];
    if (isTool) {
      def.chordScope = DRAW_CHORD_SCOPE;
      const toolRun = c.run;
      // Tool chords never switch workspace; the palette does when the chord
      // would not be live in the current workspace.
      def.run = () => {
        const ctx = currentCommandContext();
        if (!scopeMatchesContext(DRAW_CHORD_SCOPE, ctx)) {
          useEditorStore.getState().setWorkspaceMode("draw");
        }
        toolRun();
      };
    } else if (c.id === "view.flipH" || c.id === "view.flipV") {
      def.chordScope = ["draw"];
    } else if (c.id in defaults) {
      def.chordScope = NON_NODES_SCOPE;
    }
    out.push(def);
  }
  return out;
}

function workspaceCommands(): CommandDef[] {
  const out: CommandDef[] = [
    {
      id: "view.commandPalette",
      title: "View: Command Palette",
      category: "View",
      scope: "global",
      chord: PIXET_DEFAULT_KEYBINDINGS["view.commandPalette"],
      keywords: ["search", "commands", "actions"],
      run: () => {
        const st = useEditorStore.getState();
        st.setCommandPaletteOpen(!st.commandPaletteOpen);
      },
    },
    {
      id: "edit.captureBrush",
      title: "Edit: Capture Custom Brush",
      category: "Edit",
      scope: "global",
      chord: PIXET_DEFAULT_KEYBINDINGS["edit.captureBrush"],
      chordScope: NON_NODES_SCOPE,
      keywords: ["brush", "selection", "stamp"],
      run: () => captureCustomBrushFromSelectionAction(),
    },
  ];
  for (const ws of WORKSPACES) {
    out.push({
      id: `workspace.${ws.id}`,
      title: `Workspace: Open ${ws.title}`,
      category: "Workspace",
      scope: "global",
      hint: ws.hint,
      keywords: ["switch", "mode", "workspace", ws.id, ws.title.toLowerCase()],
      run: () => useEditorStore.getState().setWorkspaceMode(ws.id),
    });
  }
  return out;
}

function rigCommands(): CommandDef[] {
  const inRig = (): boolean => useEditorStore.getState().workspaceMode === "rig";
  const inSetup = (): boolean => useEditorStore.getState().rigMode === "setup";
  const out: CommandDef[] = RIG_TOOL_DEFS.map((def) => ({
    id: `rig.tool.${def.id}`,
    title: `Rig Tool: ${def.label}`,
    category: "Rig Tools",
    scope: "rig" as const,
    chord: def.shortcut.toLowerCase(),
    keywords: ["rig", "tool", "bone", def.id],
    run: () => {
      const state = useEditorStore.getState();
      const reason = rigToolDisabledReason(def, state.rigMode);
      if (reason) {
        state.setStatusMessage(`${def.label}: ${reason}`);
        return;
      }
      state.setRigTool(def.id);
    },
  }));
  out.push(
    {
      id: "rig.mode.setup",
      title: "Rig: Switch to Setup Mode",
      category: "Rig",
      scope: "rig",
      keywords: ["setup", "bind pose", "skeleton"],
      when: () => inRig() && useEditorStore.getState().rigMode !== "setup",
      run: () => useEditorStore.getState().setRigMode("setup"),
    },
    {
      id: "rig.mode.animate",
      title: "Rig: Switch to Animate Mode",
      category: "Rig",
      scope: "rig",
      keywords: ["animate", "pose", "keyframe"],
      when: () => inRig() && useEditorStore.getState().rigMode !== "animate",
      run: () => useEditorStore.getState().setRigMode("animate"),
    },
    {
      id: "rig.addBone",
      title: "Rig: Add Bone",
      category: "Rig",
      scope: "rig",
      keywords: ["bone", "create", "skeleton"],
      when: inSetup,
      run: () => {
        addRigBoneAction();
      },
    },
    {
      id: "rig.starterRig",
      title: "Rig: Create Starter 2-Bone Rig",
      category: "Rig",
      scope: "rig",
      keywords: ["starter", "template", "idle", "bones"],
      when: inSetup,
      run: () => createStarterRigAction(),
    },
    {
      id: "rig.autoWeight",
      title: "Rig: Auto-Weight Pixels",
      category: "Rig",
      scope: "rig",
      keywords: ["weights", "skin", "bind", "envelope", "heat"],
      when: () => pixelEngine.rig.bones.length > 0,
      run: () => autoWeightRigAction(),
    },
    {
      id: "rig.keyPose",
      title: "Rig: Key Pose (Selected Bone)",
      category: "Rig",
      scope: "rig",
      keywords: ["keyframe", "set key", "animate"],
      when: () => !inSetup(),
      run: () => keyRigPoseAction(),
    },
    {
      id: "rig.play",
      title: "Rig: Play / Pause Animation",
      category: "Rig",
      scope: "rig",
      hint: "Enter",
      keywords: ["play", "pause", "timeline", "preview"],
      run: () => useEditorStore.getState().togglePlaying(),
    }
  );
  return out;
}

function tilesCommands(): CommandDef[] {
  const out: CommandDef[] = TILE_TOOLS.map((t) => ({
    id: `tiles.tool.${t.id}`,
    title: `Tiles Tool: ${t.label}`,
    category: "Tiles Tools",
    scope: "tiles.map" as const,
    chord: t.shortcut.toLowerCase(),
    keywords: ["tiles", "map", "tool", t.id],
    run: () => useEditorStore.getState().setTileTool(t.id),
  }));
  out.push(
    {
      id: "tiles.mode.map",
      title: "Tiles: Switch to Map Mode",
      category: "Tiles",
      scope: "tiles",
      keywords: ["map", "paint", "tilemap"],
      when: () => useEditorStore.getState().tilesMode !== "map",
      run: () => useEditorStore.getState().setTilesMode("map"),
    },
    {
      id: "tiles.mode.tile",
      title: "Tiles: Switch to Tile Mode",
      category: "Tiles",
      scope: "tiles",
      keywords: ["tile", "edit", "tileset", "author"],
      when: () => useEditorStore.getState().tilesMode !== "tile",
      run: () => useEditorStore.getState().setTilesMode("tile"),
    },
    {
      id: "tiles.brush.flipH",
      title: "Tiles: Flip Brush Horizontally",
      category: "Tiles",
      scope: "tiles.map",
      chord: "x",
      keywords: ["mirror", "flip", "brush", "stamp"],
      run: flipTileBrushHorizontal,
    },
    {
      id: "tiles.brush.flipV",
      title: "Tiles: Flip Brush Vertically",
      category: "Tiles",
      scope: "tiles.map",
      chord: "y",
      keywords: ["mirror", "flip", "brush", "stamp"],
      run: flipTileBrushVertical,
    },
    {
      id: "tiles.brush.rotate",
      title: "Tiles: Rotate Brush 90 Degrees",
      category: "Tiles",
      scope: "tiles.map",
      chord: "z",
      keywords: ["rotate", "turn", "brush", "stamp"],
      run: rotateTileBrushClockwise,
    }
  );
  return out;
}

function nodesCommands(): CommandDef[] {
  return [
    {
      id: "nodes.addMenu",
      title: "Nodes: Add Node...",
      category: "Nodes",
      scope: "nodes",
      chord: "shift+a",
      aliases: ["/"],
      keywords: ["add", "create", "quick add", "search nodes"],
      run: openNodeAddMenu,
    },
    {
      id: "nodes.selectAll",
      title: "Nodes: Select All",
      category: "Nodes",
      scope: "nodes",
      chord: "ctrl+a",
      keywords: ["select", "all"],
      run: selectAllNodes,
    },
    {
      id: "nodes.duplicate",
      title: "Nodes: Duplicate Selected",
      category: "Nodes",
      scope: "nodes",
      chord: "ctrl+d",
      keywords: ["copy", "clone", "duplicate"],
      when: hasNodeSelection,
      run: duplicateSelectedNodes,
    },
    {
      id: "nodes.delete",
      title: "Nodes: Delete Selected",
      category: "Nodes",
      scope: "nodes",
      chord: "delete",
      aliases: ["backspace"],
      keywords: ["remove", "delete"],
      when: hasNodeSelection,
      run: deleteSelectedNodes,
    },
    {
      id: "nodes.bypass",
      title: "Nodes: Toggle Bypass",
      category: "Nodes",
      scope: "nodes",
      chord: "m",
      keywords: ["mute", "disable", "bypass"],
      when: hasNodeSelection,
      run: toggleBypassSelectedNodes,
    },
    {
      id: "nodes.pin",
      title: "Nodes: Pin Preview",
      category: "Nodes",
      scope: "nodes",
      chord: "p",
      keywords: ["pin", "preview", "output"],
      when: hasSingleNodeSelection,
      run: togglePinSelectedNode,
    },
  ];
}

function studio3dCommands(): CommandDef[] {
  return STUDIO3D_FLAT_MODES.map((m) => ({
    id: `studio3d.mode.${m.id}`,
    title: `3D Studio: ${m.label}`,
    category: "3D Studio",
    scope: "studio3d" as const,
    keywords: ["3d", "studio", "mode", m.id, m.label.toLowerCase()],
    when: () => {
      const st = useEditorStore.getState().studio3d;
      return (
        getStudio3DFlatMode({
          workspaceKind: st.workspaceKind,
          mode: st.mode,
          subMode: st.subMode,
        }) !== m.id
      );
    },
    run: () => useEditorStore.getState().patchStudio3D(studio3DFlatModePatch(m.id)),
  }));
}

let registered = false;

/** Fills the process-wide registry once (idempotent). */
export function ensureCommandsRegistered(): void {
  if (registered) return;
  registered = true;
  commandRegistry.registerAll([
    ...legacyCommands(),
    ...workspaceCommands(),
    ...rigCommands(),
    ...tilesCommands(),
    ...nodesCommands(),
    ...studio3dCommands(),
  ]);
}

/** Runs a registered command by id (menus use this); false if unavailable. */
export function runCommandById(id: string): boolean {
  ensureCommandsRegistered();
  const def = commandRegistry.get(id);
  if (!def || !commandRegistry.isEnabled(def)) return false;
  def.run();
  return true;
}

export type { CommandWorkspace };
