import assert from "node:assert/strict";
import test from "node:test";
import { MaxiCodeScanner } from "../src/maxicode/scanner.js";

function createScene({ width, height, centerX, centerY, bandWidth, noise = 0, seed = 1, dots = 180 }) {
  const data = new Uint8ClampedArray(width * height * 4);
  let randomState = seed >>> 0;
  const random = () => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = 242 - (x / width) * 18 + (y / height) * 8;
      const jitter = (random() - 0.5) * noise;
      let value = gradient + jitter;
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance < bandWidth * 6 && Math.floor(distance / bandWidth) % 2 === 1) {
        value = 18 + jitter;
      }

      const index = (y * width + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }

  // Add data-like dots so the target is not the only dark geometry in the image.
  for (let dot = 0; dot < dots; dot += 1) {
    const dotX = Math.floor(random() * width);
    const dotY = Math.floor(random() * height);
    if (Math.hypot(dotX - centerX, dotY - centerY) < bandWidth * 7.2) continue;
    const radius = Math.max(1, bandWidth * (0.22 + random() * 0.16));
    for (let y = Math.max(0, Math.floor(dotY - radius)); y <= Math.min(height - 1, Math.ceil(dotY + radius)); y += 1) {
      for (let x = Math.max(0, Math.floor(dotX - radius)); x <= Math.min(width - 1, Math.ceil(dotX + radius)); x += 1) {
        if (Math.hypot(x - dotX, y - dotY) > radius) continue;
        const index = (y * width + x) * 4;
        data[index] = 24;
        data[index + 1] = 24;
        data[index + 2] = 24;
      }
    }
  }

  return { width, height, data };
}

const cases = [
  { width: 260, height: 250, centerX: 130, centerY: 125, bandWidth: 7, noise: 8 },
  { width: 640, height: 480, centerX: 410, centerY: 180, bandWidth: 13, noise: 18 },
  { width: 180, height: 160, centerX: 60, centerY: 95, bandWidth: 4, noise: 12 },
];

for (const fixture of cases) {
  test(`finds a ${fixture.bandWidth}px bullseye at ${fixture.centerX},${fixture.centerY}`, () => {
    const scanner = new MaxiCodeScanner(createScene(fixture));
    const center = scanner.findBullseye();
    assert.equal(center.found, true);
    assert.ok(Math.hypot(center.x - fixture.centerX, center.y - fixture.centerY) <= 2.5, JSON.stringify(center));
    assert.ok(Math.abs(center.bandWidth - fixture.bandWidth) <= fixture.bandWidth * 0.2, JSON.stringify(center));
  });
}

test("keeps one-pixel ring-pattern seeds for downsampled labels", () => {
  const scanner = new MaxiCodeScanner(createScene({
    width: 64,
    height: 60,
    centerX: 29.5,
    centerY: 29.5,
    bandWidth: 1,
    noise: 0,
    dots: 0,
  }));
  const candidates = scanner.findBullseyePatternCandidates();
  assert.ok(
    candidates.some((candidate) => Math.hypot(candidate.x - 29.5, candidate.y - 29.5) <= 3),
    JSON.stringify(candidates.slice(0, 5)),
  );
});

test("rejects an empty image", () => {
  const width = 240;
  const height = 180;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const scanner = new MaxiCodeScanner({ width, height, data });
  const center = scanner.findBullseye();
  assert.equal(center.found, false);
  assert.equal(center.confidence, 0);
});
