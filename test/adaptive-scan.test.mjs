import assert from "node:assert/strict";
import test from "node:test";
import { scanWithThresholds } from "../src/maxicode/adaptiveScan.js";

function scannerFactoryFor(successThreshold, calls) {
  return (_imageData, options) => {
    calls.push(options.threshold);
    return {
      findBullseye: () => ({ found: true, confidence: 0.9, bandWidth: 4 }),
      estimateModulePitch: () => 7,
      sampleHexGrid: () => [1, 0, 1],
      decode: () => ({
        decoded: options.threshold === successThreshold,
        density: options.threshold / 1000,
        text: options.threshold === successThreshold ? "decoded" : "",
      }),
    };
  };
}

test("stops threshold retries after the first successful decode", () => {
  const calls = [];
  const result = scanWithThresholds({}, {
    thresholds: [128, 144, 152],
    scannerFactory: scannerFactoryFor(144, calls),
  });

  assert.deepEqual(calls, [128, 144]);
  assert.equal(result.threshold, 144);
  assert.equal(result.decode.decoded, true);
  assert.deepEqual(result.attempts.map((attempt) => attempt.threshold), [128, 144]);
});

test("returns the strongest failed attempt when no threshold decodes", () => {
  const calls = [];
  const result = scanWithThresholds({}, {
    thresholds: [112, 128, 152],
    scannerFactory: scannerFactoryFor(null, calls),
  });

  assert.deepEqual(calls, [112, 128, 152]);
  assert.equal(result.threshold, 152);
  assert.equal(result.decode.decoded, false);
});

test("rejects an empty threshold schedule", () => {
  assert.throws(() => scanWithThresholds({}, { thresholds: [] }), /At least one/);
});

test("retries a failed full image in a tight bullseye region", () => {
  const source = {
    width: 800,
    height: 1000,
    data: new Uint8ClampedArray(800 * 1000 * 4),
  };
  const scannerFactory = (imageData) => ({
    findBullseye: () => imageData.width === 800
      ? { x: 204, y: 196, found: true, confidence: 1, bandWidth: 2.7 }
      : { x: 76, y: 76, found: true, confidence: 1, bandWidth: 2.7 },
    findBullseyePatternCandidates: () => [],
    estimateModulePitch: () => 3,
    sampleHexGrid: () => [{ x: 76, y: 76, bit: 1 }],
    decode: () => ({
      decoded: imageData.width < 800,
      density: 0.46,
      text: imageData.width < 800 ? "decoded from crop" : "",
    }),
  });

  const result = scanWithThresholds(source, {
    thresholds: [128],
    scannerFactory,
  });

  assert.equal(result.decode.decoded, true);
  assert.equal(result.decode.text, "decoded from crop");
  assert.deepEqual(result.scanRegion, { left: 128, top: 120, width: 152, height: 152 });
  assert.deepEqual({ x: result.center.x, y: result.center.y }, { x: 204, y: 196 });
  assert.deepEqual({ x: result.cells[0].x, y: result.cells[0].y }, { x: 204, y: 196 });
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(result.attempts[1].region, result.scanRegion);
});

test("tries alternate ring candidates when the full-image bullseye is misleading", () => {
  const source = {
    width: 800,
    height: 1000,
    data: new Uint8ClampedArray(800 * 1000 * 4),
  };
  let calls = 0;
  const scannerFactory = () => {
    calls += 1;
    const fullImage = calls === 1;
    return {
      findBullseye: () => fullImage
        ? { x: 600, y: 700, found: false, confidence: 0.2, bandWidth: 3 }
        : { x: 84, y: 84, found: true, confidence: 1, bandWidth: 3 },
      findBullseyePatternCandidates: () => fullImage
        ? [
            { x: 600, y: 700, bandWidth: 3, patternScore: 0.8 },
            { x: 204, y: 196, bandWidth: 3, patternScore: 0.7 },
          ]
        : [],
      estimateModulePitch: () => 3,
      sampleHexGrid: () => [],
      decode: () => ({ decoded: calls === 3, density: 0.46, text: calls === 3 ? "alternate" : "" }),
    };
  };

  const result = scanWithThresholds(source, {
    thresholds: [128],
    scannerFactory,
  });

  assert.equal(result.decode.decoded, true);
  assert.equal(result.decode.text, "alternate");
  assert.deepEqual(result.scanRegion, { left: 120, top: 112, width: 168, height: 168 });
  assert.deepEqual({ x: result.center.x, y: result.center.y }, { x: 204, y: 196 });
  assert.equal(calls, 3);
});

test("can disable the region retry for latency-sensitive frames", () => {
  const source = {
    width: 200,
    height: 200,
    data: new Uint8ClampedArray(200 * 200 * 4),
  };
  let calls = 0;
  const result = scanWithThresholds(source, {
    thresholds: [128],
    roiRetry: false,
    scannerFactory: () => {
      calls += 1;
      return {
        findBullseye: () => ({ x: 100, y: 100, found: true, confidence: 1, bandWidth: 3 }),
        estimateModulePitch: () => 4,
        sampleHexGrid: () => [],
        decode: () => ({ decoded: false, density: 0.4, text: "" }),
      };
    },
  });

  assert.equal(result.decode.decoded, false);
  assert.equal(result.scanRegion, null);
  assert.equal(calls, 1);
});
