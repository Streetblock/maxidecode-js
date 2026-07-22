import { MaxiCodeScanner } from "./scanner.js";

export const AUTO_THRESHOLD_CANDIDATES = Object.freeze([128, 144, 152]);

function attemptScore(attempt) {
  if (attempt.decode.decoded) return Number.POSITIVE_INFINITY;
  return (attempt.center.confidence || 0) * 0.72 + (attempt.decode.density || 0) * 0.2;
}

/**
 * Scan the same image with a small, ordered set of binarization thresholds.
 * The common threshold stays first, so already-readable images pay no retry cost.
 */
export function scanWithThresholds(imageData, {
  thresholds = AUTO_THRESHOLD_CANDIDATES,
  scannerOptions = {},
  scannerFactory = (data, options) => new MaxiCodeScanner(data, options),
} = {}) {
  if (!thresholds.length) {
    throw new Error("At least one scan threshold is required.");
  }

  const attempts = [];
  let best = null;

  for (const threshold of thresholds) {
    const scanner = scannerFactory(imageData, {
      invert: false,
      expectedRings: 5,
      sensitivity: 0.7,
      ...scannerOptions,
      threshold,
    });
    const center = scanner.findBullseye();
    const pitch = center.found ? scanner.estimateModulePitch(center) : center.bandWidth || 0;
    const cells = center.found ? scanner.sampleHexGrid(center, pitch) : [];
    const decode = scanner.decode(cells);
    const attempt = { threshold, center, pitch, cells, decode };

    attempts.push({
      threshold,
      centerFound: Boolean(center.found),
      centerConfidence: center.confidence || 0,
      decoded: Boolean(decode.decoded),
    });

    if (!best || attemptScore(attempt) > attemptScore(best)) {
      best = attempt;
    }
    if (decode.decoded) break;
  }

  return { ...best, attempts };
}
