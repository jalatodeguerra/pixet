import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Grid,
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
  bulkDeleteSelectedCelsAction,
  bulkSetFrameDurationAction,
  deleteCurrentFrameAction,
  duplicateCurrentFrameAction,
  reorderFrameAction,
  reverseFramesAction,
  toggleLinkCelAction,
} from "../engine/document/timelineActions";
import { pixelEngine } from "../engine/document/PixelEngine";
import type { TagDirection } from "../engine/tools/animationHelpers";
import {
  getBoneInfluenceColor,
  type EasingMode,
} from "../engine/rig/RigEngine";
import {
  copyKeyframes,
  pasteKeyframes,
  retimeKeyframes,
  setKeyframeEasing,
  type CopiedRigKeyframe,
  type RigKeyRef,
} from "../engine/rig/animationTools";
import { mutateRig } from "../engine/rig/rigActions";
import { useEditorStore } from "../store/editorStore";
import { CurveEditor } from "./rig/CurveEditor";

function CelThumbnail({
  layerId,
  frameIndex,
  width,
  height,
}: {
  layerId: string;
  frameIndex: number;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const renderThumb = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const cel = pixelEngine.getCel(layerId, frameIndex);
      if (!cel || cel.isEmpty()) return;
      const img = new ImageData(
        new Uint8ClampedArray(cel.data),
        cel.width,
        cel.height
      );
      ctx.putImageData(img, 0, 0);
    };

    renderThumb();
    return pixelEngine.subscribe(renderThumb);
  }, [layerId, frameIndex, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="draw-cel-thumb-canvas"
    />
  );
}

function nextTagDirection(dir?: TagDirection): TagDirection {
  if (dir === "reverse") return "pingpong";
  if (dir === "pingpong") return "forward";
  return "reverse";
}

function tagDirectionBadge(dir?: TagDirection): string {
  if (dir === "reverse") return "Rev";
  if (dir === "pingpong") return "PP";
  return "Fwd";
}

export function Timeline({ fluid = false }: { fluid?: boolean } = {}) {
  const frames = useEditorStore((s) => s.frames);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const loopPlayback = useEditorStore((s) => s.loopPlayback);
  const fps = useEditorStore((s) => s.fps);
  const openContextMenu = useEditorStore((s) => s.openContextMenu);
  const onionSkin = useEditorStore((s) => s.onionSkin);
  const onionPrevFrames = useEditorStore((s) => s.onionPrevFrames);
  const onionNextFrames = useEditorStore((s) => s.onionNextFrames);
  const onionSkinTint = useEditorStore((s) => s.onionSkinTint);
  const onionSkinOpacity = useEditorStore((s) => s.onionSkinOpacity);
  const onionSkinInFront = useEditorStore((s) => s.onionSkinInFront);
  const onionSkinLoopWrap = useEditorStore((s) => s.onionSkinLoopWrap);
  const timelineShowThumbs = useEditorStore((s) => s.timelineShowThumbs);
  const selectedCels = useEditorStore((s) => s.selectedCels);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const tags = useEditorStore((s) => s.tags);
  const activeTagId = useEditorStore((s) => s.activeTagId);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const timelineHeight = useEditorStore((s) => s.timelineHeight);
  const timelineCollapsed = useEditorStore((s) => s.timelineCollapsed);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const rigMode = useEditorStore((s) => s.rigMode);
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const selectedBoneIds = useEditorStore((s) => s.selectedBoneIds);
  const setSelectedBoneId = useEditorStore((s) => s.setSelectedBoneId);
  const rigTimelineView = useEditorStore((s) => s.rigTimelineView);
  const setRigTimelineView = useEditorStore((s) => s.setRigTimelineView);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const setCurrentFrame = useEditorStore((s) => s.setCurrentFrame);
  const prevFrame = useEditorStore((s) => s.prevFrame);
  const nextFrame = useEditorStore((s) => s.nextFrame);
  const togglePlaying = useEditorStore((s) => s.togglePlaying);
  const toggleLoopPlayback = useEditorStore((s) => s.toggleLoopPlayback);
  const setFps = useEditorStore((s) => s.setFps);
  const toggleOnionSkin = useEditorStore((s) => s.toggleOnionSkin);
  const setOnionPrevFrames = useEditorStore((s) => s.setOnionPrevFrames);
  const setOnionNextFrames = useEditorStore((s) => s.setOnionNextFrames);
  const toggleOnionSkinTint = useEditorStore((s) => s.toggleOnionSkinTint);
  const setOnionSkinOpacity = useEditorStore((s) => s.setOnionSkinOpacity);
  const toggleOnionSkinInFront = useEditorStore(
    (s) => s.toggleOnionSkinInFront
  );
  const toggleOnionSkinLoopWrap = useEditorStore(
    (s) => s.toggleOnionSkinLoopWrap
  );
  const toggleTimelineShowThumbs = useEditorStore(
    (s) => s.toggleTimelineShowThumbs
  );
  const setSelectedCels = useEditorStore((s) => s.setSelectedCels);
  const clearSelectedCels = useEditorStore((s) => s.clearSelectedCels);
  const setActiveTagId = useEditorStore((s) => s.setActiveTagId);
  const setFrameDuration = useEditorStore((s) => s.setFrameDuration);
  const addTag = useEditorStore((s) => s.addTag);
  const setTagDirection = useEditorStore((s) => s.setTagDirection);
  const deleteTag = useEditorStore((s) => s.deleteTag);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const toggleTimelineCollapsed = useEditorStore(
    (s) => s.toggleTimelineCollapsed
  );

  const [dragFrameIdx, setDragFrameIdx] = useState<number | null>(null);
  const [dragOverFrameIdx, setDragOverFrameIdx] = useState<number | null>(null);
  const [expandedBoneIds, setExpandedBoneIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedKeys, setSelectedKeys] = useState<RigKeyRef[]>([]);
  const [copiedKeys, setCopiedKeys] = useState<CopiedRigKeyframe[]>([]);
  const [retimeDragFrom, setRetimeDragFrom] = useState<number | null>(null);
  const [showTagForm, setShowTagForm] = useState(false);
  const [showOnionPopover, setShowOnionPopover] = useState(false);
  const [celAnchor, setCelAnchor] = useState<{
    layerId: string;
    frame: number;
  } | null>(null);
  const [bulkDurationMs, setBulkDurationMs] = useState(100);
  const [tagName, setTagName] = useState("run");
  const [tagFrom, setTagFrom] = useState(1);
  const [tagTo, setTagTo] = useState(frames.length);
  const [tagColor, setTagColor] = useState("#4cc38a");
  const [tagDirection, setTagFormDirection] = useState<TagDirection>("forward");

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const isActiveCelLinked = Boolean(activeLayer?.linkedCels?.[currentFrame]);
  const activeFrameObj = frames[currentFrame] ?? frames[0];

  const handleCreateTag = (e: React.FormEvent) => {
    e.preventDefault();
    addTag(tagName, tagFrom - 1, tagTo - 1, tagColor, tagDirection);
    setShowTagForm(false);
  };

  const selectedFrameIndices = Array.from(
    new Set(selectedCels.map((c) => c.frame))
  );

  const effectiveCollapsed = !fluid && timelineCollapsed;

  return (
    <section
      className={`timeline-dock ${fluid ? "is-fluid" : ""}`}
      style={fluid ? undefined : { height: effectiveCollapsed ? 30 : timelineHeight }}
      aria-label="Animation Timeline"
    >
      <div className="timeline-toolbar">
        <div className="timeline-controls">
          {!fluid && (
            <button
              type="button"
              className="panel-collapse-btn"
              style={{ marginRight: 4 }}
              title={effectiveCollapsed ? "Expand Timeline" : "Collapse Timeline"}
              onClick={toggleTimelineCollapsed}
            >
              {effectiveCollapsed ? (
                <ChevronUp size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
              <span>Timeline</span>
            </button>
          )}

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
            title="Reverse Frames (Active Tag or All)"
            disabled={frames.length <= 1}
            onClick={() => reverseFramesAction()}
          >
            <ArrowLeftRight size={12} />
          </button>

          {workspaceMode === "rig" && rigMode === "animate" && (
            <>
              <div className="option-divider" />
              <button
                type="button"
                className={`toggle-chip ${rigTimelineView === "dope" ? "active" : ""}`}
                onClick={() => setRigTimelineView("dope")}
              >
                <span>Dope</span>
              </button>
              <button
                type="button"
                className={`toggle-chip ${rigTimelineView === "curves" ? "active" : ""}`}
                onClick={() => setRigTimelineView("curves")}
              >
                <span>Curves</span>
              </button>
            </>
          )}

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

          <button
            type="button"
            className={`toggle-chip ${timelineShowThumbs ? "active" : ""}`}
            style={{ padding: "2px 6px" }}
            title="Toggle Cel Thumbnails"
            onClick={toggleTimelineShowThumbs}
          >
            <Grid size={11} />
            <span>Thumbs</span>
          </button>

          <div className="option-divider" />

          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}>
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
                <button
                  type="button"
                  className={`toggle-chip ${showOnionPopover ? "active" : ""}`}
                  style={{ padding: "1px 5px", fontSize: 10 }}
                  title="Onion Skin v2 Options"
                  onClick={() => setShowOnionPopover((v) => !v)}
                >
                  Opts
                </button>
              </div>
            )}

            {onionSkin && showOnionPopover && (
              <div className="draw-onion-popover">
                <div className="draw-onion-pop-row">
                  <span>Color</span>
                  <button
                    type="button"
                    className={`toggle-chip ${onionSkinTint ? "active" : ""}`}
                    style={{ padding: "1px 6px", fontSize: 10 }}
                    onClick={toggleOnionSkinTint}
                  >
                    {onionSkinTint ? "Tint (R/B)" : "Original"}
                  </button>
                </div>
                <div className="draw-onion-pop-row">
                  <span>Opacity</span>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="range"
                      min={10}
                      max={80}
                      value={onionSkinOpacity}
                      onChange={(e) =>
                        setOnionSkinOpacity(Number(e.target.value))
                      }
                      style={{ width: 68, accentColor: "var(--accent)" }}
                    />
                    <span className="mono-value" style={{ fontSize: 10, width: 28 }}>
                      {onionSkinOpacity}%
                    </span>
                  </div>
                </div>
                <div className="draw-onion-pop-row">
                  <span>Order</span>
                  <button
                    type="button"
                    className={`toggle-chip ${onionSkinInFront ? "active" : ""}`}
                    style={{ padding: "1px 6px", fontSize: 10 }}
                    onClick={toggleOnionSkinInFront}
                  >
                    {onionSkinInFront ? "In Front" : "Behind"}
                  </button>
                </div>
                <div className="draw-onion-pop-row">
                  <span>Wrap</span>
                  <button
                    type="button"
                    className={`toggle-chip ${onionSkinLoopWrap ? "active" : ""}`}
                    style={{ padding: "1px 6px", fontSize: 10 }}
                    onClick={toggleOnionSkinLoopWrap}
                  >
                    {onionSkinLoopWrap ? "Loop On" : "Loop Off"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {selectedCels.length > 0 && (
            <>
              <div className="option-divider" />
              <div className="draw-cel-bulk-bar">
                <span className="mono-value" style={{ fontSize: 10 }}>
                  {selectedCels.length} sel
                </span>
                <button
                  type="button"
                  className="toggle-chip"
                  style={{ padding: "1px 6px", fontSize: 10 }}
                  title="Clear pixels in all selected cels (single undo)"
                  onClick={bulkDeleteSelectedCelsAction}
                >
                  Clear Selected
                </button>
                <label className="fps-badge" title="Bulk duration (ms)">
                  <input
                    type="number"
                    className="fps-input"
                    style={{ width: 38 }}
                    min={16}
                    max={5000}
                    step={10}
                    value={bulkDurationMs}
                    onChange={(e) => setBulkDurationMs(Number(e.target.value))}
                  />
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                    ms
                  </span>
                </label>
                <button
                  type="button"
                  className="toggle-chip"
                  style={{ padding: "1px 6px", fontSize: 10 }}
                  title="Set duration on selected frames"
                  onClick={() =>
                    bulkSetFrameDurationAction(
                      selectedFrameIndices,
                      bulkDurationMs
                    )
                  }
                >
                  Duration
                </button>
                <button
                  type="button"
                  className="icon-action-btn"
                  style={{ width: 18, height: 18 }}
                  title="Clear Cel Selection"
                  onClick={clearSelectedCels}
                >
                  <X size={10} />
                </button>
              </div>
            </>
          )}
        </div>

        <div className="tags-strip" style={{ position: "relative" }}>
          {tags.map((tag) => {
            const isTagActive = activeTagId === tag.id;
            const dir = tag.direction ?? "forward";
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
                  className="draw-tag-dir-btn"
                  title={`Playback direction: ${dir} (click to cycle Fwd / Rev / Ping-Pong)`}
                  onClick={() => setTagDirection(tag.id, nextTagDirection(dir))}
                >
                  {tagDirectionBadge(dir)}
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
              <select
                className="tag-form-input"
                value={tagDirection}
                onChange={(e) =>
                  setTagFormDirection(e.target.value as TagDirection)
                }
                title="Tag Playback Direction"
              >
                <option value="forward">Fwd</option>
                <option value="reverse">Rev</option>
                <option value="pingpong">Ping-Pong</option>
              </select>
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

          {!fluid && (
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 24, height: 24 }}
              title={effectiveCollapsed ? "Expand Timeline" : "Collapse Timeline"}
              onClick={toggleTimelineCollapsed}
            >
              {effectiveCollapsed ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
          )}
        </div>
      </div>

      {!effectiveCollapsed &&
        workspaceMode === "rig" &&
        rigMode === "animate" &&
        rigTimelineView === "curves" && (
          <div className="timeline-grid-wrap" style={{ flex: 1 }}>
            <CurveEditor />
          </div>
        )}

      {!effectiveCollapsed &&
        !(
          workspaceMode === "rig" &&
          rigMode === "animate" &&
          rigTimelineView === "curves"
        ) && (
        <div
          className="timeline-grid-wrap"
          tabIndex={0}
          onPointerUp={() => setRetimeDragFrom(null)}
          onKeyDown={(e) => {
            if (workspaceMode !== "rig" || rigMode !== "animate") return;
            const mod = e.ctrlKey || e.metaKey;
            const clip = pixelEngine.rig.getActiveClip();
            if (mod && e.key.toLowerCase() === "c" && selectedKeys.length > 0) {
              e.preventDefault();
              e.stopPropagation();
              const copied = copyKeyframes(clip, selectedKeys);
              setCopiedKeys(copied);
              setStatusMessage(`Copied ${copied.length} keyframe(s)`);
              return;
            }
            if (mod && e.key.toLowerCase() === "v" && copiedKeys.length > 0) {
              e.preventDefault();
              e.stopPropagation();
              const pasted = mutateRig("Paste keyframes", () => {
                const count = pasteKeyframes(clip, copiedKeys, currentFrame);
                pixelEngine.rig.invalidateEvaluation();
                return count;
              });
              setStatusMessage(`Pasted ${pasted} keyframe(s)`);
              return;
            }
            if (
              (e.key === "Delete" || e.key === "Backspace") &&
              selectedKeys.length > 0
            ) {
              e.preventDefault();
              e.stopPropagation();
              mutateRig("Delete keyframes", () => {
                for (const ref of selectedKeys) {
                  pixelEngine.rig.deleteKeyframe(ref.boneId, ref.frame);
                }
              });
              setSelectedKeys([]);
            }
          }}
        >
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

          {workspaceMode === "rig" &&
            rigMode === "animate" &&
            pixelEngine.rig.bones.map((bone, boneIdx) => {
              const [r, g, b] = getBoneInfluenceColor(boneIdx);
              const isBoneSelected =
                bone.id === selectedBoneId || selectedBoneIds.includes(bone.id);
              const isExpanded = expandedBoneIds.has(bone.id);
              const clip = pixelEngine.rig.getActiveClip();
              const track = clip.tracks[bone.id] ?? [];

              const setEasingAction = (frameIdx: number, easing: EasingMode) => {
                mutateRig("Set key easing", () => {
                  setKeyframeEasing(clip, bone.id, frameIdx, easing);
                  pixelEngine.rig.invalidateEvaluation();
                });
              };

              return (
                <div key={`rig-${bone.id}-${rigVersion}`}>
                  <div
                    className={`timeline-rig-row ${isBoneSelected ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      className="timeline-label-col"
                      title={`Bone: ${bone.name}`}
                      onClick={() => setSelectedBoneId(bone.id)}
                    >
                      <span
                        className="rig-tree-chevron"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedBoneIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(bone.id)) next.delete(bone.id);
                            else next.add(bone.id);
                            return next;
                          });
                        }}
                      >
                        {isExpanded ? (
                          <ChevronDown size={10} />
                        ) : (
                          <ChevronRight size={10} />
                        )}
                      </span>
                      <span
                        className="rig-bone-swatch"
                        style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
                      />
                      <span className="layer-name" style={{ textAlign: "left" }}>
                        {bone.name}
                      </span>
                    </button>

                    {frames.map((frame) => {
                      const kf = track.find((k) => k.frame === frame.index);
                      const hasKey = Boolean(kf);
                      const hasAttachmentKey = Boolean(
                        kf && kf.attachment !== undefined
                      );
                      const isKeySelected = selectedKeys.some(
                        (k) => k.boneId === bone.id && k.frame === frame.index
                      );
                      const activeCol = frame.index === currentFrame;
                      const attTip = hasAttachmentKey
                        ? ` · Attachment: ${kf?.attachment ?? "None"}`
                        : "";
                      return (
                        <button
                          key={`rig-${bone.id}-${frame.id}`}
                          type="button"
                          className={`rig-dope-cell ${activeCol ? "active-col" : ""} ${isKeySelected ? "active" : ""}`}
                          style={
                            isKeySelected
                              ? { outline: "1px solid var(--accent)" }
                              : undefined
                          }
                          title={`${bone.name} · Frame ${frame.index + 1}${hasKey ? " (Keyframed · Drag to retime)" : " (Double-click to set keyframe)"}${attTip}`}
                          onPointerDown={(e) => {
                            if (e.button !== 0 || !hasKey) return;
                            if (isKeySelected) {
                              setRetimeDragFrom(frame.index);
                            }
                          }}
                          onPointerEnter={() => {
                            if (
                              retimeDragFrom === null ||
                              retimeDragFrom === frame.index ||
                              selectedKeys.length === 0
                            ) {
                              return;
                            }
                            const delta = frame.index - retimeDragFrom;
                            const moves = selectedKeys.map((k) => ({
                              boneId: k.boneId,
                              fromFrame: k.frame,
                              toFrame: Math.max(0, k.frame + delta),
                            }));
                            mutateRig("Retime keyframes", () => {
                              retimeKeyframes(clip, moves);
                              pixelEngine.rig.invalidateEvaluation();
                            });
                            setSelectedKeys(
                              moves.map((m) => ({
                                boneId: m.boneId,
                                frame: m.toFrame,
                              }))
                            );
                            setRetimeDragFrom(frame.index);
                          }}
                          onClick={(e) => {
                            setSelectedBoneId(bone.id);
                            setCurrentFrame(frame.index);
                            if (!hasKey) {
                              if (!e.ctrlKey && !e.metaKey) setSelectedKeys([]);
                              return;
                            }
                            if (e.ctrlKey || e.metaKey) {
                              setSelectedKeys((prev) =>
                                prev.some(
                                  (k) =>
                                    k.boneId === bone.id &&
                                    k.frame === frame.index
                                )
                                  ? prev.filter(
                                      (k) =>
                                        !(
                                          k.boneId === bone.id &&
                                          k.frame === frame.index
                                        )
                                    )
                                  : [
                                      ...prev,
                                      { boneId: bone.id, frame: frame.index },
                                    ]
                              );
                            } else if (e.shiftKey && selectedKeys.length > 0) {
                              const last = selectedKeys[selectedKeys.length - 1];
                              if (last.boneId === bone.id) {
                                const [lo, hi] =
                                  last.frame <= frame.index
                                    ? [last.frame, frame.index]
                                    : [frame.index, last.frame];
                                const range = track
                                  .filter((k) => k.frame >= lo && k.frame <= hi)
                                  .map((k) => ({
                                    boneId: bone.id,
                                    frame: k.frame,
                                  }));
                                setSelectedKeys(range);
                                return;
                              }
                              setSelectedKeys([
                                { boneId: bone.id, frame: frame.index },
                              ]);
                            } else {
                              setSelectedKeys([
                                { boneId: bone.id, frame: frame.index },
                              ]);
                            }
                          }}
                          onDoubleClick={() => {
                            setSelectedBoneId(bone.id);
                            setCurrentFrame(frame.index);
                            if (hasKey) {
                              mutateRig("Delete keyframe", () =>
                                pixelEngine.rig.deleteKeyframe(
                                  bone.id,
                                  frame.index
                                )
                              );
                            } else {
                              mutateRig("Set keyframe", () =>
                                pixelEngine.rig.setKeyframe(
                                  bone.id,
                                  frame.index
                                )
                              );
                            }
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setSelectedBoneId(bone.id);
                            setCurrentFrame(frame.index);
                            openContextMenu(e.clientX, e.clientY, [
                              {
                                kind: "item",
                                label: "Set Keyframe",
                                action: () => {
                                  mutateRig("Set keyframe", () =>
                                    pixelEngine.rig.setKeyframe(
                                      bone.id,
                                      frame.index
                                    )
                                  );
                                },
                              },
                              {
                                kind: "item",
                                label: "Delete Keyframe",
                                disabled: !hasKey,
                                danger: true,
                                action: () => {
                                  mutateRig("Delete keyframe", () =>
                                    pixelEngine.rig.deleteKeyframe(
                                      bone.id,
                                      frame.index
                                    )
                                  );
                                },
                              },
                              { kind: "separator" },
                              {
                                kind: "item",
                                label: "Easing: Linear",
                                disabled: !hasKey,
                                action: () =>
                                  setEasingAction(frame.index, "linear"),
                              },
                              {
                                kind: "item",
                                label: "Easing: Step",
                                disabled: !hasKey,
                                action: () =>
                                  setEasingAction(frame.index, "step"),
                              },
                              {
                                kind: "item",
                                label: "Easing: Ease In",
                                disabled: !hasKey,
                                action: () =>
                                  setEasingAction(frame.index, "easeIn"),
                              },
                              {
                                kind: "item",
                                label: "Easing: Ease Out",
                                disabled: !hasKey,
                                action: () =>
                                  setEasingAction(frame.index, "easeOut"),
                              },
                              {
                                kind: "item",
                                label: "Easing: Ease In-Out",
                                disabled: !hasKey,
                                action: () =>
                                  setEasingAction(frame.index, "easeInOut"),
                              },
                              {
                                kind: "item",
                                label: "Easing: Bezier",
                                disabled: !hasKey,
                                action: () =>
                                  setEasingAction(frame.index, "bezier"),
                              },
                            ]);
                          }}
                        >
                          <span
                            className={`rig-dope-diamond ${hasKey ? "keyed" : ""}`}
                          />
                          {hasAttachmentKey && (
                            <span
                              className="rig-attach-square"
                              style={{ marginLeft: 2 }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {isExpanded &&
                    (
                      [
                        { key: "rot", label: "Rotation" },
                        { key: "pos", label: "Position" },
                        { key: "scale", label: "Scale" },
                        { key: "attach", label: "Attach" },
                      ] as const
                    ).map((ch) => (
                      <div
                        key={`rig-${bone.id}-${ch.key}`}
                        className="timeline-rig-row"
                        style={{ height: 18, opacity: 0.85 }}
                      >
                        <div
                          className="timeline-label-col"
                          style={{
                            paddingLeft: 26,
                            fontSize: 10,
                            color: "var(--text-muted)",
                          }}
                        >
                          {ch.label}
                        </div>
                        {frames.map((frame) => {
                          const kf = track.find((k) => k.frame === frame.index);
                          const hasChannel = Boolean(
                            kf &&
                              (ch.key === "rot" ||
                                (ch.key === "pos" &&
                                  (kf.localX !== undefined ||
                                    kf.localY !== undefined)) ||
                                (ch.key === "scale" &&
                                  (kf.scaleX !== undefined ||
                                    kf.scaleY !== undefined)) ||
                                (ch.key === "attach" &&
                                  kf.attachment !== undefined))
                          );
                          return (
                            <div
                              key={`rig-${bone.id}-${ch.key}-${frame.id}`}
                              className={`rig-dope-cell ${frame.index === currentFrame ? "active-col" : ""}`}
                              title={
                                ch.key === "attach" && hasChannel
                                  ? `Attachment: ${kf?.attachment ?? "None"}`
                                  : undefined
                              }
                            >
                              {hasChannel &&
                                (ch.key === "attach" ? (
                                  <span className="rig-attach-square" />
                                ) : (
                                  <span
                                    className="rig-dope-diamond keyed"
                                    style={{ width: 5, height: 5 }}
                                  />
                                ))}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                </div>
              );
            })}

          {workspaceMode === "rig" &&
            rigMode === "animate" &&
            pixelEngine.rig.constraints
              .filter((c) => c.type === "ik" || c.type === "aim")
              .map((c) => (
                <div
                  key={`rig-c-${c.id}-${rigVersion}`}
                  className="timeline-rig-row"
                >
                  <div
                    className="timeline-label-col"
                    style={{ fontSize: 10, color: "#eab308" }}
                    title={`Constraint Target: ${c.name}`}
                  >
                    <Link2 size={10} />
                    <span className="layer-name" style={{ textAlign: "left" }}>
                      {c.name}
                    </span>
                  </div>
                  {frames.map((frame) => {
                    const hasKey =
                      pixelEngine.rig.hasConstraintTargetKeyframe(
                        c.id,
                        frame.index
                      );
                    return (
                      <button
                        key={`rig-c-${c.id}-${frame.id}`}
                        type="button"
                        className={`rig-dope-cell ${frame.index === currentFrame ? "active-col" : ""}`}
                        title={`${c.name} Target · F${frame.index + 1}`}
                        onClick={() => setCurrentFrame(frame.index)}
                        onDoubleClick={() => {
                          if (hasKey) {
                            mutateRig("Delete target key", () =>
                              pixelEngine.rig.deleteConstraintTargetKeyframe(
                                c.id,
                                frame.index
                              )
                            );
                          } else {
                            mutateRig("Key target", () =>
                              pixelEngine.rig.setConstraintTargetKeyframe(
                                c.id,
                                frame.index
                              )
                            );
                          }
                        }}
                      >
                        <span
                          className={`rig-dope-diamond ${hasKey ? "keyed" : ""}`}
                        />
                      </button>
                    );
                  })}
                </div>
              ))}

          {layers.map((layer, layerIdx) => {
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
                  const isCelSelected = selectedCels.some(
                    (c) => c.layerId === layer.id && c.frame === frame.index
                  );
                  return (
                    <button
                      key={`${layer.id}-${frame.id}`}
                      type="button"
                      className={`cel-cell ${activeCol ? "active-col" : ""} ${isCelSelected ? "draw-cel-selected" : ""}`}
                      title={`${layer.name} · Frame ${frame.index + 1}${isLinked ? " (Linked)" : ""} (Shift+Click to select range)`}
                      onClick={(e) => {
                        if (e.shiftKey) {
                          const anchor = celAnchor ?? {
                            layerId: activeLayerId,
                            frame: currentFrame,
                          };
                          const anchorLayerIdx = layers.findIndex(
                            (l) => l.id === anchor.layerId
                          );
                          const loLayer =
                            anchorLayerIdx >= 0
                              ? Math.min(anchorLayerIdx, layerIdx)
                              : layerIdx;
                          const hiLayer =
                            anchorLayerIdx >= 0
                              ? Math.max(anchorLayerIdx, layerIdx)
                              : layerIdx;
                          const loFrame = Math.min(anchor.frame, frame.index);
                          const hiFrame = Math.max(anchor.frame, frame.index);
                          const range: Array<{ layerId: string; frame: number }> =
                            [];
                          for (let li = loLayer; li <= hiLayer; li++) {
                            const rowLayer = layers[li];
                            if (!rowLayer || rowLayer.kind === "group") continue;
                            for (let fi = loFrame; fi <= hiFrame; fi++) {
                              range.push({ layerId: rowLayer.id, frame: fi });
                            }
                          }
                          setSelectedCels(range);
                        } else {
                          setCelAnchor({
                            layerId: layer.id,
                            frame: frame.index,
                          });
                          if (selectedCels.length > 0) {
                            clearSelectedCels();
                          }
                        }
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
                          {timelineShowThumbs && layer.kind === "raster" ? (
                            hasCel || isLinked ? (
                              <CelThumbnail
                                layerId={layer.id}
                                frameIndex={frame.index}
                                width={canvasWidth}
                                height={canvasHeight}
                              />
                            ) : (
                              <span className="cel-dot empty" />
                            )
                          ) : (
                            <span
                              className={`cel-dot ${isLinked ? "linked" : hasCel ? "" : "empty"}`}
                            />
                          )}
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
