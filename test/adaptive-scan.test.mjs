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
