export type TextureKind = "gray16f" | "rgba16f" | "rgba8" | "grayRg8";

export function bytesPerPixel(kind: TextureKind): number {
  switch (kind) {
    case "gray16f":
      return 2;
    case "rgba16f":
      return 8;
    case "rgba8":
    case "grayRg8":
      return 4;
  }
}

export interface FboEntry {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
  kind: TextureKind;
  bytes: number;
  lastUsedTick: number;
  pinned: boolean;
}

function bucketKey(width: number, height: number, kind: TextureKind): string {
  return `${width}x${height}:${kind}`;
}

export class FboPool {
  private readonly gl: WebGL2RenderingContext;
  readonly supportsFloatFbo: boolean;
  private readonly freeBuckets = new Map<string, FboEntry[]>();
  private totalAllocatedBytes = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const extFloat = gl.getExtension("EXT_color_buffer_float");
    const extHalf = gl.getExtension("EXT_color_buffer_half_float");
    this.supportsFloatFbo = Boolean(extFloat || extHalf);
  }

  resolveKind(requested: "gray" | "rgba" | "ldr8"): TextureKind {
    if (requested === "ldr8") return "rgba8";
    if (requested === "gray") {
      return this.supportsFloatFbo ? "gray16f" : "grayRg8";
    }
    return this.supportsFloatFbo ? "rgba16f" : "rgba8";
  }

  getAllocatedBytes(): number {
    return this.totalAllocatedBytes;
  }

  acquire(width: number, height: number, kind: TextureKind, tick = 0): FboEntry {
    const key = bucketKey(width, height, kind);
    const bucket = this.freeBuckets.get(key);
    if (bucket && bucket.length > 0) {
      const reused = bucket.pop()!;
      reused.lastUsedTick = tick;
      reused.pinned = false;
      return reused;
    }

    const gl = this.gl;
    const texture = gl.createTexture()!;
    const fbo = gl.createFramebuffer()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);

    let internalFormat: number = gl.RGBA8;
    let format: number = gl.RGBA;
    let type: number = gl.UNSIGNED_BYTE;
    if (kind === "gray16f") {
      internalFormat = gl.R16F;
      format = gl.RED;
      type = gl.HALF_FLOAT;
    } else if (kind === "rgba16f") {
      internalFormat = gl.RGBA16F;
      format = gl.RGBA;
      type = gl.HALF_FLOAT;
    }

    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const bytes = width * height * bytesPerPixel(kind);
    this.totalAllocatedBytes += bytes;

    return {
      fbo,
      texture,
      width,
      height,
      kind,
      bytes,
      lastUsedTick: tick,
      pinned: false,
    };
  }

  release(entry: FboEntry): void {
    entry.pinned = false;
    const key = bucketKey(entry.width, entry.height, entry.kind);
    let bucket = this.freeBuckets.get(key);
    if (!bucket) {
      bucket = [];
      this.freeBuckets.set(key, bucket);
    }
    bucket.push(entry);
  }

  private destroyEntry(entry: FboEntry): void {
    this.gl.deleteFramebuffer(entry.fbo);
    this.gl.deleteTexture(entry.texture);
    this.totalAllocatedBytes = Math.max(0, this.totalAllocatedBytes - entry.bytes);
  }

  evictToBudget(
    activeCache: Map<string, FboEntry>,
    protectedKeys: ReadonlySet<string>,
    vramBudgetBytes = 128 * 1024 * 1024
  ): number {
    let freed = 0;
    // First trim free pool if over budget
    if (this.totalAllocatedBytes > vramBudgetBytes) {
      for (const bucket of this.freeBuckets.values()) {
        while (bucket.length > 0 && this.totalAllocatedBytes > vramBudgetBytes) {
          const entry = bucket.pop()!;
          freed += entry.bytes;
          this.destroyEntry(entry);
        }
      }
    }
    if (this.totalAllocatedBytes <= vramBudgetBytes) {
      return freed;
    }

    // Evict LRU non-protected entries from active cache
    const candidates: Array<{ key: string; entry: FboEntry }> = [];
    for (const [key, entry] of activeCache.entries()) {
      if (!entry.pinned && !protectedKeys.has(key)) {
        candidates.push({ key, entry });
      }
    }
    candidates.sort((a, b) => a.entry.lastUsedTick - b.entry.lastUsedTick);

    for (const { key, entry } of candidates) {
      if (this.totalAllocatedBytes <= vramBudgetBytes) break;
      activeCache.delete(key);
      freed += entry.bytes;
      this.destroyEntry(entry);
    }
    return freed;
  }

  disposeAll(): void {
    for (const bucket of this.freeBuckets.values()) {
      for (const entry of bucket) {
        this.gl.deleteFramebuffer(entry.fbo);
        this.gl.deleteTexture(entry.texture);
      }
    }
    this.freeBuckets.clear();
    this.totalAllocatedBytes = 0;
  }
}
