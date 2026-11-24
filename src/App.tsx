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
import { Rotate3DModal } from "./components/Rotate3DModal";
import { StatusBar } from "./components/StatusBar";
import { ImportTilesetModal } from "./components/tiles/ImportTilesetModal";
import { ToolOptionsBar } from "./components/ToolOptionsBar";
import { TopBar } from "./components/TopBar";
import { WorkspaceLayoutRoot } from "./components/layout/WorkspaceLayoutRoot";
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

export function App() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const fps = useEditorStore((s) => s.fps);
  const frames = useEditorStore((s) => s.frames);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const nextFrame = useEditorStore((s) => s.nextFrame);
  const statusMessage = useEditorStore((s) => s.statusMessage);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

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
        if (e.code === "Space") {
          e.preventDefault();
          useEditorStore.getState().toggleMaximizeArea();
          return;
        }
        if (ctrlKey === "t" && e.shiftKey) {
          e.preventDefault();
          useEditorStore.getState().toggleToolRailVisible();
          return;
        }
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
          st.setRotate3dModalOpen(!st.rotate3dModalOpen);
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
        <WorkspaceLayoutRoot />
      </main>

      <StatusBar />
      <ExportModal />
      <RigExportModal />
      <Rotate3DModal />
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
