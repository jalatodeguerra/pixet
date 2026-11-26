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

const COERCION_PAIRS: ReadonlySet<string> = new Set([
  "rgba->gray",
  "gray->rgba",
  "color->rgba",
  "float->gray",
  "color->float",
  "float->vec2",
  "normal->rgba",
]);

export function canConnectSockets(
  fromType: SocketType,
  toType: SocketType
): { allowed: boolean; coerced: boolean } {
  if (fromType === toType) {
    return { allowed: true, coerced: false };
  }
  if (fromType === "material" || toType === "material") {
    return { allowed: false, coerced: false };
  }
  if (fromType === "palette" || toType === "palette") {
    return { allowed: false, coerced: false };
  }
  if (COERCION_PAIRS.has(`${fromType}->${toType}`)) {
    return { allowed: true, coerced: true };
  }
  return { allowed: false, coerced: false };
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
