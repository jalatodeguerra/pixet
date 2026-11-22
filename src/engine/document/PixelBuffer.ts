export type RGBA = [number, number, number, number];

export interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function hexToRgba(hex: string, alpha = 255): RGBA {
  const clean = hex.trim().replace("#", "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r, g, b, alpha];
    }
  } else if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r, g, b, alpha];
    }
  }
  return [0, 0, 0, alpha];
}

export function rgbaToHex(r: number, g: number, b: number): string {
  const toByte = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  dirtyRect: DirtyRect | null = null;

  constructor(width: number, height: number, data?: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    const expectedLen = width * height * 4;
    if (data) {
      if (data.length !== expectedLen) {
        throw new Error(
          `PixelBuffer expected ${expectedLen} bytes, got ${data.length}`
        );
      }
      this.data = new Uint8ClampedArray(data);
    } else {
      this.data = new Uint8ClampedArray(expectedLen);
    }
  }

  getPixel(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return [0, 0, 0, 0];
    }
    const idx = (y * this.width + x) * 4;
    return [
      this.data[idx],
      this.data[idx + 1],
      this.data[idx + 2],
      this.data[idx + 3],
    ];
  }

  setPixel(
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
    alphaLock = false
  ): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return false;
    }
    const idx = (y * this.width + x) * 4;
    const prevR = this.data[idx];
    const prevG = this.data[idx + 1];
    const prevB = this.data[idx + 2];
    const prevA = this.data[idx + 3];

    let nextA = a;
    if (alphaLock) {
      if (prevA === 0) return false;
      // Preserve existing alpha channel when alpha lock is active
      nextA = a === 0 ? prevA : Math.round((a / 255) * prevA);
      if (a === 0) return false;
    }

    if (prevR === r && prevG === g && prevB === b && prevA === nextA) {
      return false;
    }

    this.data[idx] = r;
    this.data[idx + 1] = g;
    this.data[idx + 2] = b;
    this.data[idx + 3] = nextA;
    this.markDirty(x, y);
    return true;
  }

  clear(): void {
    this.data.fill(0);
    this.markAllDirty();
  }

  clone(): PixelBuffer {
    return new PixelBuffer(this.width, this.height, this.data);
  }

  isEmpty(): boolean {
    for (let i = 3; i < this.data.length; i += 4) {
      if (this.data[i] !== 0) return false;
    }
    return true;
  }

  markDirty(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    if (!this.dirtyRect) {
      this.dirtyRect = { x, y, w: 1, h: 1 };
      return;
    }
    const minX = Math.min(this.dirtyRect.x, x);
    const minY = Math.min(this.dirtyRect.y, y);
    const maxX = Math.max(this.dirtyRect.x + this.dirtyRect.w - 1, x);
    const maxY = Math.max(this.dirtyRect.y + this.dirtyRect.h - 1, y);
    this.dirtyRect = {
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    };
  }

  markAllDirty(): void {
    this.dirtyRect = { x: 0, y: 0, w: this.width, h: this.height };
  }

  consumeDirtyRect(): DirtyRect | null {
    const rect = this.dirtyRect;
    this.dirtyRect = null;
    return rect;
  }
}
