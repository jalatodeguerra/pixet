export type SocketType =
  | "rgba"
  | "gray"
  | "normal"
  | "palette"
  | "material"
  | "float"
  | "vec2"
  | "color";

export interface SocketDef {
  id: string;
  label: string;
  type: SocketType;
  optional?: boolean;
  defaultValue?: number | [number, number] | [number, number, number, number];
}

export interface GradientStop {
  pos: number; // 0..1
  color: string; // #rrggbb or #rrggbbaa
}

export interface PaletteParamValue {
  /** "document" | preset name from PALETTE_PRESETS | "custom" */
  source: string;
  /** Hex color list used when source === "custom" */
  colors: string[];
}

export type ParamDef =
  | {
      id: string;
      label: string;
      kind: "float";
      min: number;
      max: number;
      step: number;
      default: number;
      animatable?: boolean;
    }
  | {
      id: string;
      label: string;
      kind: "int";
      min: number;
      max: number;
      step: number;
      default: number;
    }
  | { id: string; label: string; kind: "bool"; default: boolean }
  | {
      id: string;
      label: string;
      kind: "enum";
      options: { value: string; label: string }[];
      default: string;
    }
  | { id: string; label: string; kind: "color"; default: string }
  | {
      id: string;
      label: string;
      kind: "vec2";
      min?: number;
      max?: number;
      step?: number;
      default: [number, number];
    }
  | { id: string; label: string; kind: "seed"; default: number }
  | { id: string; label: string; kind: "ramp"; default: GradientStop[] }
  | { id: string; label: string; kind: "asset"; default: string | null }
  | { id: string; label: string; kind: "layerRef"; default: string }
  | {
      id: string;
      label: string;
      kind: "tileRef";
      default: { tilesetIndex: number; localId: number };
    }
  | {
      id: string;
      label: string;
      kind: "palette";
      default: PaletteParamValue;
    };

export type ResolutionMode =
  | "inherit"
  | 16
  | 32
  | 64
  | 128
  | 256
  | 512
  | 1024
  | 2048;

export type WrapMode = "repeat" | "clamp";
export type FilterMode = "nearest" | "linear";

export type NodeCategory =
  | "inputs"
  | "control"
  | "generators"
  | "distort"
  | "pixel"
  | "adjust"
  | "pbr"
  | "outputs";

export type MaterialChannelKey =
  | "albedo"
  | "normal"
  | "height"
  | "roughness"
  | "metallic"
  | "ao"
  | "emissive";

export type OutputPrecision = "auto" | "ldr8" | "hdr16";

export interface ShaderPassUniforms {
  [name: string]: number | boolean | [number, number] | [number, number, number, number];
}

export interface ShaderPassSpec {
  id: string;
  fragmentShader: string;
  /** Which output socket this pass writes to (defaults to first output). */
  outputSocket?: string;
  /** Optional input socket names or previous pass IDs bound to u_pass0..N. */
  passInputs?: string[];
  /** Optional function computing custom uniforms from node params & pass index. */
  getUniforms?: (
    params: Record<string, unknown>,
    width: number,
    height: number
  ) => ShaderPassUniforms;
}

export type CpuSocketValue =
  | {
      kind: "rgba";
      width: number;
      height: number;
      data: Uint8ClampedArray;
    }
  | {
      kind: "gray";
      width: number;
      height: number;
      data: Float32Array;
    };

export interface CpuEvalContext {
  width: number;
  height: number;
  seed: number;
  time: number;
  frame: number;
  progress: number;
  wrap: WrapMode;
}

export interface NodeDefinition {
  type: string;
  label: string;
  category: NodeCategory;
  description: string;
  inputs: SocketDef[];
  outputs: SocketDef[];
  params: ParamDef[];
  defaultWrap?: WrapMode;
  defaultFilter?: FilterMode;
  outputPrecision?: OutputPrecision;
  fragmentShader?: string;
  passes?: ShaderPassSpec[];
  getUniforms?: (
    params: Record<string, unknown>,
    width: number,
    height: number
  ) => ShaderPassUniforms;
  cpuEvaluate?: (
    inputs: Record<string, CpuSocketValue>,
    params: Record<string, unknown>,
    ctx: CpuEvalContext
  ) => Record<string, CpuSocketValue>;
  scalarEvaluate?: (
    inputs: Record<string, number>,
    params: Record<string, unknown>,
    ctx: { time: number; frame: number; progress: number; seed: number }
  ) => Record<string, number>;
  paletteEvaluate?: (
    params: Record<string, unknown>,
    documentPalette: readonly string[]
  ) => readonly string[];
  isTimeDependent?: boolean;
  isSink?: boolean;
  isMaterialRouter?: boolean;
}

export interface NodeInstance {
  id: string;
  type: string;
  position: { x: number; y: number };
  params: Record<string, unknown>;
  resolution: ResolutionMode;
  wrap: WrapMode;
  filter: FilterMode;
  bypassed?: boolean;
  collapsed?: boolean;
  label?: string;
}

export interface EdgeConnection {
  id: string;
  fromNode: string;
  fromSocket: string;
  toNode: string;
  toSocket: string;
}

export interface NodeFrameGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface ExposedParam {
  id: string;
  label: string;
  nodeId: string;
  paramId: string;
  group?: string;
}

export interface NodeGraph {
  id: string;
  name: string;
  kind: "material" | "compositor" | "subgraph";
  baseResolution: 32 | 64 | 128 | 256 | 512 | 1024;
  seed: number;
  nodes: NodeInstance[];
  edges: EdgeConnection[];
  frames: NodeFrameGroup[];
  exposedParams: ExposedParam[];
  subgraphInputs?: SocketDef[];
  subgraphOutputs?: SocketDef[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface GraphAssetEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  pngBase64: string;
}

export interface NodesDocumentExt {
  schemaVersion: 1;
  activeGraphId: string | null;
  graphs: NodeGraph[];
  assets: Record<string, GraphAssetEntry>;
}
