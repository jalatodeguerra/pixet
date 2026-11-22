import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Layers,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { mutateRig } from "../../engine/rig/rigActions";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

function AttachmentThumb({
  layerId,
  frame,
  canvasWidth,
  canvasHeight,
}: {
  layerId: string;
  frame: number;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    const tctx = thumb.getContext("2d");
    if (!tctx) return;
    tctx.clearRect(0, 0, thumb.width, thumb.height);

    const buf = pixelEngine.getCel(layerId, frame);
    if (!buf || buf.isEmpty()) return;

    if (!scratchRef.current) {
      scratchRef.current = document.createElement("canvas");
    }
    const scratch = scratchRef.current;
    if (scratch.width !== canvasWidth || scratch.height !== canvasHeight) {
      scratch.width = canvasWidth;
      scratch.height = canvasHeight;
    }
    const sctx = scratch.getContext("2d");
    if (!sctx) return;
    const img = new ImageData(
      new Uint8ClampedArray(buf.data),
      buf.width,
      buf.height
    );
    sctx.putImageData(img, 0, 0);

    const scale = Math.min(
      thumb.width / canvasWidth,
      thumb.height / canvasHeight
    );
    const dw = Math.max(1, Math.round(canvasWidth * scale));
    const dh = Math.max(1, Math.round(canvasHeight * scale));
    const dx = Math.floor((thumb.width - dw) / 2);
    const dy = Math.floor((thumb.height - dh) / 2);
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(scratch, dx, dy, dw, dh);
  }, [layerId, frame, canvasWidth, canvasHeight]);

  return (
    <canvas
      ref={thumbRef}
      width={28}
      height={28}
      style={{
        width: 28,
        height: 28,
        background: "#141414",
        border: "1px solid var(--border-subtle)",
        imageRendering: "pixelated",
      }}
    />
  );
}

export function SlotsPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigMode = useEditorStore((s) => s.rigMode);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const layers = useEditorStore((s) => s.layers);
  const frames = useEditorStore((s) => s.frames);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  void rigVersion;

  const rig = pixelEngine.rig;
  const slots = rig.slots;
  const bones = rig.bones;
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(
    () => slots[0]?.id ?? null
  );

  useEffect(() => {
    if (selectedSlotId && !slots.some((s) => s.id === selectedSlotId)) {
      setSelectedSlotId(slots[0]?.id ?? null);
    } else if (!selectedSlotId && slots.length > 0) {
      setSelectedSlotId(slots[0].id);
    }
  }, [slots, selectedSlotId]);

  const selectedSlot = slots.find((s) => s.id === selectedSlotId) ?? null;
  const targetBone =
    bones.find((b) => b.id === selectedBoneId) ?? bones[0] ?? null;
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? null;

  const handleMakeSlotFromLayer = (bulkAllFrames: boolean) => {
    if (!targetBone) {
      setStatusMessage("Select a bone first");
      return;
    }
    if (!activeLayer || activeLayer.kind !== "raster") {
      setStatusMessage("Select a raster layer first");
      return;
    }

    const attachments: Record<string, { layerId: string; frame: number }> = {};
    if (bulkAllFrames) {
      for (const frame of frames) {
        const cel = pixelEngine.getCel(activeLayer.id, frame.index);
        if (cel && !cel.isEmpty()) {
          attachments[`f${frame.index + 1}`] = {
            layerId: activeLayer.id,
            frame: frame.index,
          };
        }
      }
      if (Object.keys(attachments).length === 0) {
        attachments[`f${currentFrame + 1}`] = {
          layerId: activeLayer.id,
          frame: currentFrame,
        };
      }
    } else {
      attachments[`f${currentFrame + 1}`] = {
        layerId: activeLayer.id,
        frame: currentFrame,
      };
    }

    const firstKey = Object.keys(attachments)[0] ?? null;
    const created = mutateRig("Create slot from layer", () =>
      rig.addSlot({
        name: activeLayer.name,
        boneId: targetBone.id,
        layerId: activeLayer.id,
        attachments,
        defaultAttachment: firstKey,
      })
    );
    setSelectedSlotId(created.id);
    setStatusMessage(
      `Created slot "${created.name}" (${Object.keys(attachments).length} att.)`
    );
  };

  const handleAddAttachmentFromFrame = () => {
    if (!selectedSlot || !activeLayer || activeLayer.kind !== "raster") {
      setStatusMessage("Select a slot and a raster layer");
      return;
    }
    const baseName = `f${currentFrame + 1}`;
    let name = baseName;
    let idx = 2;
    while (selectedSlot.attachments[name]) {
      name = `${baseName}_${idx++}`;
    }
    mutateRig("Add slot attachment", () =>
      rig.addSlotAttachment(selectedSlot.id, name, activeLayer.id, currentFrame)
    );
    setStatusMessage(`Added attachment "${name}" to "${selectedSlot.name}"`);
  };

  const handleBulkAddAttachments = () => {
    if (!selectedSlot || !activeLayer || activeLayer.kind !== "raster") {
      setStatusMessage("Select a slot and a raster layer");
      return;
    }
    let added = 0;
    mutateRig("Add attachments from layer", () => {
      for (const frame of frames) {
        const cel = pixelEngine.getCel(activeLayer.id, frame.index);
        if (!cel || cel.isEmpty()) continue;
        const name = `f${frame.index + 1}`;
        if (!selectedSlot.attachments[name]) {
          rig.addSlotAttachment(
            selectedSlot.id,
            name,
            activeLayer.id,
            frame.index
          );
          added++;
        }
      }
    });
    setStatusMessage(`Added ${added} attachment(s) from "${activeLayer.name}"`);
  };

  const activeAttachment = selectedSlot
    ? rig.resolveSlotAttachment(
        selectedSlot,
        currentFrame,
        true,
        rigMode === "setup" ? "rest" : "pose"
      )
    : null;

  return (
    <RigPanelSection
      title="Slots & Attachments"
      icon={<Layers size={12} />}
      actions={
        <span className="mono-value" style={{ fontSize: 10 }}>
          {slots.length}
        </span>
      }
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
        <button
          type="button"
          className="mini-btn"
          title="Make Slot from active raster layer at current frame"
          onClick={() => handleMakeSlotFromLayer(false)}
        >
          <Plus size={10} />
          <span>From Layer</span>
        </button>
        <button
          type="button"
          className="mini-btn"
          title="Make Slot with attachments from all populated frames of active layer"
          onClick={() => handleMakeSlotFromLayer(true)}
        >
          <Plus size={10} />
          <span>Bulk Frames</span>
        </button>
      </div>

      {slots.length === 0 ? (
        <div className="rig-empty-note">
          No slots yet. Select a bone + raster layer and click{" "}
          <strong>From Layer</strong> or <strong>Bulk Frames</strong>.
        </div>
      ) : (
        <div className="rig-bone-list" style={{ maxHeight: 110, marginBottom: 6 }}>
          {slots.map((slot, idx) => {
            const bone = bones.find((b) => b.id === slot.boneId);
            const active = selectedSlot?.id === slot.id;
            return (
              <div
                key={slot.id}
                className={`rig-constraint-row ${active ? "active" : ""}`}
                onClick={() => setSelectedSlotId(slot.id)}
              >
                <span className="rig-bone-name">{slot.name}</span>
                <span className="mono-value" style={{ fontSize: 9 }}>
                  {bone?.name ?? "?"} · {Object.keys(slot.attachments).length}
                </span>
                <button
                  type="button"
                  className="icon-action-btn"
                  style={{ width: 16, height: 16 }}
                  disabled={idx === 0}
                  title="Draw Earlier"
                  onClick={(e) => {
                    e.stopPropagation();
                    mutateRig("Reorder slot", () => rig.moveSlot(slot.id, -1));
                  }}
                >
                  <ArrowUp size={10} />
                </button>
                <button
                  type="button"
                  className="icon-action-btn"
                  style={{ width: 16, height: 16 }}
                  disabled={idx === slots.length - 1}
                  title="Draw Later"
                  onClick={(e) => {
                    e.stopPropagation();
                    mutateRig("Reorder slot", () => rig.moveSlot(slot.id, 1));
                  }}
                >
                  <ArrowDown size={10} />
                </button>
                <button
                  type="button"
                  className="icon-action-btn"
                  style={{ width: 16, height: 16 }}
                  title="Delete Slot"
                  onClick={(e) => {
                    e.stopPropagation();
                    mutateRig("Delete slot", () => rig.removeSlot(slot.id));
                  }}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selectedSlot && (
        <div className="rig-inspector">
          <div className="rig-inspector-row">
            <span>Bone</span>
            <select
              className="palette-select"
              value={selectedSlot.boneId}
              onChange={(e) =>
                mutateRig("Reassign slot bone", () =>
                  rig.updateSlot(selectedSlot.id, { boneId: e.target.value })
                )
              }
            >
              {bones.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              className="mini-btn"
              title={`Add attachment from active layer at F${currentFrame + 1}`}
              onClick={handleAddAttachmentFromFrame}
            >
              <Plus size={10} />
              <span>+ Frame {currentFrame + 1}</span>
            </button>
            <button
              type="button"
              className="mini-btn"
              title="Add attachments for all populated frames of active layer"
              onClick={handleBulkAddAttachments}
            >
              <Plus size={10} />
              <span>+ All Frames</span>
            </button>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              paddingTop: 2,
            }}
          >
            <button
              type="button"
              className={`mini-btn ${activeAttachment === null ? "active" : ""}`}
              style={{ height: 34, padding: "2px 6px" }}
              title="Hide slot (None)"
              onClick={() => {
                if (rigMode === "setup") {
                  mutateRig("Set default attachment", () =>
                    rig.updateSlot(selectedSlot.id, { defaultAttachment: null })
                  );
                } else {
                  mutateRig("Key empty attachment", () =>
                    rig.setSlotAttachmentAtFrame(
                      selectedSlot.id,
                      null,
                      currentFrame,
                      true
                    )
                  );
                }
              }}
            >
              None
            </button>

            {Object.entries(selectedSlot.attachments).map(([attName, att]) => {
              const isCurrent = activeAttachment?.name === attName;
              return (
                <div
                  key={attName}
                  style={{
                    position: "relative",
                    display: "inline-flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: 2,
                    border: isCurrent
                      ? "1px solid var(--accent)"
                      : "1px solid var(--border-subtle)",
                    background: isCurrent
                      ? "var(--accent-soft)"
                      : "var(--bg-root)",
                    cursor: "pointer",
                  }}
                  title={
                    rigMode === "setup"
                      ? `Set default: ${attName}`
                      : `Swap & key at F${currentFrame + 1}: ${attName}`
                  }
                  onClick={() => {
                    if (rigMode === "setup") {
                      mutateRig("Set default attachment", () =>
                        rig.updateSlot(selectedSlot.id, {
                          defaultAttachment: attName,
                        })
                      );
                    } else {
                      mutateRig("Swap slot attachment", () =>
                        rig.setSlotAttachmentAtFrame(
                          selectedSlot.id,
                          attName,
                          currentFrame,
                          true
                        )
                      );
                    }
                  }}
                >
                  <AttachmentThumb
                    layerId={att.layerId}
                    frame={att.frame}
                    canvasWidth={canvasWidth}
                    canvasHeight={canvasHeight}
                  />
                  <span
                    className="mono-value"
                    style={{ fontSize: 9, maxWidth: 32, overflow: "hidden" }}
                  >
                    {attName}
                  </span>
                  <button
                    type="button"
                    className="icon-action-btn"
                    style={{
                      position: "absolute",
                      top: -2,
                      right: -2,
                      width: 12,
                      height: 12,
                      background: "var(--bg-surface)",
                    }}
                    title="Remove attachment"
                    onClick={(e) => {
                      e.stopPropagation();
                      mutateRig("Remove attachment", () =>
                        rig.removeSlotAttachment(selectedSlot.id, attName)
                      );
                    }}
                  >
                    <X size={8} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </RigPanelSection>
  );
}
