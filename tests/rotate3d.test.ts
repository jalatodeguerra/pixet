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
  render25DSprite,
  type Rotate25DOptions,
} from "../src/engine/tools/rotate3d.ts";

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
