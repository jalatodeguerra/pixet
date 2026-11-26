import type { NodeDefinition } from "../types.ts";

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export const ANIM_MACRO_NODES: NodeDefinition[] = [
  {
    type: "macro.controller",
    label: "Macro Rack (4 Knobs)",
    category: "control",
    description: "DAW-style 4-knob macro controller outputting normalized 0..1 signals to drive any node parameters.",
    inputs: [],
    outputs: [
      { id: "m1", label: "Macro 1", type: "float" },
      { id: "m2", label: "Macro 2", type: "float" },
      { id: "m3", label: "Macro 3", type: "float" },
      { id: "m4", label: "Macro 4", type: "float" },
    ],
    params: [
      { id: "m1", label: "Macro 1", kind: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "m2", label: "Macro 2", kind: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "m3", label: "Macro 3", kind: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "m4", label: "Macro 4", kind: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    scalarEvaluate: (_inputs, params) => ({
      m1: clamp01(Number(params.m1 ?? 0.5)),
      m2: clamp01(Number(params.m2 ?? 0.5)),
      m3: clamp01(Number(params.m3 ?? 0.5)),
      m4: clamp01(Number(params.m4 ?? 0.5)),
    }),
  },
  {
    type: "macro.knob",
    label: "Macro Knob",
    category: "control",
    description: "Single macro knob with response curve and min/max range mapping.",
    inputs: [],
    outputs: [{ id: "out", label: "Value", type: "float" }],
    params: [
      { id: "value", label: "Value", kind: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "min", label: "Out Min", kind: "float", min: 0, max: 1, step: 0.02, default: 0 },
      { id: "max", label: "Out Max", kind: "float", min: 0, max: 1, step: 0.02, default: 1 },
      {
        id: "curve",
        label: "Curve",
        kind: "enum",
        options: [
          { value: "linear", label: "Linear" },
          { value: "easeIn", label: "Ease In" },
          { value: "easeOut", label: "Ease Out" },
          { value: "smoothstep", label: "Smoothstep" },
        ],
        default: "linear",
      },
    ],
    scalarEvaluate: (_inputs, params) => {
      const t = clamp01(Number(params.value ?? 0.5));
      const curve = String(params.curve ?? "linear");
      let shaped = t;
      if (curve === "easeIn") shaped = t * t;
      else if (curve === "easeOut") shaped = 1 - (1 - t) * (1 - t);
      else if (curve === "smoothstep") shaped = t * t * (3 - 2 * t);
      const min = Number(params.min ?? 0);
      const max = Number(params.max ?? 1);
      return { out: min + (max - min) * shaped };
    },
  },
  {
    type: "anim.time",
    label: "Time / Frame",
    category: "control",
    description: "Outputs normalized loop progress (0..1), time in seconds, and frame index.",
    isTimeDependent: true,
    inputs: [],
    outputs: [
      { id: "progress", label: "Progress", type: "float" },
      { id: "time", label: "Time (s)", type: "float" },
      { id: "frame", label: "Frame", type: "float" },
    ],
    params: [
      { id: "speed", label: "Speed", kind: "float", min: 0.1, max: 8, step: 0.1, default: 1 },
      { id: "pingPong", label: "Ping-Pong", kind: "bool", default: false },
    ],
    scalarEvaluate: (_inputs, params, ctx) => {
      const speed = Number(params.speed ?? 1);
      const raw = (ctx.progress * speed) % 1;
      const p = params.pingPong ? 1 - Math.abs(((ctx.progress * speed * 2) % 2) - 1) : raw;
      return {
        progress: clamp01(p),
        time: ctx.time * speed,
        frame: ctx.frame,
      };
    },
  },
  {
    type: "anim.lfo",
    label: "LFO / Wave",
    category: "control",
    description: "Procedural oscillator (Sine, Triangle, Saw, Square) for driving animated parameters.",
    isTimeDependent: true,
    inputs: [{ id: "phase", label: "Phase", type: "float", optional: true }],
    outputs: [{ id: "out", label: "Wave", type: "float" }],
    params: [
      {
        id: "wave",
        label: "Waveform",
        kind: "enum",
        options: [
          { value: "sine", label: "Sine" },
          { value: "triangle", label: "Triangle" },
          { value: "saw", label: "Saw" },
          { value: "square", label: "Square" },
        ],
        default: "sine",
      },
      { id: "cycles", label: "Cycles", kind: "int", min: 1, max: 16, step: 1, default: 1 },
      { id: "phaseOffset", label: "Phase Offset", kind: "float", min: 0, max: 1, step: 0.02, default: 0 },
      { id: "min", label: "Min", kind: "float", min: 0, max: 1, step: 0.02, default: 0 },
      { id: "max", label: "Max", kind: "float", min: 0, max: 1, step: 0.02, default: 1 },
    ],
    scalarEvaluate: (inputs, params, ctx) => {
      const basePhase = inputs.phase !== undefined ? inputs.phase : ctx.progress;
      const cycles = Math.max(1, Math.round(Number(params.cycles ?? 1)));
      const offset = Number(params.phaseOffset ?? 0);
      const t = (((basePhase * cycles + offset) % 1) + 1) % 1;
      const wave = String(params.wave ?? "sine");
      let unit = 0.5;
      if (wave === "sine") {
        unit = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      } else if (wave === "triangle") {
        unit = 1 - Math.abs(t * 2 - 1);
      } else if (wave === "saw") {
        unit = t;
      } else if (wave === "square") {
        unit = t < 0.5 ? 1 : 0;
      }
      const min = Number(params.min ?? 0);
      const max = Number(params.max ?? 1);
      return { out: clamp01(min + (max - min) * unit) };
    },
  },
  {
    type: "anim.valueMath",
    label: "Value Math",
    category: "control",
    description: "Combines or inverts scalar macro/animation signals.",
    inputs: [
      { id: "a", label: "A", type: "float" },
      { id: "b", label: "B", type: "float", optional: true },
    ],
    outputs: [{ id: "out", label: "Out", type: "float" }],
    params: [
      {
        id: "op",
        label: "Op",
        kind: "enum",
        options: [
          { value: "add", label: "Add" },
          { value: "sub", label: "Subtract" },
          { value: "mul", label: "Multiply" },
          { value: "mix", label: "Average" },
          { value: "inv", label: "Invert (1 - A)" },
        ],
        default: "mul",
      },
      { id: "bFallback", label: "B Value", kind: "float", min: 0, max: 2, step: 0.02, default: 0.5 },
    ],
    scalarEvaluate: (inputs, params) => {
      const a = inputs.a ?? 0;
      const b = inputs.b !== undefined ? inputs.b : Number(params.bFallback ?? 0.5);
      const op = String(params.op ?? "mul");
      let res = a;
      if (op === "add") res = a + b;
      else if (op === "sub") res = a - b;
      else if (op === "mul") res = a * b;
      else if (op === "mix") res = (a + b) * 0.5;
      else if (op === "inv") res = 1 - a;
      return { out: clamp01(res) };
    },
  },
];
