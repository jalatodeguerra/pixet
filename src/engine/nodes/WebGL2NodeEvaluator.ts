import { FboPool, type FboEntry } from "./FboPool.ts";
import { computeDownstreamNodes, computeReachableNodes, isParamSocketId, topologicalSort } from "./NodeGraph.ts";
import { linkConversion, type LinkConversion, type NodeRegistry } from "./NodeRegistry.ts";
import { buildPaletteLutBytes, uploadPaletteLut } from "./PaletteLut.ts";
import { blitWebGLCanvasTo2D, readTextureToRgba, uploadRgbaToTexture } from "./blitBridge.ts";
import { buildPreviewMesh, type Preview3DMeshKind } from "./pbrPreview3d.ts";
import { COERCE_BLIT_FS, FULLSCREEN_TRIANGLE_VS, LINK_CONVERT_FS } from "./shaders/common.glsl.ts";
import { PBR_PREVIEW_3D_FS, PBR_PREVIEW_3D_VS } from "./shaders/pbr.glsl.ts";
import type { ModelNode } from "../model3d/types.ts";
import type {
  CpuEvalContext,
  CpuSocketValue,
  MaterialChannelKey,
  NodeDefinition,
  NodeGraph,
  NodeInstance,
  ShaderPassUniforms,
  SocketType,
} from "./types.ts";

export type MaterialBundle = Partial<Record<MaterialChannelKey, FboEntry | WebGLTexture>>;

export interface EvalOptions {
  pinnedNodeId?: string | null;
  selectedNodeId?: string | null;
  compareNodeId?: string | null;
  renderThumbnails?: boolean;
  vramBudgetBytes?: number;
  time?: number;
  frame?: number;
  progress?: number;
  paletteColors?: readonly string[];
}

export interface EvaluatorStats {
  vramBytes: number;
  cachedSockets: number;
  lastEvalMs: number;
  supportsFloatFbo: boolean;
  parallelCompile: boolean;
}

export interface PreviewRenderOptions {
  mode: "rgba" | "gray" | "r" | "g" | "b" | "a" | "tile3x3";
}

interface PaletteCacheEntry {
  tex: WebGLTexture;
  count: number;
  key: string;
}

function socketCacheKey(nodeId: string, socketId: string): string {
  return `${nodeId}:${socketId}`;
}

export class WebGL2NodeEvaluator {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private pool: FboPool | null = null;
  private emptyVao: WebGLVertexArrayObject | null = null;
  private programs = new Map<string, WebGLProgram>();
  private fboCache = new Map<string, FboEntry>();
  private materialCache = new Map<string, MaterialBundle>();
  private scalarCache = new Map<string, number>();
  private effectiveParamsCache = new Map<string, Record<string, unknown>>();
  private thumbnailCache = new Map<string, FboEntry>();
  private dirtyNodes = new Set<string>();
  private allDirty = true;
  private lastTimeKey = "";
  private evalTick = 0;
  private lastEvalMs = 0;
  private nodeTimings = new Map<string, number>();

  private paletteTex: WebGLTexture | null = null;
  private paletteCount = 0;
  private lastPaletteKey = "";
  private paletteCache = new Map<string, PaletteCacheEntry>();

  private fallbackTextures = new Map<string, WebGLTexture>();
  private parallelCompileExt: unknown = null;

  constructor() {
    this.initContext();
  }

  private initContext(): void {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      alpha: true,
    });
    if (!gl) return;

    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.handleContextLost();
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.initContext();
      this.markAllDirty();
    });

    this.canvas = canvas;
    this.gl = gl;
    this.pool = new FboPool(gl);
    this.emptyVao = gl.createVertexArray();
    this.parallelCompileExt = gl.getExtension("KHR_parallel_shader_compile");
    this.createFallbackTextures(gl);
  }

  private handleContextLost(): void {
    this.programs.clear();
    this.fboCache.clear();
    this.materialCache.clear();
    this.scalarCache.clear();
    this.effectiveParamsCache.clear();
    this.thumbnailCache.clear();
    this.fallbackTextures.clear();
    this.paletteTex = null;
    this.paletteCount = 0;
    this.lastPaletteKey = "";
    this.paletteCache.clear();
    this.pool?.disposeAll();
    this.pool = null;
    this.gl = null;
  }

  private createFallbackTextures(gl: WebGL2RenderingContext): void {
    const make1x1 = (key: string, rgba: [number, number, number, number]): void => {
      const tex = uploadRgbaToTexture(gl, null, new Uint8Array(rgba), 1, 1, true);
      this.fallbackTextures.set(key, tex);
    };
    make1x1("albedo", [128, 128, 128, 255]);
    make1x1("normal", [128, 128, 255, 255]);
    make1x1("gray0", [0, 0, 0, 255]);
    make1x1("gray05", [128, 128, 128, 255]);
    make1x1("gray1", [255, 255, 255, 255]);
    make1x1("black", [0, 0, 0, 255]);
    make1x1("white", [255, 255, 255, 255]);
    make1x1("transparent", [0, 0, 0, 0]);
  }

  isAvailable(): boolean {
    return this.gl !== null && this.pool !== null;
  }

  markNodeDirty(graph: NodeGraph, nodeId: string): void {
    const downstream = computeDownstreamNodes(graph, [nodeId]);
    for (const id of downstream) {
      this.dirtyNodes.add(id);
    }
  }

  markAllDirty(): void {
    this.allDirty = true;
    this.dirtyNodes.clear();
  }

  getNodeTiming(nodeId: string): number {
    return this.nodeTimings.get(nodeId) ?? 0;
  }

  getStats(): EvaluatorStats {
    return {
      vramBytes: this.pool?.getAllocatedBytes() ?? 0,
      cachedSockets: this.fboCache.size,
      lastEvalMs: this.lastEvalMs,
      supportsFloatFbo: this.pool?.supportsFloatFbo ?? false,
      parallelCompile: this.parallelCompileExt !== null,
    };
  }

  private getOrCompileProgram(fragmentSource: string): WebGLProgram | null {
    const gl = this.gl;
    if (!gl) return null;
    const existing = this.programs.get(fragmentSource);
    if (existing) return existing;

    const definePrefix =
      this.pool && !this.pool.supportsFloatFbo ? "#define PIXET_RG8_SCALAR 1\n" : "";
    const patchedFs = fragmentSource.replace(
      "#version 300 es\n",
      `#version 300 es\n${definePrefix}`
    );

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, FULLSCREEN_TRIANGLE_VS);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, patchedFs);
    gl.compileShader(fs);

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("Node shader link failed:", gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }

    this.programs.set(fragmentSource, prog);
    return prog;
  }

  private resolveNodeResolution(
    node: NodeInstance,
    graph: NodeGraph,
    incoming: Map<string, FboEntry>
  ): number {
    if (node.resolution !== "inherit") return node.resolution;
    for (const entry of incoming.values()) {
      return entry.width;
    }
    return graph.baseResolution;
  }

  private applySamplerParams(
    tex: WebGLTexture,
    wrap: NodeInstance["wrap"],
    filter: NodeInstance["filter"]
  ): void {
    const gl = this.gl;
    if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const glWrap = wrap === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    const glFilter = filter === "nearest" ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, glWrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, glWrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, glFilter);
  }

  private bindStandardUniforms(
    gl: WebGL2RenderingContext,
    prog: WebGLProgram,
    width: number,
    height: number,
    seed: number,
    opts: EvalOptions
  ): void {
    const locRes = gl.getUniformLocation(prog, "u_resolution");
    if (locRes) gl.uniform2f(locRes, width, height);
    const locTexel = gl.getUniformLocation(prog, "u_texelSize");
    if (locTexel) gl.uniform2f(locTexel, 1 / width, 1 / height);
    const locSeed = gl.getUniformLocation(prog, "u_seed");
    if (locSeed) gl.uniform1i(locSeed, seed);
    const locTime = gl.getUniformLocation(prog, "u_time");
    if (locTime) gl.uniform1f(locTime, opts.time ?? 0);
    const locFrame = gl.getUniformLocation(prog, "u_frame");
    if (locFrame) gl.uniform1f(locFrame, opts.frame ?? 0);
    const locProg = gl.getUniformLocation(prog, "u_progress");
    if (locProg) gl.uniform1f(locProg, opts.progress ?? 0);
  }

  private bindCustomUniforms(
    gl: WebGL2RenderingContext,
    prog: WebGLProgram,
    uniforms: ShaderPassUniforms
  ): void {
    for (const [name, value] of Object.entries(uniforms)) {
      const loc = gl.getUniformLocation(prog, name);
      if (!loc) continue;
      if (typeof value === "number") {
        gl.uniform1f(loc, value);
      } else if (typeof value === "boolean") {
        gl.uniform1i(loc, value ? 1 : 0);
      } else if (value.length === 2) {
        gl.uniform2f(loc, value[0], value[1]);
      } else if (value.length === 4) {
        gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
      }
    }
  }

  private drawFullscreenPass(
    prog: WebGLProgram,
    target: FboEntry,
    textures: Array<{ unitName: string; tex: WebGLTexture }>,
    width: number,
    height: number,
    seed: number,
    opts: EvalOptions,
    customUniforms?: ShaderPassUniforms,
    paletteOverride?: PaletteCacheEntry | null
  ): void {
    const gl = this.gl!;
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, width, height);

    this.bindStandardUniforms(gl, prog, width, height, seed, opts);
    if (customUniforms) {
      this.bindCustomUniforms(gl, prog, customUniforms);
    }

    let unit = 0;
    for (const item of textures) {
      const loc = gl.getUniformLocation(prog, item.unitName);
      if (loc) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, item.tex);
        gl.uniform1i(loc, unit);
        unit += 1;
      }
    }

    const activePalTex = paletteOverride?.tex ?? this.paletteTex;
    const activePalCount = paletteOverride ? paletteOverride.count : this.paletteCount;
    if (activePalTex) {
      const locPal = gl.getUniformLocation(prog, "u_palette");
      const locCount = gl.getUniformLocation(prog, "u_paletteCount");
      if (locPal) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, activePalTex);
        gl.uniform1i(locPal, unit);
      }
      if (locCount) {
        gl.uniform1i(locCount, activePalCount);
      }
    }

    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  evaluateGraph(
    graph: NodeGraph,
    registry: NodeRegistry,
    opts: EvalOptions = {}
  ): void {
    const gl = this.gl;
    const pool = this.pool;
    if (!gl || !pool) return;

    const tStart = performance.now();
    this.evalTick += 1;

    if (opts.paletteColors) {
      const palKey = opts.paletteColors.join(",");
      if (palKey !== this.lastPaletteKey) {
        const built = buildPaletteLutBytes(opts.paletteColors);
        this.paletteTex = uploadPaletteLut(gl, this.paletteTex, built.data);
        this.paletteCount = built.count;
        this.lastPaletteKey = palKey;
        for (const node of graph.nodes) {
          const def = registry.get(node.type);
          if (def?.paletteEvaluate) {
            this.markNodeDirty(graph, node.id);
          }
        }
      }
    }

    const timeKey = `${opts.frame ?? 0}:${opts.time ?? 0}:${opts.progress ?? 0}`;
    if (timeKey !== this.lastTimeKey) {
      this.lastTimeKey = timeKey;
      for (const node of graph.nodes) {
        const def = registry.get(node.type);
        if (def?.isTimeDependent) {
          this.markNodeDirty(graph, node.id);
        }
      }
    }

    const { order } = topologicalSort(graph);
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

    // Active sinks: pinned node, selected node, compare node, MaterialOutput/Bake nodes, and thumbnail-visible nodes.
    const sinkIds = new Set<string>();
    if (opts.pinnedNodeId) sinkIds.add(opts.pinnedNodeId);
    if (opts.selectedNodeId) sinkIds.add(opts.selectedNodeId);
    if (opts.compareNodeId) sinkIds.add(opts.compareNodeId);
    for (const node of graph.nodes) {
      const def = registry.get(node.type);
      if (def?.isSink || opts.renderThumbnails) {
        sinkIds.add(node.id);
      }
    }
    const reachable = computeReachableNodes(graph, Array.from(sinkIds));

    const protectedKeys = new Set<string>();
    if (opts.pinnedNodeId) protectedKeys.add(opts.pinnedNodeId);
    if (opts.selectedNodeId) protectedKeys.add(opts.selectedNodeId);

    for (const nodeId of order) {
      if (!reachable.has(nodeId)) continue;
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      const def = registry.get(node.type);
      if (!def) continue;

      const isDirty =
        this.allDirty ||
        this.dirtyNodes.has(nodeId) ||
        (!def.scalarEvaluate &&
          !def.paletteEvaluate &&
          !def.isMaterialRouter &&
          def.outputs.some((out) => !this.fboCache.has(socketCacheKey(nodeId, out.id)))) ||
        (Boolean(def.paletteEvaluate) &&
          def.outputs.some((out) => !this.paletteCache.has(socketCacheKey(nodeId, out.id))));

      if (!isDirty) continue;

      const nodeStart = performance.now();
      this.evaluateSingleNode(node, def, graph, registry, opts);
      this.nodeTimings.set(nodeId, performance.now() - nodeStart);
      this.dirtyNodes.delete(nodeId);
    }

    this.allDirty = false;
    pool.evictToBudget(
      this.fboCache,
      protectedKeys,
      opts.vramBudgetBytes ?? 128 * 1024 * 1024
    );
    this.lastEvalMs = performance.now() - tStart;
  }

  private evaluateSingleNode(
    node: NodeInstance,
    def: NodeDefinition,
    graph: NodeGraph,
    registry: NodeRegistry,
    opts: EvalOptions
  ): void {
    const gl = this.gl!;
    const pool = this.pool!;

    const incoming = new Map<string, FboEntry>();
    let incomingPalette: PaletteCacheEntry | null = null;
    const scalarInputs: Record<string, number> = {};
    const effectiveParams: Record<string, unknown> = { ...node.params };

    // Texture links that need a Blender-style implicit conversion, resolved below
    // once the node's resolution is known.
    const pendingConversions: Array<{
      inputId: string;
      conv: LinkConversion;
      src: FboEntry | null;
      scalar: number | undefined;
    }> = [];

    for (const edge of graph.edges) {
      if (edge.toNode !== node.id) continue;
      const srcKey = socketCacheKey(edge.fromNode, edge.fromSocket);
      const scalarVal = this.scalarCache.get(srcKey);

      if (isParamSocketId(edge.toSocket)) {
        const paramId = edge.toSocket.slice(6);
        const paramDef = def.params.find((p) => p.id === paramId);
        if (
          scalarVal !== undefined &&
          paramDef &&
          (paramDef.kind === "float" || paramDef.kind === "int")
        ) {
          const clampedUnit = Math.max(0, Math.min(1, scalarVal));
          const mapped = paramDef.min + (paramDef.max - paramDef.min) * clampedUnit;
          effectiveParams[paramId] =
            paramDef.kind === "int" ? Math.round(mapped) : Number(mapped.toFixed(4));
        }
        continue;
      }

      if (scalarVal !== undefined) {
        scalarInputs[edge.toSocket] = scalarVal;
      }
      const palCached = this.paletteCache.get(srcKey);
      if (palCached) {
        incomingPalette = palCached;
      }
      const cached = this.fboCache.get(srcKey) ?? null;
      const inDef = def.inputs.find((i) => i.id === edge.toSocket);
      const fromNode = graph.nodes.find((n) => n.id === edge.fromNode);
      const outDef = fromNode
        ? registry.get(fromNode.type)?.outputs.find((o) => o.id === edge.fromSocket)
        : undefined;
      const conv = inDef && outDef ? linkConversion(outDef.type, inDef.type) : "none";
      if (conv === "invalid") continue;
      if (conv === "broadcast" || conv === "luminance" || conv === "fillScalar" || conv === "fillColor") {
        pendingConversions.push({ inputId: edge.toSocket, conv, src: cached, scalar: scalarVal });
        continue;
      }
      if (cached) incoming.set(edge.toSocket, cached);
    }
    this.effectiveParamsCache.set(node.id, effectiveParams);

    if (def.paletteEvaluate) {
      const colors = def.paletteEvaluate(effectiveParams, opts.paletteColors ?? []);
      const key = colors.join(",");
      for (const out of def.outputs) {
        const sockKey = socketCacheKey(node.id, out.id);
        const existing = this.paletteCache.get(sockKey);
        if (!existing || existing.key !== key) {
          const built = buildPaletteLutBytes(colors);
          const tex = uploadPaletteLut(gl, existing?.tex ?? null, built.data);
          this.paletteCache.set(sockKey, { tex, count: built.count, key });
        }
      }
      return;
    }

    if (def.scalarEvaluate) {
      const outScalars = def.scalarEvaluate(scalarInputs, effectiveParams, {
        time: opts.time ?? 0,
        frame: opts.frame ?? 0,
        progress: opts.progress ?? 0,
        seed: (graph.seed ^ Number(effectiveParams.seed ?? 0)) | 0,
      });
      for (const [k, v] of Object.entries(outScalars)) {
        this.scalarCache.set(socketCacheKey(node.id, k), v);
      }
      return;
    }

    if (pendingConversions.length > 0) {
      const textureSrc = pendingConversions.find((p) => p.src)?.src ?? null;
      const fallbackRes =
        node.resolution !== "inherit"
          ? node.resolution
          : incoming.values().next().value?.width ?? textureSrc?.width ?? graph.baseResolution;
      for (const pc of pendingConversions) {
        const converted = this.convertLinkInput(node.id, pc.inputId, pc.conv, pc.src, pc.scalar, fallbackRes);
        if (converted) incoming.set(pc.inputId, converted);
      }
    }

    // Bypass short-circuit: only pass through an input stored the same way as the output.
    if (node.bypassed && def.outputs.length > 0 && def.inputs.length > 0) {
      const primaryOut = def.outputs[0];
      const compatibleIn = def.inputs.find((inp) => {
        const has = incoming.get(inp.id);
        const conv = linkConversion(inp.type, primaryOut.type);
        return has && (conv === "none" || conv === "passthrough");
      });
      if (compatibleIn) {
        const srcEntry = incoming.get(compatibleIn.id)!;
        srcEntry.lastUsedTick = this.evalTick;
        this.fboCache.set(socketCacheKey(node.id, primaryOut.id), srcEntry);
        return;
      }
    }

    const res = this.resolveNodeResolution(node, graph, incoming);
    const nodeSeed = (graph.seed ^ Number(effectiveParams.seed ?? 0)) | 0;
    const effectiveNode: NodeInstance = { ...node, params: effectiveParams };

    if (def.isMaterialRouter) {
      this.evaluateMaterialRouter(effectiveNode, def, graph, incoming);
    } else if (def.cpuEvaluate) {
      this.runCpuBridgeNode(effectiveNode, def, incoming, res, nodeSeed, opts);
    } else if (def.passes && def.passes.length > 0) {
      this.runMultiPassNode(effectiveNode, def, incoming, res, nodeSeed, opts, incomingPalette);
    } else if (def.fragmentShader) {
      const prog = this.getOrCompileProgram(def.fragmentShader);
      if (prog && def.outputs.length > 0) {
        const outDef = def.outputs[0];
        const kind = pool.resolveKind(
          outDef.type === "gray"
            ? "gray"
            : def.outputPrecision === "ldr8"
            ? "ldr8"
            : "rgba"
        );
        const key = socketCacheKey(node.id, outDef.id);
        let target = this.fboCache.get(key);
        if (!target || target.width !== res || target.height !== res || target.kind !== kind) {
          if (target) pool.release(target);
          target = pool.acquire(res, res, kind, this.evalTick);
          this.fboCache.set(key, target);
        }
        target.lastUsedTick = this.evalTick;
        this.applySamplerParams(target.texture, node.wrap, node.filter);

        const texBindings: Array<{ unitName: string; tex: WebGLTexture }> = [];
        for (const inp of def.inputs) {
          if (inp.type === "palette") continue;
          const entry = incoming.get(inp.id);
          texBindings.push({
            unitName: `u_${inp.id}`,
            tex: entry?.texture ?? this.getDefaultTextureForSocket(inp.type),
          });
        }
        const customUniforms = def.getUniforms
          ? def.getUniforms(effectiveParams, res, res)
          : undefined;
        this.drawFullscreenPass(
          prog,
          target,
          texBindings,
          res,
          res,
          nodeSeed,
          opts,
          customUniforms,
          incomingPalette
        );
      }
    }

    if (opts.renderThumbnails && def.outputs.length > 0) {
      const primaryKey = socketCacheKey(node.id, def.outputs[0].id);
      const primary = this.fboCache.get(primaryKey);
      if (primary) {
        this.updateThumbnail(node.id, primary, def.outputs[0].type);
      }
    }
    void registry;
  }

  /**
   * Render the converted texture for one link into a per-(node, input) cache slot.
   * Returns null when there is nothing to convert yet (e.g. source not evaluated).
   */
  private convertLinkInput(
    nodeId: string,
    inputId: string,
    conv: LinkConversion,
    src: FboEntry | null,
    scalar: number | undefined,
    fallbackRes: number
  ): FboEntry | null {
    const pool = this.pool!;
    const isFill = conv === "fillScalar" || conv === "fillColor";
    if (isFill && scalar === undefined) return null;
    if (!isFill && !src) return null;
    const prog = this.getOrCompileProgram(LINK_CONVERT_FS);
    if (!prog) return null;

    const toGray = conv === "luminance" || conv === "fillScalar";
    const kind = pool.resolveKind(toGray ? "gray" : "rgba");
    const res = src?.width ?? fallbackRes;
    const key = `conv:${nodeId}:${inputId}`;
    let target = this.fboCache.get(key);
    if (!target || target.width !== res || target.height !== res || target.kind !== kind) {
      if (target) pool.release(target);
      target = pool.acquire(res, res, kind, this.evalTick);
      this.fboCache.set(key, target);
    }
    target.lastUsedTick = this.evalTick;
    if (src) src.lastUsedTick = this.evalTick;

    const mode = conv === "broadcast" ? 1 : conv === "luminance" ? 2 : conv === "fillScalar" ? 3 : 4;
    this.drawFullscreenPass(
      prog,
      target,
      [{ unitName: "u_src", tex: src?.texture ?? this.fallbackTextures.get("black")! }],
      res,
      res,
      0,
      {},
      { u_mode: mode, u_value: scalar ?? 0 }
    );
    return target;
  }

  private runMultiPassNode(
    node: NodeInstance,
    def: NodeDefinition,
    incoming: Map<string, FboEntry>,
    res: number,
    nodeSeed: number,
    opts: EvalOptions,
    incomingPalette?: PaletteCacheEntry | null
  ): void {
    const pool = this.pool!;
    const passResults = new Map<string, FboEntry>();
    const passes = def.passes ?? [];

    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      const prog = this.getOrCompileProgram(pass.fragmentShader);
      if (!prog) continue;

      const isFinalOut = Boolean(pass.outputSocket) || i === passes.length - 1;
      const outId = pass.outputSocket ?? def.outputs[0]?.id ?? "out";
      const outDef = def.outputs.find((o) => o.id === outId);
      const kind = pool.resolveKind(
        outDef?.type === "gray"
          ? "gray"
          : def.outputPrecision === "ldr8"
          ? "ldr8"
          : "rgba"
      );

      let target: FboEntry;
      if (isFinalOut) {
        const key = socketCacheKey(node.id, outId);
        const existing = this.fboCache.get(key);
        if (!existing || existing.width !== res || existing.height !== res || existing.kind !== kind) {
          if (existing) pool.release(existing);
          target = pool.acquire(res, res, kind, this.evalTick);
          this.fboCache.set(key, target);
        } else {
          target = existing;
        }
      } else {
        target = pool.acquire(res, res, kind, this.evalTick);
      }

      target.lastUsedTick = this.evalTick;
      this.applySamplerParams(target.texture, node.wrap, node.filter);

      const texBindings: Array<{ unitName: string; tex: WebGLTexture }> = [];
      for (const inp of def.inputs) {
        if (inp.type === "palette") continue;
        const entry = incoming.get(inp.id);
        texBindings.push({
          unitName: `u_${inp.id}`,
          tex: entry?.texture ?? this.getDefaultTextureForSocket(inp.type),
        });
      }
      if (pass.passInputs) {
        pass.passInputs.forEach((pId, idx) => {
          const prev = passResults.get(pId) ?? incoming.get(pId);
          if (prev) texBindings.push({ unitName: `u_pass${idx}`, tex: prev.texture });
        });
      }

      const customUniforms = pass.getUniforms
        ? pass.getUniforms(node.params, res, res)
        : def.getUniforms?.(node.params, res, res);

      this.drawFullscreenPass(
        prog,
        target,
        texBindings,
        res,
        res,
        nodeSeed,
        opts,
        customUniforms,
        incomingPalette
      );
      passResults.set(pass.id, target);
    }

    for (let i = 0; i < passes.length - 1; i++) {
      const p = passes[i];
      if (!p.outputSocket) {
        const entry = passResults.get(p.id);
        if (entry) pool.release(entry);
      }
    }
  }

  private runCpuBridgeNode(
    node: NodeInstance,
    def: NodeDefinition,
    incoming: Map<string, FboEntry>,
    res: number,
    nodeSeed: number,
    opts: EvalOptions
  ): void {
    const gl = this.gl!;
    const pool = this.pool!;
    const cpuInputs: Record<string, CpuSocketValue> = {};

    for (const inp of def.inputs) {
      const entry = incoming.get(inp.id);
      if (!entry) continue;
      const rgba = readTextureToRgba(gl, entry.fbo, entry.width, entry.height, false);
      cpuInputs[inp.id] = {
        kind: "rgba",
        width: entry.width,
        height: entry.height,
        data: rgba,
      };
    }

    const ctx: CpuEvalContext = {
      width: res,
      height: res,
      seed: nodeSeed,
      time: opts.time ?? 0,
      frame: opts.frame ?? 0,
      progress: opts.progress ?? 0,
      wrap: node.wrap,
    };

    const outputs = def.cpuEvaluate!(cpuInputs, node.params, ctx);
    for (const [outId, val] of Object.entries(outputs)) {
      const key = socketCacheKey(node.id, outId);
      let target = this.fboCache.get(key);
      const kind = pool.resolveKind("ldr8");
      if (!target || target.width !== val.width || target.height !== val.height || target.kind !== kind) {
        if (target) pool.release(target);
        target = pool.acquire(val.width, val.height, kind, this.evalTick);
        this.fboCache.set(key, target);
      }
      target.lastUsedTick = this.evalTick;
      if (val.kind === "rgba") {
        uploadRgbaToTexture(gl, target.texture, val.data, val.width, val.height, node.filter === "nearest");
      } else {
        const packed = new Uint8Array(val.width * val.height * 4);
        for (let i = 0; i < val.data.length; i++) {
          const byte = Math.max(0, Math.min(255, Math.round(val.data[i] * 255)));
          const p = i * 4;
          packed[p] = byte;
          packed[p + 1] = byte;
          packed[p + 2] = byte;
          packed[p + 3] = 255;
        }
        uploadRgbaToTexture(gl, target.texture, packed, val.width, val.height, node.filter === "nearest");
      }
    }
  }

  private getDefaultTextureForSocket(type: SocketType): WebGLTexture {
    if (type === "normal") return this.fallbackTextures.get("normal")!;
    if (type === "gray") return this.fallbackTextures.get("gray05")!;
    return this.fallbackTextures.get("transparent")!;
  }

  private updateThumbnail(
    nodeId: string,
    src: FboEntry,
    socketType: SocketType
  ): void {
    const pool = this.pool;
    if (!pool) return;
    const prog = this.getOrCompileProgram(COERCE_BLIT_FS);
    if (!prog) return;
    const THUMB_SIZE = 128;

    let thumb = this.thumbnailCache.get(nodeId);
    if (!thumb || thumb.width !== THUMB_SIZE || thumb.height !== THUMB_SIZE) {
      if (thumb) pool.release(thumb);
      thumb = pool.acquire(THUMB_SIZE, THUMB_SIZE, "rgba8", this.evalTick);
      thumb.pinned = true;
      this.thumbnailCache.set(nodeId, thumb);
    }

    const mode = socketType === "gray" ? 1 : 0;
    this.drawFullscreenPass(
      prog,
      thumb,
      [{ unitName: "u_src", tex: src.texture }],
      THUMB_SIZE,
      THUMB_SIZE,
      0,
      {},
      { u_mode: mode }
    );
  }

  renderThumbnailToCanvas(nodeId: string, targetCanvas: HTMLCanvasElement): boolean {
    const gl = this.gl;
    const srcCanvas = this.canvas;
    if (!gl || !srcCanvas) return false;
    const thumb = this.thumbnailCache.get(nodeId);
    if (!thumb) return false;
    const THUMB_SIZE = 128;

    if (srcCanvas.width !== THUMB_SIZE || srcCanvas.height !== THUMB_SIZE) {
      srcCanvas.width = THUMB_SIZE;
      srcCanvas.height = THUMB_SIZE;
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, thumb.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      THUMB_SIZE,
      THUMB_SIZE,
      0,
      0,
      THUMB_SIZE,
      THUMB_SIZE,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    blitWebGLCanvasTo2D(srcCanvas, targetCanvas);
    return true;
  }

  renderPreviewToCanvas(
    nodeId: string,
    socketId: string,
    targetCanvas: HTMLCanvasElement,
    mode: PreviewRenderOptions["mode"] = "rgba"
  ): boolean {
    const gl = this.gl;
    const pool = this.pool;
    const srcCanvas = this.canvas;
    if (!gl || !pool || !srcCanvas) return false;
    const entry = this.fboCache.get(socketCacheKey(nodeId, socketId));
    if (!entry) return false;

    const prog = this.getOrCompileProgram(COERCE_BLIT_FS);
    if (!prog) return false;

    const size = Math.max(64, Math.min(512, entry.width));
    const temp = pool.acquire(size, size, "rgba8", this.evalTick);
    const modeInt =
      mode === "gray"
        ? 1
        : mode === "r"
        ? 3
        : mode === "g"
        ? 4
        : mode === "b"
        ? 5
        : mode === "a"
        ? 6
        : mode === "tile3x3"
        ? 7
        : 0;

    this.drawFullscreenPass(
      prog,
      temp,
      [{ unitName: "u_src", tex: entry.texture }],
      size,
      size,
      0,
      {},
      { u_mode: modeInt }
    );

    if (srcCanvas.width !== size || srcCanvas.height !== size) {
      srcCanvas.width = size;
      srcCanvas.height = size;
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, temp.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, size, size, 0, 0, size, size, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    blitWebGLCanvasTo2D(srcCanvas, targetCanvas);
    pool.release(temp);
    return true;
  }

  readOutputRgba(nodeId: string, socketId: string): {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  } | null {
    const gl = this.gl;
    if (!gl) return null;
    const entry = this.fboCache.get(socketCacheKey(nodeId, socketId));
    if (!entry) return null;
    return {
      width: entry.width,
      height: entry.height,
      data: readTextureToRgba(gl, entry.fbo, entry.width, entry.height, true),
    };
  }

  private evaluateMaterialRouter(
    node: NodeInstance,
    def: NodeDefinition,
    graph: NodeGraph,
    incoming: Map<string, FboEntry>
  ): void {
    const findIncomingMat = (socketId: string): MaterialBundle | undefined => {
      const edge = graph.edges.find(
        (e) => e.toNode === node.id && e.toSocket === socketId
      );
      if (!edge) return undefined;
      return this.materialCache.get(socketCacheKey(edge.fromNode, edge.fromSocket));
    };

    if (node.type === "pbr.materialCombine") {
      const bundle: MaterialBundle = {
        albedo: incoming.get("albedo"),
        normal: incoming.get("normal"),
        height: incoming.get("height"),
        roughness: incoming.get("roughness"),
        metallic: incoming.get("metallic"),
        ao: incoming.get("ao"),
        emissive: incoming.get("emissive"),
      };
      this.materialCache.set(socketCacheKey(node.id, "material"), bundle);
      return;
    }

    if (node.type === "pbr.materialSplit") {
      const bundle = findIncomingMat("material");
      if (!bundle) return;
      const channels: MaterialChannelKey[] = [
        "albedo",
        "normal",
        "height",
        "roughness",
        "metallic",
        "ao",
        "emissive",
      ];
      for (const ch of channels) {
        const item = bundle[ch];
        if (item && "fbo" in item) {
          this.fboCache.set(socketCacheKey(node.id, ch), item);
        }
      }
      return;
    }

    if (node.type === "pbr.materialBlend") {
      const base = findIncomingMat("base");
      const top = findIncomingMat("top");
      const bundle: MaterialBundle = {
        albedo: top?.albedo ?? base?.albedo,
        normal: top?.normal ?? base?.normal,
        height: top?.height ?? base?.height,
        roughness: top?.roughness ?? base?.roughness,
        metallic: top?.metallic ?? base?.metallic,
        ao: top?.ao ?? base?.ao,
        emissive: top?.emissive ?? base?.emissive,
      };
      this.materialCache.set(socketCacheKey(node.id, "material"), bundle);
      return;
    }

    if (node.type === "output.material") {
      const bundle = findIncomingMat("material") ?? {};
      this.materialCache.set(socketCacheKey(node.id, "material"), bundle);
      if (bundle.albedo && "fbo" in bundle.albedo) {
        this.fboCache.set(socketCacheKey(node.id, "albedo"), bundle.albedo);
      }
    }
    void def;
  }

  getMaterialBundle(nodeId: string): MaterialBundle | null {
    return this.materialCache.get(socketCacheKey(nodeId, "material")) ?? null;
  }

  getEffectiveParams(nodeId: string): Record<string, unknown> | null {
    return this.effectiveParamsCache.get(nodeId) ?? null;
  }

  getPreviewMaterialBundle(nodeId: string, registry: NodeRegistry, nodeType: string): MaterialBundle | null {
    const mat = this.getMaterialBundle(nodeId);
    if (mat) return mat;
    const def = registry.get(nodeType);
    const outSock = def?.outputs[0];
    if (!outSock) return null;
    const entry = this.fboCache.get(socketCacheKey(nodeId, outSock.id));
    if (!entry) return null;
    if (outSock.type === "normal") {
      return { normal: entry };
    }
    return { albedo: entry };
  }

  readMaterialChannelsRgba(
    graph: NodeGraph,
    _registry: NodeRegistry,
    materialNodeId: string
  ): {
    width: number;
    height: number;
    albedo: Uint8ClampedArray;
    normal: Uint8ClampedArray;
    heightMap: Uint8ClampedArray;
    roughness: Uint8ClampedArray;
    metallic: Uint8ClampedArray;
    ao: Uint8ClampedArray;
    emissive: Uint8ClampedArray;
  } | null {
    const gl = this.gl;
    if (!gl) return null;
    const bundle = this.getMaterialBundle(materialNodeId);
    let w: number = graph.baseResolution;
    let h: number = graph.baseResolution;
    if (bundle?.albedo && "fbo" in bundle.albedo) {
      w = bundle.albedo.width;
      h = bundle.albedo.height;
    }
    const fillSolid = (r: number, g: number, b: number, a: number): Uint8ClampedArray => {
      const arr = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < arr.length; i += 4) {
        arr[i] = r;
        arr[i + 1] = g;
        arr[i + 2] = b;
        arr[i + 3] = a;
      }
      return arr;
    };
    const readOrFill = (
      entry: FboEntry | WebGLTexture | undefined,
      r: number,
      g: number,
      b: number,
      a: number
    ): Uint8ClampedArray => {
      if (entry && "fbo" in entry) {
        return readTextureToRgba(gl, entry.fbo, entry.width, entry.height, true);
      }
      return fillSolid(r, g, b, a);
    };

    return {
      width: w,
      height: h,
      albedo: readOrFill(bundle?.albedo, 128, 128, 128, 255),
      normal: readOrFill(bundle?.normal, 128, 128, 255, 255),
      heightMap: readOrFill(bundle?.height, 128, 128, 128, 255),
      roughness: readOrFill(bundle?.roughness, 128, 128, 128, 255),
      metallic: readOrFill(bundle?.metallic, 0, 0, 0, 255),
      ao: readOrFill(bundle?.ao, 255, 255, 255, 255),
      emissive: readOrFill(bundle?.emissive, 0, 0, 0, 255),
    };
  }

  render3DPbrPreviewToCanvas(
    targetCanvas: HTMLCanvasElement,
    bundle: MaterialBundle | null,
    opts: {
      meshKind: Preview3DMeshKind;
      yawDeg: number;
      pitchDeg: number;
      lightAngleDeg: number;
      modelNodes?: readonly ModelNode[];
    }
  ): boolean {
    const gl = this.gl;
    const pool = this.pool;
    const srcCanvas = this.canvas;
    if (!gl || !pool || !srcCanvas) return false;

    const progKey = "pbr-3d-preview";
    let prog = this.programs.get(progKey);
    if (!prog) {
      const vs = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(vs, PBR_PREVIEW_3D_VS);
      gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fs, PBR_PREVIEW_3D_FS);
      gl.compileShader(fs);
      prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.deleteProgram(prog);
        return false;
      }
      this.programs.set(progKey, prog);
    }

    const size = 256;
    if (srcCanvas.width !== size || srcCanvas.height !== size) {
      srcCanvas.width = size;
      srcCanvas.height = size;
    }

    const mesh = buildPreviewMesh(opts.meshKind, opts.modelNodes ?? []);
    const vbo = gl.createBuffer()!;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, size, size);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.08, 0.08, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(prog);
    const yaw = (opts.yawDeg * Math.PI) / 180;
    const pitch = (opts.pitchDeg * Math.PI) / 180;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);

    // Simple rotation matrix (model) and orthographic-ish perspective (mvp)
    const model = new Float32Array([
      cy, sy * sp, sy * cp, 0,
      0, cp, -sp, 0,
      -sy, cy * sp, cy * cp, 0,
      0, 0, 0, 1,
    ]);
    const scale = 0.72;
    const mvp = new Float32Array([
      model[0] * scale, model[1] * scale, model[2] * scale * 0.5, 0,
      model[4] * scale, model[5] * scale, model[6] * scale * 0.5, 0,
      model[8] * scale, model[9] * scale, model[10] * scale * 0.5, 0,
      0, 0, 0, 1,
    ]);

    gl.uniformMatrix4fv(gl.getUniformLocation(prog, "u_model"), false, model);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, "u_mvp"), false, mvp);
    gl.uniform3f(gl.getUniformLocation(prog, "u_camPos"), 0, 0, 3.0);
    const la = (opts.lightAngleDeg * Math.PI) / 180;
    gl.uniform3f(gl.getUniformLocation(prog, "u_lightDir"), Math.cos(la), 0.7, Math.sin(la));

    const bindTex = (name: string, unit: number, entry: FboEntry | WebGLTexture | undefined, fbKey: string) => {
      const tex =
        entry && "fbo" in entry
          ? entry.texture
          : entry ?? this.fallbackTextures.get(fbKey)!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    };
    bindTex("u_albedo", 0, bundle?.albedo, "albedo");
    bindTex("u_normalMap", 1, bundle?.normal, "normal");
    bindTex("u_roughness", 2, bundle?.roughness, "gray05");
    bindTex("u_metallic", 3, bundle?.metallic, "gray0");
    bindTex("u_ao", 4, bundle?.ao, "gray1");
    bindTex("u_emissive", 5, bundle?.emissive, "black");

    gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    gl.deleteBuffer(vbo);
    gl.deleteVertexArray(vao);

    blitWebGLCanvasTo2D(srcCanvas, targetCanvas);
    return true;
  }

  dispose(): void {
    this.handleContextLost();
    this.canvas = null;
  }
}
