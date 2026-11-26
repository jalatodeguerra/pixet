/** Pure zoom helpers for the canvas viewport (React-free). */

export const ZOOM_STOPS: readonly number[] = [
  1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64,
];

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 64;

/** Default empty space (px) kept around the canvas when fitting. */
export const FIT_PADDING = 32;

/**
 * Largest integer zoom at which the whole document fits the viewport with
 * `padding` px of margin on every side. Floored at 1 (pixel art stays crisp).
 */
export function computeFitZoom(
  docW: number,
  docH: number,
  viewportW: number,
  viewportH: number,
  padding: number = FIT_PADDING
): number {
  if (!(docW > 0) || !(docH > 0)) return MIN_ZOOM;
  const availW = Math.max(1, viewportW - padding * 2);
  const availH = Math.max(1, viewportH - padding * 2);
  const z = Math.floor(Math.min(availW / docW, availH / docH));
  if (!Number.isFinite(z)) return MIN_ZOOM;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** Next zoom stop above (direction 1) or below (-1) `current`. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    for (const s of ZOOM_STOPS) if (s > current) return s;
    return ZOOM_STOPS[ZOOM_STOPS.length - 1];
  }
  for (let i = ZOOM_STOPS.length - 1; i >= 0; i--) {
    if (ZOOM_STOPS[i] < current) return ZOOM_STOPS[i];
  }
  return ZOOM_STOPS[0];
}

/**
 * New pan offset so the point under the cursor stays fixed when zoom goes
 * from `oldZoom` to `newZoom`. `dx`/`dy` is the cursor offset from the
 * viewport centre; the canvas centre sits at (centre + pan).
 */
export function panForZoomAtCursor(
  pan: { x: number; y: number },
  dx: number,
  dy: number,
  oldZoom: number,
  newZoom: number
): { x: number; y: number } {
  const r = newZoom / oldZoom;
  const cx = dx - pan.x;
  const cy = dy - pan.y;
  return { x: dx - cx * r, y: dy - cy * r };
}
