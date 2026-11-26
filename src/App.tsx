import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { CanvasSizeModal } from "./components/CanvasSizeModal";
import { CommandPalette } from "./components/CommandPalette";
import { ContextMenu } from "./components/ContextMenu";
import { ExportModal } from "./components/ExportModal";
import { FilterModal } from "./components/draw/FilterModal";
import { KeybindingsModal } from "./components/draw/KeybindingsModal";
import { RigExportModal } from "./components/rig/RigExportModal";
import { ImportImageModal } from "./components/ImportImageModal";
import { NewSpriteModal } from "./components/NewSpriteModal";
import { RightSidebar } from "./components/RightSidebar";
import { Studio3DViewport } from "./components/studio3d/Studio3DViewport";
import { StatusBar } from "./components/StatusBar";
import { Timeline } from "./components/Timeline";
import { ImportTilesetModal } from "./components/tiles/ImportTilesetModal";
import { ToolOptionsBar } from "./components/ToolOptionsBar";
import { ToolRail } from "./components/ToolRail";
import { TopBar } from "./components/TopBar";
import { Viewport } from "./components/Viewport";
import {
  formatEventToChord,
  resolveActionForChord,
} from "./engine/config/keybindings";
import { pixelEngine } from "./engine/document/PixelEngine";
import { performRedo, performUndo } from "./engine/document/historyActions";
import { mergeDownLayerAction } from "./engine/document/layerActions";
import {
  captureCustomBrushFromSelectionAction,
  commitFloatingSelection,
  copySelection,
  copySelectionToNewLayer,
  cutSelection,
  cutSelectionToNewLayer,
  deleteSelection,
  deselectAll,
  fillSelectionAction,
  invertSelectionAction,
  pasteClipboard,
  selectAllCanvas,
} from "./engine/document/selectionActions";
import {
  beginFreeTransformAction,
  cancelFreeTransformAction,
  commitFreeTransformAction,
} from "./engine/document/transformActions";
import {
  openProjectAction,
  saveProjectAction,
} from "./engine/io/projectBridge";
import {
  decodeImageFileToPixelBuffer,
  isSupportedImageFile,
  pickImageFileForImport,
} from "./engine/io/imageImport";
import { useEditorStore, type ToolId } from "./store/editorStore";
import { DRAW_TOOL_BY_ID } from "./components/draw/drawTools";
import {
  RIG_TOOL_BY_ID,
  RIG_TOOL_SHORTCUTS,
  rigToolDisabledReason,
} from "./components/rig/rigTools";
import { TilesetBrowserPanel } from "./components/tiles/TilesetBrowserPanel";
import {
  copyTileSelectionToClipboard,
  deleteTileSelectionCells,
} from "./components/tiles/TileToolOptionsBar";
import { TILE_TOOL_SHORTCUTS } from "./components/tiles/tileTools";
import { packCell, rotateCellCW, unpackCell } from "./engine/tiles/cell";
import {
  flipBrushH,
  flipBrushV,
  rotateBrushCW,
} from "./engine/tiles/mapTools";
import {
  createModelClip,
  recordNodeTransformKeyframes,
} from "./engine/model3d/animEval";
import { flipQuadDiagonal, mirrorNode } from "./engine/model3d/meshOps";
import { mutateModel3D } from "./engine/model3d/model3dActions";
import {
  cycleTileCursorPlane,
  flipTileCursor,
  rotateTileCursorCW,
  stepTileCursor,
  type TileCursorStepDir,
} from "./engine/model3d/tileStamp";
import type { SelectionGranularity } from "./engine/model3d/types";

export function App() {
  const panelsCollapsed = useEditorStore((s) => s.panelsCollapsed);
  const timelineCollapsed = useEditorStore((s) => s.timelineCollapsed);
  const timelineHeight = useEditorStore((s) => s.timelineHeight);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const tilesetBrowserDocked = useEditorStore((s) => s.tilesetBrowserDocked);
  const setRightPanelWidth = useEditorStore((s) => s.setRightPanelWidth);
  const setTimelineHeight = useEditorStore((s) => s.setTimelineHeight);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const fps = useEditorStore((s) => s.fps);
  const frames = useEditorStore((s) => s.frames);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const nextFrame = useEditorStore((s) => s.nextFrame);
  const statusMessage = useEditorStore((s) => s.statusMessage);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const [draggingRight, setDraggingRight] = useState(false);
  const [draggingTimeline, setDraggingTimeline] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  // Variable-duration playback timer loop
  useEffect(() => {
    if (!isPlaying) return;
    const durationMs =
      frames[currentFrame]?.durationMs ?? Math.round(1000 / fps);
    const id = window.setTimeout(() => {
      const state = useEditorStore.getState();
      if (state.workspaceMode === "rig" && state.rigMode === "animate") {
        const clip = pixelEngine.rig.getActiveClip();
        const maxFrames = Math.max(1, clip.frameCount);
        const loop = clip.loop !== false;
        pixelEngine.rig.clearPoseOverrides();
        if (state.currentFrame + 1 < maxFrames) {
          state.setCurrentFrame(state.currentFrame + 1);
        } else if (loop) {
          state.setCurrentFrame(0);
        } else {
          state.togglePlaying();
        }
        return;
      }
      if (
        state.workspaceMode === "studio3d" &&
        state.studio3d.workspaceKind === "lowpoly3d" &&
        state.studio3d.subMode === "animate"
      ) {
        const eng = pixelEngine.model3d;
        const activeClip =
          (eng.activeClipId
            ? eng.clips.find((c) => c.id === eng.activeClipId)
            : undefined) ?? eng.clips[0];
        const maxFrames = Math.max(
          1,
          activeClip?.frameCount ?? state.frames.length
        );
        const loop = activeClip?.loop ?? state.loopPlayback;
        if (state.currentFrame + 1 < maxFrames) {
          state.setCurrentFrame(state.currentFrame + 1);
        } else if (loop) {
          state.setCurrentFrame(0);
        } else {
          state.togglePlaying();
        }
        return;
      }
      nextFrame();
    }, Math.max(16, durationMs));
    return () => window.clearTimeout(id);
  }, [isPlaying, currentFrame, frames, fps, nextFrame]);

  // Auto-clear transient status messages
  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 3500);
    return () => window.clearTimeout(timer);
  }, [statusMessage, setStatusMessage]);

  // Global keyboard shortcuts
  useEffect(() => {
    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT");

    const runKeybindingAction = (actionId: string): boolean => {
      const st = useEditorStore.getState();
      if (actionId === "view.commandPalette") {
        st.setCommandPaletteOpen(!st.commandPaletteOpen);
        return true;
      }
      if (actionId === "edit.freeTransform") {
        beginFreeTransformAction();
        return true;
      }
      if (actionId === "edit.captureBrush") {
        captureCustomBrushFromSelectionAction();
        return true;
      }
      if (actionId === "layer.mergeDown") {
        mergeDownLayerAction();
        return true;
      }
      if (actionId === "view.flipH") {
        if (st.workspaceMode === "draw") {
          st.toggleViewFlipH();
          return true;
        }
        return false;
      }
      if (actionId === "view.flipV") {
        if (st.workspaceMode === "draw") {
          st.toggleViewFlipV();
          return true;
        }
        return false;
      }
      if (actionId.startsWith("tool.")) {
        const toolId = actionId.slice(5) as ToolId;
        if (DRAW_TOOL_BY_ID.has(toolId)) {
          st.setActiveTool(toolId);
          return true;
        }
      }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const stNow = useEditorStore.getState();
      if (stNow.keybindingsModalOpen) {
        return;
      }

      const chord = formatEventToChord(e);
      const boundAction = chord
        ? resolveActionForChord(chord, stNow.keybindings)
        : null;

      if (boundAction === "view.commandPalette") {
        if (stNow.commandPaletteOpen || !isEditable(e.target)) {
          e.preventDefault();
          stNow.setCommandPaletteOpen(!stNow.commandPaletteOpen);
          return;
        }
      }

      if (isEditable(e.target)) {
        return;
      }

      // Low-Poly 3D workspace keyboard isolation (runs before Draw tool shortcuts)
      if (
        stNow.workspaceMode === "studio3d" &&
        stNow.studio3d.workspaceKind === "lowpoly3d"
      ) {
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
          const ctrlKey = e.key.toLowerCase();
          if (ctrlKey === "z") {
            e.preventDefault();
            if (e.shiftKey) performRedo();
            else performUndo();
            return;
          }
          if (ctrlKey === "y") {
            e.preventDefault();
            performRedo();
            return;
          }
          if (ctrlKey === "s") {
            e.preventDefault();
            void saveProjectAction(e.shiftKey);
            return;
          }
          if (ctrlKey === "n") {
            e.preventDefault();
            stNow.setNewSpriteModalOpen(true);
            return;
          }
          if (ctrlKey === "o") {
            e.preventDefault();
            void openProjectAction();
            return;
          }
          if (ctrlKey === "3") {
            e.preventDefault();
            stNow.setWorkspaceMode("draw");
            return;
          }
          if (ctrlKey === "d") {
            e.preventDefault();
            const ids = [...pixelEngine.model3d.selectedNodeIds];
            if (ids.length > 0) {
              mutateModel3D("Duplicate Nodes", (eng) => {
                eng.duplicateNodes(ids);
              });
              stNow.setStatusMessage(`Duplicated ${ids.length} node(s)`);
            }
            return;
          }
          if (ctrlKey === "a") {
            e.preventDefault();
            const allIds = pixelEngine.model3d.nodes.map((n) => n.id);
            pixelEngine.model3d.selectNodes(
              allIds,
              allIds[allIds.length - 1] ?? null
            );
            stNow.bumpModel3DVersion();
            return;
          }
          if (ctrlKey === "t") {
            e.preventDefault();
            const eng = pixelEngine.model3d;
            const activeNode = eng.activeNodeId
              ? eng.getNode(eng.activeNodeId)
              : undefined;
            if (activeNode && activeNode.kind === "mesh" && activeNode.mesh && !activeNode.locked) {
              const selFaces = eng.selectedFaces[activeNode.id] ?? [];
              const targetFaceIds =
                selFaces.length > 0
                  ? selFaces
                  : activeNode.mesh.faces
                      .filter((f) => f.verts.length === 4)
                      .map((f) => f.id);
              if (targetFaceIds.length > 0) {
                mutateModel3D("Flip Quad Diagonal", (m) => {
                  const n = m.getNode(activeNode.id);
                  if (!n || !n.mesh) return;
                  m.updateNode(n.id, {
                    mesh: flipQuadDiagonal(n.mesh, targetFaceIds),
                  });
                });
                stNow.setStatusMessage(
                  `Flipped diagonal on ${targetFaceIds.length} quad(s)`
                );
              }
            }
            return;
          }
          if (ctrlKey === "m") {
            e.preventDefault();
            const ids = [...pixelEngine.model3d.selectedNodeIds];
            if (ids.length > 0) {
              mutateModel3D("Mirror 3D Node", (eng) => {
                for (const id of ids) {
                  const node = eng.getNode(id);
                  if (!node || node.locked) continue;
                  const mirrored = mirrorNode(node, "x", true);
                  eng.updateNode(id, {
                    transform: mirrored.transform,
                    cuboid: mirrored.cuboid,
                    mesh: mirrored.mesh,
                  });
                }
              });
              stNow.setStatusMessage(`Mirrored ${ids.length} node(s) across X`);
            }
            return;
          }
          return;
        }

        if (e.altKey) {
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();
          stNow.togglePlaying();
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          pixelEngine.model3d.clearSelection();
          stNow.bumpModel3DVersion();
          return;
        }

        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          const ids = [...pixelEngine.model3d.selectedNodeIds];
          if (ids.length > 0) {
            mutateModel3D("Delete Nodes", (eng) => {
              eng.deleteNodes(ids);
            });
            stNow.setStatusMessage(`Deleted ${ids.length} node(s)`);
          }
          return;
        }

        if (e.key === "Tab") {
          e.preventDefault();
          stNow.togglePanelsCollapsed();
          return;
        }

        const key = e.key.toLowerCase();

        if (stNow.studio3d.subMode === "tile") {
          const eng = pixelEngine.model3d;
          const stepDirMap: Record<string, TileCursorStepDir> = {
            ArrowLeft: "left",
            ArrowRight: "right",
            ArrowUp: "forward",
            ArrowDown: "backward",
            PageUp: "up",
            PageDown: "down",
          };
          const stepDir = stepDirMap[e.key];
          if (stepDir) {
            e.preventDefault();
            eng.patchTileCursor(stepTileCursor(eng.tileCursor, stepDir));
            stNow.bumpModel3DVersion();
            return;
          }
          if (e.code === "Space") {
            e.preventDefault();
            eng.patchTileCursor(cycleTileCursorPlane(eng.tileCursor));
            stNow.bumpModel3DVersion();
            return;
          }
          if (key === "r") {
            e.preventDefault();
            eng.patchTileCursor(rotateTileCursorCW(eng.tileCursor));
            stNow.bumpModel3DVersion();
            return;
          }
          if (key === "f") {
            e.preventDefault();
            eng.patchTileCursor(
              flipTileCursor(eng.tileCursor, e.shiftKey ? "y" : "x")
            );
            stNow.bumpModel3DVersion();
            return;
          }
        }

        if (stNow.studio3d.subMode === "paint") {
          const paintToolMap: Record<
            string,
            "brush" | "eraser" | "fillFace" | "eyedropper" | "vertexColor"
          > = {
            b: "brush",
            e: "eraser",
            g: "fillFace",
            i: "eyedropper",
            v: "vertexColor",
          };
          const mappedPaintTool = paintToolMap[key];
          if (mappedPaintTool) {
            e.preventDefault();
            stNow.patchStudio3D({ paint3dTool: mappedPaintTool });
            return;
          }
        }

        if (stNow.studio3d.subMode === "animate") {
          if (key === "k") {
            e.preventDefault();
            const eng = pixelEngine.model3d;
            const activeNode = eng.activeNodeId
              ? eng.getNode(eng.activeNodeId)
              : undefined;
            if (activeNode) {
              mutateModel3D("Record 3D Keyframe", (m) => {
                const node = m.getNode(activeNode.id);
                if (!node) return;
                let clip =
                  m.clips.find((c) => c.id === m.activeClipId) ?? m.clips[0];
                if (!clip) {
                  clip = createModelClip(
                    "Clip 1",
                    Math.max(1, stNow.frames.length),
                    Math.max(1, stNow.fps),
                    true
                  );
                  m.clips.push(clip);
                  m.activeClipId = clip.id;
                }
                const updated = recordNodeTransformKeyframes(
                  clip,
                  node,
                  stNow.currentFrame
                );
                const idx = m.clips.findIndex((c) => c.id === updated.id);
                if (idx >= 0) m.clips[idx] = updated;
              });
              stNow.setStatusMessage(
                `Keyframed "${activeNode.name}" at frame ${stNow.currentFrame + 1}`
              );
            }
            return;
          }
        }

        if (key === "q") {
          e.preventDefault();
          stNow.patchStudio3D({ gizmoMode: "select" });
          return;
        }
        if (key === "w") {
          e.preventDefault();
          stNow.patchStudio3D({ gizmoMode: "move" });
          return;
        }
        if (key === "e") {
          e.preventDefault();
          stNow.patchStudio3D({ gizmoMode: "rotate" });
          return;
        }
        if (key === "r") {
          e.preventDefault();
          stNow.patchStudio3D({ gizmoMode: "scale" });
          return;
        }

        if (stNow.studio3d.subMode === "model") {
          const granularityMap: Record<string, SelectionGranularity> = {
            "1": "object",
            "2": "vertex",
            "3": "edge",
            "4": "face",
          };
          const mappedGranularity = granularityMap[e.key];
          if (mappedGranularity) {
            e.preventDefault();
            pixelEngine.model3d.setSelectionGranularity(mappedGranularity);
            stNow.bumpModel3DVersion();
            return;
          }
        }

        // Do not allow B, E, G, M, V, Delete, etc. to fall through to Draw shortcuts
        return;
      }

      if (
        boundAction &&
        (e.ctrlKey || e.metaKey || e.altKey) &&
        (boundAction === "edit.freeTransform" ||
          boundAction === "edit.captureBrush" ||
          boundAction === "layer.mergeDown" ||
          boundAction === "view.flipH" ||
          boundAction === "view.flipV" ||
          (stNow.workspaceMode !== "rig" &&
            !(stNow.workspaceMode === "tiles" && stNow.tilesMode === "map") &&
            boundAction.startsWith("tool.")))
      ) {
        if (runKeybindingAction(boundAction)) {
          e.preventDefault();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const ctrlKey = e.key.toLowerCase();
        if (e.key === "Backspace") {
          const st = useEditorStore.getState();
          if (st.hasSelection && !st.freeTransformActive) {
            e.preventDefault();
            fillSelectionAction(true);
            return;
          }
        }
        if (ctrlKey === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            performRedo();
          } else {
            performUndo();
          }
          return;
        }
        if (ctrlKey === "y") {
          e.preventDefault();
          performRedo();
          return;
        }
        if (ctrlKey === "c") {
          e.preventDefault();
          const st = useEditorStore.getState();
          if (st.workspaceMode === "tiles" && st.tilesMode === "map") {
            copyTileSelectionToClipboard(false);
          } else {
            copySelection();
          }
          return;
        }
        if (ctrlKey === "x") {
          e.preventDefault();
          const st = useEditorStore.getState();
          if (st.workspaceMode === "tiles" && st.tilesMode === "map") {
            copyTileSelectionToClipboard(true);
          } else if (e.shiftKey) {
            cutSelectionToNewLayer();
          } else {
            cutSelection();
          }
          return;
        }
        if (ctrlKey === "j") {
          e.preventDefault();
          copySelectionToNewLayer();
          return;
        }
        if (ctrlKey === "v") {
          e.preventDefault();
          const st = useEditorStore.getState();
          if (st.workspaceMode === "tiles" && st.tilesMode === "map") {
            if (st.tileClipboard) {
              st.setTileBrush(st.tileClipboard);
              st.setTileTool("stamp");
              st.setStatusMessage(
                `Pasted ${st.tileClipboard.cols}×${st.tileClipboard.rows} tile brush`
              );
            }
          } else {
            pasteClipboard();
          }
          return;
        }
        if (ctrlKey === "a") {
          e.preventDefault();
          if (e.shiftKey) {
            invertSelectionAction();
          } else {
            selectAllCanvas();
          }
          return;
        }
        if (ctrlKey === "d") {
          e.preventDefault();
          const st = useEditorStore.getState();
          if (st.workspaceMode === "tiles" && st.tilesMode === "map") {
            st.setTileSelection([]);
          } else {
            deselectAll();
          }
          return;
        }
        if (ctrlKey === "s") {
          e.preventDefault();
          void saveProjectAction(e.shiftKey);
          return;
        }
        if (ctrlKey === "n") {
          e.preventDefault();
          useEditorStore.getState().setNewSpriteModalOpen(true);
          return;
        }
        if (ctrlKey === "o") {
          e.preventDefault();
          void openProjectAction();
          return;
        }
        if (ctrlKey === "e") {
          e.preventDefault();
          useEditorStore.getState().setExportModalOpen(true);
          return;
        }
        if (ctrlKey === "3") {
          e.preventDefault();
          const st = useEditorStore.getState();
          st.setWorkspaceMode(
            st.workspaceMode === "studio3d" ? "draw" : "studio3d"
          );
          return;
        }
        if (ctrlKey === "i" && e.shiftKey) {
          e.preventDefault();
          void pickImageFileForImport()
            .then((img) => {
              if (img) useEditorStore.getState().setPendingImportImage(img);
            })
            .catch((err) => {
              useEditorStore
                .getState()
                .setStatusMessage(`Import failed: ${String(err)}`);
            });
          return;
        }
        return;
      }

      if (e.altKey) {
        if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey) {
          const st = useEditorStore.getState();
          if (st.hasSelection && !st.freeTransformActive) {
            e.preventDefault();
            fillSelectionAction(false);
          }
        }
        return;
      }

      const key = e.key.toLowerCase();
      const state = useEditorStore.getState();

      if (e.key === "Escape") {
        e.preventDefault();
        if (state.freeTransformActive) {
          cancelFreeTransformAction();
        } else {
          deselectAll();
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const st = useEditorStore.getState();
        if (
          st.workspaceMode === "tiles" &&
          st.tilesMode === "map" &&
          st.tileSelection.length > 0
        ) {
          e.preventDefault();
          deleteTileSelectionCells();
          return;
        }
        if (pixelEngine.floating || pixelEngine.selection) {
          e.preventDefault();
          deleteSelection();
          return;
        }
      }

      if (
        pixelEngine.floating &&
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown")
      ) {
        e.preventDefault();
        const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
        const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        pixelEngine.floating.offsetX += dx;
        pixelEngine.floating.offsetY += dy;
        if (pixelEngine.selection) {
          pixelEngine.selection = pixelEngine.selection.translate(dx, dy);
        }
        pixelEngine.emitChange();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        state.togglePanelsCollapsed();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (state.freeTransformActive) {
          commitFreeTransformAction();
        } else if (pixelEngine.floating) {
          commitFloatingSelection();
          state.setStatusMessage("Committed selection");
        } else {
          state.togglePlaying();
        }
        return;
      }

      if (
        key === "x" &&
        !(state.workspaceMode === "tiles" && state.tilesMode === "map")
      ) {
        state.swapColors();
        return;
      }

      if (e.key === "[") {
        state.setBrushSize(state.brushSize - 1);
        return;
      }

      if (e.key === "]") {
        state.setBrushSize(state.brushSize + 1);
        return;
      }

      if (e.key === "=" || e.key === "+") {
        state.setZoom(state.zoom + 1);
        return;
      }

      if (e.key === "-") {
        state.setZoom(state.zoom - 1);
        return;
      }

      // Rig workspace shortcuts replace the drawing tool shortcuts entirely.
      if (state.workspaceMode === "rig") {
        const rigTool = RIG_TOOL_SHORTCUTS[key];
        if (rigTool) {
          const def = RIG_TOOL_BY_ID.get(rigTool);
          const reason = def ? rigToolDisabledReason(def, state.rigMode) : null;
          if (def && reason) {
            state.setStatusMessage(`${def.label}: ${reason}`);
            return;
          }
          state.setRigTool(rigTool);
          return;
        }
        // Never fall through to drawing tool shortcuts in the rig workspace.
        return;
      }

      // Tiles Map workspace shortcuts replace drawing shortcuts.
      if (state.workspaceMode === "tiles" && state.tilesMode === "map") {
        if (e.key === "Escape") {
          state.setTileSelection([]);
          return;
        }
        if (key === "x") {
          if (state.tileBrush) {
            const flipped = flipBrushH({
              cols: state.tileBrush.cols,
              rows: state.tileBrush.rows,
              cells: new Uint32Array(state.tileBrush.cells),
            });
            state.setTileBrush({
              tilesetIndex: state.tileBrush.tilesetIndex,
              cols: flipped.cols,
              rows: flipped.rows,
              cells: Array.from(flipped.cells),
            });
          } else {
            state.setTileBrushFlags({
              ...state.tileBrushFlags,
              flipH: !state.tileBrushFlags.flipH,
            });
          }
          return;
        }
        if (key === "y") {
          if (state.tileBrush) {
            const flipped = flipBrushV({
              cols: state.tileBrush.cols,
              rows: state.tileBrush.rows,
              cells: new Uint32Array(state.tileBrush.cells),
            });
            state.setTileBrush({
              tilesetIndex: state.tileBrush.tilesetIndex,
              cols: flipped.cols,
              rows: flipped.rows,
              cells: Array.from(flipped.cells),
            });
          } else {
            state.setTileBrushFlags({
              ...state.tileBrushFlags,
              flipV: !state.tileBrushFlags.flipV,
            });
          }
          return;
        }
        if (key === "z") {
          if (state.tileBrush) {
            const rotated = rotateBrushCW({
              cols: state.tileBrush.cols,
              rows: state.tileBrush.rows,
              cells: new Uint32Array(state.tileBrush.cells),
            });
            state.setTileBrush({
              tilesetIndex: state.tileBrush.tilesetIndex,
              cols: rotated.cols,
              rows: rotated.rows,
              cells: Array.from(rotated.cells),
            });
          } else {
            const packed = packCell(0, 1, state.tileBrushFlags);
            const rot = unpackCell(rotateCellCW(packed));
            state.setTileBrushFlags({
              flipH: rot.flipH,
              flipV: rot.flipV,
              flipD: rot.flipD,
            });
          }
          return;
        }
        const mappedTileTool = TILE_TOOL_SHORTCUTS[key];
        if (mappedTileTool) {
          state.setTileTool(mappedTileTool);
        }
        return;
      }

      if (boundAction && runKeybindingAction(boundAction)) {
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Drag resize handlers
  useEffect(() => {
    if (!draggingRight && !draggingTimeline) return;

    const onMouseMove = (e: MouseEvent) => {
      if (draggingRight) {
        setRightPanelWidth(window.innerWidth - e.clientX);
      }
      if (draggingTimeline) {
        // Status bar is 24px at bottom
        setTimelineHeight(window.innerHeight - 24 - e.clientY);
      }
    };

    const onMouseUp = () => {
      setDraggingRight(false);
      setDraggingTimeline(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [draggingRight, draggingTimeline, setRightPanelWidth, setTimelineHeight]);

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find((f) => isSupportedImageFile(f));
    if (!imageFile) {
      if (files.length > 0) {
        setStatusMessage("Drop a PNG, WebP, JPG, BMP, or GIF image");
      }
      return;
    }

    void decodeImageFileToPixelBuffer(imageFile)
      .then((decoded) => {
        useEditorStore.getState().setPendingImportImage(decoded);
      })
      .catch((err) => {
        setStatusMessage(`Image import failed: ${String(err)}`);
      });
  };

  return (
    <div
      className="editor-shell"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <TopBar />
      <ToolOptionsBar />

      <main className="workspace-main">
        <div className="workspace-middle">
          {!panelsCollapsed && <ToolRail />}
          {workspaceMode === "studio3d" ? <Studio3DViewport /> : <Viewport />}
          {!panelsCollapsed && (
            <>
              <div
                className={`resizer-vertical ${draggingRight ? "dragging" : ""}`}
                onMouseDown={() => setDraggingRight(true)}
              />
              <RightSidebar />
            </>
          )}
          <div id="floating-panels-root" className="floating-panels-root" />
        </div>

        {!panelsCollapsed && (
          <>
            {!timelineCollapsed && (
              <div
                className={`resizer-horizontal ${draggingTimeline ? "dragging" : ""}`}
                onMouseDown={() => setDraggingTimeline(true)}
              />
            )}
            {workspaceMode === "tiles" && tilesetBrowserDocked ? (
              <div
                className="tiles-docked-browser"
                style={{ height: timelineHeight }}
              >
                <TilesetBrowserPanel docked />
              </div>
            ) : (
              <Timeline />
            )}
          </>
        )}
      </main>

      <StatusBar />
      <ExportModal />
      <RigExportModal />
      <ImportImageModal />
      <NewSpriteModal />
      <CanvasSizeModal />
      <FilterModal />
      <ImportTilesetModal />
      <CommandPalette />
      <KeybindingsModal />
      <ContextMenu />
      {isDragOver && (
        <div className="dropzone-overlay">
          <div className="dropzone-card">
            <Upload size={26} />
            <span>Drop image to import into Pixet</span>
            <small>PNG, WebP, JPG, BMP, or GIF — New Sprite, Layer, or Spritesheet</small>
          </div>
        </div>
      )}
    </div>
  );
}
