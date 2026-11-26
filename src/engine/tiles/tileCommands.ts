import { useEditorStore } from "../../store/editorStore.ts";
import { packCell, rotateCellCW, unpackCell } from "./cell.ts";
import { flipBrushH, flipBrushV, rotateBrushCW } from "./mapTools.ts";

/** Tiles Map brush transforms shared by keyboard shortcuts and the palette. */

function toBrush(b: {
  cols: number;
  rows: number;
  cells: readonly number[];
}) {
  return { cols: b.cols, rows: b.rows, cells: new Uint32Array(b.cells) };
}

export function flipTileBrushHorizontal(): void {
  const state = useEditorStore.getState();
  if (state.tileBrush) {
    const flipped = flipBrushH(toBrush(state.tileBrush));
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
}

export function flipTileBrushVertical(): void {
  const state = useEditorStore.getState();
  if (state.tileBrush) {
    const flipped = flipBrushV(toBrush(state.tileBrush));
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
}

export function rotateTileBrushClockwise(): void {
  const state = useEditorStore.getState();
  if (state.tileBrush) {
    const rotated = rotateBrushCW(toBrush(state.tileBrush));
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
}
