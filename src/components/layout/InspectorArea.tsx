import { Plus, X } from "lucide-react";
import type { AreaNode } from "../../engine/ui/workspaceLayout";
import { DEFAULT_DOCKED_ORDER, type PanelId } from "../../engine/ui/panelLayout";
import { useEditorStore } from "../../store/editorStore";
import { PANEL_REGISTRY } from "./panelRegistry";

interface InspectorAreaProps {
  area: AreaNode;
}

export function InspectorArea({ area }: InspectorAreaProps) {
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const setLayoutInspectorActiveTab = useEditorStore(
    (s) => s.setLayoutInspectorActiveTab
  );
  const addLayoutPanelToInspector = useEditorStore(
    (s) => s.addLayoutPanelToInspector
  );
  const removeLayoutPanelFromInspector = useEditorStore(
    (s) => s.removeLayoutPanelFromInspector
  );

  const panels: PanelId[] = area.panels ?? [];
  const mode = area.inspectorMode ?? "stack";

  if (panels.length === 0) {
    const defaultPanel = DEFAULT_DOCKED_ORDER[workspaceMode][0];
    return (
      <div className="layout-inspector-empty">
        <span>Empty Inspector</span>
        <button
          type="button"
          className="toggle-chip"
          onClick={() => addLayoutPanelToInspector(area.id, defaultPanel)}
        >
          <Plus size={11} />
          <span>Add {PANEL_REGISTRY[defaultPanel].title}</span>
        </button>
      </div>
    );
  }

  if (mode === "tabs") {
    const activeId =
      area.activeTabPanelId && panels.includes(area.activeTabPanelId)
        ? area.activeTabPanelId
        : panels[0];
    const activeEntry = PANEL_REGISTRY[activeId];

    return (
      <div className="layout-inspector-tabs-root">
        <div className="layout-inspector-tabbar" role="tablist">
          {panels.map((pid) => {
            const entry = PANEL_REGISTRY[pid];
            if (!entry) return null;
            const active = pid === activeId;
            return (
              <div
                key={pid}
                className={`layout-inspector-tab ${active ? "active" : ""}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="layout-inspector-tab-btn"
                  onClick={() => setLayoutInspectorActiveTab(area.id, pid)}
                >
                  {entry.icon}
                  <span>{entry.title}</span>
                </button>
                {panels.length > 1 && (
                  <button
                    type="button"
                    className="layout-inspector-tab-close"
                    title={`Remove ${entry.title}`}
                    onClick={() => removeLayoutPanelFromInspector(area.id, pid)}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="layout-inspector-scroll" data-inspector-area-id={area.id}>
          {activeEntry ? activeEntry.render() : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className="layout-inspector-scroll"
      data-inspector-area-id={area.id}
    >
      <div className="sidebar-section-stack">
        {panels.map((pid) => {
          const entry = PANEL_REGISTRY[pid];
          if (!entry) return null;
          return <div key={pid} className="layout-inspector-slot">{entry.render()}</div>;
        })}
      </div>
    </div>
  );
}
