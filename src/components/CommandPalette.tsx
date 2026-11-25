import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { performRedo, performUndo } from "../engine/document/historyActions";
import {
  borderSelectionAction,
  contractSelectionAction,
  copySelection,
  cutSelection,
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
import {
  generateAllStudio3DMapsAction,
  generateStudio3DMapLayerAction,
} from "./studio3d/studio3dActions";
import { beginFreeTransformAction } from "../engine/document/transformActions";
import {
  applyBufferFilterAction,
  autoCropSpriteAction,
} from "../engine/document/filterActions";
import {
  applyDesaturateFilter,
  applyInvertFilter,
} from "../engine/tools/filters";
import {
  addEmptyFrameAction,
  duplicateCurrentFrameAction,
} from "../engine/document/timelineActions";
import {
  clearActiveCelAction,
  duplicateLayerAllFramesAction,
  flattenImageAction,
  mergeDownLayerAction,
  mergeVisibleLayersAction,
} from "../engine/document/layerActions";
import { openProjectAction, saveProjectAction } from "../engine/io/projectBridge";
import {
  fuzzyMatchCommands,
  type CommandEntry,
} from "../engine/tools/commandMatcher";
import { useEditorStore } from "../store/editorStore";
import { DRAW_TOOL_GROUPS } from "./draw/drawTools";

interface ActionCommandEntry extends CommandEntry {
  run: () => void;
}

export function CommandPalette() {
  const open = useEditorStore((s) => s.commandPaletteOpen);
  const setOpen = useEditorStore((s) => s.setCommandPaletteOpen);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<ActionCommandEntry[]>(() => {
    const st = useEditorStore.getState;

    const toolCmds: ActionCommandEntry[] = DRAW_TOOL_GROUPS.flatMap((g) =>
      g.items.map((tool) => ({
        id: `tool.${tool.id}`,
        label: `Tool: ${tool.label}`,
        category: "Tools",
        shortcut: tool.shortcut,
        keywords: [tool.id, tool.label.toLowerCase(), "draw"],
        run: () => {
          const s = st();
          if (s.workspaceMode !== "draw") s.setWorkspaceMode("draw");
          s.setActiveTool(tool.id);
        },
      }))
    );

    const viewCmds: ActionCommandEntry[] = [
      {
        id: "view.flipH",
        label: "View: Flip Horizontal",
        category: "View",
        shortcut: "H",
        keywords: ["mirror", "flip", "horizontal", "check"],
        run: () => st().toggleViewFlipH(),
      },
      {
        id: "view.flipV",
        label: "View: Flip Vertical",
        category: "View",
        shortcut: "Shift+H",
        keywords: ["mirror", "flip", "vertical", "check"],
        run: () => st().toggleViewFlipV(),
      },
      {
        id: "view.grayscale",
        label: "View: Toggle Grayscale Value Check",
        category: "View",
        keywords: ["greyscale", "luminance", "value", "contrast", "check"],
        run: () => st().toggleViewGrayscale(),
      },
      {
        id: "view.silhouette",
        label: "View: Toggle Silhouette Check",
        category: "View",
        keywords: ["shape", "shadow", "readability", "check"],
        run: () => st().toggleViewSilhouette(),
      },
      {
        id: "view.pixelGrid",
        label: "View: Toggle Pixel Grid",
        category: "View",
        keywords: ["grid", "pixels"],
        run: () => st().toggleShowGrid(),
      },
      {
        id: "view.customGrid",
        label: "View: Toggle Custom Grid",
        category: "View",
        keywords: ["grid", "custom", "c-grid"],
        run: () => st().toggleShowCustomGrid(),
      },
      {
        id: "view.rulers",
        label: "View: Toggle Rulers",
        category: "View",
        keywords: ["ruler", "guides", "measure"],
        run: () => st().toggleShowRulers(),
      },
      {
        id: "view.clearGuides",
        label: "View: Clear All Guides",
        category: "View",
        keywords: ["guides", "clear", "remove"],
        run: () => st().clearGuides(),
      },
      {
        id: "view.snapToGuides",
        label: "View: Toggle Snap to Guides",
        category: "View",
        keywords: ["snap", "guides"],
        run: () => st().toggleSnapToGuides(),
      },
      {
        id: "view.seamlessWrap",
        label: "View: Toggle Seamless Wrap Mode",
        category: "View",
        keywords: ["wrap", "tile", "seamless"],
        run: () => st().toggleSeamlessWrap(),
      },
      {
        id: "view.floatingPreview",
        label: "View: Toggle Floating Preview",
        category: "View",
        keywords: ["preview", "animation", "window"],
        run: () => st().toggleFloatingPreview(),
      },
      {
        id: "view.backdrop.checkerDark",
        label: "Backdrop: Checker Dark",
        category: "View",
        keywords: ["background", "checker", "dark", "backdrop"],
        run: () => st().setCanvasBackdrop("checkerDark"),
      },
      {
        id: "view.backdrop.checkerLight",
        label: "Backdrop: Checker Light",
        category: "View",
        keywords: ["background", "checker", "light", "backdrop"],
        run: () => st().setCanvasBackdrop("checkerLight"),
      },
      {
        id: "view.backdrop.solidDark",
        label: "Backdrop: Solid Dark",
        category: "View",
        keywords: ["background", "solid", "dark", "backdrop"],
        run: () => st().setCanvasBackdrop("solidDark"),
      },
      {
        id: "view.backdrop.solidMid",
        label: "Backdrop: Solid Mid Gray",
        category: "View",
        keywords: ["background", "solid", "mid", "gray", "backdrop"],
        run: () => st().setCanvasBackdrop("solidMid"),
      },
      {
        id: "view.backdrop.custom",
        label: "Backdrop: Custom Color",
        category: "View",
        keywords: ["background", "custom", "color", "backdrop"],
        run: () => st().setCanvasBackdrop("custom"),
      },
    ];

    const editCmds: ActionCommandEntry[] = [
      {
        id: "edit.undo",
        label: "Edit: Undo",
        category: "Edit",
        shortcut: "Ctrl+Z",
        run: () => performUndo(),
      },
      {
        id: "edit.redo",
        label: "Edit: Redo",
        category: "Edit",
        shortcut: "Ctrl+Shift+Z",
        run: () => performRedo(),
      },
      {
        id: "edit.copy",
        label: "Edit: Copy",
        category: "Edit",
        shortcut: "Ctrl+C",
        run: () => copySelection(),
      },
      {
        id: "edit.cut",
        label: "Edit: Cut",
        category: "Edit",
        shortcut: "Ctrl+X",
        run: () => cutSelection(),
      },
      {
        id: "edit.paste",
        label: "Edit: Paste",
        category: "Edit",
        shortcut: "Ctrl+V",
        run: () => pasteClipboard(),
      },
      {
        id: "edit.freeTransform",
        label: "Edit: Free Transform",
        category: "Edit",
        shortcut: "Ctrl+T",
        keywords: ["transform", "scale", "rotate", "rotsprite", "resize"],
        run: () => beginFreeTransformAction(),
      },
      {
        id: "edit.selectAll",
        label: "Edit: Select All",
        category: "Edit",
        shortcut: "Ctrl+A",
        run: () => selectAllCanvas(),
      },
      {
        id: "edit.deselect",
        label: "Edit: Deselect",
        category: "Edit",
        shortcut: "Ctrl+D",
        run: () => deselectAll(),
      },
      {
        id: "edit.invertSelection",
        label: "Edit: Invert Selection",
        category: "Edit",
        shortcut: "Ctrl+Shift+A",
        keywords: ["selection", "invert", "reverse"],
        run: () => invertSelectionAction(),
      },
      {
        id: "edit.selectLayerContent",
        label: "Edit: Select Layer Content",
        category: "Edit",
        keywords: ["selection", "layer", "opaque", "alpha", "bounds"],
        run: () => selectLayerContentAction(),
      },
      {
        id: "edit.expandSelection",
        label: "Edit: Expand Selection (+1px)",
        category: "Edit",
        keywords: ["selection", "grow", "dilate", "expand"],
        run: () => expandSelectionAction(1),
      },
      {
        id: "edit.contractSelection",
        label: "Edit: Contract Selection (-1px)",
        category: "Edit",
        keywords: ["selection", "shrink", "erode", "contract"],
        run: () => contractSelectionAction(1),
      },
      {
        id: "edit.borderSelection",
        label: "Edit: Border Selection (1px)",
        category: "Edit",
        keywords: ["selection", "border", "ring", "outline"],
        run: () => borderSelectionAction(1),
      },
      {
        id: "edit.strokeSelection",
        label: "Edit: Stroke Selection (1px)",
        category: "Edit",
        keywords: ["selection", "stroke", "outline", "paint"],
        run: () => strokeSelectionAction(1, "outside"),
      },
      {
        id: "edit.fillSelectionFg",
        label: "Edit: Fill Selection (FG)",
        category: "Edit",
        shortcut: "Alt+Backspace",
        keywords: ["selection", "fill", "foreground", "bucket"],
        run: () => fillSelectionAction(false),
      },
      {
        id: "edit.fillSelectionBg",
        label: "Edit: Fill Selection (BG)",
        category: "Edit",
        shortcut: "Ctrl+Backspace",
        keywords: ["selection", "fill", "background", "bucket"],
        run: () => fillSelectionAction(true),
      },
      {
        id: "edit.flipH",
        label: "Edit: Flip Selection/Cel Horizontal",
        category: "Edit",
        keywords: ["flip", "mirror", "horizontal"],
        run: () => transformSelectionOrCel("flipH"),
      },
      {
        id: "edit.flipV",
        label: "Edit: Flip Selection/Cel Vertical",
        category: "Edit",
        keywords: ["flip", "mirror", "vertical"],
        run: () => transformSelectionOrCel("flipV"),
      },
      {
        id: "edit.rotateCW",
        label: "Edit: Rotate 90° CW",
        category: "Edit",
        keywords: ["rotate", "clockwise", "90"],
        run: () => transformSelectionOrCel("rotateCW"),
      },
      {
        id: "edit.rotateCCW",
        label: "Edit: Rotate 90° CCW",
        category: "Edit",
        keywords: ["rotate", "counterclockwise", "90"],
        run: () => transformSelectionOrCel("rotateCCW"),
      },
      {
        id: "edit.keybindings",
        label: "Edit: Keybindings...",
        category: "Edit",
        keywords: ["keybindings", "shortcuts", "hotkeys", "aseprite", "preset"],
        run: () => st().setKeybindingsModalOpen(true),
      },
    ];

    const fileCmds: ActionCommandEntry[] = [
      {
        id: "file.new",
        label: "File: New Sprite...",
        category: "File",
        shortcut: "Ctrl+N",
        run: () => st().setNewSpriteModalOpen(true),
      },
      {
        id: "file.open",
        label: "File: Open .pixet...",
        category: "File",
        shortcut: "Ctrl+O",
        run: () => {
          void openProjectAction();
        },
      },
      {
        id: "file.save",
        label: "File: Save",
        category: "File",
        shortcut: "Ctrl+S",
        run: () => {
          void saveProjectAction(false);
        },
      },
      {
        id: "file.export",
        label: "File: Export Spritesheet...",
        category: "File",
        shortcut: "Ctrl+E",
        run: () => st().setExportModalOpen(true),
      },
    ];

    const spriteCmds: ActionCommandEntry[] = [
      {
        id: "sprite.newLayer",
        label: "Sprite: New Layer",
        category: "Sprite",
        keywords: ["layer", "add"],
        run: () => st().addLayer(),
      },
      {
        id: "sprite.mergeDown",
        label: "Sprite: Merge Down",
        category: "Sprite",
        shortcut: "Ctrl+M",
        keywords: ["layer", "merge", "down"],
        run: () => mergeDownLayerAction(),
      },
      {
        id: "sprite.mergeVisible",
        label: "Sprite: Merge Visible",
        category: "Sprite",
        keywords: ["layer", "merge", "visible"],
        run: () => mergeVisibleLayersAction(),
      },
      {
        id: "sprite.flattenImage",
        label: "Sprite: Flatten Image",
        category: "Sprite",
        keywords: ["layer", "flatten", "background", "merge"],
        run: () => flattenImageAction(),
      },
      {
        id: "sprite.clearCel",
        label: "Sprite: Clear Cel",
        category: "Sprite",
        keywords: ["layer", "cel", "clear", "erase"],
        run: () => clearActiveCelAction(),
      },
      {
        id: "pbr.generateNormal",
        label: "3D & PBR: Generate Normal Map Layer",
        category: "Sprite",
        keywords: ["normal", "map", "3d", "lighting", "bump"],
        run: () => generateStudio3DMapLayerAction("normal"),
      },
      {
        id: "pbr.generateHeight",
        label: "3D & PBR: Generate Height / Displacement Map Layer",
        category: "Sprite",
        keywords: ["height", "displacement", "map", "bump", "3d"],
        run: () => generateStudio3DMapLayerAction("height"),
      },
      {
        id: "pbr.generateDepth",
        label: "3D & PBR: Generate Depth Map Layer",
        category: "Sprite",
        keywords: ["depth", "zbuffer", "map", "3d"],
        run: () => generateStudio3DMapLayerAction("depth"),
      },
      {
        id: "pbr.generateAllMaps",
        label: "3D & PBR: Generate All PBR Maps (Normal + Height + Depth)",
        category: "Sprite",
        keywords: ["pbr", "normal", "height", "depth", "displacement", "maps"],
        run: () => generateAllStudio3DMapsAction(),
      },
      {
        id: "workspace.studio3d",
        label: "Workspace: Open 3D Studio",
        category: "View",
        shortcut: "Ctrl+3",
        keywords: ["3d", "studio", "lighting", "turntable", "normal", "depth"],
        run: () => st().setWorkspaceMode("studio3d"),
      },
      {
        id: "sprite.toggleClippingMask",
        label: "Sprite: Toggle Clipping Mask",
        category: "Sprite",
        keywords: ["layer", "clip", "clipping", "mask"],
        run: () => {
          const s = st();
          const active = s.layers.find((l) => l.id === s.activeLayerId);
          if (active && active.kind === "raster") {
            s.toggleLayerClipped(active.id);
          }
        },
      },
      {
        id: "sprite.duplicateLayerAllFrames",
        label: "Sprite: Duplicate Layer Across All Frames",
        category: "Sprite",
        keywords: ["layer", "duplicate", "frames", "clone"],
        run: () => duplicateLayerAllFramesAction(),
      },
      {
        id: "sprite.newFrame",
        label: "Sprite: New Frame",
        category: "Sprite",
        keywords: ["frame", "add", "timeline"],
        run: () => addEmptyFrameAction(),
      },
      {
        id: "sprite.duplicateFrame",
        label: "Sprite: Duplicate Frame",
        category: "Sprite",
        keywords: ["frame", "duplicate", "clone"],
        run: () => duplicateCurrentFrameAction(),
      },
      {
        id: "sprite.canvasSize",
        label: "Sprite: Canvas Size...",
        category: "Sprite",
        keywords: ["resize", "canvas", "dimensions"],
        run: () => st().setCanvasSizeModalOpen(true),
      },
      {
        id: "sprite.rotate3d",
        label: "Sprite: 3D Rotate & Turntable...",
        category: "Sprite",
        shortcut: "Ctrl+3",
        keywords: ["3d", "rotate", "turntable", "voxel"],
        run: () => st().setRotate3dModalOpen(true),
      },
      {
        id: "sprite.autoCrop",
        label: "Sprite: Auto-Crop / Trim",
        category: "Sprite",
        keywords: ["crop", "trim", "bounds", "transparent"],
        run: () => autoCropSpriteAction(),
      },
      {
        id: "sprite.scaleSprite",
        label: "Sprite: Scale Sprite...",
        category: "Sprite",
        keywords: ["scale", "resize", "nearest", "scale2x", "rotsprite"],
        run: () => st().setFilterModalOpen(true, "scaleSprite"),
      },
    ];

    const filterCmds: ActionCommandEntry[] = [
      {
        id: "filter.open",
        label: "Filter: Open Filters & Adjustments...",
        category: "Filter",
        keywords: ["filters", "adjustments", "effects"],
        run: () => st().setFilterModalOpen(true, "outline"),
      },
      {
        id: "filter.outline",
        label: "Filter: Auto-Outline...",
        category: "Filter",
        keywords: ["outline", "border", "selective", "stroke"],
        run: () => st().setFilterModalOpen(true, "outline"),
      },
      {
        id: "filter.dropShadow",
        label: "Filter: Drop Shadow...",
        category: "Filter",
        keywords: ["shadow", "drop", "offset"],
        run: () => st().setFilterModalOpen(true, "dropShadow"),
      },
      {
        id: "filter.hsv",
        label: "Filter: HSV Adjust...",
        category: "Filter",
        keywords: ["hue", "saturation", "value", "color", "adjust"],
        run: () => st().setFilterModalOpen(true, "hsv"),
      },
      {
        id: "filter.colorReplace",
        label: "Filter: Color Replace...",
        category: "Filter",
        keywords: ["replace", "swap", "color", "tolerance"],
        run: () => st().setFilterModalOpen(true, "colorReplace"),
      },
      {
        id: "filter.quantize",
        label: "Filter: Quantize to Palette...",
        category: "Filter",
        keywords: ["quantize", "palette", "dither", "bayer", "floyd"],
        run: () => st().setFilterModalOpen(true, "quantize"),
      },
      {
        id: "filter.cleanup",
        label: "Filter: Pixel Cleanup...",
        category: "Filter",
        keywords: ["cleanup", "orphan", "holes", "specks"],
        run: () => st().setFilterModalOpen(true, "cleanup"),
      },
      {
        id: "filter.offsetWrap",
        label: "Filter: Offset / Wrap...",
        category: "Filter",
        keywords: ["offset", "wrap", "shift", "tile", "seamless"],
        run: () => st().setFilterModalOpen(true, "offsetWrap"),
      },
      {
        id: "filter.invert",
        label: "Filter: Invert Colors",
        category: "Filter",
        keywords: ["invert", "negative", "rgb"],
        run: () => {
          applyBufferFilterAction("Invert Colors", "cel", (buf, mask) =>
            applyInvertFilter(buf, mask)
          );
        },
      },
      {
        id: "filter.desaturate",
        label: "Filter: Desaturate",
        category: "Filter",
        keywords: ["desaturate", "grayscale", "greyscale", "luminance"],
        run: () => {
          applyBufferFilterAction("Desaturate", "cel", (buf, mask) =>
            applyDesaturateFilter(buf, mask)
          );
        },
      },
    ];

    return [
      ...toolCmds,
      ...viewCmds,
      ...editCmds,
      ...fileCmds,
      ...spriteCmds,
      ...filterCmds,
    ];
  }, []);

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

  useEffect(() => {
    setSelectedIndex((prev) => {
      if (results.length === 0) return 0;
      return Math.max(0, Math.min(results.length - 1, prev));
    });
  }, [results.length]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const activeEl = listRef.current.children[selectedIndex] as
      | HTMLElement
      | undefined;
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
      if (results.length > 0) {
        setSelectedIndex((i) => (i + 1) % results.length);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length > 0) {
        setSelectedIndex((i) => (i - 1 + results.length) % results.length);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      execute(results[selectedIndex]);
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
          {results.length === 0 ? (
            <div className="draw-cmd-empty">No matching commands</div>
          ) : (
            results.map((cmd, idx) => {
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
