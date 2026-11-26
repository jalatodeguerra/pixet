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
import { cullInternalCoplanarFaces } from "../engine/model3d/meshOps";
import { mutateModel3D } from "../engine/model3d/model3dActions";
import {
  createPrimitiveNode,
  instantiateStarterTemplate,
} from "../engine/model3d/primitives";
import type { Model3DSubMode } from "../engine/model3d/types";
import { autoPackModelUvs } from "../engine/model3d/uvOps";
import {
  generateAllStudio3DMapsAction,
  generateStudio3DMapLayerAction,
} from "./studio3d/studio3dActions";
import { downloadExportedModelAction } from "./studio3d/three/modelExporter";
import {
  bakeModel3DToTilesetAction,
  bakeModel3DTurntableAction,
} from "./studio3d/three/modelSpriteBaker";
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
        id: "view.zoomFit",
        label: "View: Fit to Window",
        category: "View",
        shortcut: "Ctrl+0",
        keywords: ["zoom", "fit", "screen", "reset"],
        run: () => st().fitZoomToWindow(),
      },
      {
        id: "view.zoomActual",
        label: "View: Actual Size (1:1)",
        category: "View",
        shortcut: "Ctrl+1",
        keywords: ["zoom", "100%", "actual", "pixel"],
        run: () => st().zoomActualSize(),
      },
      {
        id: "view.zoomIn",
        label: "View: Zoom In",
        category: "View",
        shortcut: "+",
        keywords: ["zoom", "magnify", "larger"],
        run: () => st().zoomStep(1),
      },
      {
        id: "view.zoomOut",
        label: "View: Zoom Out",
        category: "View",
        shortcut: "-",
        keywords: ["zoom", "smaller"],
        run: () => st().zoomStep(-1),
      },
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

    const switchToLowPolySubMode = (subMode: Model3DSubMode) => {
      const s = st();
      if (s.workspaceMode !== "studio3d") s.setWorkspaceMode("studio3d");
      s.patchStudio3D({ workspaceKind: "lowpoly3d", subMode });
    };

    const model3dCmds: ActionCommandEntry[] = [
      ...(
        [
          ["model", "Model"],
          ["tile", "Tile"],
          ["uv", "UV"],
          ["paint", "Paint"],
          ["animate", "Animate"],
          ["bake", "Bake"],
        ] as const satisfies readonly [Model3DSubMode, string][]
      ).map(([subMode, label]) => ({
        id: `model3d.mode.${subMode}`,
        label: `3D Model: Switch to Low-Poly 3D (${label})`,
        category: "3D Model",
        keywords: ["lowpoly", "3d", "model", subMode, label.toLowerCase()],
        run: () => switchToLowPolySubMode(subMode),
      })),
      {
        id: "model3d.addCuboid",
        label: "3D Model: Add Cuboid",
        category: "3D Model",
        keywords: ["cuboid", "box", "primitive", "add", "3d"],
        run: () => {
          switchToLowPolySubMode("model");
          mutateModel3D("Add Cuboid", (eng) => {
            eng.addNode(
              createPrimitiveNode("cuboid", {
                name: `Cuboid ${eng.nodes.length + 1}`,
              })
            );
          });
        },
      },
      {
        id: "model3d.template.chibi16",
        label: "3D Model: Instantiate Chibi 16px Template",
        category: "3D Model",
        keywords: ["template", "chibi", "16px", "rig", "character", "3d"],
        run: () => {
          switchToLowPolySubMode("model");
          mutateModel3D("Instantiate Chibi 16px", (eng) => {
            instantiateStarterTemplate(eng, "chibi16");
          });
        },
      },
      {
        id: "model3d.template.humanoid32",
        label: "3D Model: Instantiate Retro Humanoid 32px Template",
        category: "3D Model",
        keywords: ["template", "humanoid", "32px", "rig", "character", "3d"],
        run: () => {
          switchToLowPolySubMode("model");
          mutateModel3D("Instantiate Retro Humanoid 32px", (eng) => {
            instantiateStarterTemplate(eng, "humanoid32");
          });
        },
      },
      {
        id: "model3d.template.dungeonChunk",
        label: "3D Model: Instantiate Dungeon Chunk Template",
        category: "3D Model",
        keywords: ["template", "dungeon", "room", "chunk", "crocotile", "3d"],
        run: () => {
          switchToLowPolySubMode("model");
          mutateModel3D("Instantiate Dungeon Chunk", (eng) => {
            instantiateStarterTemplate(eng, "dungeonChunk");
          });
        },
      },
      {
        id: "model3d.autoPackUvs",
        label: "3D Model: Auto-Pack 3D UVs (1px Gutter)",
        category: "3D Model",
        keywords: ["uv", "pack", "autopack", "3d"],
        run: () => {
          const s = st();
          let packed = 0;
          mutateModel3D("Auto-Pack 3D UVs", (eng) => {
            const res = autoPackModelUvs(
              eng.nodes,
              Math.max(1, s.canvasWidth),
              Math.max(1, s.canvasHeight),
              1
            );
            eng.nodes = res.nodes;
            packed = res.packedCount;
          });
          s.setStatusMessage(`Packed ${packed} 3D UV island(s)`);
        },
      },
      {
        id: "model3d.cullInternalFaces",
        label: "3D Model: Cull Internal 3D Faces",
        category: "3D Model",
        keywords: ["cull", "hidden", "coplanar", "faces", "optimize", "3d"],
        run: () => {
          let culled = 0;
          mutateModel3D("Cull Internal Coplanar Faces", (eng) => {
            const res = cullInternalCoplanarFaces(eng.nodes);
            culled = res.culledCount;
            eng.nodes = res.nodes;
          });
          st().setStatusMessage(`Culled ${culled} internal coplanar face(s)`);
        },
      },
      {
        id: "model3d.export.glb",
        label: "3D Model: Export 3D Model (.GLB)",
        category: "3D Model",
        keywords: ["export", "glb", "gltf", "godot", "unity", "3d"],
        run: () => {
          void downloadExportedModelAction("glb");
        },
      },
      {
        id: "model3d.export.obj",
        label: "3D Model: Export 3D Model (.OBJ + .MTL)",
        category: "3D Model",
        keywords: ["export", "obj", "mtl", "quad", "blender", "3d"],
        run: () => {
          void downloadExportedModelAction("obj");
        },
      },
      {
        id: "model3d.bake.turntable",
        label: "3D Model: Bake 3D Model Turntable to Sprite",
        category: "3D Model",
        keywords: ["bake", "turntable", "sprite", "2d", "ortho", "3d"],
        run: () => {
          bakeModel3DTurntableAction({ directions: 8, projection: "ortho" });
        },
      },
      {
        id: "model3d.bake.tileset",
        label: "3D Model: Bake 3D Model to Tileset (4 Rotations)",
        category: "3D Model",
        keywords: ["bake", "tileset", "tile", "rotations", "isometric", "3d"],
        run: () => {
          bakeModel3DToTilesetAction({ rotations: 4, projection: "ortho" });
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
      ...model3dCmds,
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
