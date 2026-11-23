const VERTEX_SHADER_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision mediump float;

in vec2 v_uv;
uniform sampler2D u_frameTex;
uniform sampler2D u_overlayTex;
uniform sampler2D u_onionTex;
uniform float u_showOnion;
uniform float u_checkSize;
uniform vec3 u_bgColorA;
uniform vec3 u_bgColorB;

out vec4 outColor;

vec4 over(vec4 fg, vec4 bg) {
  float outA = fg.a + bg.a * (1.0 - fg.a);
  if (outA <= 0.0001) return vec4(0.0);
  vec3 rgb = (fg.rgb * fg.a + bg.rgb * bg.a * (1.0 - fg.a)) / outA;
  return vec4(rgb, outA);
}

void main() {
  vec2 tile = floor(gl_FragCoord.xy / u_checkSize);
  float checker = mod(tile.x + tile.y, 2.0);
  vec3 bgRgb = mix(u_bgColorA, u_bgColorB, checker);
  vec4 result = vec4(bgRgb, 1.0);

  vec2 texUv = vec2(v_uv.x, 1.0 - v_uv.y);
  if (u_showOnion > 0.5) {
    vec4 onionPx = texture(u_onionTex, texUv);
    result = over(onionPx, result);
  }
  vec4 framePx = texture(u_frameTex, texUv);
  vec4 overlayPx = texture(u_overlayTex, texUv);

  result = over(framePx, result);
  result = over(overlayPx, result);
  outColor = result;
}
`;

export interface RendererBackdrop {
  colorA: [number, number, number];
  colorB: [number, number, number];
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r, g, b];
    }
  }
  return [32, 32, 32];
}

export function resolveRendererBackdrop(
  backdrop: "checkerDark" | "checkerLight" | "solidDark" | "solidMid" | "custom",
  customColor: string
): RendererBackdrop {
  switch (backdrop) {
    case "checkerLight":
      return { colorA: [204, 204, 204], colorB: [236, 236, 236] };
    case "solidDark":
      return { colorA: [20, 20, 20], colorB: [20, 20, 20] };
    case "solidMid":
      return { colorA: [74, 74, 74], colorB: [74, 74, 74] };
    case "custom": {
      const rgb = parseHexRgb(customColor);
      return { colorA: rgb, colorB: rgb };
    }
    case "checkerDark":
    default:
      return { colorA: [32, 32, 38], colorB: [42, 42, 51] };
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create WebGL2 shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(`WebGL2 shader compile failed: ${info}`);
  }
  return shader;
}

function createNearestTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("Failed to create WebGL2 texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export class WebGL2Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext | null = null;
  private readonly fallbackCtx: CanvasRenderingContext2D | null = null;

  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private frameTex: WebGLTexture | null = null;
  private overlayTex: WebGLTexture | null = null;
  private onionTex: WebGLTexture | null = null;
  private checkSizeLoc: WebGLUniformLocation | null = null;
  private showOnionLoc: WebGLUniformLocation | null = null;
  private bgColorALoc: WebGLUniformLocation | null = null;
  private bgColorBLoc: WebGLUniformLocation | null = null;
  private showOnion = false;
  private backdrop: RendererBackdrop = {
    colorA: [32, 32, 38],
    colorB: [42, 42, 51],
  };
  private dpr = 1;

  // Fallback state
  private frameData: Uint8ClampedArray | null = null;
  private overlayData: Uint8ClampedArray | null = null;
  private onionData: Uint8ClampedArray | null = null;
  private texWidth = 0;
  private texHeight = 0;
  private scratchCanvas: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });

    if (gl) {
      this.gl = gl;
      this.initGL(gl);
    } else {
      this.fallbackCtx = canvas.getContext("2d");
      if (typeof document !== "undefined") {
        this.scratchCanvas = document.createElement("canvas");
      }
    }
  }

  private initGL(gl: WebGL2RenderingContext): void {
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create WebGL2 program");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? "Unknown link error";
      gl.deleteProgram(program);
      throw new Error(`WebGL2 program link failed: ${info}`);
    }

    this.program = program;
    gl.useProgram(program);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) throw new Error("Failed to allocate WebGL2 quad buffers");

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    this.vao = vao;
    this.vbo = vbo;
    this.frameTex = createNearestTexture(gl);
    this.overlayTex = createNearestTexture(gl);
    this.onionTex = createNearestTexture(gl);

    gl.uniform1i(gl.getUniformLocation(program, "u_frameTex"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "u_overlayTex"), 1);
    gl.uniform1i(gl.getUniformLocation(program, "u_onionTex"), 2);
    this.checkSizeLoc = gl.getUniformLocation(program, "u_checkSize");
    this.showOnionLoc = gl.getUniformLocation(program, "u_showOnion");
    this.bgColorALoc = gl.getUniformLocation(program, "u_bgColorA");
    this.bgColorBLoc = gl.getUniformLocation(program, "u_bgColorB");
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.dpr = Math.max(1, dpr);
    const w = Math.max(1, Math.round(cssWidth * this.dpr));
    const h = Math.max(1, Math.round(cssHeight * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.gl) {
      this.gl.viewport(0, 0, w, h);
    }
  }

  uploadFrame(width: number, height: number, rgba: Uint8ClampedArray): void {
    this.texWidth = width;
    this.texHeight = height;
    if (this.gl && this.frameTex) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        rgba
      );
    } else {
      this.frameData = rgba;
    }
  }

  uploadOverlay(width: number, height: number, rgba: Uint8ClampedArray): void {
    this.texWidth = width;
    this.texHeight = height;
    if (this.gl && this.overlayTex) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        rgba
      );
    } else {
      this.overlayData = rgba;
    }
  }

  uploadOnion(width: number, height: number, rgba: Uint8ClampedArray): void {
    this.texWidth = width;
    this.texHeight = height;
    if (this.gl && this.onionTex) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.onionTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        rgba
      );
    } else {
      this.onionData = rgba;
    }
  }

  setShowOnion(show: boolean): void {
    this.showOnion = show;
  }

  setBackdrop(backdrop: RendererBackdrop): void {
    this.backdrop = backdrop;
  }

  render(docWidth: number, docHeight: number): void {
    if (this.gl && this.program && this.vao) {
      const gl = this.gl;
      gl.useProgram(this.program);
      if (this.checkSizeLoc) {
        gl.uniform1f(this.checkSizeLoc, 8.0 * this.dpr);
      }
      if (this.showOnionLoc) {
        gl.uniform1f(this.showOnionLoc, this.showOnion ? 1.0 : 0.0);
      }
      const [ar, ag, ab] = this.backdrop.colorA;
      const [br, bg, bb] = this.backdrop.colorB;
      if (this.bgColorALoc) {
        gl.uniform3f(this.bgColorALoc, ar / 255, ag / 255, ab / 255);
      }
      if (this.bgColorBLoc) {
        gl.uniform3f(this.bgColorBLoc, br / 255, bg / 255, bb / 255);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.onionTex);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }

    if (this.fallbackCtx && this.scratchCanvas) {
      const ctx = this.fallbackCtx;
      const cw = this.canvas.width;
      const ch = this.canvas.height;
      ctx.clearRect(0, 0, cw, ch);

      const [ar, ag, ab] = this.backdrop.colorA;
      const [br, bg, bb] = this.backdrop.colorB;
      const colorAStr = `rgb(${ar}, ${ag}, ${ab})`;
      const colorBStr = `rgb(${br}, ${bg}, ${bb})`;
      if (ar === br && ag === bg && ab === bb) {
        ctx.fillStyle = colorAStr;
        ctx.fillRect(0, 0, cw, ch);
      } else {
        const sq = Math.max(4, Math.round(8 * this.dpr));
        for (let y = 0; y < ch; y += sq) {
          for (let x = 0; x < cw; x += sq) {
            const even = (x / sq + y / sq) % 2 === 0;
            ctx.fillStyle = even ? colorAStr : colorBStr;
            ctx.fillRect(x, y, sq, sq);
          }
        }
      }

      const drawLayer = (data: Uint8ClampedArray | null) => {
        if (!data || !this.scratchCanvas) return;
        const w = this.texWidth || docWidth;
        const h = this.texHeight || docHeight;
        this.scratchCanvas.width = w;
        this.scratchCanvas.height = h;
        const sctx = this.scratchCanvas.getContext("2d");
        if (!sctx) return;
        const img = new ImageData(new Uint8ClampedArray(data), w, h);
        sctx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.scratchCanvas, 0, 0, cw, ch);
      };

      if (this.showOnion) {
        drawLayer(this.onionData);
      }
      drawLayer(this.frameData);
      drawLayer(this.overlayData);
    }
  }

  dispose(): void {
    if (!this.gl) return;
    const gl = this.gl;
    if (this.frameTex) gl.deleteTexture(this.frameTex);
    if (this.overlayTex) gl.deleteTexture(this.overlayTex);
    if (this.onionTex) gl.deleteTexture(this.onionTex);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
    this.frameTex = null;
    this.overlayTex = null;
    this.onionTex = null;
    this.vbo = null;
    this.vao = null;
    this.program = null;
  }
}
