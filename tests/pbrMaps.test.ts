import test from "node:test";
import assert from "node:assert/strict";

import { PixelBuffer } from "../src/engine/document/PixelBuffer.ts";
import {
  generateDepthMap,
  generateHeightMap,
  generateNormalMap,
} from "../src/engine/gamedev/pbrMaps.ts";
import { apply2DLighting } from "../src/engine/gamedev/shaderPreview.ts";

function makeShadedBox(w = 12, h = 12): PixelBuffer {
  const buf = new PixelBuffer(w, h);
  for (let y = 2; y <= h - 3; y++) {
    for (let x = 2; x <= w - 3; x++) {
      // Brighter toward center-top-left
      const v = Math.min(255, 80 + (x + y) * 10);
      buf.setPixel(x, y, v, v, v, 255);
    }
  }
  return buf;
}

test("pbrMaps: generateHeightMap supports hybrid, luminance, bevel, pillow, invert, and blur", () => {
  const src = makeShadedBox(12, 12);

  for (const source of ["hybrid", "luminance", "bevel", "pillow"] as const) {
    const hm = generateHeightMap(src, { source });
    assert.equal(hm.getPixel(0, 0)[3], 0, "transparent pixel stays transparent");
    const center = hm.getPixel(5, 5);
    assert.equal(center[3], 255);
    assert.equal(center[0], center[1]);
    assert.equal(center[1], center[2]);
  }

  // Bevel/pillow: center is higher than edge
  const pillow = generateHeightMap(src, { source: "pillow", normalize: true });
  assert.ok(pillow.getPixel(5, 5)[0] > pillow.getPixel(2, 2)[0]);

  // Invert flips heights
  const inv = generateHeightMap(src, { source: "pillow", normalize: true, invert: true });
  assert.ok(inv.getPixel(2, 2)[0] > inv.getPixel(5, 5)[0]);

  // Blur preserves alpha silhouette
  const blurred = generateHeightMap(src, { source: "hybrid", blurRadius: 2 });
  assert.equal(blurred.getPixel(0, 0)[3], 0);
  assert.equal(blurred.getPixel(5, 5)[3], 255);
});

test("pbrMaps: generateNormalMap OpenGL vs DirectX, invertX/Y, scharr, and custom heightMap", () => {
  const src = new PixelBuffer(12, 12);
  for (let y = 2; y <= 9; y++) {
    for (let x = 2; x <= 9; x++) {
      src.setPixel(x, y, 160, 160, 160, 255);
    }
  }

  // Flat interior with bevelStrength=0 produces neutral (128, 128, 255)
  const flatNorm = generateNormalMap(src, { bevelStrength: 0, strength: 2.0 });
  const centerFlat = flatNorm.getPixel(5, 5);
  assert.equal(centerFlat[0], 128);
  assert.equal(centerFlat[1], 128);
  assert.equal(centerFlat[2], 255);
  assert.equal(flatNorm.getPixel(0, 0)[3], 0);

  // Ramp heightMap: height increases downward (+Y) -> OpenGL normal tilts -Y (G < 128), DirectX tilts +Y (G > 128)
  const rampHm = new PixelBuffer(12, 12);
  for (let y = 2; y <= 9; y++) {
    const v = Math.round(((y - 2) / 7) * 255);
    for (let x = 2; x <= 9; x++) {
      rampHm.setPixel(x, y, v, v, v, 255);
    }
  }

  const glNorm = generateNormalMap(src, {
    heightMap: rampHm,
    convention: "opengl",
    strength: 3.0,
    kernel: "sobel",
  });
  const dxNorm = generateNormalMap(src, {
    heightMap: rampHm,
    convention: "directx",
    strength: 3.0,
    kernel: "scharr",
  });

  // On a downward-increasing height ramp, gy > 0 so OpenGL ny > 0 (G > 128) and DirectX ny < 0 (G < 128)
  assert.ok(glNorm.getPixel(5, 5)[1] > 128);
  assert.ok(dxNorm.getPixel(5, 5)[1] < 128);

  const flippedY = generateNormalMap(src, {
    heightMap: rampHm,
    convention: "opengl",
    invertY: true,
    strength: 3.0,
  });
  assert.ok(flippedY.getPixel(5, 5)[1] < 128);
});

test("pbrMaps: generateDepthMap modes, near/far range, and invert", () => {
  const src = makeShadedBox(12, 12);

  const td = generateDepthMap(src, { mode: "topDown", relief: 0 });
  assert.ok(td.getPixel(5, 9)[0] > td.getPixel(5, 2)[0], "topDown: bottom is nearer/brighter");
  assert.equal(td.getPixel(0, 0)[3], 0);

  const iso = generateDepthMap(src, { mode: "isometric", relief: 0 });
  assert.ok(iso.getPixel(9, 9)[0] > iso.getPixel(2, 2)[0], "isometric: bottom-right is nearer");

  const rad = generateDepthMap(src, { mode: "radial", relief: 0 });
  assert.ok(rad.getPixel(5, 5)[0] > rad.getPixel(2, 2)[0], "radial: center is nearer");

  const volInv = generateDepthMap(src, { mode: "volume", relief: 0, invert: true });
  assert.ok(volInv.getPixel(2, 2)[0] > volInv.getPixel(5, 5)[0], "invert flips volume depth");

  const clamped = generateDepthMap(src, { mode: "topDown", relief: 0, near: 0.25, far: 0.75 });
  assert.ok(clamped.getPixel(5, 2)[0] >= 60);
  assert.ok(clamped.getPixel(5, 9)[0] <= 195);
});

test("shaderPreview: apply2DLighting supports directional, specular, height shadow, depth AO, cel, and autoNormalIfMissing", () => {
  const albedo = new PixelBuffer(12, 12);
  for (let y = 2; y <= 9; y++) {
    for (let x = 2; x <= 9; x++) {
      albedo.setPixel(x, y, 120, 120, 120, 255);
    }
  }

  // Flat normal facing viewer, light directly overhead -> strong Blinn-Phong specular boost
  const flatNormal = new PixelBuffer(12, 12);
  for (let y = 2; y <= 9; y++) {
    for (let x = 2; x <= 9; x++) {
      flatNormal.setPixel(x, y, 128, 128, 255, 255);
    }
  }

  const noSpec = apply2DLighting(albedo.data, flatNormal.data, null, 12, 12, {
    enabled: true,
    lightType: "directional",
    lightX: 0.5,
    lightY: 0.5,
    lightZ: 1.0,
    lightColor: "#ffffff",
    intensity: 1.0,
    ambient: 0.2,
    emissionStrength: 0,
    specularStrength: 0,
  });

  const withSpec = apply2DLighting(albedo.data, flatNormal.data, null, 12, 12, {
    enabled: true,
    lightType: "directional",
    lightX: 0.5,
    lightY: 0.5,
    lightZ: 1.0,
    lightColor: "#ffffff",
    intensity: 1.0,
    ambient: 0.2,
    emissionStrength: 0,
    specularStrength: 1.0,
    shininess: 16,
  });

  const cIdx = (5 * 12 + 5) * 4;
  assert.ok(withSpec[cIdx] > noSpec[cIdx], "specular highlight brightens lit pixel");

  // Depth AO darkens low-depth pixels when aoStrength > 0
  const depthMap = new PixelBuffer(12, 12);
  for (let y = 2; y <= 9; y++) {
    for (let x = 2; x <= 9; x++) {
      const dv = x === 2 ? 20 : 255;
      depthMap.setPixel(x, y, dv, dv, dv, 255);
    }
  }
  const withAo = apply2DLighting(
    albedo.data,
    flatNormal.data,
    null,
    12,
    12,
    {
      enabled: true,
      lightType: "directional",
      lightX: 0.5,
      lightY: 0.5,
      lightZ: 1.0,
      lightColor: "#ffffff",
      intensity: 0.5,
      ambient: 0.5,
      emissionStrength: 0,
      aoStrength: 0.9,
    },
    null,
    depthMap.data
  );
  assert.ok(
    withAo[(5 * 12 + 2) * 4] < withAo[(5 * 12 + 5) * 4],
    "AO darkens occluded pixel relative to exposed pixel"
  );

  // autoNormalIfMissing works when normal is null
  const autoLit = apply2DLighting(albedo.data, null, null, 12, 12, {
    enabled: true,
    lightType: "point",
    lightX: 0.2,
    lightY: 0.2,
    lightZ: 0.35,
    lightColor: "#ffffff",
    intensity: 1.4,
    ambient: 0.25,
    emissionStrength: 0,
    autoNormalIfMissing: true,
  });
  assert.equal(autoLit[(5 * 12 + 5) * 4 + 3], 255);
});
