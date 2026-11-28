import type {
  NodeCategory,
  NodeDefinition,
  NodeInstance,
  ParamDef,
  SocketType,
} from "./types.ts";

export const SOCKET_COLORS: Record<SocketType, string> = {
  rgba: "#38bdf8",
  gray: "#cbd5e1",
  normal: "#a78bfa",
  palette: "#fbbf24",
  material: "#34d399",
  float: "#86efac",
  vec2: "#2dd4bf",
  color: "#f472b6",
};

export const CATEGORY_COLORS: Record<NodeCategory, string> = {
  inputs: "#38bdf8",
  control: "#f59e0b",
  generators: "#a78bfa",
  distort: "#2dd4bf",
  pixel: "#f472b6",
  adjust: "#94a3b8",
  pbr: "#34d399",
  outputs: "#34d399",
};

/**
 * How a socket's data is physically carried during evaluation.
 * - scalar: a single CPU number (control nodes: LFO, Macro, Math)
 * - scalarTex: a single-channel texture (gray / height masks)
 * - colorTex: an RGBA texture (rgba, color, normal and vec2 all share it)
 * - palette / material: special bundles that only link to their own type
 */
export type SocketRepresentation = "scalar" | "scalarTex" | "colorTex" | "palette" | "material";

export function socketRepresentation(type: SocketType): SocketRepresentation {
  switch (type) {
    case "float":
      return "scalar";
    case "gray":
      return "scalarTex";
    case "palette":
      return "palette";
    case "material":
      return "material";
    default:
      return "colorTex";
  }
}

/**
 * What the evaluator does to the data on a link, Blender-style implicit conversion.
 * - none: same socket type
 * - passthrough: same storage, different meaning (e.g. normal -> rgba, rgba -> vec2), copied as-is
 * - broadcast: gray texture -> RGBA (g, g, g, 1)
 * - luminance: RGBA texture -> gray, Rec.709 luminance times alpha
 * - fillScalar: CPU float -> solid gray texture
 * - fillColor: CPU float -> solid RGBA texture (v, v, v, 1)
 * - invalid: the link is refused
 */
export type LinkConversion =
  | "none"
  | "passthrough"
  | "broadcast"
  | "luminance"
  | "fillScalar"
  | "fillColor"
  | "invalid";

export function linkConversion(fromType: SocketType, toType: SocketType): LinkConversion {
  if (fromType === toType) return "none";
  const from = socketRepresentation(fromType);
  const to = socketRepresentation(toType);
  // Palettes and material bundles are like Blender's shader socket: same type only.
  if (from === "palette" || from === "material" || to === "palette" || to === "material") {
    return "invalid";
  }
  if (from === to) return "passthrough";
  if (from === "scalar") return to === "scalarTex" ? "fillScalar" : "fillColor";
  // A per-pixel texture can't collapse into one CPU number (like a field -> single value in Blender).
  if (to === "scalar") return "invalid";
  if (from === "scalarTex" && to === "colorTex") return "broadcast";
  return "luminance";
}

export function canConnectSockets(
  fromType: SocketType,
  toType: SocketType
): { allowed: boolean; coerced: boolean } {
  const conv = linkConversion(fromType, toType);
  if (conv === "invalid") return { allowed: false, coerced: false };
  return { allowed: true, coerced: conv !== "none" };
}

function cloneParamDefault(param: ParamDef): unknown {
  switch (param.kind) {
    case "vec2":
      return [param.default[0], param.default[1]];
    case "ramp":
      return param.default.map((stop) => ({ ...stop }));
    case "tileRef":
      return { ...param.default };
    case "palette":
      return {
        source: param.default.source,
        colors: [...param.default.colors],
      };
    default:
      return param.default;
  }
}

export class NodeRegistry {
  private readonly defs = new Map<string, NodeDefinition>();

  register(def: NodeDefinition): void {
    this.defs.set(def.type, def);
  }

  registerAll(defs: readonly NodeDefinition[]): void {
    for (const def of defs) {
      this.register(def);
    }
  }

  get(type: string): NodeDefinition | undefined {
    return this.defs.get(type);
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  list(): NodeDefinition[] {
    return Array.from(this.defs.values());
  }

  listByCategory(): Record<NodeCategory, NodeDefinition[]> {
    const grouped: Record<NodeCategory, NodeDefinition[]> = {
      inputs: [],
      control: [],
      generators: [],
      distort: [],
      pixel: [],
      adjust: [],
      pbr: [],
      outputs: [],
    };
    for (const def of this.defs.values()) {
      grouped[def.category].push(def);
    }
    return grouped;
  }

  createDefaultParams(type: string): Record<string, unknown> {
    const def = this.defs.get(type);
    if (!def) return {};
    const out: Record<string, unknown> = {};
    for (const param of def.params) {
      out[param.id] = cloneParamDefault(param);
    }
    return out;
  }

  createNodeInstance(
    type: string,
    position: { x: number; y: number },
    overrides?: Partial<Omit<NodeInstance, "type" | "position">> & { id: string }
  ): NodeInstance {
    const def = this.defs.get(type);
    const defaultParams = this.createDefaultParams(type);
    const mergedParams = overrides?.params
      ? { ...defaultParams, ...overrides.params }
      : defaultParams;
    return {
      id: overrides?.id ?? `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      position: { x: position.x, y: position.y },
      params: mergedParams,
      resolution: overrides?.resolution ?? "inherit",
      wrap: overrides?.wrap ?? def?.defaultWrap ?? "repeat",
      filter: overrides?.filter ?? def?.defaultFilter ?? "linear",
      ...(overrides?.bypassed !== undefined ? { bypassed: overrides.bypassed } : {}),
      ...(overrides?.collapsed !== undefined ? { collapsed: overrides.collapsed } : {}),
      ...(overrides?.label !== undefined ? { label: overrides.label } : {}),
    };
  }
}

export const nodeRegistry = new NodeRegistry();
