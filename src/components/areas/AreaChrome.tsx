import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  Film,
  Grid3x3,
  LayoutPanelLeft,
  MonitorPlay,
  Spline,
  X,
} from "lucide-react";
import {
  availableEditors,
  type AreaEditorId,
  type AreaSlot,
} from "../../engine/ui/areaEditors";
import type { PanelWorkspace } from "../../engine/ui/panelLayout";

export const AREA_ICONS: Record<string, typeof Film> = {
  timeline: Film,
  curves: Spline,
  tileset: Grid3x3,
  preview: MonitorPlay,
  panels: LayoutPanelLeft,
};

/**
 * Lets an editor that already owns a header row (the Timeline toolbar) host the
 * area switcher and split/join buttons instead of getting an extra row.
 */
export interface AreaChromeValue {
  leading: ReactNode;
  trailing: ReactNode;
  /** True when the editor sits in a fixed-size cell and must fill it. */
  fill: boolean;
}
export const AreaChromeContext = createContext<AreaChromeValue | null>(null);
export function useAreaChrome(): AreaChromeValue | null {
  return useContext(AreaChromeContext);
}

interface SwitcherProps {
  workspace: PanelWorkspace;
  slot: AreaSlot;
  value: AreaEditorId;
  onChange: (id: AreaEditorId) => void;
  label?: boolean;
}

export function AreaSwitcher({ workspace, slot, value, onChange, label }: SwitcherProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const options = availableEditors(workspace, slot);
  const current = options.find((o) => o.id === value) ?? options[0];
  const Icon = AREA_ICONS[current?.icon ?? "panels"] ?? Film;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(4, Math.min(window.innerWidth - 190, r.left));
      setPos(
        r.top > window.innerHeight / 2
          ? { left, bottom: window.innerHeight - r.top + 2 }
          : { left, top: r.bottom + 2 }
      );
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`area-switcher-btn ${open ? "active" : ""}`}
        title={`Editor type: ${current?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Editor type (${slot} area)`}
        onClick={toggle}
      >
        <Icon size={13} />
        <ChevronDown size={9} />
        {label && <span className="area-switcher-label">{current?.label}</span>}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="area-switcher-menu"
            role="listbox"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
          >
            {options.map((o) => {
              const OptIcon = AREA_ICONS[o.icon] ?? Film;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={o.id === value}
                  className={`area-switcher-item ${o.id === value ? "active" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    onChange(o.id);
                  }}
                >
                  <OptIcon size={13} />
                  <span>{o.label}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

export function SplitButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="area-header-btn"
      title="Split area (side by side)"
      aria-label="Split area"
      onClick={onClick}
    >
      <Columns2 size={12} />
    </button>
  );
}

export function JoinButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="area-header-btn"
      title="Close area (join back)"
      aria-label="Close area"
      onClick={onClick}
    >
      <X size={12} />
    </button>
  );
}

export function CollapseButton({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="area-header-btn"
      title={collapsed ? "Expand area" : "Collapse area"}
      aria-label={collapsed ? "Expand area" : "Collapse area"}
      onClick={onClick}
    >
      {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
    </button>
  );
}

/** Slim header row for editors that have no toolbar of their own. */
export function AreaHeader({
  switcher,
  title,
  actions,
}: {
  switcher: ReactNode;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="area-header">
      {switcher}
      <span className="area-header-title">{title}</span>
      <div className="area-header-actions">{actions}</div>
    </div>
  );
}
