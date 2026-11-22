import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, X } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { commitFloatingSelection } from "../../engine/document/selectionActions";
import { syncTimelineCels } from "../../engine/document/timelineActions";
import { isTauriRuntime } from "../../engine/io/projectBridge";
import { bakeRigClips } from "../../engine/rig/export/bake";
import { exportRigToGodot } from "../../engine/rig/export/godot";
import { exportRigToSpine } from "../../engine/rig/export/spine";
import { useEditorStore } from "../../store/editorStore";

type RigExportFormat = "pixet" | "spine" | "godot" | "bake";

interface ExportFilePayload {
  name: string;
  text?: string;
  base64?: string;
}

function celToPngBase64(layerId: string, frame: number): string | null {
  const cel = pixelEngine.getCel(layerId, frame);
  if (!cel || cel.isEmpty()) return null;
  const canvas = document.createElement("canvas");
  canvas.width = cel.width;
  canvas.height = cel.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(cel.data), cel.width, cel.height),
    0,
    0
  );
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.split(",")[1] ?? null;
}

function downloadBrowserFiles(files: ExportFilePayload[]) {
  for (const file of files) {
    let blob: Blob;
    if (file.text !== undefined) {
      blob = new Blob([file.text], { type: "text/plain;charset=utf-8" });
    } else if (file.base64 !== undefined) {
      const bin = atob(file.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: "image/png" });
    } else {
      continue;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

export function RigExportModal() {
  const openFlag = useEditorStore((s) => s.rigExportModalOpen);
  const setOpenFlag = useEditorStore((s) => s.setRigExportModalOpen);
  const documentName = useEditorStore((s) => s.documentName);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const fps = useEditorStore((s) => s.fps);
  const layers = useEditorStore((s) => s.layers);
  const rigPixelSnap = useEditorStore((s) => s.rigPixelSnap);
  const rigRotSprite = useEditorStore((s) => s.rigRotSprite);
  const rigCleanupOrphans = useEditorStore((s) => s.rigCleanupOrphans);
  const rigCleanupHoles = useEditorStore((s) => s.rigCleanupHoles);
  const rigCleanupPaletteLock = useEditorStore((s) => s.rigCleanupPaletteLock);
  const rigCleanupOutline = useEditorStore((s) => s.rigCleanupOutline);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const [format, setFormat] = useState<RigExportFormat>("spine");
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [bakePixelSnap, setBakePixelSnap] = useState(rigPixelSnap);
  const [bakeCleanup, setBakeCleanup] = useState(true);
  const [bakeOnionOff, setBakeOnionOff] = useState(true);
  const [bakeAppend, setBakeAppend] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const rig = pixelEngine.rig;
  const baseName = documentName.replace(/\.pixet$/i, "") || "character";

  useEffect(() => {
    if (openFlag) {
      setSelectedClipIds(rig.clips.map((c) => c.id));
      setBakePixelSnap(rigPixelSnap);
      setWarnings([]);
    }
  }, [openFlag, rig.clips, rigPixelSnap]);

  useEffect(() => {
    if (!openFlag) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenFlag(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openFlag, setOpenFlag]);

  if (!openFlag) return null;

  const toggleClip = (id: string) => {
    setSelectedClipIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (format === "bake") {
        if (rig.bones.length === 0) {
          setStatusMessage("Add or seed bones before baking");
          return;
        }
        commitFloatingSelection();
        const state = useEditorStore.getState();
        const cleanup = bakeCleanup
          ? {
              removeOrphans: rigCleanupOrphans,
              fillHoles: rigCleanupHoles,
              paletteLock: rigCleanupPaletteLock,
              preserveOutline: rigCleanupOutline,
            }
          : undefined;
        const result = bakeRigClips(
          pixelEngine,
          state.layers.slice(),
          selectedClipIds,
          {
            pixelSnap: bakePixelSnap,
            rotSprite: rigRotSprite,
            mode: "pose",
            cleanup,
          }
        );

        const startOffset = bakeAppend ? state.frames.length : 0;
        const neededFrames = startOffset + result.frames.length;
        const addedFrames = neededFrames > state.frames.length;
        while (useEditorStore.getState().frames.length < neededFrames) {
          const count = useEditorStore.getState().frames.length;
          pixelEngine.insertEmptyFrame(count, count);
          useEditorStore.getState().insertFrameMetadata(count);
        }

        const layerId = state.addNamedLayer("Baked Rig");
        for (let i = 0; i < result.frames.length; i++) {
          const cel = pixelEngine.getOrCreateCel(layerId, startOffset + i);
          cel.data.set(result.frames[i]);
          cel.markAllDirty();
        }
        for (const tag of result.tags) {
          useEditorStore
            .getState()
            .addTag(
              tag.name,
              startOffset + tag.fromFrame,
              startOffset + tag.toFrame,
              tag.color
            );
        }
        if (bakeOnionOff && useEditorStore.getState().onionSkin) {
          useEditorStore.getState().toggleOnionSkin();
        }
        if (addedFrames) {
          pixelEngine.history.clear();
          useEditorStore.getState().setHistoryFlags(false, false);
        }
        syncTimelineCels();
        useEditorStore.getState().setCurrentFrame(startOffset);
        pixelEngine.emitChange();
        setStatusMessage(
          `Baked ${result.frames.length} frames across ${result.tags.length} clip(s)`
        );
        setOpenFlag(false);
        return;
      }

      const files: ExportFilePayload[] = [];
      let nextWarnings: string[] = [];

      if (format === "pixet") {
        files.push({
          name: `${baseName}.rig.json`,
          text: rig.serializeRuntimeJson(canvasWidth, canvasHeight),
        });
      } else if (format === "spine") {
        const layerNames = new Map(layers.map((l) => [l.id, l.name]));
        const res = exportRigToSpine(
          rig,
          canvasWidth,
          canvasHeight,
          fps,
          layerNames
        );
        nextWarnings = res.warnings;
        files.push({ name: `${baseName}.spine.json`, text: res.json });
        if (res.atlas.trim().length > 0) {
          files.push({ name: `${baseName}.atlas`, text: res.atlas });
        }
        for (const reg of res.regions) {
          const b64 = celToPngBase64(reg.layerId, reg.frame);
          if (b64) files.push({ name: `${reg.name}.png`, base64: b64 });
        }
      } else if (format === "godot") {
        const res = exportRigToGodot(
          rig,
          baseName,
          canvasWidth,
          canvasHeight,
          fps
        );
        nextWarnings = res.warnings;
        files.push({ name: `${baseName}.tscn`, text: res.tscn });
        for (const sp of res.sprites) {
          const b64 = celToPngBase64(sp.layerId, sp.frame);
          if (b64) files.push({ name: sp.filename, base64: b64 });
        }
      }

      setWarnings(nextWarnings);

      if (isTauriRuntime()) {
        const selectedDir = await open({
          directory: true,
          multiple: false,
          title: "Choose Rig Export Directory",
        });
        if (!selectedDir || Array.isArray(selectedDir)) return;
        const written = await invoke<number>("write_text_and_pngs", {
          outDir: selectedDir,
          files,
        });
        setStatusMessage(`Exported ${written} rig file(s) to ${selectedDir}`);
      } else {
        downloadBrowserFiles(files);
        setStatusMessage(`Downloaded ${files.length} rig export file(s)`);
      }

      if (nextWarnings.length === 0) {
        setOpenFlag(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpenFlag(false)}>
      <div
        className="modal-dialog"
        style={{ width: 380 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>Export Rig</span>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => setOpenFlag(false)}
          >
            <X size={13} />
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="modal-field">
            <span className="modal-label">Format</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {(
                [
                  { id: "pixet", label: "Pixet JSON (v2)" },
                  { id: "spine", label: "Spine 4.x JSON" },
                  { id: "godot", label: "Godot 4 (.tscn)" },
                  { id: "bake", label: "Bake to Frames" },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.id}
                  className="modal-checkbox"
                  style={{ fontSize: 11 }}
                >
                  <input
                    type="radio"
                    name="rigExportFormat"
                    checked={format === opt.id}
                    onChange={() => setFormat(opt.id)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {format === "bake" && (
            <>
              <div className="modal-field">
                <span className="modal-label">Clips to Bake</span>
                <div
                  className="rig-bone-list"
                  style={{ maxHeight: 96, padding: 4 }}
                >
                  {rig.clips.map((clip) => (
                    <label
                      key={clip.id}
                      className="modal-checkbox"
                      style={{ fontSize: 11 }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedClipIds.includes(clip.id)}
                        onChange={() => toggleClip(clip.id)}
                      />
                      <span>
                        {clip.name} ({clip.frameCount}f)
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                }}
              >
                <label className="modal-checkbox" style={{ fontSize: 11 }}>
                  <input
                    type="checkbox"
                    checked={bakePixelSnap}
                    onChange={(e) => setBakePixelSnap(e.target.checked)}
                  />
                  <span>Pixel-Snap</span>
                </label>
                <label className="modal-checkbox" style={{ fontSize: 11 }}>
                  <input
                    type="checkbox"
                    checked={bakeCleanup}
                    onChange={(e) => setBakeCleanup(e.target.checked)}
                  />
                  <span>Cleanup Pass</span>
                </label>
                <label className="modal-checkbox" style={{ fontSize: 11 }}>
                  <input
                    type="checkbox"
                    checked={bakeOnionOff}
                    onChange={(e) => setBakeOnionOff(e.target.checked)}
                  />
                  <span>Onion Off</span>
                </label>
                <label className="modal-checkbox" style={{ fontSize: 11 }}>
                  <input
                    type="checkbox"
                    checked={bakeAppend}
                    onChange={(e) => setBakeAppend(e.target.checked)}
                  />
                  <span>Append Frames</span>
                </label>
              </div>
            </>
          )}

          {warnings.length > 0 && (
            <div
              style={{
                padding: 6,
                border: "1px solid #eab308",
                background: "var(--bg-root)",
                color: "#eab308",
                fontSize: 11,
              }}
            >
              {warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}

          <div className="modal-footer">
            <button
              type="button"
              className="mini-btn"
              onClick={() => setOpenFlag(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="mini-btn active"
              disabled={busy || (format === "bake" && selectedClipIds.length === 0)}
            >
              <Download size={12} />
              <span>{format === "bake" ? "Bake Clips" : "Export Rig"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
