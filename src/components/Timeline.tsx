import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Layers,
  Link2,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  SkipForward,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import {
  copySelection,
  copySelectionToNewLayer,
  cutSelection,
  cutSelectionToNewLayer,
  pasteClipboard,
} from "../engine/document/selectionActions";
import {
  addEmptyFrameAction,
  deleteCurrentFrameAction,
  duplicateCurrentFrameAction,
  reorderFrameAction,
  toggleLinkCelAction,
} from "../engine/document/timelineActions";
import { pixelEngine } from "../engine/document/PixelEngine";
import { useEditorStore } from "../store/editorStore";

export function Timeline() {
  const frames = useEditorStore((s) => s.frames);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const loopPlayback = useEditorStore((s) => s.loopPlayback);
  const fps = useEditorStore((s) => s.fps);
  const openContextMenu = useEditorStore((s) => s.openContextMenu);
  const onionSkin = useEditorStore((s) => s.onionSkin);
  const onionPrevFrames = useEditorStore((s) => s.onionPrevFrames);
  const onionNextFrames = useEditorStore((s) => s.onionNextFrames);
  const tags = useEditorStore((s) => s.tags);
  const activeTagId = useEditorStore((s) => s.activeTagId);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const timelineHeight = useEditorStore((s) => s.timelineHeight);
  const timelineCollapsed = useEditorStore((s) => s.timelineCollapsed);

  const setCurrentFrame = useEditorStore((s) => s.setCurrentFrame);
  const prevFrame = useEditorStore((s) => s.prevFrame);
  const nextFrame = useEditorStore((s) => s.nextFrame);
  const togglePlaying = useEditorStore((s) => s.togglePlaying);
  const toggleLoopPlayback = useEditorStore((s) => s.toggleLoopPlayback);
  const setFps = useEditorStore((s) => s.setFps);
  const toggleOnionSkin = useEditorStore((s) => s.toggleOnionSkin);
  const setOnionPrevFrames = useEditorStore((s) => s.setOnionPrevFrames);
  const setOnionNextFrames = useEditorStore((s) => s.setOnionNextFrames);
  const setActiveTagId = useEditorStore((s) => s.setActiveTagId);
  const setFrameDuration = useEditorStore((s) => s.setFrameDuration);
  const addTag = useEditorStore((s) => s.addTag);
  const deleteTag = useEditorStore((s) => s.deleteTag);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const toggleTimelineCollapsed = useEditorStore(
    (s) => s.toggleTimelineCollapsed
  );

  const [dragFrameIdx, setDragFrameIdx] = useState<number | null>(null);
  const [dragOverFrameIdx, setDragOverFrameIdx] = useState<number | null>(null);
  const [showTagForm, setShowTagForm] = useState(false);
  const [tagName, setTagName] = useState("run");
  const [tagFrom, setTagFrom] = useState(1);
  const [tagTo, setTagTo] = useState(frames.length);
  const [tagColor, setTagColor] = useState("#4cc38a");

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const isActiveCelLinked = Boolean(activeLayer?.linkedCels?.[currentFrame]);
  const activeFrameObj = frames[currentFrame] ?? frames[0];

  const handleCreateTag = (e: React.FormEvent) => {
    e.preventDefault();
    addTag(tagName, tagFrom - 1, tagTo - 1, tagColor);
    setShowTagForm(false);
  };

  return (
    <section
      className="timeline-dock"
      style={{ height: timelineCollapsed ? 32 : timelineHeight }}
      aria-label="Animation Timeline"
    >
      <div className="timeline-toolbar">
        <div className="timeline-controls">
          <span
            style={{
              fontWeight: 600,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              color: "var(--text-secondary)",
              marginRight: 4,
            }}
          >
            Timeline
          </span>

          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 24, height: 24 }}
            title="Previous Frame"
            onClick={prevFrame}
          >
            <SkipBack size={13} />
          </button>

          <button
            type="button"
            className={`icon-action-btn ${isPlaying ? "active" : ""}`}
            style={{ width: 24, height: 24 }}
            title="Play / Pause (Enter)"
            onClick={togglePlaying}
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} />}
          </button>

          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 24, height: 24 }}
            title="Next Frame"
            onClick={nextFrame}
          >
            <SkipForward size={13} />
          </button>

          <button
            type="button"
            className={`icon-action-btn ${loopPlayback ? "active" : ""}`}
            style={{ width: 24, height: 24 }}
            title="Loop Playback"
            onClick={toggleLoopPlayback}
          >
            <Repeat size={13} />
          </button>

          <label className="fps-badge" title="Global Frames Per Second">
            <input
              type="number"
              className="fps-input"
              min={1}
              max={60}
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
            />
            <span style={{ color: "var(--text-muted)", fontSize: 10 }}>FPS</span>
          </label>

          <label
            className="fps-badge"
            title={`Frame ${currentFrame + 1} Duration (ms)`}
          >
            <input
              type="number"
              className="fps-input"
              style={{ width: 40 }}
              min={16}
              max={5000}
              step={10}
              value={activeFrameObj?.durationMs ?? 100}
              onChange={(e) =>
                setFrameDuration(currentFrame, Number(e.target.value))
              }
            />
            <span style={{ color: "var(--text-muted)", fontSize: 10 }}>ms</span>
          </label>

          <div className="option-divider" />

          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 24, height: 24 }}
            title="Duplicate Current Frame"
            onClick={duplicateCurrentFrameAction}
          >
            <Copy size={12} />
          </button>

          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 24, height: 24 }}
            title="Delete Current Frame"
            disabled={frames.length <= 1}
            onClick={deleteCurrentFrameAction}
          >
            <Trash2 size={12} />
          </button>

          <button
            type="button"
            className={`icon-action-btn ${isActiveCelLinked ? "active" : ""}`}
            style={{ width: 24, height: 24 }}
            title={
              isActiveCelLinked
                ? "Unlink Cel from Previous Frame"
                : "Link Cel to Previous Frame"
            }
            disabled={!activeLayer || activeLayer.kind === "group"}
            onClick={() => toggleLinkCelAction(activeLayerId, currentFrame)}
          >
            <Link2 size={13} />
          </button>

          <div className="option-divider" />

          <button
            type="button"
            className={`toggle-chip ${onionSkin ? "active" : ""}`}
            onClick={toggleOnionSkin}
            title="Toggle GPU Onion Skinning"
          >
            <Layers size={12} />
            <span>Onion</span>
          </button>

          {onionSkin && (
            <div className="onion-controls">
              <span title="Previous frames">Prev</span>
              <input
                type="number"
                className="onion-mini-input"
                min={0}
                max={3}
                value={onionPrevFrames}
                onChange={(e) => setOnionPrevFrames(Number(e.target.value))}
              />
              <span title="Next frames">Next</span>
              <input
                type="number"
                className="onion-mini-input"
                min={0}
                max={3}
                value={onionNextFrames}
                onChange={(e) => setOnionNextFrames(Number(e.target.value))}
              />
            </div>
          )}
        </div>

        <div className="tags-strip" style={{ position: "relative" }}>
          {tags.map((tag) => {
            const isTagActive = activeTagId === tag.id;
            return (
              <div
                key={tag.id}
                className={`tag-pill ${isTagActive ? "active" : ""}`}
              >
                <button
                  type="button"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                  title={`Play tag '${tag.name}' (${tag.fromFrame + 1}-${tag.toFrame + 1})`}
                  onClick={() => setActiveTagId(isTagActive ? null : tag.id)}
                >
                  <span
                    className="tag-dot"
                    style={{ backgroundColor: isTagActive ? "#fff" : tag.color }}
                  />
                  <span>{tag.name}</span>
                </button>
                <button
                  type="button"
                  className="tag-delete-btn"
                  title={`Delete tag '${tag.name}'`}
                  onClick={() => deleteTag(tag.id)}
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            className={`toggle-chip ${showTagForm ? "active" : ""}`}
            style={{ padding: "2px 7px" }}
            title="New Animation Tag"
            onClick={() => {
              setTagFrom(currentFrame + 1);
              setTagTo(frames.length);
              setShowTagForm((v) => !v);
            }}
          >
            <Tag size={11} />
            <span>+ Tag</span>
          </button>

          {showTagForm && (
            <form className="tag-form-popover" onSubmit={handleCreateTag}>
              <input
                type="text"
                className="tag-form-input"
                style={{ width: 68 }}
                placeholder="Name"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
              />
              <input
                type="number"
                className="tag-form-input"
                style={{ width: 38 }}
                min={1}
                max={frames.length}
                value={tagFrom}
                onChange={(e) => setTagFrom(Number(e.target.value))}
                title="From frame"
              />
              <span style={{ color: "var(--text-muted)" }}>-</span>
              <input
                type="number"
                className="tag-form-input"
                style={{ width: 38 }}
                min={1}
                max={frames.length}
                value={tagTo}
                onChange={(e) => setTagTo(Number(e.target.value))}
                title="To frame"
              />
              <input
                type="color"
                value={tagColor}
                onChange={(e) => setTagColor(e.target.value)}
                style={{ width: 22, height: 22, border: "none", padding: 0 }}
              />
              <button
                type="submit"
                className="export-cta"
                style={{ padding: "2px 8px", fontSize: 11 }}
              >
                Add
              </button>
            </form>
          )}

          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 24, height: 24 }}
            title={timelineCollapsed ? "Expand Timeline" : "Collapse Timeline"}
            onClick={toggleTimelineCollapsed}
          >
            {timelineCollapsed ? (
              <ChevronUp size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>
        </div>
      </div>

      {!timelineCollapsed && (
        <div className="timeline-grid-wrap">
          {tags.length > 0 && (
            <div className="timeline-tag-bar-row">
              <div
                className="timeline-label-col"
                style={{ fontSize: 10, color: "var(--text-muted)" }}
              >
                Tags
              </div>
              <div
                className="timeline-tag-track"
                style={{ minWidth: frames.length * 34 }}
              >
                {tags.map((tag) => {
                  const left = tag.fromFrame * 34 + 2;
                  const width =
                    Math.max(1, tag.toFrame - tag.fromFrame + 1) * 34 - 4;
                  const active = activeTagId === tag.id;
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={`tag-span-bar ${active ? "active" : ""}`}
                      style={{ left, width, backgroundColor: tag.color }}
                      title={`${tag.name} (${tag.fromFrame + 1}..${tag.toFrame + 1})`}
                      onClick={() => setActiveTagId(active ? null : tag.id)}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="timeline-header-row">
            <div className="timeline-label-col" style={{ fontWeight: 600 }}>
              <span>Layer \ Frame</span>
              <span
                className="mono-value"
                style={{ fontSize: 10, color: "var(--text-muted)" }}
              >
                {frames.length}f
              </span>
            </div>

            {frames.map((frame) => {
              const active = frame.index === currentFrame;
              const isDragOver =
                dragOverFrameIdx === frame.index && dragFrameIdx !== frame.index;
              return (
                <button
                  key={frame.id}
                  type="button"
                  draggable
                  className={`frame-head-cell ${active ? "active" : ""} ${isDragOver ? "drag-over" : ""}`}
                  title={`Frame ${frame.index + 1} (${frame.durationMs}ms) · Drag to reorder`}
                  onClick={() => setCurrentFrame(frame.index)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCurrentFrame(frame.index);
                    openContextMenu(e.clientX, e.clientY, [
                      { kind: "item", label: "New Frame", action: () => addEmptyFrameAction() },
                      { kind: "item", label: "Duplicate Frame", action: () => duplicateCurrentFrameAction() },
                      { kind: "separator" },
                      {
                        kind: "item",
                        label: "Delete Frame",
                        disabled: frames.length <= 1,
                        danger: true,
                        action: () => deleteCurrentFrameAction(),
                      },
                    ]);
                  }}
                  onDragStart={() => setDragFrameIdx(frame.index)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverFrameIdx(frame.index);
                  }}
                  onDragLeave={() => {
                    if (dragOverFrameIdx === frame.index) {
                      setDragOverFrameIdx(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverFrameIdx(null);
                    if (dragFrameIdx !== null && dragFrameIdx !== frame.index) {
                      reorderFrameAction(dragFrameIdx, frame.index);
                    }
                    setDragFrameIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragFrameIdx(null);
                    setDragOverFrameIdx(null);
                  }}
                >
                  {frame.index + 1}
                </button>
              );
            })}

            <button
              type="button"
              className="add-frame-cell"
              title="Add Empty Frame"
              onClick={addEmptyFrameAction}
            >
              <Plus size={13} />
            </button>
          </div>

          {layers.map((layer) => {
            const isLayerActive = layer.id === activeLayerId;
            return (
              <div
                key={layer.id}
                className={`timeline-layer-row ${isLayerActive ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="timeline-label-col"
                  onClick={() => selectLayer(layer.id)}
                >
                  <span className="layer-name" style={{ textAlign: "left" }}>
                    {layer.name}
                  </span>
                </button>

                {frames.map((frame) => {
                  const hasCel = Boolean(layer.cels[frame.index]);
                  const isLinked = Boolean(layer.linkedCels?.[frame.index]);
                  const activeCol = frame.index === currentFrame;
                  return (
                    <button
                      key={`${layer.id}-${frame.id}`}
                      type="button"
                      className={`cel-cell ${activeCol ? "active-col" : ""}`}
                      title={`${layer.name} · Frame ${frame.index + 1}${isLinked ? " (Linked)" : ""}`}
                      onClick={() => {
                        selectLayer(layer.id);
                        setCurrentFrame(frame.index);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        selectLayer(layer.id);
                        setCurrentFrame(frame.index);
                        const hasClip = Boolean(pixelEngine.clipboard);
                        openContextMenu(e.clientX, e.clientY, [
                          { kind: "item", label: "Cut", shortcut: "Ctrl+X", action: () => { cutSelection(); } },
                          { kind: "item", label: "Copy", shortcut: "Ctrl+C", action: () => { copySelection(); } },
                          { kind: "item", label: "Paste", shortcut: "Ctrl+V", disabled: !hasClip, action: () => { pasteClipboard(); } },
                          { kind: "separator" },
                          { kind: "item", label: "Cut to New Layer", shortcut: "Ctrl+Shift+X", action: () => { cutSelectionToNewLayer(); } },
                          { kind: "item", label: "Copy to New Layer", shortcut: "Ctrl+J", action: () => { copySelectionToNewLayer(); } },
                          { kind: "separator" },
                          {
                            kind: "item",
                            label: isLinked ? "Unlink Cel" : "Link Cel to Previous",
                            disabled: layer.kind === "group" || (!isLinked && frame.index === 0),
                            action: () => toggleLinkCelAction(layer.id, frame.index),
                          },
                          { kind: "item", label: "Duplicate Frame", action: () => duplicateCurrentFrameAction() },
                          {
                            kind: "item",
                            label: "Delete Frame",
                            disabled: frames.length <= 1,
                            danger: true,
                            action: () => deleteCurrentFrameAction(),
                          },
                        ]);
                      }}
                    >
                      {layer.kind !== "group" && (
                        <>
                          {isLinked && <span className="cel-link-bridge" />}
                          <span
                            className={`cel-dot ${isLinked ? "linked" : hasCel ? "" : "empty"}`}
                          />
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
