// Orchestration for GIF / PNG sequence / browser spritesheet exports.
// Runs only on user export; yields to the event loop between frames.

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../store/editorStore.ts";
import { collectExportFrames } from "./frameSource.ts";
import { encodeGif } from "./gif.ts";
import {
  generateGodotSpriteFrames,
  generateSpritesheetJson,
  packSpritesheet,
} from "./packer.ts";
import {
  flattenOnBackground,
  parseHexColor,
  scaleRgbaNearest,
} from "./raster.ts";
import { createZip, type ZipEntry } from "./zip.ts";
import {
  bytesToBase64,
  downloadBytes,
  encodePngRgba,
} from "./domOutput.ts";

export interface AnimatedExportOptions {
  name: string;
  tagId: string | null;
  scale: number;
  /** null = keep transparency */
  background: string | null;
  loop: boolean;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function status(msg: string): void {
  useEditorStore.getState().setStatusMessage(msg);
}

function safeName(name: string, fallback: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\.\.+/g, "_");
  return cleaned || fallback;
}

async function prepareFrames(opts: AnimatedExportOptions, label: string) {
  const scale = Math.max(1, Math.min(8, Math.floor(opts.scale) || 1));
  const bg = opts.background ? parseHexColor(opts.background) : null;
  const src = await collectExportFrames(
    { tagId: opts.tagId, applyDirection: true },
    (d, t) => status(`${label}: compositing frame ${d}/${t}`)
  );
  const frames = src.frames.map((f) => {
    let rgba: Uint8ClampedArray = f.rgba;
    if (bg) rgba = flattenOnBackground(rgba, bg);
    if (scale > 1) rgba = scaleRgbaNearest(rgba, src.width, src.height, scale);
    return { rgba, delayMs: f.durationMs };
  });
  return { frames, width: src.width * scale, height: src.height * scale };
}

async function pickTauriFolder(title: string): Promise<string | null> {
  const dir = await open({ directory: true, multiple: false, title });
  return dir && typeof dir === "string" ? dir : null;
}

async function writeTauriFiles(
  outDir: string,
  files: Array<{ name: string; bytes: Uint8Array }>
): Promise<number> {
  return invoke<number>("write_text_and_pngs", {
    outDir,
    files: files.map((f) => ({ name: f.name, base64: bytesToBase64(f.bytes) })),
  });
}

export async function exportGifAction(
  opts: AnimatedExportOptions
): Promise<boolean> {
  try {
    const name = safeName(opts.name, "animation");
    let outDir: string | null = null;
    if (isTauri()) {
      outDir = await pickTauriFolder("Select Export Folder");
      if (!outDir) return false;
    }
    const { frames, width, height } = await prepareFrames(opts, "GIF");
    const res = await encodeGif(
      { width, height, frames, loop: opts.loop },
      { onProgress: (d, t) => status(`GIF: encoding frame ${d}/${t}`) }
    );
    const fileName = `${name}.gif`;
    if (outDir) {
      await writeTauriFiles(outDir, [{ name: fileName, bytes: res.bytes }]);
    } else {
      downloadBytes(res.bytes, fileName, "image/gif");
    }
    const kb = Math.max(1, Math.round(res.bytes.length / 1024));
    const note = res.colorsReduced
      ? " (colours reduced to 256 per frame)"
      : res.paletteMode === "global"
        ? ` (${res.uniqueColors} colours, exact)`
        : "";
    status(`Exported ${fileName}: ${frames.length}f, ${width}×${height}, ${kb} KB${note}`);
    return true;
  } catch (err) {
    status(`GIF export failed: ${String(err)}`);
    return false;
  }
}

export async function exportPngSequenceAction(
  opts: AnimatedExportOptions
): Promise<boolean> {
  try {
    const name = safeName(opts.name, "frame");
    let outDir: string | null = null;
    if (isTauri()) {
      outDir = await pickTauriFolder("Select Export Folder");
      if (!outDir) return false;
    }
    const { frames, width, height } = await prepareFrames(opts, "PNG sequence");
    const entries: ZipEntry[] = [];
    for (let i = 0; i < frames.length; i++) {
      const data = await encodePngRgba(frames[i].rgba, width, height);
      entries.push({ name: `${name}_${String(i).padStart(4, "0")}.png`, data });
      status(`PNG sequence: encoding frame ${i + 1}/${frames.length}`);
      await new Promise((r) => setTimeout(r, 0));
    }
    if (outDir) {
      const n = await writeTauriFiles(
        outDir,
        entries.map((e) => ({ name: e.name, bytes: e.data }))
      );
      status(`Exported ${n} PNG files (${width}×${height})`);
    } else {
      downloadBytes(createZip(entries), `${name}_frames.zip`, "application/zip");
      status(`Downloaded ${name}_frames.zip: ${entries.length} PNGs (${width}×${height})`);
    }
    return true;
  } catch (err) {
    status(`PNG sequence export failed: ${String(err)}`);
    return false;
  }
}

export interface BrowserSheetOptions {
  format: "json" | "godot";
  pack: "grid" | "tight";
  trim: boolean;
  extrude: number;
  padding: number;
  sheetName: string;
}

/** Browser spritesheet export: same packer and metadata as the Rust core. */
export async function exportBrowserSpritesheet(
  opts: BrowserSheetOptions
): Promise<boolean> {
  try {
    const state = useEditorStore.getState();
    const src = await collectExportFrames(
      { tagId: null, applyDirection: false },
      (d, t) => status(`Spritesheet: compositing frame ${d}/${t}`)
    );
    const sheet = packSpritesheet(
      src.frames.map((f) => ({
        frameIndex: f.frameIndex,
        durationMs: f.durationMs,
        rgba: f.rgba,
      })),
      src.width,
      src.height,
      opts
    );
    const clean = safeName(opts.sheetName, "spritesheet");
    const pngName = `${clean}.png`;
    const png = await encodePngRgba(sheet.rgba, sheet.width, sheet.height);
    downloadBytes(png, pngName, "image/png");
    await new Promise((r) => setTimeout(r, 200));

    const tags = state.tags.map((t) => ({
      name: t.name,
      fromFrame: t.fromFrame,
      toFrame: t.toFrame,
      color: t.color,
    }));
    const enc = new TextEncoder();
    if (opts.format === "godot") {
      const tres = generateGodotSpriteFrames(tags, sheet, pngName);
      downloadBytes(enc.encode(tres), `${clean}.tres`, "text/plain");
    } else {
      const json = generateSpritesheetJson(state.documentName, tags, sheet, pngName);
      downloadBytes(enc.encode(json), `${clean}.json`, "application/json");
    }
    status(`Exported ${sheet.frames.length}f (${sheet.width}×${sheet.height}) as ${pngName} + ${opts.format === "godot" ? "tres" : "json"}`);
    return true;
  } catch (err) {
    status(`Export failed: ${String(err)}`);
    return false;
  }
}
