import test from "node:test";
import assert from "node:assert/strict";

import {
  codewordsIntersectingBand,
  findBrightDamageBands,
} from "../src/maxicode/recovery.js";

test("detects a long bright diagonal without consulting decoded text", () => {
  const width = 240;
  const height = 240;
  const gray = new Float32Array(width * height).fill(65);
  const center = { x: 120, y: 120 };
  const expectedAngle = Math.atan(-0.5);
  const dx = Math.cos(expectedAngle);
  const dy = Math.sin(expectedAngle);
  const nx = -dy;
  const ny = dx;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const perpendicular = (x - center.x) * nx + (y - center.y) * ny;
      if (Math.abs(perpendicular) <= 7) gray[y * width + x] = 255;
    }
  }

  const [detected] = findBrightDamageBands(gray, width, height, center, 8, 1);
  assert.ok(detected);
  assert.ok(Math.abs(detected.angle - expectedAngle) < 6 * Math.PI / 180);
  assert.ok(Math.abs(detected.offset) <= 8);
});

test("maps damaged modules back to their Reed-Solomon codewords", () => {
  const erased = codewordsIntersectingBand(
    { x: 0, y: 0 },
    { modulePitch: 10, angle: 0, verticalScale: 1 },
    { angle: -Math.PI / 6, offset: 0, halfWidth: 8, halfLength: 150 },
  );

  assert.ok(erased.size > 0);
  assert.ok(erased.size < 144);
  for (const [codewordIndex, modules] of erased) {
    assert.ok(codewordIndex >= 0 && codewordIndex < 144);
    assert.ok(modules.every((module) => Math.floor(module.bitNumber / 6) === codewordIndex));
  }
});
