import { useEffect, useRef, useState } from "react";
import {
  Bone,
  Box,
  Download,
  LayoutGrid,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
} from "lucide-react";
import { performRedo, performUndo } from "../engine/document/historyActions";
import {
  copySelection,
  cutSelection,
  deselectAll,
  pasteClipboard,
  selectAllCanvas,
  transformSelectionOrCel,
} from "../engine/document/selectionActions";
import {
  addEmptyFrameAction,
  duplicateCurrentFrameAction,
} from "../engine/document/timelineActions";
import {
  openProjectAction,
  saveProjectAction,
} from "../engine/io/projectBridge";
import { pickImageFileForImport } from "../engine/io/imageImport";
import { useEditorStore, WorkspaceMode } from "../store/editorStore";

type MenuKey = "File" | "Edit" | "View" | "Sprite";

interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
}

const MODES: { id: WorkspaceMode; label: string; icon: typeof Pencil; badge?: string }[] = [
  { id: "draw", label: "Draw", icon: Pencil },
  { id: "tiles", label: "Tiles", icon: LayoutGrid, badge: "P2" },
  { id: "rig", label: "Rig", icon: Bone, badge: "P3" },
];

export function TopBar() {
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const setWorkspaceMode = useEditorStore((s) => s.setWorkspaceMode);
  const panelsCollapsed = useEditorStore((s) => s.panelsCollapsed);
  const togglePanelsCollapsed = useEditorStore((s) => s.togglePanelsCollapsed);
  const toggleShowGrid = useEditorStore((s) => s.toggleShowGrid);
  const toggleTimelineCollapsed = useEditorStore((s) => s.toggleTimelineCollapsed);
  const setZoom = useEditorStore((s) => s.setZoom);
  const zoom = useEditorStore((s) => s.zoom);
  const swapColors = useEditorStore((s) => s.swapColors);
  const addLayer = useEditorStore((s) => s.addLayer);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  const setExportModalOpen = useEditorStore((s) => s.setExportModalOpen);
  const setRotate3dModalOpen = useEditorStore((s) => s.setRotate3dModalOpen);

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

  const notifyMilestone = (label: string, milestone: string) => {
    setStatusMessage(`${label} will be wired in ${milestone}`);
    setOpenMenu(null);
  };

  const menus: Record<MenuKey, MenuItem[]> = {
    File: [
      { label: "New Sprite...", shortcut: "Ctrl+N", action: () => notifyMilestone("New Sprite dialog", "Phase 2") },
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
      { label: "Select All", shortcut: "Ctrl+A", action: () => { selectAllCanvas(); setOpenMenu(null); } },
      { label: "Deselect", shortcut: "Ctrl+D", action: () => { deselectAll(); setOpenMenu(null); } },
      { label: "Flip Horizontal", action: () => { transformSelectionOrCel("flipH"); setOpenMenu(null); } },
      { label: "Flip Vertical", action: () => { transformSelectionOrCel("flipV"); setOpenMenu(null); } },
      { label: "Rotate 90° CW", action: () => { transformSelectionOrCel("rotateCW"); setOpenMenu(null); } },
      { label: "Rotate 90° CCW", action: () => { transformSelectionOrCel("rotateCCW"); setOpenMenu(null); } },
      { label: "Swap FG / BG Colors", shortcut: "X", action: () => { swapColors(); setOpenMenu(null); } },
    ],
    View: [
      { label: "Toggle Pixel Grid", shortcut: "G", action: () => { toggleShowGrid(); setOpenMenu(null); } },
      { label: "Toggle Side Panels", shortcut: "Tab", action: () => { togglePanelsCollapsed(); setOpenMenu(null); } },
      { label: "Toggle Timeline", action: () => { toggleTimelineCollapsed(); setOpenMenu(null); } },
      { label: "Zoom In", shortcut: "+", action: () => { setZoom(zoom + 2); setOpenMenu(null); } },
      { label: "Zoom Out", shortcut: "-", action: () => { setZoom(zoom - 2); setOpenMenu(null); } },
      { label: "Reset Zoom (12x)", action: () => { setZoom(12); setOpenMenu(null); } },
    ],
    Sprite: [
      { label: "New Layer", action: () => { addLayer(); setOpenMenu(null); } },
      { label: "New Frame", action: () => { addEmptyFrameAction(); setOpenMenu(null); } },
      { label: "Duplicate Frame", action: () => { duplicateCurrentFrameAction(); setOpenMenu(null); } },
      { label: "3D Rotate & Turntable...", shortcut: "Ctrl+3", action: () => { setOpenMenu(null); setRotate3dModalOpen(true); } },
      { label: "Canvas Size...", action: () => notifyMilestone("Canvas Resize", "Milestone 1.2") },
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
              onClick={() => setWorkspaceMode(m.id)}
            >
              <Icon size={13} />
              <span>{m.label}</span>
              {m.badge && <span className="mode-badge">{m.badge}</span>}
            </button>
          );
        })}
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className="mini-btn"
          title="3D Rotate & Turntable (Ctrl+3)"
          onClick={() => setRotate3dModalOpen(true)}
        >
          <Box size={13} />
          <span>3D Spin</span>
        </button>

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
