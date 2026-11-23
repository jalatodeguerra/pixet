import type { ReactNode } from "react";
import type { PanelId } from "../../engine/ui/panelLayout";
import { DockablePanelSection } from "../DockablePanelSection";

/**
 * Collapsible right-sidebar section used by every rig panel.
 * Delegates to DockablePanelSection so rig sections can be reordered,
 * detached, dragged, pinned, and re-docked like every other panel.
 */
export function RigPanelSection({
  id,
  title,
  icon,
  actions,
  children,
  defaultOpen = true,
}: {
  id: PanelId;
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <DockablePanelSection
      id={id}
      title={title}
      icon={icon}
      actions={actions}
      defaultOpen={defaultOpen}
    >
      {children}
    </DockablePanelSection>
  );
}
