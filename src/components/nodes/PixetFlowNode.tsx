import { useEffect, useRef, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, Dices } from "lucide-react";
import { SOCKET_COLORS, nodeRegistry } from "../../engine/nodes/NodeRegistry";
import {
  CUSTOM_PALETTE_SOURCE,
  DOCUMENT_PALETTE_SOURCE,
  normalizePaletteParam,
  resolvePaletteColors,
} from "../../engine/nodes/PaletteLut";
import {
  beginNodeTransaction,
  commitNodeTransaction,
  getNodeEvaluator,
  mutateActiveNodeGraph,
  updateActiveNodeGraphLive,
} from "../../engine/nodes/nodeActions";
import type { NodeInstance, ParamDef, SocketDef } from "../../engine/nodes/types";

type OutputSocketDef = SocketDef;
import { useEditorStore } from "../../store/editorStore";
import { PALETTE_PRESETS } from "../../utils/paletteParser";

export interface PixetFlowNodeData extends Record<string, unknown> {
  instance: NodeInstance;
  pinned: boolean;
  evalVersion: number;
  drivenParams: Record<string, number>;
  drivenKeys: string[];
}

export type PixetFlowNodeType = Node<PixetFlowNodeData, "pixetNode">;

interface BlenderSliderProps {
  paramId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  isInt: boolean;
  isDriven: boolean;
  onBegin: () => void;
  onLive: (val: number) => void;
  onCommit: (val: number) => void;
}

function snapAndClamp(raw: number, min: number, max: number, step: number, isInt: boolean): number {
  const clamped = Math.max(min, Math.min(max, raw));
  const snapped = step > 0 ? Math.round((clamped - min) / step) * step + min : clamped;
  const bounded = Math.max(min, Math.min(max, snapped));
  return isInt ? Math.round(bounded) : Number(bounded.toFixed(4));
}

function BlenderSlider({
  paramId,
  label,
  value,
  min,
  max,
  step,
  isInt,
  isDriven,
  onBegin,
  onLive,
  onCommit,
}: BlenderSliderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const dragRef = useRef<{ startX: number; startVal: number; width: number; moved: boolean } | null>(
    null
  );

  const span = Math.max(1e-6, max - min);
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100));

  if (editing && !isDriven) {
    return (
      <div className="nodes-param-handle-row">
        <Handle
          type="target"
          position={Position.Left}
          id={`param:${paramId}`}
          className="nodes-handle nodes-param-handle"
          style={{ background: SOCKET_COLORS.float }}
        />
        <input
          type="number"
          className="nodes-blender-slider-input nodrag nopan"
          autoFocus
          step={step}
          value={draft}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const parsed = Number(draft);
              if (Number.isFinite(parsed)) {
                onCommit(snapAndClamp(parsed, min, max, step, isInt));
              }
              setEditing(false);
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
          onBlur={() => {
            const parsed = Number(draft);
            if (Number.isFinite(parsed)) {
              onCommit(snapAndClamp(parsed, min, max, step, isInt));
            }
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="nodes-param-handle-row">
      <Handle
        type="target"
        position={Position.Left}
        id={`param:${paramId}`}
        className="nodes-handle nodes-param-handle"
        style={{ background: isDriven ? "#f59e0b" : SOCKET_COLORS.float }}
      />
      <div
        className={`nodes-blender-slider nodrag nopan ${isDriven ? "is-driven" : ""}`}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (isDriven) return;
          const rect = e.currentTarget.getBoundingClientRect();
          dragRef.current = {
            startX: e.clientX,
            startVal: value,
            width: Math.max(60, rect.width),
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          onBegin();
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          const dx = e.clientX - d.startX;
          if (Math.abs(dx) > 1) d.moved = true;
          const deltaVal = (dx / d.width) * span;
          onLive(snapAndClamp(d.startVal + deltaVal, min, max, step, isInt));
        }}
        onPointerUp={(e) => {
          if (!dragRef.current) return;
          dragRef.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          commitNodeTransaction();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (isDriven) return;
          setDraft(isInt ? String(Math.round(value)) : String(Number(value.toFixed(3))));
          setEditing(true);
        }}
      >
        <div className="nodes-blender-slider-fill" style={{ width: `${pct}%` }} />
        <div className="nodes-blender-slider-content">
          <span className="nodes-blender-slider-label">{label}</span>
          <span className="nodes-blender-slider-val">
            {isInt ? Math.round(value) : value.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}

function renderInlineParam(
  node: NodeInstance,
  param: ParamDef,
  drivenParams: Record<string, number>,
  drivenSet: ReadonlySet<string>,
  documentPalette: readonly string[]
) {
  const isDriven = drivenSet.has(param.id);
  const val = isDriven && param.id in drivenParams
    ? drivenParams[param.id]
    : node.params[param.id] ?? param.default;

  const updateLive = (v: unknown) => {
    updateActiveNodeGraphLive(
      (g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === node.id ? { ...n, params: { ...n.params, [param.id]: v } } : n
        ),
      }),
      [node.id]
    );
  };

  const commitChange = (v: unknown) => {
    mutateActiveNodeGraph(
      `Edit ${param.label}`,
      (g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === node.id ? { ...n, params: { ...n.params, [param.id]: v } } : n
        ),
      }),
      [node.id]
    );
  };

  if (param.kind === "float" || param.kind === "int") {
    return (
      <BlenderSlider
        key={param.id}
        paramId={param.id}
        label={param.label}
        value={Number(val ?? param.default)}
        min={param.min}
        max={param.max}
        step={param.step}
        isInt={param.kind === "int"}
        isDriven={isDriven}
        onBegin={() => beginNodeTransaction(`Change ${param.label}`)}
        onLive={updateLive}
        onCommit={commitChange}
      />
    );
  }

  if (param.kind === "enum") {
    return (
      <select
        key={param.id}
        className="nodes-inline-select nodrag nopan"
        value={String(val)}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => commitChange(e.target.value)}
      >
        {param.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {param.label}: {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (param.kind === "bool") {
    const checked = Boolean(val);
    return (
      <label
        key={param.id}
        className="nodes-inline-bool nodrag nopan"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => commitChange(e.target.checked)}
        />
        <span>{param.label}</span>
      </label>
    );
  }

  if (param.kind === "color") {
    const hex = String(val ?? param.default);
    return (
      <label
        key={param.id}
        className="nodes-inline-color nodrag nopan"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span>{param.label}</span>
        <span className="nodes-inline-color-right">
          <span className="nodes-inline-color-hex">{hex.slice(0, 7)}</span>
          <input
            type="color"
            value={hex.slice(0, 7)}
            onFocus={() => beginNodeTransaction(`Change ${param.label}`)}
            onChange={(e) => updateLive(e.target.value)}
            onBlur={() => commitNodeTransaction()}
          />
        </span>
      </label>
    );
  }

  if (param.kind === "seed") {
    const num = Number(val ?? param.default);
    return (
      <div
        key={param.id}
        className="nodes-inline-seed nodrag nopan"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="nodes-blender-slider-label">{param.label}</span>
        <input
          type="number"
          className="nodes-inline-seed-input"
          value={num}
          onChange={(e) => commitChange(Number(e.target.value) || 0)}
        />
        <button
          type="button"
          className="nodes-inline-dice-btn"
          title="Randomize Seed"
          onClick={() => commitChange(Math.floor(Math.random() * 99999))}
        >
          <Dices size={11} />
        </button>
      </div>
    );
  }

  if (param.kind === "vec2") {
    const vec = Array.isArray(val) ? (val as [number, number]) : param.default;
    return (
      <div
        key={param.id}
        className="nodes-inline-vec2 nodrag nopan"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="nodes-blender-slider-label">{param.label}</span>
        <input
          type="number"
          className="nodes-inline-seed-input"
          step={param.step ?? 0.1}
          value={vec[0]}
          onChange={(e) => commitChange([Number(e.target.value) || 0, vec[1]])}
        />
        <input
          type="number"
          className="nodes-inline-seed-input"
          step={param.step ?? 0.1}
          value={vec[1]}
          onChange={(e) => commitChange([vec[0], Number(e.target.value) || 0])}
        />
      </div>
    );
  }

  if (param.kind === "palette") {
    const palParam = normalizePaletteParam(val);
    const resolved = resolvePaletteColors(palParam, documentPalette);
    const isCustom = palParam.source === CUSTOM_PALETTE_SOURCE;
    return (
      <div
        key={param.id}
        className="nodes-inline-palette nodrag nopan"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <select
          className="nodes-inline-select"
          value={palParam.source}
          onChange={(e) => {
            const nextSource = e.target.value;
            const nextColors =
              nextSource === CUSTOM_PALETTE_SOURCE ? [...resolved] : palParam.colors;
            commitChange({ source: nextSource, colors: nextColors });
          }}
        >
          <option value={DOCUMENT_PALETTE_SOURCE}>Document Palette</option>
          {PALETTE_PRESETS.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
          <option value={CUSTOM_PALETTE_SOURCE}>Custom ({resolved.length})</option>
        </select>
        <div className="nodes-palette-swatches" title={`${resolved.length} colors`}>
          {resolved.map((hex, idx) =>
            isCustom ? (
              <label
                key={`${idx}-${hex}`}
                className="nodes-palette-swatch is-editable"
                style={{ background: hex }}
                title={`Edit color ${idx + 1}: ${hex}`}
              >
                <input
                  type="color"
                  value={hex.slice(0, 7)}
                  onFocus={() => beginNodeTransaction("Edit Palette Color")}
                  onChange={(e) => {
                    const nextColors = [...resolved];
                    nextColors[idx] = e.target.value;
                    updateLive({ source: CUSTOM_PALETTE_SOURCE, colors: nextColors });
                  }}
                  onBlur={() => commitNodeTransaction()}
                />
              </label>
            ) : (
              <span
                key={`${idx}-${hex}`}
                className="nodes-palette-swatch"
                style={{ background: hex }}
                title={hex}
              />
            )
          )}
        </div>
      </div>
    );
  }

  return null;
}

/** True when an output carries the same kind of value as the parameter it shares a name with. */
function exposesParam(out: OutputSocketDef, param: ParamDef): boolean {
  switch (out.type) {
    case "float":
      return param.kind === "float" || param.kind === "int";
    case "color":
    case "rgba":
      return param.kind === "color";
    case "palette":
      return param.kind === "palette";
    default:
      return false;
  }
}

export function PixetFlowNode({ data, selected }: NodeProps<PixetFlowNodeType>) {
  const showThumbnails = useEditorStore((s) => s.nodesUi.showThumbnails);
  const documentPalette = useEditorStore((s) => s.palette);
  const thumbRef = useRef<HTMLCanvasElement | null>(null);
  const { instance, pinned, evalVersion, drivenParams, drivenKeys } = data;
  const drivenSet = new Set(drivenKeys);
  const def = nodeRegistry.get(instance.type);

  useEffect(() => {
    if (!showThumbnails || !thumbRef.current) return;
    getNodeEvaluator().renderThumbnailToCanvas(instance.id, thumbRef.current);
  }, [instance.id, showThumbnails, evalVersion]);

  if (!def) {
    return (
      <div className="nodes-card">
        <div className="nodes-card-header">Unknown ({instance.type})</div>
      </div>
    );
  }

  const hasParams = def.params.length > 0;
  const paramsVisible = hasParams && !instance.collapsed;

  // Blender-style alignment: an output that exposes one of the node's parameters
  // (same id or label, e.g. Macro 1..4, Value, Color) sits on that parameter's row,
  // on the right edge, the same way a parameter's input socket sits on its left edge.
  // Outputs without a matching parameter keep their own row at the top.
  const outputForParam = new Map<string, OutputSocketDef>();
  if (paramsVisible) {
    for (const out of def.outputs) {
      const param =
        def.params.find((p) => p.id === out.id) ?? def.params.find((p) => p.label === out.label);
      if (param && exposesParam(out, param) && !outputForParam.has(param.id)) {
        outputForParam.set(param.id, out);
      }
    }
  }
  const alignedOutputIds = new Set(Array.from(outputForParam.values(), (o) => o.id));
  const topOutputs = def.outputs.filter((o) => !alignedOutputIds.has(o.id));

  return (
    <div
      className={`nodes-card ${selected ? "is-selected" : ""} ${
        pinned ? "is-pinned" : ""
      } ${instance.bypassed ? "is-bypassed" : ""}`}
    >
      <div className="nodes-card-header">
        <span className="nodes-card-title-wrap">
          {hasParams && (
            <button
              type="button"
              className="nodes-collapse-btn nodrag nopan"
              title={instance.collapsed ? "Expand Parameters" : "Collapse Parameters"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() =>
                mutateActiveNodeGraph("Toggle Node Collapse", (g) => ({
                  ...g,
                  nodes: g.nodes.map((n) =>
                    n.id === instance.id ? { ...n, collapsed: !n.collapsed } : n
                  ),
                }))
              }
            >
              {instance.collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            </button>
          )}
          <span>{instance.label ?? def.label}</span>
        </span>
        <span className="nodes-card-badges">
          {pinned && <span className="nodes-badge is-pin">PIN</span>}
          {instance.bypassed && <span className="nodes-badge">M</span>}
        </span>
      </div>

      {topOutputs.length > 0 && (
        <div className="nodes-socket-list is-outputs">
          {topOutputs.map((out) => (
            <div
              key={out.id}
              className="nodes-socket-row is-output"
              title={`${out.label} (${out.type})`}
            >
              <span className="nodes-socket-label">{out.label}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={out.id}
                className="nodes-handle"
                style={{ background: SOCKET_COLORS[out.type] }}
              />
            </div>
          ))}
        </div>
      )}

      {showThumbnails && def.outputs.length > 0 && !def.scalarEvaluate && !def.paletteEvaluate && (
        <div className="nodes-thumb-wrap">
          <canvas
            ref={thumbRef}
            width={128}
            height={128}
            className="nodes-thumb-canvas"
          />
        </div>
      )}

      {def.inputs.length > 0 && (
        <div className="nodes-socket-list is-inputs">
          {def.inputs.map((inp) => (
            <div
              key={inp.id}
              className="nodes-socket-row is-input"
              title={`${inp.label} (${inp.type})`}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={inp.id}
                className="nodes-handle"
                style={{ background: SOCKET_COLORS[inp.type] }}
              />
              <span className="nodes-socket-label">{inp.label}</span>
            </div>
          ))}
        </div>
      )}

      {!instance.collapsed && hasParams && (
        <div className="nodes-inline-params">
          {def.params.map((p) => {
            const control = renderInlineParam(instance, p, drivenParams, drivenSet, documentPalette);
            const out = outputForParam.get(p.id);
            if (!out) return control;
            return (
              <div
                key={p.id}
                className={`nodes-param-out-row ${p.kind === "palette" ? "is-tall" : ""}`}
                title={`${out.label} (${out.type})`}
              >
                {control}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={out.id}
                  className="nodes-handle nodes-param-out-handle"
                  style={{ background: SOCKET_COLORS[out.type] }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
