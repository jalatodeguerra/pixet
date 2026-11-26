import * as THREE from "three";

/**
 * Lazy singleton WebGLRenderer shared across the interactive Low-Poly 3D
 * viewport and offscreen sprite/turntable bakers so Pixet only allocates
 * a single Three.js WebGL context.
 */
class ThreeStudioRuntime {
  private renderer: THREE.WebGLRenderer | null = null;
  private currentHost: HTMLElement | null = null;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  getRenderer(): THREE.WebGLRenderer {
    if (this.renderer) return this.renderer;

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(this.width, this.height, false);
    renderer.domElement.className = "m3d-three-canvas";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.imageRendering = "pixelated";

    this.renderer = renderer;
    return renderer;
  }

  attachCanvas(host: HTMLElement): HTMLCanvasElement {
    const renderer = this.getRenderer();
    const canvas = renderer.domElement;
    if (this.currentHost !== host || canvas.parentElement !== host) {
      if (canvas.parentElement && canvas.parentElement !== host) {
        canvas.parentElement.removeChild(canvas);
      }
      host.appendChild(canvas);
      this.currentHost = host;
    }
    return canvas;
  }

  detachCanvas(host: HTMLElement): void {
    if (!this.renderer) return;
    const canvas = this.renderer.domElement;
    if (this.currentHost === host) {
      this.currentHost = null;
    }
    if (canvas.parentElement === host) {
      host.removeChild(canvas);
    }
  }

  setViewportSize(width: number, height: number, pixelRatio?: number): void {
    const safeW = Math.max(1, Math.round(width));
    const safeH = Math.max(1, Math.round(height));
    const safePr = Math.max(
      1,
      Math.min(2, pixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1))
    );
    this.width = safeW;
    this.height = safeH;
    this.pixelRatio = safePr;
    if (this.renderer) {
      this.renderer.setPixelRatio(safePr);
      this.renderer.setSize(safeW, safeH, false);
    }
  }
}

export const threeStudioRuntime = new ThreeStudioRuntime();
