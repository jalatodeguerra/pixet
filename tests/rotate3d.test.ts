import test from "node:test";
import assert from "node:assert/strict";

import { PixelBuffer, type RGBA } from "../src/engine/document/PixelBuffer.ts";
import {
  collectPalette,
  packRgba,
} from "../src/engine/rig/pixelCleanup.ts";
import {
  mat3ExtractEulerDeg,
  mat3FacingZ,
  mat3FromEulerDeg,
  mat3Identity,
  mat3Mul,
  mat3MulVec,
  mat3Transpose,
  mat3TransposeMulVec,
  normalizeDeg180,
  type Mat3,
} from "../src/engine/tools/math3d.ts";
import {
  ROTATE3D_CAMERA_PRESETS,
  TURNTABLE_PRESETS,
  bakeTurntableFrames,
  computeTurntableAngleOffset,
  render25DSprite,
  renderSpriteStack,
  type Rotate25DOptions,
  type SpriteStackOptions,
  type TurntableEasing,
} from "../src/engine/tools/rotate3d.ts";
import {
  buildFloorShadowEllipse,
  buildSceneGridLines,
  buildTurntableRing,
  projectScenePoint,
  type Scene3DCamera,
} from "../src/engine/tools/scene3d.ts";

function assertClose(actual: number, expected: number, eps = 1e-5): void {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} to be within ${eps} of ${expected}`
  );
}

function assertMat3Close(actual: Mat3, expected: Mat3, eps = 1e-5): void {
  for (let i = 0; i < 9; i++) {
    assertClose(actual[i], expected[i], eps);
  }
}

function baseOpts(overrides: Partial<Rotate25DOptions> = {}): Rotate25DOptions {
  return {
    pitchDeg: 0,
    yawDeg: 0,
    rollDeg: 0,
    extrudeDepth: 0,
    perspective: 0,
    shadeDepth: false,
    supersample: false,
    outlineColor: null,
    ...overrides,
  };
}

function countOpaque(buf: PixelBuffer): number {
  let n = 0;
  for (let i = 3; i < buf.data.length; i += 4) {
    if (buf.data[i] > 0) n++;
  }
  return n;
}

function countOpaqueInRow(buf: PixelBuffer, y: number): number {
  let n = 0;
  for (let x = 0; x < buf.width; x++) {
    if (buf.getPixel(x, y)[3] > 0) n++;
  }
  return n;
}

test("math3d: identity, normalizeDeg180, transpose inverse, composition, and facingZ", () => {
  const I = mat3Identity();
  assert.deepEqual(I, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assertClose(mat3FacingZ(I), 1);

  assert.equal(normalizeDeg180(0), 0);
  assert.equal(normalizeDeg180(-0), 0);
  assert.equal(normalizeDeg180(180), 180);
  assert.equal(normalizeDeg180(-180), 180);
  assert.equal(normalizeDeg180(270), -90);
  assert.equal(normalizeDeg180(-450), -90);

  const R = mat3FromEulerDeg(37, -22, 53);
  const Rt = mat3Transpose(R);
  assertMat3Close(mat3Mul(R, Rt), I);
  assertMat3Close(mat3Mul(Rt, R), I);

  const v: [number, number, number] = [3.5, -2.25, 1.75];
  const rv = mat3MulVec(R, v[0], v[1], v[2]);
  const back = mat3TransposeMulVec(R, rv[0], rv[1], rv[2]);
  assertClose(back[0], v[0]);
  assertClose(back[1], v[1]);
  assertClose(back[2], v[2]);

  // Composition: R(yaw, pitch, roll) === Rz(roll) * Rx(pitch) * Ry(yaw)
  const Ry = mat3FromEulerDeg(37, 0, 0);
  const Rx = mat3FromEulerDeg(0, -22, 0);
  const Rz = mat3FromEulerDeg(0, 0, 53);
  assertMat3Close(R, mat3Mul(Rz, mat3Mul(Rx, Ry)));

  // facingZ at 0°, 90°, 180° yaw
  assertClose(mat3FacingZ(mat3FromEulerDeg(0, 0, 0)), 1);
  assertClose(mat3FacingZ(mat3FromEulerDeg(90, 0, 0)), 0);
  assertClose(mat3FacingZ(mat3FromEulerDeg(180, 0, 0)), -1);
});

test("math3d: Euler round-trip including gimbal lock near pitch ±90°", () => {
  const cases: Array<[number, number, number]> = [
    [0, 0, 0],
    [45, 25, -30],
    [-120, -40, 85],
    [170, 10, -160],
    [30, 90, 40],
    [-25, -90, 65],
  ];

  for (const [yaw, pitch, roll] of cases) {
    const M = mat3FromEulerDeg(yaw, pitch, roll);
    const extracted = mat3ExtractEulerDeg(M);
    const M2 = mat3FromEulerDeg(
      extracted.yawDeg,
      extracted.pitchDeg,
      extracted.rollDeg
    );
    assertMat3Close(M2, M, 1e-4);
  }
});

test("render25DSprite: pivotX/pivotY keeps anchored base pixel fixed under rotation", () => {
  const src = new PixelBuffer(17, 17);
  // Vertical pillar from y=4..14 at x=8
  for (let y = 4; y <= 14; y++) {
    src.setPixel(8, y, 220, 180, 60, 255);
  }
  // Distinct color on base pixel (8, 14)
  src.setPixel(8, 14, 255, 0, 0, 255);

  const rotated = render25DSprite(
    src,
    baseOpts({
      rollDeg: 90,
      pivotX: 8,
      pivotY: 14,
    })
  );

  // Base pixel at pivot (8, 14) stays red
  assert.deepEqual(rotated.getPixel(8, 14), [255, 0, 0, 255]);
  // Top of pillar (was at y=4, 10px above pivot) rotates +90° (clockwise in Y-down -> left to x=18 or right?)
  // With Rz(+90): [0, -10] -> [+10, 0], wait: [0*0 - 1*(-10), 1*0 + 0*(-10)] = [+10, 0] -> right!
  // Check at least some pixels extended horizontally on row y=14
  assert.ok(countOpaqueInRow(rotated, 14) >= 6);
  // Original top at (8, 4) is now empty
  assert.equal(rotated.getPixel(8, 4)[3], 0);
});

test("render25DSprite: depthProfile bevel & pillow taper edges relative to center", () => {
  const src = new PixelBuffer(20, 20);
  for (let y = 5; y <= 14; y++) {
    for (let x = 5; x <= 14; x++) {
      src.setPixel(x, y, 180, 180, 200, 255);
    }
  }

  const slab = render25DSprite(
    src,
    baseOpts({
      yawDeg: 70,
      extrudeDepth: 8,
      depthProfile: "slab",
    })
  );
  const bevel = render25DSprite(
    src,
    baseOpts({
      yawDeg: 70,
      extrudeDepth: 8,
      depthProfile: "bevel",
    })
  );
  const pillow = render25DSprite(
    src,
    baseOpts({
      yawDeg: 70,
      extrudeDepth: 8,
      depthProfile: "pillow",
    })
  );

  // Both bevel and pillow should have strictly fewer opaque pixels than a full slab
  assert.ok(countOpaque(bevel) < countOpaque(slab));
  assert.ok(countOpaque(pillow) < countOpaque(slab));

  // Center row (y=9) should be wider than top edge row (y=5) for both bevel and pillow
  assert.ok(countOpaqueInRow(bevel, 9) > countOpaqueInRow(bevel, 5));
  assert.ok(countOpaqueInRow(pillow, 9) > countOpaqueInRow(pillow, 5));
});

test("render25DSprite: depthProfile heightmap respects pixel luminance", () => {
  const src = new PixelBuffer(20, 20);
  const hm = new PixelBuffer(20, 20);
  // Top block (y=4..7) has white heightmap (max depth), bottom block (y=12..15) has dark heightmap (near-zero depth)
  for (let x = 7; x <= 12; x++) {
    for (let y = 4; y <= 7; y++) {
      src.setPixel(x, y, 200, 100, 100, 255);
      hm.setPixel(x, y, 255, 255, 255, 255);
    }
    for (let y = 12; y <= 15; y++) {
      src.setPixel(x, y, 200, 100, 100, 255);
      hm.setPixel(x, y, 10, 10, 10, 255);
    }
  }

  const rendered = render25DSprite(
    src,
    baseOpts({
      yawDeg: 55,
      extrudeDepth: 8,
      depthProfile: "heightmap",
      heightMap: hm,
    })
  );

  let topCount = 0;
  let bottomCount = 0;
  for (let y = 4; y <= 7; y++) topCount += countOpaqueInRow(rendered, y);
  for (let y = 12; y <= 15; y++) bottomCount += countOpaqueInRow(rendered, y);

  assert.ok(
    topCount > bottomCount,
    `expected bright heightmap region (${topCount}) to extrude wider than dark region (${bottomCount})`
  );
});

test("render25DSprite: directionalLighting shades lit side brighter and rimStrength brightens grazing angles", () => {
  const src = new PixelBuffer(20, 20);
  for (let y = 4; y <= 15; y++) {
    for (let x = 4; x <= 15; x++) {
      src.setPixel(x, y, 200, 200, 200, 255);
    }
  }

  const avgLuma = (
    buf: PixelBuffer,
    x0: number,
    x1: number,
    y0: number,
    y1: number
  ): number => {
    let sum = 0;
    let count = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [r, g, b, a] = buf.getPixel(x, y);
        if (a > 0) {
          sum += (r + g + b) / 3;
          count++;
        }
      }
    }
    return count > 0 ? sum / count : 0;
  };

  // Pillow lit from left (lightAzimuthDeg = -60, lightElevationDeg = 0)
  const leftLit = render25DSprite(
    src,
    baseOpts({
      extrudeDepth: 6,
      depthProfile: "pillow",
      directionalLighting: true,
      lightAzimuthDeg: -60,
      lightElevationDeg: 0,
      ambient: 0.3,
    })
  );

  const leftHalf = avgLuma(leftLit, 4, 8, 4, 15);
  const rightHalf = avgLuma(leftLit, 11, 15, 4, 15);
  assert.ok(
    leftHalf > rightHalf + 10,
    `expected left half (${leftHalf}) brighter than right half (${rightHalf})`
  );

  // Rim highlight on a rotated surface (grazing angle)
  const noRim = render25DSprite(
    src,
    baseOpts({
      yawDeg: 60,
      extrudeDepth: 0,
      directionalLighting: true,
      lightAzimuthDeg: 0,
      lightElevationDeg: 0,
      ambient: 0.3,
      rimStrength: 0,
    })
  );
  const withRim = render25DSprite(
    src,
    baseOpts({
      yawDeg: 60,
      extrudeDepth: 0,
      directionalLighting: true,
      lightAzimuthDeg: 0,
      lightElevationDeg: 0,
      ambient: 0.3,
      rimStrength: 0.8,
    })
  );

  const lumaNoRim = avgLuma(noRim, 0, 19, 0, 19);
  const lumaWithRim = avgLuma(withRim, 0, 19, 0, 19);
  assert.ok(
    lumaWithRim > lumaNoRim + 10,
    `expected rim highlight (${lumaWithRim}) to brighten grazing surface (${lumaNoRim})`
  );
});

test("render25DSprite: backSource and mirrorBack render correctly at 180° yaw", () => {
  const front = new PixelBuffer(12, 12);
  const back = new PixelBuffer(12, 12);
  for (let y = 3; y <= 8; y++) {
    for (let x = 3; x <= 8; x++) {
      front.setPixel(x, y, 220, 40, 40, 255); // Red front
      back.setPixel(x, y, 40, 80, 230, 255); // Blue back
    }
  }
  // Put a green marker on the left side of the back texture (x=3)
  back.setPixel(3, 6, 40, 220, 40, 255);

  // Flat card (extrudeDepth = 0) at 180° yaw
  const flatBack = render25DSprite(
    front,
    baseOpts({
      yawDeg: 180,
      extrudeDepth: 0,
      backSource: back,
    })
  );
  assert.deepEqual(flatBack.getPixel(6, 6), [40, 80, 230, 255]);
  // Left marker of backSource should still appear on the left when viewed from behind
  assert.deepEqual(flatBack.getPixel(3, 6), [40, 220, 40, 255]);

  // Extruded sprite (extrudeDepth = 6) at 180° yaw
  const extrudedBack = render25DSprite(
    front,
    baseOpts({
      yawDeg: 180,
      extrudeDepth: 6,
      backSource: back,
    })
  );
  assert.deepEqual(extrudedBack.getPixel(6, 6), [40, 80, 230, 255]);
  assert.deepEqual(extrudedBack.getPixel(3, 6), [40, 220, 40, 255]);

  // mirrorBack with no backSource: left-only marker on front stays on left when mirrored at 180°
  const asymFront = new PixelBuffer(12, 12);
  asymFront.setPixel(3, 6, 250, 220, 50, 255);
  const unmirrored = render25DSprite(
    asymFront,
    baseOpts({
      yawDeg: 180,
      mirrorBack: false,
    })
  );
  const mirrored = render25DSprite(
    asymFront,
    baseOpts({
      yawDeg: 180,
      mirrorBack: true,
    })
  );
  // Without mirrorBack, x=3 flips to x=8 at 180° yaw
  assert.deepEqual(unmirrored.getPixel(8, 6), [250, 220, 50, 255]);
  assert.equal(unmirrored.getPixel(3, 6)[3], 0);
  // With mirrorBack, back face mirrors horizontally so it appears back at x=3
  assert.deepEqual(mirrored.getPixel(3, 6), [250, 220, 50, 255]);
  assert.equal(mirrored.getPixel(8, 6)[3], 0);
});

test("render25DSprite: autoFitBounds prevents corner clipping on 45° rotated full-canvas square", () => {
  const src = new PixelBuffer(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      src.setPixel(x, y, 160, 160, 160, 255);
    }
  }
  // Mark all 4 corners with bright green
  const cornerColor: RGBA = [0, 255, 0, 255];
  src.setPixel(0, 0, ...cornerColor);
  src.setPixel(15, 0, ...cornerColor);
  src.setPixel(0, 15, ...cornerColor);
  src.setPixel(15, 15, ...cornerColor);

  const clipped = render25DSprite(
    src,
    baseOpts({
      rollDeg: 45,
      autoFitBounds: false,
    })
  );
  const fitted = render25DSprite(
    src,
    baseOpts({
      rollDeg: 45,
      autoFitBounds: true,
    })
  );

  // Count how many green corner pixels survived inside the canvas
  const countGreen = (buf: PixelBuffer): number => {
    let n = 0;
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        const [r, g, b, a] = buf.getPixel(x, y);
        if (a === 255 && r === 0 && g === 255 && b === 0) n++;
      }
    }
    return n;
  };

  // Without autoFitBounds, all 4 corners are clipped outside the 16x16 canvas
  assert.equal(countGreen(clipped), 0);
  // With autoFitBounds, corners fit inside the canvas without clipping
  assert.ok(
    countGreen(fitted) >= 2,
    `expected fitted 45° square to preserve corner pixels, got ${countGreen(fitted)}`
  );
  // Top row of fitted 45° diamond should be narrow (tip of diamond), not flat-clipped
  assert.ok(countOpaqueInRow(fitted, 0) < countOpaqueInRow(clipped, 0));
});

test("render25DSprite: preScaleEPX and cleanup paletteLock keep all colors strictly within source palette", () => {
  const src = new PixelBuffer(16, 16);
  for (let y = 4; y <= 11; y++) {
    for (let x = 4; x <= 11; x++) {
      if (x < 8) {
        src.setPixel(x, y, 220, 60, 40, 255);
      } else {
        src.setPixel(x, y, 40, 160, 220, 255);
      }
    }
  }

  const rendered = render25DSprite(
    src,
    baseOpts({
      yawDeg: 30,
      pitchDeg: 20,
      rollDeg: 15,
      extrudeDepth: 4,
      shadeDepth: true,
      directionalLighting: true,
      rimStrength: 0.4,
      preScaleEPX: true,
      cleanup: {
        removeOrphans: true,
        fillHoles: true,
        paletteLock: true,
        preserveOutline: false,
      },
    })
  );

  assert.ok(countOpaque(rendered) > 0);

  const allowed = new Set(
    collectPalette(src).map((c) => packRgba(c[0], c[1], c[2], c[3]))
  );
  const outPalette = collectPalette(rendered);
  for (const c of outPalette) {
    assert.ok(
      allowed.has(packRgba(c[0], c[1], c[2], c[3])),
      `unexpected color [${c.join(",")}] outside source palette`
    );
  }
});

function baseStackOpts(
  overrides: Partial<SpriteStackOptions> = {}
): SpriteStackOptions {
  return {
    yawDeg: 0,
    pitchDeg: 45,
    sliceSpacing: 2,
    depthShading: false,
    outlineColor: null,
    ...overrides,
  };
}

test("renderSpriteStack: rollDeg rotates stack around screen center", () => {
  const bottom = new PixelBuffer(21, 21);
  const top = new PixelBuffer(21, 21);
  for (let y = 9; y <= 11; y++) {
    for (let x = 9; x <= 11; x++) {
      bottom.setPixel(x, y, 220, 40, 40, 255); // Red
      top.setPixel(x, y, 40, 80, 230, 255); // Blue
    }
  }

  const upright = renderSpriteStack(
    [bottom, top],
    baseStackOpts({ pitchDeg: 60, sliceSpacing: 4, rollDeg: 0 })
  );
  const rolled = renderSpriteStack(
    [bottom, top],
    baseStackOpts({ pitchDeg: 60, sliceSpacing: 4, rollDeg: 90 })
  );

  const findColorCenter = (
    buf: PixelBuffer,
    pred: (p: RGBA) => boolean
  ): { x: number; y: number } => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        const p = buf.getPixel(x, y);
        if (p[3] > 0 && pred(p)) {
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    assert.ok(n > 0, "expected matching pixels");
    return { x: sx / n, y: sy / n };
  };

  const uprightRed = findColorCenter(upright, (p) => p[0] > 150);
  const uprightBlue = findColorCenter(upright, (p) => p[2] > 150);
  assert.ok(uprightBlue.y < uprightRed.y - 1);
  assertClose(uprightBlue.x, uprightRed.x, 0.5);

  // With rollDeg = +90°, vertical stack lift (-Y) rotates to +X (blue to the right of red)
  const rolledRed = findColorCenter(rolled, (p) => p[0] > 150);
  const rolledBlue = findColorCenter(rolled, (p) => p[2] > 150);
  assert.ok(
    rolledBlue.x > rolledRed.x + 1,
    `expected rolled blue x (${rolledBlue.x}) > red x (${rolledRed.x})`
  );
  assertClose(rolledBlue.y, rolledRed.y, 0.5);
});

test("renderSpriteStack: perspective scales upper slices larger than lower slices", () => {
  const makeBar = (r: number, g: number, b: number) => {
    const buf = new PixelBuffer(25, 25);
    for (let x = 7; x <= 17; x++) {
      buf.setPixel(x, 12, r, g, b, 255);
    }
    return buf;
  };

  const bottom = makeBar(220, 40, 40);
  const mid1 = new PixelBuffer(25, 25);
  const mid2 = new PixelBuffer(25, 25);
  const top = makeBar(40, 80, 220);

  const rendered = renderSpriteStack(
    [bottom, mid1, mid2, top],
    baseStackOpts({
      pitchDeg: 55,
      sliceSpacing: 3,
      perspective: 0.85,
    })
  );

  const spanX = (pred: (p: RGBA) => boolean): number => {
    let minX = 25;
    let maxX = -1;
    for (let y = 0; y < 25; y++) {
      for (let x = 0; x < 25; x++) {
        const p = rendered.getPixel(x, y);
        if (p[3] > 0 && pred(p)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    return maxX >= minX ? maxX - minX + 1 : 0;
  };

  const redSpan = spanX((p) => p[0] > 150);
  const blueSpan = spanX((p) => p[2] > 150);
  assert.ok(
    blueSpan > redSpan,
    `expected upper slice span (${blueSpan}) > lower slice span (${redSpan})`
  );
});

test("renderSpriteStack: reverseOrder flips bottom and top slices", () => {
  const bottom = new PixelBuffer(16, 16);
  const top = new PixelBuffer(16, 16);
  bottom.setPixel(8, 8, 220, 40, 40, 255); // Red
  top.setPixel(8, 8, 40, 80, 220, 255); // Blue

  const normal = renderSpriteStack(
    [bottom, top],
    baseStackOpts({ pitchDeg: 55, sliceSpacing: 3, reverseOrder: false })
  );
  const reversed = renderSpriteStack(
    [bottom, top],
    baseStackOpts({ pitchDeg: 55, sliceSpacing: 3, reverseOrder: true })
  );

  const minYFor = (buf: PixelBuffer, pred: (p: RGBA) => boolean): number => {
    let minY = buf.height;
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        const p = buf.getPixel(x, y);
        if (p[3] > 0 && pred(p) && y < minY) minY = y;
      }
    }
    return minY;
  };

  assert.ok(
    minYFor(normal, (p) => p[2] > 150) < minYFor(normal, (p) => p[0] > 150)
  );
  assert.ok(
    minYFor(reversed, (p) => p[0] > 150) < minYFor(reversed, (p) => p[2] > 150)
  );
});

test("renderSpriteStack: directionalLighting shades lit side brighter than shadowed side", () => {
  const slices: PixelBuffer[] = [];
  for (let s = 0; s < 6; s++) {
    const buf = new PixelBuffer(24, 24);
    for (let y = 7; y <= 16; y++) {
      for (let x = 7; x <= 16; x++) {
        buf.setPixel(x, y, 200, 200, 200, 255);
      }
    }
    slices.push(buf);
  }

  // Yaw 45° exposes left-front and right-front extruded faces cleanly
  const litLeft = renderSpriteStack(
    slices,
    baseStackOpts({
      yawDeg: 45,
      pitchDeg: 55,
      sliceSpacing: 1.5,
      directionalLighting: true,
      lightAzimuthDeg: -70,
      lightElevationDeg: 10,
      ambient: 0.3,
    })
  );

  const avgLumaCols = (x0: number, x1: number): number => {
    let sum = 0;
    let count = 0;
    for (let y = 12; y < 24; y++) {
      for (let x = x0; x <= x1; x++) {
        const [r, g, b, a] = litLeft.getPixel(x, y);
        if (a > 0) {
          sum += (r + g + b) / 3;
          count++;
        }
      }
    }
    return count > 0 ? sum / count : 0;
  };

  const leftSide = avgLumaCols(4, 10);
  const rightSide = avgLumaCols(13, 19);
  assert.ok(
    leftSide > rightSide + 15,
    `expected left side (${leftSide}) brighter than right side (${rightSide})`
  );
});

test("renderSpriteStack: sliceThickness increases vertical extrusion coverage", () => {
  const slice = new PixelBuffer(16, 16);
  slice.setPixel(8, 8, 180, 200, 220, 255);

  const thin = renderSpriteStack(
    [slice, slice],
    baseStackOpts({
      pitchDeg: 60,
      sliceSpacing: 1.5,
      sliceThickness: 0.5,
    })
  );
  const thick = renderSpriteStack(
    [slice, slice],
    baseStackOpts({
      pitchDeg: 60,
      sliceSpacing: 1.5,
      sliceThickness: 3,
    })
  );

  assert.ok(
    countOpaque(thick) > countOpaque(thin),
    `expected thick stack (${countOpaque(thick)}) > thin stack (${countOpaque(thin)})`
  );
});

test("renderSpriteStack: autoFitBounds prevents clipping on 45° rolled full-canvas stack", () => {
  const slice = new PixelBuffer(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      slice.setPixel(x, y, 160, 160, 160, 255);
    }
  }
  const corner: RGBA = [0, 255, 0, 255];
  slice.setPixel(0, 0, ...corner);
  slice.setPixel(15, 0, ...corner);
  slice.setPixel(0, 15, ...corner);
  slice.setPixel(15, 15, ...corner);

  const clipped = renderSpriteStack(
    [slice, slice],
    baseStackOpts({ pitchDeg: 0, rollDeg: 45, autoFitBounds: false })
  );
  const fitted = renderSpriteStack(
    [slice, slice],
    baseStackOpts({ pitchDeg: 0, rollDeg: 45, autoFitBounds: true })
  );

  const countGreen = (buf: PixelBuffer): number => {
    let n = 0;
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        const [r, g, b, a] = buf.getPixel(x, y);
        if (a === 255 && r === 0 && g === 255 && b === 0) n++;
      }
    }
    return n;
  };

  assert.equal(countGreen(clipped), 0);
  assert.ok(
    countGreen(fitted) >= 2,
    `expected autoFitBounds to preserve corner pixels, got ${countGreen(fitted)}`
  );
  assert.ok(countOpaqueInRow(fitted, 0) < countOpaqueInRow(clipped, 0));
});

test("renderSpriteStack: cleanup paletteLock restricts output to combined slice palette", () => {
  const s1 = new PixelBuffer(16, 16);
  const s2 = new PixelBuffer(16, 16);
  for (let y = 5; y <= 10; y++) {
    for (let x = 5; x <= 10; x++) {
      s1.setPixel(x, y, 220, 60, 40, 255);
      s2.setPixel(x, y, 40, 180, 220, 255);
    }
  }

  const rendered = renderSpriteStack(
    [s1, s2],
    baseStackOpts({
      yawDeg: 30,
      pitchDeg: 45,
      sliceSpacing: 2,
      depthShading: true,
      directionalLighting: true,
      cleanup: {
        removeOrphans: true,
        fillHoles: true,
        paletteLock: true,
        preserveOutline: false,
      },
    })
  );

  assert.ok(countOpaque(rendered) > 0);
  const allowed = new Set(
    [...collectPalette(s1), ...collectPalette(s2)].map((c) =>
      packRgba(c[0], c[1], c[2], c[3])
    )
  );
  for (const c of collectPalette(rendered)) {
    assert.ok(
      allowed.has(packRgba(c[0], c[1], c[2], c[3])),
      `unexpected color [${c.join(",")}] outside combined slice palette`
    );
  }
});

test("computeTurntableAngleOffset: startDeg/sweepDeg, pingPong, easing, and presets", () => {
  // Default 360° linear loop matches legacy (i / count) * 360
  for (let i = 0; i < 8; i++) {
    assertClose(computeTurntableAngleOffset(i, 8), i * 45);
  }

  // Custom partial sweep hits exact start and end endpoints
  const partial = Array.from({ length: 5 }, (_, i) =>
    computeTurntableAngleOffset(i, 5, {
      startDeg: -40,
      sweepDeg: 80,
      pingPong: false,
      easing: "linear",
    })
  );
  assert.deepEqual(partial, [-40, -20, 0, 20, 40]);

  // Ping-pong sway (8 frames, -35° -> +35° -> back)
  const sway = Array.from({ length: 8 }, (_, i) =>
    computeTurntableAngleOffset(i, 8, {
      startDeg: -35,
      sweepDeg: 70,
      pingPong: true,
      easing: "linear",
    })
  );
  assertClose(sway[0], -35);
  assertClose(sway[4], 35);
  assertClose(sway[1], sway[7]);
  assertClose(sway[2], sway[6]);
  assertClose(sway[3], sway[5]);

  // Easing monotonicity, endpoints, and curve shape
  const easings: TurntableEasing[] = ["linear", "easeIn", "easeOut", "easeInOut"];
  for (const easing of easings) {
    const seq = Array.from({ length: 9 }, (_, i) =>
      computeTurntableAngleOffset(i, 9, {
        startDeg: 10,
        sweepDeg: 100,
        pingPong: false,
        easing,
      })
    );
    assertClose(seq[0], 10);
    assertClose(seq[8], 110);
    for (let i = 1; i < seq.length; i++) {
      assert.ok(
        seq[i] >= seq[i - 1],
        `expected ${easing} to be monotonic at index ${i}`
      );
    }
  }

  const midIn = computeTurntableAngleOffset(2, 5, {
    startDeg: 0,
    sweepDeg: 100,
    easing: "easeIn",
  });
  const midLin = computeTurntableAngleOffset(2, 5, {
    startDeg: 0,
    sweepDeg: 100,
    easing: "linear",
  });
  const midOut = computeTurntableAngleOffset(2, 5, {
    startDeg: 0,
    sweepDeg: 100,
    easing: "easeOut",
  });
  assert.ok(midIn < midLin && midLin < midOut);

  const q1InOut = computeTurntableAngleOffset(1, 5, {
    startDeg: 0,
    sweepDeg: 100,
    easing: "easeInOut",
  });
  const q3InOut = computeTurntableAngleOffset(3, 5, {
    startDeg: 0,
    sweepDeg: 100,
    easing: "easeInOut",
  });
  assert.ok(q1InOut < 25 && q3InOut > 75);

  // Verify exported presets
  assert.equal(ROTATE3D_CAMERA_PRESETS.iso2to1.yawDeg, 45);
  assert.equal(ROTATE3D_CAMERA_PRESETS.iso2to1.pitchDeg, 30);
  assert.equal(ROTATE3D_CAMERA_PRESETS.topDown.pitchDeg, 65);
  assert.equal(TURNTABLE_PRESETS.dir8.frameCount, 8);
  assert.equal(TURNTABLE_PRESETS.sway.pingPong, true);
  assert.equal(TURNTABLE_PRESETS.sway.startDeg, -35);
  assert.equal(TURNTABLE_PRESETS.sway.sweepDeg, 70);
  assert.equal(TURNTABLE_PRESETS.sway.easing, "easeInOut");
});

test("bakeTurntableFrames: animated sourceFrames and backFrames combine with rotation steps", () => {
  const makeSolid = (r: number, g: number, b: number) => {
    const buf = new PixelBuffer(12, 12);
    for (let y = 4; y <= 7; y++) {
      for (let x = 4; x <= 7; x++) {
        buf.setPixel(x, y, r, g, b, 255);
      }
    }
    return buf;
  };

  const front0 = makeSolid(230, 40, 40); // Red
  const front1 = makeSolid(40, 220, 40); // Green
  const back0 = makeSolid(40, 80, 230); // Blue
  const back1 = makeSolid(230, 210, 40); // Yellow

  // 4 frames, 360° yaw: angles are 0°, 90°, 180°, 270°
  // Frame 0 (0°): front0 (Red)
  // Frame 2 (180°): back0 (Blue) since 2 % 2 === 0
  const frames = bakeTurntableFrames({
    mode: "extruded",
    frameCount: 4,
    spinAxis: "yaw",
    sourceFrames: [front0, front1],
    backFrames: [back0, back1],
    opts25d: baseOpts(),
    optsStack: baseStackOpts(),
  });

  assert.equal(frames.length, 4);
  assert.deepEqual(frames[0].getPixel(6, 6), [230, 40, 40, 255]);
  assert.deepEqual(frames[2].getPixel(6, 6), [40, 80, 230, 255]);

  // 2 frames at 0° and 180° with 2 sourceFrames + 2 backFrames:
  // Frame 0 (0°) -> front0 (Red), Frame 1 (180°) -> back1 (Yellow)
  const flipFrames = bakeTurntableFrames({
    mode: "extruded",
    frameCount: 2,
    spinAxis: "yaw",
    startDeg: 0,
    sweepDeg: 180,
    sourceFrames: [front0, front1],
    backFrames: [back0, back1],
    opts25d: baseOpts(),
    optsStack: baseStackOpts(),
  });

  assert.equal(flipFrames.length, 2);
  assert.deepEqual(flipFrames[0].getPixel(6, 6), [230, 40, 40, 255]);
  assert.deepEqual(flipFrames[1].getPixel(6, 6), [230, 210, 40, 255]);
});

test("render25DSprite: exact 90° yaw and 90° pitch side views render solid, watertight side profiles", () => {
  const src = new PixelBuffer(24, 24);
  for (let y = 6; y <= 17; y++) {
    for (let x = 6; x <= 17; x++) {
      src.setPixel(x, y, 200, 140, 90, 255);
    }
  }

  for (const profile of ["slab", "bevel", "pillow"] as const) {
    const sideYaw = render25DSprite(
      src,
      baseOpts({
        yawDeg: 90,
        extrudeDepth: 8,
        depthProfile: profile,
        shadeDepth: true,
      })
    );
    assert.ok(
      countOpaque(sideYaw) > 0,
      `Expected non-empty 90° yaw side view for profile=${profile}`
    );

    // Center row (y=11) must be a continuous horizontal span without internal gaps
    let minX = 24;
    let maxX = -1;
    let rowOpaque = 0;
    for (let x = 0; x < 24; x++) {
      if (sideYaw.getPixel(x, 11)[3] > 0) {
        rowOpaque++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    assert.equal(
      rowOpaque,
      maxX - minX + 1,
      `Expected continuous horizontal span on 90° yaw for ${profile}, got ${rowOpaque} in [${minX}..${maxX}]`
    );
    assert.ok(
      rowOpaque >= 6,
      `Expected side thickness >= 6px for extrudeDepth=8 (${profile}), got ${rowOpaque}`
    );
  }

  const sidePitch = render25DSprite(
    src,
    baseOpts({
      pitchDeg: 90,
      extrudeDepth: 8,
      depthProfile: "slab",
      shadeDepth: true,
    })
  );
  let colOpaque = 0;
  let minY = 24;
  let maxY = -1;
  for (let y = 0; y < 24; y++) {
    if (sidePitch.getPixel(11, y)[3] > 0) {
      colOpaque++;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  assert.equal(colOpaque, maxY - minY + 1);
  assert.ok(colOpaque >= 6);
});

test("render25DSprite: grazing 85° yaw renders continuous gap-free side without striping", () => {
  const src = new PixelBuffer(24, 24);
  for (let y = 6; y <= 17; y++) {
    for (let x = 6; x <= 17; x++) {
      src.setPixel(x, y, 160, 200, 120, 255);
    }
  }

  const grazing = render25DSprite(
    src,
    baseOpts({
      yawDeg: 85,
      extrudeDepth: 8,
      depthProfile: "slab",
      shadeDepth: true,
    })
  );

  for (let y = 7; y <= 16; y++) {
    let minX = 24;
    let maxX = -1;
    let count = 0;
    for (let x = 0; x < 24; x++) {
      if (grazing.getPixel(x, y)[3] > 0) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    assert.ok(count > 0, `Row ${y} should not be empty at 85° yaw`);
    assert.equal(
      count,
      maxX - minX + 1,
      `Row ${y} at 85° yaw should have no gaps (${count} vs ${maxX - minX + 1})`
    );
  }
});

test("render25DSprite: shadeDepth preserves front cap color at 0° yaw and shades side walls at 75° yaw", () => {
  const src = new PixelBuffer(20, 20);
  for (let y = 5; y <= 14; y++) {
    for (let x = 5; x <= 14; x++) {
      src.setPixel(x, y, 200, 160, 120, 255);
    }
  }

  // At 0° yaw, front cap pixels retain exact source color
  const front = render25DSprite(
    src,
    baseOpts({
      yawDeg: 0,
      extrudeDepth: 6,
      depthProfile: "slab",
      shadeDepth: true,
    })
  );
  assert.deepEqual(front.getPixel(10, 10), [200, 160, 120, 255]);

  // At 75° yaw, extruded side wall pixels are shaded darker than front cap (R < 200)
  const tilted = render25DSprite(
    src,
    baseOpts({
      yawDeg: 75,
      extrudeDepth: 8,
      depthProfile: "slab",
      shadeDepth: true,
    })
  );
  let hasUnmodifiedFront = false;
  let hasShadedSide = false;
  for (let x = 0; x < 20; x++) {
    const px = tilted.getPixel(x, 10);
    if (px[3] === 0) continue;
    if (px[0] === 200 && px[1] === 160 && px[2] === 120) {
      hasUnmodifiedFront = true;
    } else if (px[0] < 200 && px[0] > 80) {
      hasShadedSide = true;
    }
  }
  assert.ok(hasUnmodifiedFront, "Expected front cap pixels to stay unmodified");
  assert.ok(hasShadedSide, "Expected extruded side wall pixels to be shaded");
});

test("scene3d: projectScenePoint, perspective/isometric grids, turntable ring, and floor shadow", () => {
  const baseCam: Scene3DCamera = {
    yawDeg: 35,
    pitchDeg: 25,
    rollDeg: 0,
    perspective: 0.4,
    canvasWidth: 32,
    canvasHeight: 32,
    floorY: 16,
    viewWidth: 640,
    viewHeight: 480,
    pixelScale: 4,
    gridMode: "perspective",
  };

  // Origin (0,0,0) always projects to center of viewport
  const origin = projectScenePoint(0, 0, 0, baseCam);
  assert.equal(origin.visible, true);
  assertClose(origin.sx, 320);
  assertClose(origin.sy, 240);

  // Perspective grid produces minor, major, and X/Y/Z axis lines with valid alpha
  const perspLines = buildSceneGridLines(baseCam);
  assert.ok(perspLines.some((l) => l.kind === "minor"));
  assert.ok(perspLines.some((l) => l.kind === "major"));
  assert.ok(perspLines.some((l) => l.kind === "axisX"));
  assert.ok(perspLines.some((l) => l.kind === "axisY"));
  assert.ok(perspLines.some((l) => l.kind === "axisZ"));
  assert.ok(perspLines.every((l) => l.alpha > 0 && l.alpha <= 1 && Number.isFinite(l.x1)));

  // Isometric grid uses orthographic projection and includes isoFootprint diamond lines
  const isoCam: Scene3DCamera = {
    ...baseCam,
    yawDeg: 45,
    pitchDeg: 30,
    gridMode: "isometric",
  };
  const isoLines = buildSceneGridLines(isoCam);
  assert.ok(isoLines.some((l) => l.kind === "isoFootprint"));
  assert.ok(isoLines.some((l) => l.kind === "minor"));

  // None grid mode omits floor grid lines while preserving axes when requested
  const noneLines = buildSceneGridLines({ ...baseCam, gridMode: "none" }, { showAxes: false });
  assert.equal(noneLines.length, 0);

  // Turntable ring includes closed perimeter points and cardinal angle labels
  const ring = buildTurntableRing(baseCam, 20, 32);
  assert.equal(ring.points.length, 33);
  const labels = ring.ticks.map((t) => t.label).filter(Boolean);
  assert.deepEqual(labels, ["0°", "90°", "180°", "270°"]);

  // Floor shadow ellipse produces valid polygon points
  const shadow = buildFloorShadowEllipse(baseCam, 10, 6, 24);
  assert.equal(shadow.length, 24);
});
