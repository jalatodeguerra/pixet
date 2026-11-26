// Store/engine glue for object layers (T5). All edits go through
// pixelEngine.recordObjectOp so Ctrl+Z / Ctrl+Shift+Z cover them.

import { useEditorStore } from "../../store/editorStore.ts";
import {
  cloneObject,
  type ObjectPropertyValue,
  type TileObject,
} from "../tiles/objects.ts";
import { pixelEngine } from "./PixelEngine.ts";

export function getActiveObjectLayerId(): string | null {
  const s = useEditorStore.getState();
  const layer = s.layers.find((l) => l.id === s.activeLayerId);
  return layer && layer.kind === "object" ? layer.id : null;
}

export function addObject(layerId: string, obj: TileObject): void {
  pixelEngine.recordObjectOp("Add Object", () => {
    pixelEngine.objectLayers.set(layerId, [
      ...pixelEngine.getObjects(layerId),
      obj,
    ]);
  });
}

export type ObjectPatch = Partial<
  Pick<TileObject, "name" | "type" | "x" | "y" | "w" | "h">
>;

export function updateObject(
  layerId: string,
  id: string,
  patch: ObjectPatch,
  label = "Edit Object"
): void {
  pixelEngine.recordObjectOp(label, () => {
    pixelEngine.objectLayers.set(
      layerId,
      pixelEngine
        .getObjects(layerId)
        .map((o) => (o.id === id ? { ...cloneObject(o), ...patch } : o))
    );
  });
}

export function setObjectProperty(
  layerId: string,
  id: string,
  key: string,
  value: ObjectPropertyValue
): void {
  pixelEngine.recordObjectOp("Edit Object Property", () => {
    pixelEngine.objectLayers.set(
      layerId,
      pixelEngine.getObjects(layerId).map((o) => {
        if (o.id !== id) return o;
        const c = cloneObject(o);
        c.properties[key] = value;
        return c;
      })
    );
  });
}

export function renameObjectProperty(
  layerId: string,
  id: string,
  oldKey: string,
  newKey: string
): void {
  if (oldKey === newKey || newKey === "") return;
  pixelEngine.recordObjectOp("Rename Object Property", () => {
    pixelEngine.objectLayers.set(
      layerId,
      pixelEngine.getObjects(layerId).map((o) => {
        if (o.id !== id || !(oldKey in o.properties)) return o;
        const c = cloneObject(o);
        const entries = Object.entries(c.properties).map(
          ([k, v]): [string, ObjectPropertyValue] => [
            k === oldKey ? newKey : k,
            v,
          ]
        );
        c.properties = Object.fromEntries(entries);
        return c;
      })
    );
  });
}

export function removeObjectProperty(
  layerId: string,
  id: string,
  key: string
): void {
  pixelEngine.recordObjectOp("Remove Object Property", () => {
    pixelEngine.objectLayers.set(
      layerId,
      pixelEngine.getObjects(layerId).map((o) => {
        if (o.id !== id) return o;
        const c = cloneObject(o);
        delete c.properties[key];
        return c;
      })
    );
  });
}

export function deleteObject(layerId: string, id: string): void {
  pixelEngine.recordObjectOp("Delete Object", () => {
    pixelEngine.objectLayers.set(
      layerId,
      pixelEngine.getObjects(layerId).filter((o) => o.id !== id)
    );
  });
  const s = useEditorStore.getState();
  if (s.selectedObjectId === id) s.setSelectedObjectId(null);
}

/** Delete key in Map mode with the Object tool: returns true when handled. */
export function deleteSelectedObject(): boolean {
  const s = useEditorStore.getState();
  const layerId = getActiveObjectLayerId();
  if (!layerId || !s.selectedObjectId) return false;
  if (!pixelEngine.getObjects(layerId).some((o) => o.id === s.selectedObjectId)) {
    return false;
  }
  deleteObject(layerId, s.selectedObjectId);
  return true;
}
