import { createContext, useContext } from "react";
import type { PanelId } from "../../engine/ui/panelLayout";
import type {
  DropZone,
  LayoutNode,
  SplitDirection,
} from "../../engine/ui/workspaceLayout";

export type LayoutDragPayload =
  | { kind: "area"; sourceAreaId: string }
  | { kind: "panel"; panelId: PanelId; fromAreaId: string | null };

export interface LayoutDropTarget {
  areaId: string;
  zone: DropZone;
}

export interface CornerDragPreview {
  sourceAreaId: string;
  mode: "split" | "join";
  splitDirection?: SplitDirection;
  splitRatio?: number;
  joinTargetAreaId?: string;
  joinDirection?: "left" | "right" | "top" | "bottom";
}

export interface BorderMenuState {
  splitId: string;
  x: number;
  y: number;
  direction: SplitDirection;
  firstAreaId: string | null;
  secondAreaId: string | null;
}

export interface LayoutInteractionContextValue {
  tree: LayoutNode;
  rootElement: HTMLDivElement | null;
  dragPayload: LayoutDragPayload | null;
  dropTarget: LayoutDropTarget | null;
  cornerPreview: CornerDragPreview | null;
  startAreaDrag: (sourceAreaId: string, e: React.MouseEvent) => void;
  startPanelDrag: (
    panelId: PanelId,
    fromAreaId: string | null,
    e: React.MouseEvent
  ) => void;
  startCornerDrag: (
    sourceAreaId: string,
    corner: "nw" | "ne" | "sw" | "se",
    e: React.MouseEvent
  ) => void;
  openBorderMenu: (menu: BorderMenuState) => void;
}

export const LayoutInteractionContext =
  createContext<LayoutInteractionContextValue | null>(null);

export function useLayoutInteraction(): LayoutInteractionContextValue | null {
  return useContext(LayoutInteractionContext);
}

export const CurrentAreaIdContext = createContext<string | null>(null);

export function useCurrentAreaId(): string | null {
  return useContext(CurrentAreaIdContext);
}
