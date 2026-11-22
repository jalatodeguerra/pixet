import { PixelBuffer, rgbaToHex } from "../document/PixelBuffer.ts";

export interface PendingImageImport {
  name: string;
  buffer: PixelBuffer;
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".webp",
  ".jpg",
  ".jpeg",
  ".bmp",
  ".gif",
]);

export function isSupportedImageFile(file: {
  name: string;
  type?: string;
}): boolean {
  if (file.type && file.type.toLowerCase().startsWith("image/")) {
    return true;
  }
  const lower = file.name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(lower.slice(dot));
}

export function resizePixelBufferNearest(
  src: PixelBuffer,
  targetW: number,
  targetH: number
): PixelBuffer {
  const w = Math.max(1, Math.round(targetW));
  const h = Math.max(1, Math.round(targetH));
  if (w === src.width && h === src.height) {
    return src.clone();
  }

  const out = new PixelBuffer(w, h);
  const srcData = src.data;
  const outData = out.data;

  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / w));
      const sIdx = (sy * src.width + sx) * 4;
      const dIdx = (y * w + x) * 4;
      outData[dIdx] = srcData[sIdx];
      outData[dIdx + 1] = srcData[sIdx + 1];
      outData[dIdx + 2] = srcData[sIdx + 2];
      outData[dIdx + 3] = srcData[sIdx + 3];
    }
  }

  out.markAllDirty();
  return out;
}

export function placeBufferCentered(
  src: PixelBuffer,
  canvasW: number,
  canvasH: number,
  fitToCanvas: boolean
): PixelBuffer {
  let working = src;
  if (fitToCanvas && (src.width > canvasW || src.height > canvasH)) {
    const scale = Math.min(canvasW / src.width, canvasH / src.height);
    const nextW = Math.max(1, Math.round(src.width * scale));
    const nextH = Math.max(1, Math.round(src.height * scale));
    working = resizePixelBufferNearest(src, nextW, nextH);
  }

  const out = new PixelBuffer(canvasW, canvasH);
  const ox = Math.floor((canvasW - working.width) / 2);
  const oy = Math.floor((canvasH - working.height) / 2);

  for (let y = 0; y < working.height; y++) {
    const dy = oy + y;
    if (dy < 0 || dy >= canvasH) continue;
    for (let x = 0; x < working.width; x++) {
      const dx = ox + x;
      if (dx < 0 || dx >= canvasW) continue;
      const [r, g, b, a] = working.getPixel(x, y);
      if (a > 0) {
        out.setPixel(dx, dy, r, g, b, a);
      }
    }
  }

  out.markAllDirty();
  return out;
}

export function sliceSpritesheet(
  src: PixelBuffer,
  frameW: number,
  frameH: number,
  skipEmpty = true
): PixelBuffer[] {
  const fw = Math.max(1, Math.min(src.width, Math.round(frameW)));
  const fh = Math.max(1, Math.min(src.height, Math.round(frameH)));
  const cols = Math.max(1, Math.floor(src.width / fw));
  const rows = Math.max(1, Math.floor(src.height / fh));

  const allFrames: PixelBuffer[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const frame = new PixelBuffer(fw, fh);
      const sx0 = col * fw;
      const sy0 = row * fh;
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const [r, g, b, a] = src.getPixel(sx0 + x, sy0 + y);
          if (a > 0) {
            frame.setPixel(x, y, r, g, b, a);
          }
        }
      }
      frame.markAllDirty();
      allFrames.push(frame);
    }
  }

  if (!skipEmpty) {
    return allFrames;
  }

  const nonEmpty = allFrames.filter((f) => !f.isEmpty());
  return nonEmpty.length > 0 ? nonEmpty : [allFrames[0]];
}

export function extractPaletteFromBuffer(
  src: PixelBuffer,
  maxColors = 32
): string[] {
  const counts = new Map<string, number>();
  const data = src.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const hex = rgbaToHex(data[i], data[i + 1], data[i + 2]);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, maxColors))
    .map(([hex]) => hex);
}

async function loadImageFallback(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to decode ${file.name}`));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeImageFileToPixelBuffer(
  file: File
): Promise<PendingImageImport> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      canvas.width = Math.max(1, bitmap.width);
      canvas.height = Math.max(1, bitmap.height);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
  } else {
    const img = await loadImageFallback(file);
    canvas.width = Math.max(1, img.naturalWidth || img.width);
    canvas.height = Math.max(1, img.naturalHeight || img.height);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    name: file.name,
    buffer: new PixelBuffer(canvas.width, canvas.height, imageData.data),
  };
}

export function pickImageFileForImport(): Promise<PendingImageImport | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept =
      "image/png,image/webp,image/jpeg,image/bmp,image/gif,.png,.webp,.jpg,.jpeg,.bmp,.gif";
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("focus", onWindowFocus);
    };

    const onWindowFocus = () => {
      window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          settled = true;
          cleanup();
          resolve(null);
        }
      }, 350);
    };

    input.onchange = async () => {
      if (settled) return;
      settled = true;
      cleanup();
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve(await decodeImageFileToPixelBuffer(file));
      } catch (err) {
        reject(err);
      }
    };

    window.addEventListener("focus", onWindowFocus);
    input.click();
  });
}
