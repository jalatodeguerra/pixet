import { useEffect, useRef, useState } from "react";
import {
  Bone,
  Box,
  Download,
  LayoutGrid,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Workflow,
} from "lucide-react";
import { performRedo, performUndo } from "../engine/document/historyActions";
import {
  borderSelectionAction,
  contractSelectionAction,
  copySelection,
  copySelectionToNewLayer,
  cutSelection,
  cutSelectionToNewLayer,
  deselectAll,
  expandSelectionAction,
  fillSelectionAction,
  invertSelectionAction,
  pasteClipboard,
  selectAllCanvas,
  selectLayerContentAction,
  strokeSelectionAction,
  transformSelectionOrCel,
} from "../engine/document/selectionActions";
import { beginFreeTransformAction } from "../engine/document/transformActions";
import { autoCropSpriteAction } from "../engine/document/filterActions";
import {
  clearActiveCelAction,
  flattenImageAction,
  mergeDownLayerAction,
  mergeVisibleLayersAction,
} from "../engine/document/layerActions";
import {
  addEmptyFrameAction,
  duplicateCurrentFrameAction,
} from "../engine/document/timelineActions";
import {
  importAsepriteAction,
  openProjectAction,
  saveProjectAction,
} from "../engine/io/projectBridge";
import { pickImageFileForImport } from "../engine/io/imageImport";
import { syncRigHistoryFlags } from "../engine/rig/rigActions";
import {
  useEditorStore,
  WorkspaceMode,
  RigMode,
  TileMode,
} from "../store/editorStore";

type MenuKey = "File" | "Edit" | "View" | "Sprite";

interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
}

const MODES: { id: WorkspaceMode; label: string; icon: typeof Pencil; }[] = [
  { id: "draw", label: "Draw", icon: Pencil },
  { id: "tiles", label: "Tiles", icon: LayoutGrid },
  { id: "rig", label: "Rig", icon: Bone },
  { id: "studio3d", label: "3D Studio", icon: Box },
  { id: "nodes", label: "Nodes", icon: Workflow },
];

const STUDIO3D_MODES: { id: "extruded" | "stack" | "rig"; label: string; hint: string }[] = [
  { id: "extruded", label: "2.5D", hint: "2.5D extruded spin & volumetric side walls" },
  { id: "stack", label: "Stack", hint: "Sprite stacking bottom-to-top layers" },
  { id: "rig", label: "Rig 3D", hint: "Orbit and bake rigged 3D skeleton" },
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
  const toggleShowGrid = useEditorStore((s) => s.toggleShowGrid);
  const toggleTimelineCollapsed = useEditorStore((s) => s.toggleTimelineCollapsed);
  const toggleFloatingPreview = useEditorStore((s) => s.toggleFloatingPreview);
  const setCommandPaletteOpen = useEditorStore((s) => s.setCommandPaletteOpen);
  const toggleViewFlipH = useEditorStore((s) => s.toggleViewFlipH);
  const toggleViewFlipV = useEditorStore((s) => s.toggleViewFlipV);
  const toggleViewGrayscale = useEditorStore((s) => s.toggleViewGrayscale);
  const toggleViewSilhouette = useEditorStore((s) => s.toggleViewSilhouette);
  const toggleShowRulers = useEditorStore((s) => s.toggleShowRulers);
  const toggleShowCustomGrid = useEditorStore((s) => s.toggleShowCustomGrid);
  const clearGuides = useEditorStore((s) => s.clearGuides);
  const zoomStep = useEditorStore((s) => s.zoomStep);
  const fitZoomToWindow = useEditorStore((s) => s.fitZoomToWindow);
  const zoomActualSize = useEditorStore((s) => s.zoomActualSize);
  const swapColors = useEditorStore((s) => s.swapColors);
  const addLayer = useEditorStore((s) => s.addLayer);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  const setExportModalOpen = useEditorStore((s) => s.setExportModalOpen);
  const studio3dMode = useEditorStore((s) => s.studio3d.mode);
  const studio3dWorkspaceKind = useEditorStore((s) => s.studio3d.workspaceKind);
  const patchStudio3D = useEditorStore((s) => s.patchStudio3D);
  const setNewSpriteModalOpen = useEditorStore((s) => s.setNewSpriteModalOpen);
  const setCanvasSizeModalOpen = useEditorStore((s) => s.setCanvasSizeModalOpen);
  const dockAllPanels = useEditorStore((s) => s.dockAllPanels);
  const resetPanelLayout = useEditorStore((s) => s.resetPanelLayout);
  const setFilterModalOpen = useEditorStore((s) => s.setFilterModalOpen);
  const setKeybindingsModalOpen = useEditorStore((s) => s.setKeybindingsModalOpen);

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
      { label: "Export Spritesheet...", shortcut: "Ctrl+E", action: () => { setOpenMenu(null); setExportModalOpen(true); } },
    ],
    Edit: [
      { label: "Undo", shortcut: "Ctrl+Z", action: () => { performUndo(); setOpenMenu(null); } },
      { label: "Redo", shortcut: "Ctrl+Shift+Z", action: () => { performRedo(); setOpenMenu(null); } },
      { label: "Cut", shortcut: "Ctrl+X", action: () => { cutSelection(); setOpenMenu(null); } },
      { label: "Copy", shortcut: "Ctrl+C", action: () => { copySelection(); setOpenMenu(null); } },
      { label: "Paste", shortcut: "Ctrl+V", action: () => { pasteClipboard(); setOpenMenu(null); } },
      { label: "Cut to New Layer", shortcut: "Ctrl+Shift+X", action: () => { cutSelectionToNewLayer(); setOpenMenu(null); } },
      { label: "Copy to New Layer", shortcut: "Ctrl+J", action: () => { copySelectionToNewLayer(); setOpenMenu(null); } },
      { label: "Free Transform", shortcut: "Ctrl+T", action: () => { beginFreeTransformAction(); setOpenMenu(null); } },
      { label: "Select All", shortcut: "Ctrl+A", action: () => { selectAllCanvas(); setOpenMenu(null); } },
      { label: "Deselect", shortcut: "Ctrl+D", action: () => { deselectAll(); setOpenMenu(null); } },
      { label: "Invert Selection", shortcut: "Ctrl+Shift+A", action: () => { invertSelectionAction(); setOpenMenu(null); } },
      { label: "Select Layer Content", action: () => { selectLayerContentAction(); setOpenMenu(null); } },
      { label: "Expand Selection (+1px)", action: () => { expandSelectionAction(1); setOpenMenu(null); } },
      { label: "Contract Selection (-1px)", action: () => { contractSelectionAction(1); setOpenMenu(null); } },
      { label: "Border Selection (1px)", action: () => { borderSelectionAction(1); setOpenMenu(null); } },
      { label: "Stroke Selection (1px)", action: () => { strokeSelectionAction(1, "outside"); setOpenMenu(null); } },
      { label: "Fill Selection (FG)", shortcut: "Alt+Backspace", action: () => { fillSelectionAction(false); setOpenMenu(null); } },
      { label: "Fill Selection (BG)", shortcut: "Ctrl+Backspace", action: () => { fillSelectionAction(true); setOpenMenu(null); } },
      { label: "Flip Horizontal", action: () => { transformSelectionOrCel("flipH"); setOpenMenu(null); } },
      { label: "Flip Vertical", action: () => { transformSelectionOrCel("flipV"); setOpenMenu(null); } },
      { label: "Rotate 90° CW", action: () => { transformSelectionOrCel("rotateCW"); setOpenMenu(null); } },
      { label: "Rotate 90° CCW", action: () => { transformSelectionOrCel("rotateCCW"); setOpenMenu(null); } },
      { label: "Swap FG / BG Colors", shortcut: "X", action: () => { swapColors(); setOpenMenu(null); } },
      { label: "Keybindings...", action: () => { setOpenMenu(null); setKeybindingsModalOpen(true); } },
    ],
    View: [
      { label: "Command Palette...", shortcut: "Ctrl+K", action: () => { setOpenMenu(null); setCommandPaletteOpen(true); } },
      { label: "Flip View Horizontal", shortcut: "H", action: () => { toggleViewFlipH(); setOpenMenu(null); } },
      { label: "Flip View Vertical", shortcut: "Shift+H", action: () => { toggleViewFlipV(); setOpenMenu(null); } },
      { label: "Grayscale Value Check", action: () => { toggleViewGrayscale(); setOpenMenu(null); } },
      { label: "Silhouette Check", action: () => { toggleViewSilhouette(); setOpenMenu(null); } },
      { label: "Toggle Pixel Grid", shortcut: "G", action: () => { toggleShowGrid(); setOpenMenu(null); } },
      { label: "Toggle Rulers", action: () => { toggleShowRulers(); setOpenMenu(null); } },
      { label: "Toggle Custom Grid", action: () => { toggleShowCustomGrid(); setOpenMenu(null); } },
      { label: "Clear Guides", action: () => { clearGuides(); setOpenMenu(null); } },
      { label: "Toggle Side Panels", shortcut: "Tab", action: () => { togglePanelsCollapsed(); setOpenMenu(null); } },
      { label: "Dock All Panels", action: () => { dockAllPanels(); setOpenMenu(null); } },
      { label: "Reset Panel Layout", action: () => { resetPanelLayout(); setOpenMenu(null); } },
      { label: "Toggle Timeline", action: () => { toggleTimelineCollapsed(); setOpenMenu(null); } },
      { label: "Toggle Floating Preview", action: () => { toggleFloatingPreview(); setOpenMenu(null); } },
      { label: "Zoom In", shortcut: "+", action: () => { zoomStep(1); setOpenMenu(null); } },
      { label: "Zoom Out", shortcut: "-", action: () => { zoomStep(-1); setOpenMenu(null); } },
      { label: "Fit to Window", shortcut: "Ctrl+0", action: () => { fitZoomToWindow(); setOpenMenu(null); } },
      { label: "Actual Size (1:1)", shortcut: "Ctrl+1", action: () => { zoomActualSize(); setOpenMenu(null); } },
    ],
    Sprite: [
      { label: "New Layer", action: () => { addLayer(); setOpenMenu(null); } },
      { label: "Merge Down", shortcut: "Ctrl+M", action: () => { mergeDownLayerAction(); setOpenMenu(null); } },
      { label: "Merge Visible", action: () => { mergeVisibleLayersAction(); setOpenMenu(null); } },
      { label: "Flatten Image", action: () => { flattenImageAction(); setOpenMenu(null); } },
      { label: "Clear Cel", action: () => { clearActiveCelAction(); setOpenMenu(null); } },
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
      { label: "New Frame", action: () => { addEmptyFrameAction(); setOpenMenu(null); } },
      { label: "Duplicate Frame", action: () => { duplicateCurrentFrameAction(); setOpenMenu(null); } },
      { label: "Filters & Adjustments...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "outline"); } },
      { label: "Auto-Outline...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "outline"); } },
      { label: "Drop Shadow...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "dropShadow"); } },
      { label: "Color Replace...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "colorReplace"); } },
      { label: "Offset / Wrap...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "offsetWrap"); } },
      { label: "Scale Sprite...", action: () => { setOpenMenu(null); setFilterModalOpen(true, "scaleSprite"); } },
      { label: "Auto-Crop / Trim", action: () => { autoCropSpriteAction(); setOpenMenu(null); } },
      { label: "3D Studio & Turntable", shortcut: "Ctrl+3", action: () => { setOpenMenu(null); setWorkspaceMode("studio3d"); } },
      { label: "Canvas Size...", action: () => { setOpenMenu(null); setCanvasSizeModalOpen(true); } },
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
                  {menus[key].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="menu-dropdown-item"
                      role="menuitem"
                      onClick={item.action}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className="menu-shortcut">{item.shortcut}</span>
                      )}
                    </button>
                  ))}
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

        {workspaceMode === "studio3d" && studio3dWorkspaceKind !== "lowpoly3d" && (
          <div
            className="mode-switcher rig-mode-switcher"
            role="tablist"
            aria-label="3D Studio Mode"
          >
            {STUDIO3D_MODES.map((m) => {
              const active = studio3dMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={m.hint}
                  className={`mode-pill ${active ? "active" : ""}`}
                  onClick={() => patchStudio3D({ mode: m.id })}
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
