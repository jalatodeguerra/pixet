import { pixelEngine } from "../../engine/document/PixelEngine";
import { useEditorStore } from "../../store/editorStore";
import { PALETTE_PRESETS } from "../../utils/paletteParser";

/**
 * Composite the current frame (rig pose, 2D lighting, palette LUT included)
 * into `canvas`, and optionally mirror it into `canvas2x`. Shared by the
 * floating preview window and the embedded Preview area editor.
 */
export function drawPreviewComposite(
  canvas: HTMLCanvasElement | null,
  canvas2x?: HTMLCanvasElement | null
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const state = useEditorStore.getState();
  const targetPalette =
    PALETTE_PRESETS.find((p) => p.name === state.paletteLutPresetName)?.colors ?? [];
  const composite = pixelEngine.compositeFrameWithShaderPreview(
    state.layers,
    state.currentFrame,
    {
      useRig: state.workspaceMode === "rig",
      rigOpts: {
        pixelSnap: state.rigPixelSnap,
        rotSprite: state.rigRotSprite,
        mode: state.rigMode === "setup" ? "rest" : "pose",
        cleanup: {
          removeOrphans: state.rigCleanupOrphans,
          fillHoles: state.rigCleanupHoles,
          paletteLock: state.rigCleanupPaletteLock,
          preserveOutline: state.rigCleanupOutline,
        },
      },
      light2d: {
        enabled: state.light2dEnabled,
        lightX: state.light2dX,
        lightY: state.light2dY,
        lightZ: state.light2dZ,
        lightColor: state.light2dColor,
        intensity: state.light2dIntensity,
        ambient: state.light2dAmbient,
        emissionStrength: state.light2dEmission,
      },
      paletteLut: {
        enabled: state.paletteLutEnabled,
        sourcePalette: state.palette,
        targetPalette,
      },
    }
  );

  const img = new ImageData(
    new Uint8ClampedArray(composite),
    pixelEngine.width,
    pixelEngine.height
  );
  ctx.putImageData(img, 0, 0);

  if (canvas2x) {
    const ctx2 = canvas2x.getContext("2d");
    if (ctx2) ctx2.putImageData(img, 0, 0);
  }
}

/** Store values that should trigger a preview redraw. */
export function usePreviewRedrawKey(): unknown[] {
  const s = useEditorStore;
  return [
    s((x) => x.canvasWidth),
    s((x) => x.canvasHeight),
    s((x) => x.currentFrame),
    s((x) => x.layers),
    s((x) => x.workspaceMode),
    s((x) => x.rigVersion),
    s((x) => x.rigMode),
    s((x) => x.rigPixelSnap),
    s((x) => x.rigRotSprite),
    s((x) => x.rigCleanupOrphans),
    s((x) => x.rigCleanupHoles),
    s((x) => x.rigCleanupPaletteLock),
    s((x) => x.rigCleanupOutline),
    s((x) => x.light2dEnabled),
    s((x) => x.light2dX),
    s((x) => x.light2dY),
    s((x) => x.light2dZ),
    s((x) => x.light2dColor),
    s((x) => x.light2dIntensity),
    s((x) => x.light2dAmbient),
    s((x) => x.light2dEmission),
    s((x) => x.paletteLutEnabled),
    s((x) => x.paletteLutPresetName),
    s((x) => x.palette),
  ];
}
