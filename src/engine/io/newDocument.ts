/**
 * The single document-replacement path for "new sprite" and sample loading.
 * Callers are responsible for confirmDiscardChanges() beforehand.
 */
import { hexToRgba } from "../document/PixelBuffer.ts";
import { pixelEngine } from "../document/PixelEngine.ts";
import type { SampleDocument } from "../document/samples.ts";
import { commitFloatingSelection } from "../document/selectionActions.ts";
import { syncTimelineCels } from "../document/timelineActions.ts";
import { resetRigHistory } from "../rig/rigActions.ts";
import { useEditorStore } from "../../store/editorStore.ts";
import { markDocumentReplaced } from "./projectBridge.ts";

export type NewDocumentBackground = "transparent" | "secondary" | "white";

export interface NewDocumentOptions {
  name: string;
  width: number;
  height: number;
  colorMode: "RGBA" | "Indexed";
  background: NewDocumentBackground;
}

export function normalizeDocumentName(name: string): string {
  const clean = name.trim() || "untitled";
  return clean.toLowerCase().endsWith(".pixet") ? clean : `${clean}.pixet`;
}

function clampSize(v: number): number {
  return Math.max(1, Math.min(1024, Math.round(v) || 32));
}

/** Replaces the open document with a blank one and marks it clean. */
export function createNewDocument(opts: NewDocumentOptions): void {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const w = clampSize(opts.width);
  const h = clampSize(opts.height);
  const docName = normalizeDocumentName(opts.name);

  pixelEngine.resetForDocument(w, h);
  resetRigHistory();
  state.bumpModel3DVersion();
  const cel = pixelEngine.getOrCreateCel("layer-1", 0);

  if (opts.background !== "transparent") {
    const fillHex = opts.background === "white" ? "#ffffff" : state.secondaryColor;
    const [r, g, b, a] = hexToRgba(fillHex, 255);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) cel.setPixel(x, y, r, g, b, a);
    }
    cel.markAllDirty();
  }

  state.loadProjectState({
    documentName: docName,
    filePath: null,
    canvasWidth: w,
    canvasHeight: h,
    colorMode: opts.colorMode,
    paletteName: state.paletteName,
    palette: state.palette,
    layers: [
      {
        id: "layer-1",
        name: "Layer 1",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        cels: { 0: !cel.isEmpty() },
      },
    ],
    frames: [{ id: "frame-new-1", index: 0, durationMs: Math.round(1000 / state.fps) }],
    tags: [],
  });

  syncTimelineCels();
  pixelEngine.emitChange();
  markDocumentReplaced();
  state.setStatusMessage(`Created "${docName}" (${w}×${h})`);
}

/** Replaces the open document with a built-in sample and marks it clean. */
export function loadSampleDocument(sample: SampleDocument): void {
  commitFloatingSelection();
  const state = useEditorStore.getState();

  pixelEngine.resetForDocument(sample.width, sample.height);
  resetRigHistory();
  state.bumpModel3DVersion();
  pixelEngine.applySampleCels(sample);

  const celMap: Record<number, boolean> = {};
  for (let i = 0; i < sample.frames.length; i++) celMap[i] = true;

  state.loadProjectState({
    documentName: sample.documentName,
    filePath: null,
    canvasWidth: sample.width,
    canvasHeight: sample.height,
    colorMode: "RGBA",
    paletteName: state.paletteName,
    palette: state.palette,
    layers: sample.layers.map((l) => ({
      id: l.id,
      name: l.name,
      kind: "raster" as const,
      visible: true,
      locked: false,
      opacity: 100,
      alphaLock: false,
      blendMode: l.blendMode,
      parentId: null,
      cels: { ...celMap },
    })),
    frames: sample.frames.map((f, i) => ({
      id: `frame-${sample.id}-${i + 1}`,
      index: i,
      durationMs: f.durationMs,
    })),
    tags: sample.tags.map((t, i) => ({
      id: `tag-${sample.id}-${i + 1}`,
      name: t.name,
      fromFrame: t.fromFrame,
      toFrame: t.toFrame,
      color: t.color,
      direction: "forward" as const,
    })),
  });

  syncTimelineCels();
  pixelEngine.emitChange();
  markDocumentReplaced();
  state.setStatusMessage(`Loaded sample "${sample.label}"`);
}
