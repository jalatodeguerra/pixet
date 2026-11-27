import { useEffect, useRef, useState } from "react";
import {
  Bone,
  Box,
  Check,
  Download,
  LayoutGrid,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Trash2,
  Workflow,
} from "lucide-react";
import {
  copySelectionToNewLayer,
  cutSelectionToNewLayer,
} from "../engine/document/selectionActions";
import {} from "../engine/document/transformActions";
import {} from "../engine/document/filterActions";
import {
  importAsepriteAction,
  openProjectAction,
  saveProjectAction,
} from "../engine/io/projectBridge";
import { pickImageFileForImport } from "../engine/io/imageImport";
import { commandRegistry } from "../engine/config/commands";
import { ensureCommandsRegistered, runCommandById } from "./commands/appCommands";
import { syncRigHistoryFlags } from "../engine/rig/rigActions";
import { useTimelineAllowed, useVisibleBottomEditors } from "./areas/useAreaLayout";
import { DEFAULT_DOCKED_ORDER, PANEL_TITLES } from "../engine/ui/panelLayout";
import {
  useEditorStore,
  WorkspaceMode,
  RigMode,
  TileMode,
} from "../store/editorStore";

type MenuKey = "File" | "Edit" | "View" | "Window" | "Sprite" | "Help";

/** Menu entry that runs a registered command (shows its current chord). */
function menuCommand(
  label: string,
  commandId: string,
  fallbackShortcut?: string
): MenuItem {
  ensureCommandsRegistered();
  const def = commandRegistry.get(commandId);
  const chord = def
    ? commandRegistry.displayChord(def, useEditorStore.getState().keybindings)
    : "";
  return {
    label,
    shortcut: chord || fallbackShortcut,
    action: () => runCommandById(commandId),
  };
}

interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  /** Renders a checkbox-style entry (checked state shown as a tick). */
  checked?: boolean;
  disabled?: boolean;
  /** When set, a small delete button is shown beside the entry. */
  onDelete?: () => void;
  separator?: boolean;
  heading?: boolean;
  /** Keep the menu open after activation (for toggles). */
  keepOpen?: boolean;
}

const SEPARATOR: MenuItem = { label: "", action: () => {}, separator: true };

const MODES: { id: WorkspaceMode; label: string; icon: typeof Pencil; }[] = [
  { id: "draw", label: "Draw", icon: Pencil },
  { id: "tiles", label: "Tiles", icon: LayoutGrid },
  { id: "rig", label: "Rig", icon: Bone },
  { id: "studio3d", label: "3D Studio", icon: Box },
  { id: "nodes", label: "Nodes", icon: Workflow },
];

const RIG_MODES: { id: RigMode; label: string; hint: string }[] = [
  {
    id: "setup",
    label: "Setup",
    hint: "Setup · edit bind pose, skeleton and weights",
  },
  {
    id: "animate",
    label: "Animate",
    hint: "Animate · pose overrides and keyframes",
  },
];

const TILE_MODES: { id: TileMode; label: string; hint: string }[] = [
  {
    id: "map",
    label: "Map",
    hint: "Map · paint tiles and objects on tilemap layers",
  },
  {
    id: "tile",
    label: "Tile",
    hint: "Tile · edit selected tile pixels",
  },
];

export function TopBar() {
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const setWorkspaceMode = useEditorStore((s) => s.setWorkspaceMode);
  const rigMode = useEditorStore((s) => s.rigMode);
  const setRigMode = useEditorStore((s) => s.setRigMode);
  const tilesMode = useEditorStore((s) => s.tilesMode);
  const setTilesMode = useEditorStore((s) => s.setTilesMode);
  const panelsCollapsed = useEditorStore((s) => s.panelsCollapsed);
  const togglePanelsCollapsed = useEditorStore((s) => s.togglePanelsCollapsed);
  const toggleTimelineCollapsed = useEditorStore((s) => s.toggleTimelineCollapsed);
  const swapColors = useEditorStore((s) => s.swapColors);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  const setExportModalOpen = useEditorStore((s) => s.setExportModalOpen);
  const setNewSpriteModalOpen = useEditorStore((s) => s.setNewSpriteModalOpen);
  const dockAllPanels = useEditorStore((s) => s.dockAllPanels);
  const resetWorkspaceLayout = useEditorStore((s) => s.resetWorkspaceLayout);
  const hiddenPanels = useEditorStore((s) => s.hiddenPanels);
  const togglePanelHidden = useEditorStore((s) => s.togglePanelHidden);
  const savedLayouts = useEditorStore((s) => s.savedLayouts);
  const applySavedLayout = useEditorStore((s) => s.applySavedLayout);
  const deleteSavedLayoutByName = useEditorStore((s) => s.deleteSavedLayoutByName);
  const setSaveLayoutModalOpen = useEditorStore((s) => s.setSaveLayoutModalOpen);
  const toggleBottomAreaVisible = useEditorStore((s) => s.toggleBottomAreaVisible);
  const bottomAreaShown = useVisibleBottomEditors().length > 0;
  const timelineAllowed = useTimelineAllowed();
  const setFilterModalOpen = useEditorStore((s) => s.setFilterModalOpen);

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const menuStripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (menuStripRef.current && !menuStripRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  const wsPanels = [...DEFAULT_DOCKED_ORDER[workspaceMode]];
  const windowMenu: MenuItem[] = [
    { label: "Panels", action: () => {}, heading: true },
    ...(wsPanels.length === 0
      ? [
          {
            label: "No dockable panels in this workspace",
            action: () => {},
            disabled: true,
          },
        ]
      : wsPanels.map<MenuItem>((id) => ({
          label: PANEL_TITLES[id],
          checked: hiddenPanels[id] !== true,
          keepOpen: true,
          action: () => togglePanelHidden(id),
        }))),
    SEPARATOR,
    {
      label: "Show Bottom Area",
      checked: bottomAreaShown,
      keepOpen: true,
      action: () => toggleBottomAreaVisible(workspaceMode, timelineAllowed),
    },
    SEPARATOR,
    { label: "Dock All Panels", action: () => dockAllPanels() },
    {
      label: "Reset Layout (this workspace)",
      action: () => resetWorkspaceLayout(workspaceMode),
    },
    SEPARATOR,
    { label: "Saved Layouts", action: () => {}, heading: true },
    ...(savedLayouts.length === 0
      ? [{ label: "None yet", action: () => {}, disabled: true }]
      : savedLayouts.map<MenuItem>((l) => ({
          label: l.name,
          action: () => {
            applySavedLayout(l.name);
            setStatusMessage(`Applied layout "${l.name}"`);
          },
          onDelete: () => deleteSavedLayoutByName(l.name),
        }))),
    { label: "Save Layout As...", action: () => setSaveLayoutModalOpen(true) },
  ];

  const menus: Record<MenuKey, MenuItem[]> = {
    File: [
      { label: "New Sprite...", shortcut: "Ctrl+N", action: () => { setOpenMenu(null); setNewSpriteModalOpen(true); } },
      { label: "Open .pixet...", shortcut: "Ctrl+O", action: () => { setOpenMenu(null); void openProjectAction(); } },
      {
        label: "Import Image...",
        shortcut: "Ctrl+Shift+I",
        action: () => {
          setOpenMenu(null);
          void pickImageFileForImport()
            .then((img) => {
              if (img) useEditorStore.getState().setPendingImportImage(img);
            })
            .catch((err) => {
              setStatusMessage(`Import failed: ${String(err)}`);
            });
        },
      },
      {
        label: "Import .ase / .aseprite...",
        action: () => {
          setOpenMenu(null);
          void importAsepriteAction();
        },
      },
      { label: "Save", shortcut: "Ctrl+S", action: () => { setOpenMenu(null); void saveProjectAction(false); } },
      { label: "Save As...", shortcut: "Ctrl+Shift+S", action: () => { setOpenMenu(null); void saveProjectAction(true); } },
      { label: "Export Spritesheet...", shortcut: "Ctrl+E", action: () => { setOpenMenu(null); setExportModalOpen(true, "sheet"); } },
      { label: "Export GIF...", action: () => { setOpenMenu(null); setExportModalOpen(true, "gif"); } },
      { label: "Export PNG Sequence...", action: () => { setOpenMenu(null); setExportModalOpen(true, "png_sequence"); } },
      { label: "Export Tilemap...", action: () => { setOpenMenu(null); setExportModalOpen(true, "tilemap"); } },
    ],
    Edit: [
      menuCommand("Undo", "edit.undo", "Ctrl+Z"),
      menuCommand("Redo", "edit.redo", "Ctrl+Shift+Z"),
      menuCommand("Cut", "edit.cut", "Ctrl+X"),
      menuCommand("Copy", "edit.copy", "Ctrl+C"),
      menuCommand("Paste", "edit.paste", "Ctrl+V"),
      { label: "Cut to New Layer", shortcut: "Ctrl+Shift+X", action: () => { cutSelectionToNewLayer(); setOpenMenu(null); } },
      { label: "Copy to New Layer", shortcut: "Ctrl+J", action: () => { copySelectionToNewLayer(); setOpenMenu(null); } },
      menuCommand("Free Transform", "edit.freeTransform", "Ctrl+T"),
      menuCommand("Select All", "edit.selectAll", "Ctrl+A"),
      menuCommand("Deselect", "edit.deselect", "Ctrl+D"),
      menuCommand("Invert Selection", "edit.invertSelection", "Ctrl+Shift+A"),
      menuCommand("Select Layer Content", "edit.selectLayerContent"),
      menuCommand("Expand Selection (+1px)", "edit.expandSelection"),
      menuCommand("Contract Selection (-1px)", "edit.contractSelection"),
      menuCommand("Border Selection (1px)", "edit.borderSelection"),
      menuCommand("Stroke Selection (1px)", "edit.strokeSelection"),
      menuCommand("Fill Selection (FG)", "edit.fillSelectionFg", "Alt+Backspace"),
      menuCommand("Fill Selection (BG)", "edit.fillSelectionBg", "Ctrl+Backspace"),
      menuCommand("Flip Horizontal", "edit.flipH"),
      menuCommand("Flip Vertical", "edit.flipV"),
      menuCommand("Rotate 90° CW", "edit.rotateCW"),
      menuCommand("Rotate 90° CCW", "edit.rotateCCW"),
      { label: "Swap FG / BG Colors", shortcut: "X", action: () => { swapColors(); setOpenMenu(null); } },
      menuCommand("Keybindings...", "edit.keybindings"),
    ],
    View: [
      menuCommand("Command Palette...", "view.commandPalette", "Ctrl+K"),
      menuCommand("Flip View Horizontal", "view.flipH", "H"),
      menuCommand("Flip View Vertical", "view.flipV", "Shift+H"),
      menuCommand("Grayscale Value Check", "view.grayscale"),
      menuCommand("Silhouette Check", "view.silhouette"),
      menuCommand("Toggle Pixel Grid", "view.pixelGrid"),
      menuCommand("Toggle Rulers", "view.rulers"),
      menuCommand("Toggle Custom Grid", "view.customGrid"),
      menuCommand("Clear Guides", "view.clearGuides"),
      { label: "Toggle Side Panels", shortcut: "Tab", action: () => { togglePanelsCollapsed(); setOpenMenu(null); } },
      { label: "Toggle Timeline", action: () => { toggleTimelineCollapsed(); setOpenMenu(null); } },
      menuCommand("Toggle Floating Preview", "view.floatingPreview"),
      menuCommand("Zoom In", "view.zoomIn", "+"),
      menuCommand("Zoom Out", "view.zoomOut", "-"),
      menuCommand("Fit to Window", "view.zoomFit", "Ctrl+0"),
      menuCommand("Actual Size (1:1)", "view.zoomActual", "Ctrl+1"),
    ],
    Window: windowMenu,
    Sprite: [
      menuCommand("New Layer", "sprite.newLayer"),
      menuCommand("Merge Down", "layer.mergeDown", "Ctrl+M"),
      menuCommand("Merge Visible", "sprite.mergeVisible"),
      menuCommand("Flatten Image", "sprite.flattenImage"),
      menuCommand("Clear Cel", "sprite.clearCel"),
      {
        label: "Toggle Clipping Mask",
        action: () => {
          const st = useEditorStore.getState();
          const active = st.layers.find((l) => l.id === st.activeLayerId);
          if (active && active.kind === "raster") {
            st.toggleLayerClipped(active.id);
          }
          setOpenMenu(null);
        },
      },
      menuCommand("New Frame", "sprite.newFrame"),
      menuCommand("Duplicate Frame", "sprite.duplicateFrame"),
      { label: "Filters & Adjustments...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "outline"); } },
      { label: "Auto-Outline...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "outline"); } },
      { label: "Drop Shadow...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "dropShadow"); } },
      { label: "Color Replace...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "colorReplace"); } },
      { label: "Offset / Wrap...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "offsetWrap"); } },
      { label: "Scale Sprite...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "scaleSprite"); } },
      menuCommand("Auto-Crop / Trim", "sprite.autoCrop"),
      menuCommand("3D Studio & Turntable", "workspace.studio3d", "Ctrl+3"),
      menuCommand("Canvas Size...", "sprite.canvasSize"),
    ],
    Help: [
      menuCommand("Welcome screen...", "help.welcome"),
      menuCommand("Keyboard shortcuts...", "edit.keybindings"),
      menuCommand("Command palette", "view.commandPalette", "Ctrl+K"),
    ],
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-mark">
          <div className="brand-cube">P</div>
          <span>Pixet</span>
        </div>

        <nav className="menu-strip" ref={menuStripRef} aria-label="Main Menu">
          {(Object.keys(menus) as MenuKey[]).map((key) => (
            <div key={key} style={{ position: "relative" }}>
              <button
                type="button"
                className={`menu-btn ${openMenu === key ? "active" : ""}`}
                onClick={() => setOpenMenu(openMenu === key ? null : key)}
              >
                {key}
              </button>
              {openMenu === key && (
                <div className="menu-dropdown" role="menu">
                  {menus[key].map((item, idx) => {
                    if (item.separator) {
                      return <div key={`sep-${idx}`} className="menu-dropdown-sep" />;
                    }
                    if (item.heading) {
                      return (
                        <div key={`h-${item.label}`} className="menu-dropdown-label">
                          {item.label}
                        </div>
                      );
                    }
                    const button = (
                      <button
                        key={item.label}
                        type="button"
                        className="menu-dropdown-item"
                        role={item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
                        aria-checked={item.checked}
                        disabled={item.disabled}
                        onClick={() => {
                          if (!item.keepOpen) setOpenMenu(null);
                          item.action();
                        }}
                      >
                        {item.checked !== undefined ? (
                          <span className="menu-check">
                            <span className="menu-check-box">
                              {item.checked && <Check size={11} />}
                            </span>
                            <span>{item.label}</span>
                          </span>
                        ) : (
                          <span>{item.label}</span>
                        )}
                        {item.shortcut && (
                          <span className="menu-shortcut">{item.shortcut}</span>
                        )}
                      </button>
                    );
                    if (!item.onDelete) return button;
                    return (
                      <div key={item.label} className="menu-dropdown-row">
                        {button}
                        <button
                          type="button"
                          className="icon-action-btn"
                          style={{ width: 20, height: 20 }}
                          title={`Delete layout "${item.label}"`}
                          aria-label={`Delete layout ${item.label}`}
                          onClick={() => item.onDelete?.()}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      <div className="topbar-center">
        <div className="mode-switcher" role="tablist" aria-label="Workspace Mode">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = workspaceMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`mode-pill ${active ? "active" : ""}`}
                onClick={() => {
                  setWorkspaceMode(m.id);
                  syncRigHistoryFlags();
                }}
              >
                <Icon size={13} />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

      </div>

      <div className="topbar-right">
        <div className="topbar-submode-slot">
        {workspaceMode === "tiles" && (
          <div
            className="mode-switcher tiles-mode-switcher"
            role="tablist"
            aria-label="Tiles Mode"
          >
            {TILE_MODES.map((m) => {
              const active = tilesMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={m.hint}
                  className={`mode-pill ${active ? "active" : ""}`}
                  onClick={() => setTilesMode(m.id)}
                >
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {workspaceMode === "rig" && (
          <div
            className="mode-switcher rig-mode-switcher"
            role="tablist"
            aria-label="Rig Mode"
          >
            {RIG_MODES.map((m) => {
              const active = rigMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={m.hint}
                  className={`mode-pill ${active ? "active" : ""}`}
                  onClick={() => setRigMode(m.id)}
                >
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
        )}

        </div>

        <button
          type="button"
          className={`icon-action-btn ${panelsCollapsed ? "active" : ""}`}
          title="Toggle Panels (Tab)"
          onClick={togglePanelsCollapsed}
        >
          {panelsCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
        </button>

        <button
          type="button"
          className="export-cta"
          onClick={() => setExportModalOpen(true)}
        >
          <Download size={13} />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
}
