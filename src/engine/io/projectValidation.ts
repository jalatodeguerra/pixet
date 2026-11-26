import type { ProjectTransfer } from "./projectBridge.ts";

/** Largest canvas edge we accept when opening a file. */
export const MAX_PROJECT_DIMENSION = 16384;

export type ProjectValidationResult =
  | { ok: true; transfer: ProjectTransfer }
  | { ok: false; error: string };

type Rec = Record<string, unknown>;

function isRec(x: unknown): x is Rec {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isPosInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x > 0;
}

function describe(x: unknown): string {
  if (x === null) return "null";
  if (Array.isArray(x)) return "an array";
  return typeof x === "undefined" ? "missing" : `a ${typeof x}`;
}

/**
 * Pure structural validation of a project payload. Unknown extra fields are
 * allowed and optional extension fields may be absent (old files).
 */
export function validateProjectTransfer(x: unknown): ProjectValidationResult {
  const fail = (error: string): ProjectValidationResult => ({ ok: false, error });
  if (!isRec(x)) return fail("not a Pixet project file");
  const doc = x.document;
  if (!isRec(doc)) return fail(`"document" must be an object (found ${describe(doc)})`);

  const size = doc.size;
  if (!isRec(size)) return fail(`"document.size" is missing or not an object`);
  if (!isPosInt(size.width) || !isPosInt(size.height)) {
    return fail(
      `canvas size must be positive whole numbers (got ${String(size.width)} x ${String(size.height)})`
    );
  }
  if (size.width > MAX_PROJECT_DIMENSION || size.height > MAX_PROJECT_DIMENSION) {
    return fail(
      `canvas size ${size.width} x ${size.height} exceeds the ${MAX_PROJECT_DIMENSION}px limit`
    );
  }

  if (!Array.isArray(doc.layers)) return fail(`"document.layers" must be an array`);
  if (!Array.isArray(doc.frames)) return fail(`"document.frames" must be an array`);
  if (!Array.isArray(doc.tags)) return fail(`"document.tags" must be an array`);
  if (!isRec(doc.palette) || !Array.isArray(doc.palette.colors)) {
    return fail(`"document.palette.colors" must be an array`);
  }

  for (let i = 0; i < doc.layers.length; i++) {
    const l: unknown = doc.layers[i];
    if (!isRec(l)) return fail(`layer ${i + 1} is not an object`);
    if (typeof l.id !== "string") return fail(`layer ${i + 1} has no string "id"`);
    if (typeof l.name !== "string") return fail(`layer ${i + 1} has no string "name"`);
    if (!Array.isArray(l.cels)) return fail(`layer "${l.id}" has no "cels" array`);
    if (l.tilemaps !== undefined && l.tilemaps !== null && !isRec(l.tilemaps)) {
      return fail(`layer "${l.id}" has invalid "tilemaps"`);
    }
    if (isRec(l.tilemaps)) {
      for (const [k, g] of Object.entries(l.tilemaps)) {
        if (
          !isRec(g) ||
          !isPosInt(g.cols) ||
          !isPosInt(g.rows) ||
          !Array.isArray(g.cells)
        ) {
          return fail(`layer "${l.id}" has a malformed tilemap for frame ${k}`);
        }
      }
    }
  }
  for (let i = 0; i < doc.frames.length; i++) {
    const f: unknown = doc.frames[i];
    if (!isRec(f) || typeof f.id !== "string" || typeof f.index !== "number") {
      return fail(`frame ${i + 1} is malformed`);
    }
  }
  for (let i = 0; i < doc.tags.length; i++) {
    const t: unknown = doc.tags[i];
    if (!isRec(t) || typeof t.from_frame !== "number" || typeof t.to_frame !== "number") {
      return fail(`tag ${i + 1} is malformed`);
    }
  }

  const cels = x.cels;
  if (!isRec(cels)) return fail(`"cels" must be an object (found ${describe(cels)})`);
  for (const [k, v] of Object.entries(cels)) {
    if (typeof v !== "string") return fail(`cel data for "${k}" must be a string`);
  }
  if (x.tiles !== undefined && x.tiles !== null) {
    if (!Array.isArray(x.tiles) || x.tiles.some((t) => typeof t !== "string")) {
      return fail(`"tiles" must be an array of strings`);
    }
  }

  const ts = doc.tileset;
  if (ts !== undefined && ts !== null) {
    if (!isRec(ts) || !isPosInt(ts.tile_width) || !isPosInt(ts.tile_height)) {
      return fail(`"document.tileset" has invalid tile size`);
    }
  }
  if (doc.tiles_ext !== undefined && doc.tiles_ext !== null && !isRec(doc.tiles_ext)) {
    return fail(`"document.tiles_ext" must be an object`);
  }
  if (doc.draw_ext !== undefined && doc.draw_ext !== null && !isRec(doc.draw_ext)) {
    return fail(`"document.draw_ext" must be an object`);
  }
  if (
    doc.tile_projection !== undefined &&
    doc.tile_projection !== "orthogonal" &&
    doc.tile_projection !== "isometric"
  ) {
    return fail(`unknown tile projection "${String(doc.tile_projection)}"`);
  }

  return { ok: true, transfer: x as unknown as ProjectTransfer };
}
