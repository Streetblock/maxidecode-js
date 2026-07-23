import { MaxiCodeScanner } from "./scanner.js";

// Preserve the common thresholds first. The darker fallback is needed for
// photographed labels where gray paper and shadows otherwise merge into ink.
export const AUTO_THRESHOLD_CANDIDATES = Object.freeze([128, 144, 152, 96]);

function attemptScore(attempt) {
  if (attempt.decode.decoded) return Number.POSITIVE_INFINITY;
  return (attempt.center.confidence || 0) * 0.72 + (attempt.decode.density || 0) * 0.2;
}

function cropImageData(imageData, region) {
  const data = new Uint8ClampedArray(region.width * region.height * 4);
  for (let y = 0; y < region.height; y += 1) {
    const sourceStart = ((region.top + y) * imageData.width + region.left) * 4;
    const targetStart = y * region.width * 4;
    data.set(
      imageData.data.subarray(sourceStart, sourceStart + region.width * 4),
      targetStart,
    );
  }
  return { width: region.width, height: region.height, data };
}

function cropRegionForCandidate(imageData, candidate) {
  if (!Number.isFinite(candidate?.x) || !Number.isFinite(candidate?.y)) return null;
  if (!Number.isFinite(candidate?.bandWidth) || candidate.bandWidth <= 0) return null;

  // The MaxiCode symbol extends roughly 25 bullseye bands from its center.
  // Keep the retry tight: unrelated label text can otherwise dominate the
  // fallback geometry just as it did in the original full-image attempt.
  // A complete symbol spans roughly 24-28 true bullseye bands from its center.
  // Keeping a fixed 72 px minimum made tiny web labels worse: their 1 px
  // bullseye band was recropped with more surrounding text than MaxiCode. Run
  // pattern widths are often slightly inflated, so 20 provides useful margin
  // without pulling the adjacent linear barcodes back into the retry.
  const halfSize = Math.max(32, Math.ceil(candidate.bandWidth * 20));
  const left = Math.max(0, Math.floor(candidate.x - halfSize));
  const top = Math.max(0, Math.floor(candidate.y - halfSize));
  const right = Math.min(imageData.width, Math.ceil(candidate.x + halfSize));
  const bottom = Math.min(imageData.height, Math.ceil(candidate.y + halfSize));
  const width = right - left;
  const height = bottom - top;

  if (width < 48 || height < 48) return null;
  return { left, top, width, height };
}

function candidateKey(candidate) {
  const scale = Math.max(4, candidate.bandWidth * 4);
  return `${Math.round(candidate.x / scale)}:${Math.round(candidate.y / scale)}:${Math.round(candidate.bandWidth)}`;
}

function translateAttempt(attempt, region) {
  return {
    ...attempt,
    center: {
      ...attempt.center,
      x: attempt.center.x + region.left,
      y: attempt.center.y + region.top,
    },
    cells: attempt.cells.map((cell) => ({
      ...cell,
      x: Number.isFinite(cell.x) ? cell.x + region.left : cell.x,
      y: Number.isFinite(cell.y) ? cell.y + region.top : cell.y,
    })),
    scanRegion: region,
  };
}

function runThresholds(imageData, thresholds, scannerOptions, scannerFactory, region = null) {
  const attempts = [];
  const candidates = [];
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
    const attempt = { threshold, center, pitch, cells, decode, scanner };

    if (typeof scanner.findBullseyePatternCandidates === "function") {
      candidates.push(...scanner.findBullseyePatternCandidates());
    }

    attempts.push({
      threshold,
      centerFound: Boolean(center.found),
      centerConfidence: center.confidence || 0,
      decoded: Boolean(decode.decoded),
      ...(region ? { region } : {}),
    });

    if (!best || attemptScore(attempt) > attemptScore(best)) {
      best = attempt;
    }
    if (decode.decoded) break;
  }

  return { best, attempts, candidates };
}

/**
 * Scan the same image with a small, ordered set of binarization thresholds.
 * The common threshold stays first, so already-readable images pay no retry cost.
 */
export function scanWithThresholds(imageData, {
  thresholds = AUTO_THRESHOLD_CANDIDATES,
  scannerOptions = {},
  scannerFactory = (data, options) => new MaxiCodeScanner(data, options),
  roiRetry = true,
  maxRoiCandidates = 6,
} = {}) {
  if (!thresholds.length) {
    throw new Error("At least one scan threshold is required.");
  }

  const primary = runThresholds(imageData, thresholds, scannerOptions, scannerFactory);
  const publicBest = { ...primary.best };
  delete publicBest.scanner;
  if (primary.best.decode.decoded || !roiRetry || !imageData?.data) {
    return { ...publicBest, attempts: primary.attempts, scanRegion: null };
  }

  const candidates = [];
  if ((primary.best.center.confidence || 0) >= 0.1) {
    candidates.push(primary.best.center);
  }
  // A real bullseye may rank strongly under one threshold while a false label
  // pattern makes another threshold the strongest failed attempt. Preserve the
  // seeds from every threshold and let successful Reed-Solomon decoding decide.
  candidates.push(...primary.candidates);

  const seen = new Set();
  const regions = [];
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    const region = cropRegionForCandidate(imageData, candidate);
    if (!region) continue;
    regions.push(region);
    if (regions.length >= maxRoiCandidates) break;
  }

  const attempts = [...primary.attempts];
  for (const region of regions) {
    const cropped = cropImageData(imageData, region);
    const retry = runThresholds(cropped, thresholds, scannerOptions, scannerFactory, region);
    attempts.push(...retry.attempts);
    if (retry.best.decode.decoded) {
      const translated = translateAttempt(retry.best, region);
      delete translated.scanner;
      return { ...translated, attempts };
    }
  }

  return { ...publicBest, attempts, scanRegion: null };
}
