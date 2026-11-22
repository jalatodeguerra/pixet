import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Collapsible right-sidebar section used by every rig panel. It reuses the
 * shared layout.css panel classes so the rig workspace matches the rest of
 * the editor exactly.
 */
export function RigPanelSection({
  title,
  icon,
  actions,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="panel-section">
      <div className="panel-header">
        <button
          type="button"
          className="panel-collapse-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {icon}
          <span>{title}</span>
        </button>
        {actions && <div className="panel-header-actions">{actions}</div>}
      </div>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}
