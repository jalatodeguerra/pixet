import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  ChevronDown,
  ChevronRight,
  Copy,
  Monitor,
  Plus,
  Trash2,
} from "lucide-react";
import { mutateModel3D } from "../../engine/model3d/model3dActions";
import { convertNodeCuboidToMesh } from "../../engine/model3d/meshOps";
import {
  MAX_MODIFIER_FACES,
  MODIFIER_LABELS,
  MODIFIER_LIMITS,
  MODIFIER_TYPES,
  applyAllModifiers,
  applyModifier,
  createModifier,
  duplicateModifier,
  isEvaluationTruncated,
  moveModifier,
  removeModifier,
  updateModifier,
} from "../../engine/model3d/modifiers";
import type { ModelModifier, ModifierType } from "../../engine/model3d/modifiers";
import type { Model3DEngine } from "../../engine/model3d/Model3DEngine";
import type { ModelNode } from "../../engine/model3d/types";

interface NumFieldProps {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  onCommit: (v: number) => void;
}

/** Number input that commits on blur / Enter (one undo step per edit, not per keystroke). */
function NumField({ label, value, step = 1, min, max, integer, onCommit }: NumFieldProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    let v = Number(text);
    if (!Number.isFinite(v)) {
      setText(String(value));
      return;
    }
    if (integer) v = Math.round(v);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <label className="m3d-field-label">
      <span>{label}</span>
      <input
        type="number"
        className="m3d-num-input"
        step={step}
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
    </label>
  );
}

function Vec3Fields({
  label,
  value,
  step,
  onCommit,
}: {
  label: string;
  value: [number, number, number];
  step?: number;
  onCommit: (v: [number, number, number]) => void;
}) {
  return (
    <div className="m3d-mod-vec">
      <span className="m3d-mod-vec-label">{label}</span>
      <div className="m3d-mod-vec-row">
        {(["X", "Y", "Z"] as const).map((ax, i) => (
          <NumField
            key={ax}
            label={ax}
            value={value[i]}
            step={step}
            onCommit={(v) => {
              const next: [number, number, number] = [value[0], value[1], value[2]];
              next[i] = v;
              onCommit(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function setNodeModifiers(eng: Model3DEngine, nodeId: string, list: ModelModifier[]): void {
  eng.updateNode(nodeId, { modifiers: list });
}

function editModifiers(
  nodeId: string,
  label: string,
  fn: (list: ReadonlyArray<ModelModifier>) => ModelModifier[]
): void {
  mutateModel3D(label, (eng) => {
    const n = eng.getNode(nodeId);
    if (!n || n.kind !== "mesh") return;
    setNodeModifiers(eng, nodeId, fn(n.modifiers ?? []));
  });
}

function bake(nodeId: string, label: string, modifierId: string | null): void {
  mutateModel3D(label, (eng) => {
    const n = eng.getNode(nodeId);
    if (!n || !n.mesh) return;
    const baked = modifierId ? applyModifier(n, modifierId) : applyAllModifiers(n);
    const idx = eng.nodes.findIndex((x) => x.id === nodeId);
    if (idx < 0 || baked === n) return;
    eng.nodes[idx] = baked;
    // Topology changed: element indices of the old selection are meaningless now.
    eng.selectedVertices[nodeId] = [];
    eng.selectedEdges[nodeId] = [];
    eng.selectedFaces[nodeId] = [];
  });
}

function ModifierParams({ nodeId, mod }: { nodeId: string; mod: ModelModifier }) {
  const patch = (patchObj: Record<string, unknown>) =>
    editModifiers(nodeId, `Edit ${mod.name} Modifier`, (list) =>
      updateModifier(list, mod.id, patchObj)
    );
  switch (mod.type) {
    case "mirror":
      return (
        <>
          <div className="m3d-mod-axes">
            {(["x", "y", "z"] as const).map((ax) => (
              <button
                key={ax}
                type="button"
                className={`m3d-btn-compact ${mod.axes[ax] ? "active" : ""}`}
                title={`Mirror across the ${ax.toUpperCase()} plane through the pivot`}
                onClick={() => patch({ axes: { ...mod.axes, [ax]: !mod.axes[ax] } })}
              >
                {ax.toUpperCase()}
              </button>
            ))}
          </div>
          <label className="m3d-checkbox-row">
            <input
              type="checkbox"
              checked={mod.mergeSeam}
              onChange={(e) => patch({ mergeSeam: e.target.checked })}
            />
            <span>Merge seam vertices</span>
          </label>
          <NumField
            label="Merge threshold (px)"
            value={mod.mergeThresholdPx}
            step={0.01}
            min={0}
            onCommit={(v) => patch({ mergeThresholdPx: v })}
          />
        </>
      );
    case "array":
      return (
        <>
          <NumField
            label="Count"
            value={mod.count}
            min={1}
            max={MODIFIER_LIMITS.maxArrayCount}
            integer
            onCommit={(v) => patch({ count: v })}
          />
          <Vec3Fields
            label="Relative offset (x bounds)"
            value={mod.relativeOffset}
            step={0.1}
            onCommit={(v) => patch({ relativeOffset: v })}
          />
          <Vec3Fields
            label="Constant offset (px)"
            value={mod.constantOffsetPx}
            onCommit={(v) => patch({ constantOffsetPx: v })}
          />
          <label className="m3d-checkbox-row">
            <input
              type="checkbox"
              checked={mod.mergeAdjacent}
              onChange={(e) => patch({ mergeAdjacent: e.target.checked })}
            />
            <span>Merge adjacent copies</span>
          </label>
          {mod.mergeAdjacent && (
            <NumField
              label="Merge threshold (px)"
              value={mod.mergeThresholdPx}
              step={0.01}
              min={0}
              onCommit={(v) => patch({ mergeThresholdPx: v })}
            />
          )}
        </>
      );
    case "subdivide":
      return (
        <NumField
          label="Levels (linear)"
          value={mod.levels}
          min={1}
          max={MODIFIER_LIMITS.maxSubdivideLevels}
          integer
          onCommit={(v) => patch({ levels: v })}
        />
      );
    case "solidify":
      return (
        <>
          <div className="m3d-inline-pair">
            <NumField
              label="Thickness (px)"
              value={mod.thicknessPx}
              step={0.5}
              onCommit={(v) => patch({ thicknessPx: v })}
            />
            <NumField
              label="Offset (-1..1)"
              value={mod.offset}
              step={0.1}
              min={-1}
              max={1}
              onCommit={(v) => patch({ offset: v })}
            />
          </div>
          <label className="m3d-checkbox-row">
            <input
              type="checkbox"
              checked={mod.rim}
              onChange={(e) => patch({ rim: e.target.checked })}
            />
            <span>Fill rim</span>
          </label>
        </>
      );
    case "bevel":
      return (
        <div className="m3d-inline-pair">
          <NumField
            label="Width (px)"
            value={mod.widthPx}
            step={0.5}
            min={0}
            onCommit={(v) => patch({ widthPx: v })}
          />
          <NumField
            label="Angle (deg)"
            value={mod.angleDeg}
            min={0}
            max={180}
            onCommit={(v) => patch({ angleDeg: v })}
          />
        </div>
      );
    case "triangulate":
      return <span className="mode-hint">Splits every quad into two triangles.</span>;
  }
}

function ModifierCard({
  nodeId,
  mod,
  index,
  count,
  collapsed,
  onToggleCollapsed,
}: {
  nodeId: string;
  mod: ModelModifier;
  index: number;
  count: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const label = `${mod.name} Modifier`;
  return (
    <div className={`m3d-list-card m3d-mod-card ${mod.enabled ? "" : "m3d-mod-off"}`} data-modifier-type={mod.type}>
      <div className="m3d-mod-head">
        <button
          type="button"
          className="m3d-mod-icon-btn"
          title={collapsed ? "Expand" : "Collapse"}
          aria-label={collapsed ? "Expand modifier" : "Collapse modifier"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <span className="m3d-mod-name" title={mod.name}>
          {mod.name}
        </span>
        <button
          type="button"
          className={`m3d-mod-icon-btn ${mod.showInViewport ? "on" : ""}`}
          title="Show in viewport"
          aria-label="Toggle modifier in viewport"
          aria-pressed={mod.showInViewport}
          onClick={() =>
            editModifiers(nodeId, `Toggle ${label} Viewport`, (l) =>
              updateModifier(l, mod.id, { showInViewport: !mod.showInViewport })
            )
          }
        >
          <Monitor size={12} />
        </button>
        <button
          type="button"
          className={`m3d-mod-icon-btn ${mod.enabled ? "on" : ""}`}
          title="Enabled for render / export / bake"
          aria-label="Toggle modifier for render and export"
          aria-pressed={mod.enabled}
          onClick={() =>
            editModifiers(nodeId, `Toggle ${label}`, (l) =>
              updateModifier(l, mod.id, { enabled: !mod.enabled })
            )
          }
        >
          <Camera size={12} />
        </button>
        <button
          type="button"
          className="m3d-mod-icon-btn"
          title="Move up"
          aria-label="Move modifier up"
          disabled={index === 0}
          onClick={() => editModifiers(nodeId, `Move ${label} Up`, (l) => moveModifier(l, mod.id, -1))}
        >
          <ArrowUp size={12} />
        </button>
        <button
          type="button"
          className="m3d-mod-icon-btn"
          title="Move down"
          aria-label="Move modifier down"
          disabled={index === count - 1}
          onClick={() => editModifiers(nodeId, `Move ${label} Down`, (l) => moveModifier(l, mod.id, 1))}
        >
          <ArrowDown size={12} />
        </button>
        <button
          type="button"
          className="m3d-mod-icon-btn"
          title="Duplicate"
          aria-label="Duplicate modifier"
          disabled={count >= MODIFIER_LIMITS.maxModifiersPerNode}
          onClick={() => editModifiers(nodeId, `Duplicate ${label}`, (l) => duplicateModifier(l, mod.id))}
        >
          <Copy size={12} />
        </button>
        <button
          type="button"
          className="m3d-mod-icon-btn"
          title="Delete"
          aria-label="Delete modifier"
          onClick={() => editModifiers(nodeId, `Delete ${label}`, (l) => removeModifier(l, mod.id))}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {!collapsed && (
        <div className="m3d-mod-body">
          <ModifierParams nodeId={nodeId} mod={mod} />
          <button
            type="button"
            className="m3d-btn-compact"
            title="Bake this modifier (and the ones above it) into the mesh"
            onClick={() => bake(nodeId, `Apply ${label}`, mod.id)}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

export function ModifierPanel({ node }: { node: ModelNode | null | undefined }) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  if (!node || (node.kind !== "mesh" && node.kind !== "cuboid")) return null;

  if (node.kind === "cuboid") {
    return (
      <div className="m3d-section" data-testid="modifier-panel">
        <div className="m3d-section-header">
          <span>Modifiers</span>
        </div>
        <span className="mode-hint">Modifiers need a mesh. Convert this cuboid to a mesh first.</span>
        <button
          type="button"
          className="m3d-btn"
          style={{ justifyContent: "center" }}
          onClick={() =>
            mutateModel3D("Convert Cuboid to Mesh", (eng) => {
              const n = eng.getNode(node.id);
              if (!n) return;
              const converted = convertNodeCuboidToMesh(n);
              const idx = eng.nodes.findIndex((x) => x.id === n.id);
              if (idx >= 0) eng.nodes[idx] = converted;
            })
          }
        >
          Convert to Mesh
        </button>
      </div>
    );
  }

  const mods = node.modifiers ?? [];
  const truncated =
    isEvaluationTruncated(node, "viewport") || isEvaluationTruncated(node, "export");
  const toggleCollapsed = (id: string) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="m3d-section" data-testid="modifier-panel">
      <div className="m3d-section-header">
        <span>Modifiers</span>
        <span className="m3d-badge-mono">{mods.length}</span>
      </div>

      <div className="m3d-mod-add">
        <Plus size={12} />
        <select
          className="m3d-select"
          aria-label="Add Modifier"
          value=""
          disabled={mods.length >= MODIFIER_LIMITS.maxModifiersPerNode}
          onChange={(e) => {
            const type = e.target.value as ModifierType;
            if (!type) return;
            const created = createModifier(type);
            editModifiers(node.id, `Add ${MODIFIER_LABELS[type]} Modifier`, (l) => [...l, created]);
          }}
        >
          <option value="">Add Modifier…</option>
          {MODIFIER_TYPES.map((t) => (
            <option key={t} value={t}>
              {MODIFIER_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {mods.length === 0 && (
        <span className="mode-hint">
          Non-destructive effects applied top to bottom. Edit Mode still edits the base mesh.
        </span>
      )}

      {truncated && (
        <span className="m3d-mod-warning" role="alert">
          Face limit ({MAX_MODIFIER_FACES.toLocaleString()}) reached: later modifiers are skipped.
        </span>
      )}

      {mods.map((m, i) => (
        <ModifierCard
          key={m.id}
          nodeId={node.id}
          mod={m}
          index={i}
          count={mods.length}
          collapsed={collapsedIds.has(m.id)}
          onToggleCollapsed={() => toggleCollapsed(m.id)}
        />
      ))}

      {mods.length > 0 && (
        <button
          type="button"
          className="m3d-btn"
          style={{ justifyContent: "center" }}
          onClick={() => bake(node.id, "Apply All Modifiers", null)}
        >
          Apply All
        </button>
      )}
    </div>
  );
}
