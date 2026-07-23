import {
  MAXICODE_BITNR,
  MaxiCodeScanner,
  decodeMaxiCodeDataWithErasures,
  orientedImagePosition,
  sampleGray,
  sampleOrientedCodewords,
  scoreOrientedGridContrast,
} from "./scanner.js";
import { cropImageData, cropRegionForCandidate } from "./adaptiveScan.js";
import { interpretObservedMaxiCode } from "./partialInterpretation.js";

const DEFAULT_THRESHOLDS = [112, 144, 176];

function angleDistance(left, right) {
  const full = Math.PI * 2;
  let delta = Math.abs(left - right) % full;
  if (delta > Math.PI) delta = full - delta;
  return Math.min(delta, Math.abs(Math.PI - delta));
}

function sampleBandProfile(gray, width, height, center, pitch, angle, offset) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const nx = -dy;
  const ny = dx;
  const length = pitch * 14;
  const step = Math.max(1, pitch * 0.45);
  let contrast = 0;
  let brightness = 0;
  let samples = 0;

  for (let along = -length; along <= length; along += step) {
    const x = center.x + dx * along + nx * offset;
    const y = center.y + dy * along + ny * offset;
    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) continue;
    const middle = (
      sampleGray(gray, width, height, x - nx * pitch * 0.28, y - ny * pitch * 0.28)
      + sampleGray(gray, width, height, x, y)
      + sampleGray(gray, width, height, x + nx * pitch * 0.28, y + ny * pitch * 0.28)
    ) / 3;
    const sides = (
      sampleGray(gray, width, height, x - nx * pitch * 1.45, y - ny * pitch * 1.45)
      + sampleGray(gray, width, height, x + nx * pitch * 1.45, y + ny * pitch * 1.45)
    ) / 2;
    contrast += Math.max(0, middle - sides);
    brightness += middle;
    samples += 1;
  }

  if (samples < 20) return null;
  const meanContrast = contrast / samples;
  const meanBrightness = brightness / samples;
  return {
    angle,
    offset,
    // Correction fluid/paint is both locally brighter and close to paper white.
    // The brightness term keeps ordinary high-contrast label edges below it.
    score: meanContrast + Math.max(0, meanBrightness - 205) * 0.3,
    meanContrast,
    meanBrightness,
  };
}

/**
 * Finds long, locally brighter bands such as correction-fluid or paint strokes.
 * This is deliberately a geometric detector: decoded text never influences it.
 */
export function findBrightDamageBands(gray, width, height, center, pitch, limit = 6) {
  const candidates = [];
  for (let degrees = -78; degrees <= 90; degrees += 3) {
    const angle = degrees * Math.PI / 180;
    for (let offset = -pitch * 9; offset <= pitch * 9; offset += pitch * 0.5) {
      const candidate = sampleBandProfile(gray, width, height, center, pitch, angle, offset);
      if (candidate) candidates.push(candidate);
    }
  }
  candidates.sort((left, right) => right.score - left.score);

  const unique = [];
  for (const candidate of candidates) {
    const duplicate = unique.some((other) => (
      angleDistance(other.angle, candidate.angle) < 5 * Math.PI / 180
      && Math.abs(other.offset - candidate.offset) < pitch
    ));
    if (!duplicate) unique.push(candidate);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function codewordsIntersectingBand(center, transform, band) {
  const directionX = Math.cos(band.angle);
  const directionY = Math.sin(band.angle);
  const normalX = -directionY;
  const normalY = directionX;
  const erased = new Map();

  for (let row = 0; row < MAXICODE_BITNR.length; row += 1) {
    for (let col = 0; col < MAXICODE_BITNR[row].length; col += 1) {
      const bitNumber = MAXICODE_BITNR[row][col];
      if (bitNumber < 0) continue;
      const point = orientedImagePosition(
        center,
        transform.modulePitch,
        transform.angle,
        col,
        row,
        transform.verticalScale,
        transform.perspectiveX || 0,
        transform.perspectiveY || 0,
        transform.shear || 0,
      );
      const relativeX = point.x - center.x;
      const relativeY = point.y - center.y;
      const perpendicular = relativeX * normalX + relativeY * normalY - band.offset;
      const along = relativeX * directionX + relativeY * directionY;
      if (Math.abs(perpendicular) > band.halfWidth || Math.abs(along) > band.halfLength) continue;
      const codewordIndex = Math.floor(bitNumber / 6);
      if (!erased.has(codewordIndex)) erased.set(codewordIndex, []);
      erased.get(codewordIndex).push({ bitNumber, row, col, x: point.x, y: point.y });
    }
  }
  return erased;
}

function withinErasureCapacity(indexes) {
  const primary = indexes.filter((index) => index < 20).length;
  const secondaryEven = indexes.filter((index) => index >= 20 && (index - 20) % 2 === 0).length;
  const secondaryOdd = indexes.filter((index) => index >= 20 && (index - 20) % 2 === 1).length;
  // Keep independent parity checks in reserve. Filling a block's entire
  // erasure capacity can interpolate a valid but unrelated codeword.
  return primary <= 8 && secondaryEven <= 16 && secondaryOdd <= 16;
}

function addLowConfidenceErasures(gray, width, height, center, transform, threshold, erasedMap) {
  const confidenceByCodeword = Array.from({ length: 144 }, () => []);
  for (let row = 0; row < MAXICODE_BITNR.length; row += 1) {
    for (let col = 0; col < MAXICODE_BITNR[row].length; col += 1) {
      const bitNumber = MAXICODE_BITNR[row][col];
      if (bitNumber < 0) continue;
      const point = orientedImagePosition(
        center,
        transform.modulePitch,
        transform.angle,
        col,
        row,
        transform.verticalScale,
        transform.perspectiveX || 0,
        transform.perspectiveY || 0,
        transform.shear || 0,
      );
      const value = sampleGray(gray, width, height, point.x, point.y);
      confidenceByCodeword[Math.floor(bitNumber / 6)].push(Math.abs(value - threshold));
    }
  }

  const groups = [
    // Never consume the complete erasure capacity. At 10/20/20 every parity
    // equation is needed for interpolation and no independent check remains;
    // a wrong grid can then manufacture a different but valid codeword.
    { indexes: Array.from({ length: 20 }, (_, index) => index), capacity: 8 },
    { indexes: Array.from({ length: 62 }, (_, index) => 20 + index * 2), capacity: 16 },
    { indexes: Array.from({ length: 62 }, (_, index) => 21 + index * 2), capacity: 16 },
  ];
  for (const group of groups) {
    const alreadyErased = group.indexes.filter((index) => erasedMap.has(index)).length;
    const additions = group.indexes
      .filter((index) => !erasedMap.has(index))
      .map((index) => ({
        index,
        confidence: confidenceByCodeword[index].length
          ? Math.min(...confidenceByCodeword[index])
          : 0,
      }))
      .sort((left, right) => left.confidence - right.confidence)
      .slice(0, Math.max(0, group.capacity - alreadyErased));
    for (const addition of additions) {
      erasedMap.set(addition.index, [{
        reason: "low-sampling-confidence",
        confidence: addition.confidence,
      }]);
    }
  }
  return erasedMap;
}

function sampleSoftDecisionEvidence(gray, width, height, center, transform, threshold) {
  const evidence = Array.from({ length: 144 }, (_, codewordIndex) => ({
    codewordIndex,
    bits: [],
  }));
  const radius = Math.max(0.7, transform.modulePitch * 0.14);
  const offsets = [[0, 0], [-radius, 0], [radius, 0], [0, -radius], [0, radius]];

  for (let row = 0; row < MAXICODE_BITNR.length; row += 1) {
    for (let col = 0; col < MAXICODE_BITNR[row].length; col += 1) {
      const bitNumber = MAXICODE_BITNR[row][col];
      if (bitNumber < 0) continue;
      const point = orientedImagePosition(
        center,
        transform.modulePitch,
        transform.angle,
        col,
        row,
        transform.verticalScale,
        transform.perspectiveX || 0,
        transform.perspectiveY || 0,
        transform.shear || 0,
      );
      const samples = offsets.map(([offsetX, offsetY]) => (
        sampleGray(gray, width, height, point.x + offsetX, point.y + offsetY)
      ));
      const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      const spread = Math.max(...samples) - Math.min(...samples);
      // Low threshold margin and high local disagreement both indicate that a
      // hard black/white decision is fragile. Lower scores are searched first.
      const confidence = Math.max(0, Math.abs(mean - threshold) - spread * 0.45);
      evidence[Math.floor(bitNumber / 6)].bits.push({
        bitNumber,
        bitOffset: bitNumber % 6,
        row,
        col,
        x: point.x,
        y: point.y,
        mean,
        spread,
        confidence,
      });
    }
  }

  return evidence.map((entry) => {
    const rankedBits = [...entry.bits].sort(
      (left, right) => left.confidence - right.confidence,
    );
    const weakest = rankedBits.slice(0, 2);
    return {
      ...entry,
      confidence: weakest.length
        ? weakest.reduce((sum, bit) => sum + bit.confidence, 0) / weakest.length
        : Number.POSITIVE_INFINITY,
      weakestBits: weakest,
    };
  });
}

function rankSoftDecisionCandidates(evidence, sampledCodewords, erasedMap, maxPerBlock = 7) {
  const groups = [
    Array.from({ length: 20 }, (_, index) => index),
    Array.from({ length: 62 }, (_, index) => 20 + index * 2),
    Array.from({ length: 62 }, (_, index) => 21 + index * 2),
  ];
  return groups.flatMap((indexes, block) => indexes
    .filter((index) => !erasedMap.has(index))
    .map((index) => {
      const entry = evidence[index];
      const weakestBits = entry.weakestBits.map((bit) => ({
        bitNumber: bit.bitNumber,
        bitOffset: bit.bitOffset,
        confidence: bit.confidence,
        mean: bit.mean,
        spread: bit.spread,
      }));
      const observedValue = sampledCodewords[index] & 0x3F;
      const singleBitAlternatives = weakestBits.map((bit) => (
        observedValue ^ (1 << (5 - bit.bitOffset))
      ));
      return {
        codewordIndex: index,
        block: block === 0 ? "primary" : block === 1 ? "secondary-even" : "secondary-odd",
        confidence: entry.confidence,
        observedValue,
        weakestBits,
        singleBitAlternatives,
      };
    })
    .sort((left, right) => left.confidence - right.confidence)
    .slice(0, maxPerBlock));
}

function retainBestSoftCandidate(candidates, candidate, limit) {
  candidates.push(candidate);
  candidates.sort((left, right) => right.candidateScore - left.candidateScore);
  if (candidates.length > limit) candidates.length = limit;
}

export function findPartialBullseyeCandidates(scanner, limit = 12) {
  const minDimension = Math.min(scanner.width, scanner.height);
  const step = Math.max(5, Math.round(minDimension / 105));
  const widths = [];
  for (let bandWidth = Math.max(2, minDimension / 420); bandWidth <= minDimension / 48; bandWidth *= 1.28) {
    widths.push(bandWidth);
  }
  const anchor = scanner.estimateDarkCentroid();
  const ranked = [];
  for (let y = step; y < scanner.height - step; y += step) {
    for (let x = step; x < scanner.width - step; x += step) {
      for (const bandWidth of widths) {
        const score = scanner.scoreBullseyeAtScale(x, y, bandWidth, anchor);
        if (score.score < 0.58 || score.contrast < 0.35) continue;
        // Partial rings tend to under-estimate the band scale. Inflate only the
        // crop hint; the cropped scanner measures the real scale again.
        ranked.push({ x, y, bandWidth: bandWidth * 1.45, patternScore: score.score });
      }
    }
  }
  ranked.sort((left, right) => right.patternScore - left.patternScore);

  const unique = [];
  for (const candidate of ranked) {
    const duplicate = unique.some((other) => (
      Math.hypot(other.x - candidate.x, other.y - candidate.y)
      < Math.max(other.bandWidth, candidate.bandWidth) * 5
    ));
    if (!duplicate) unique.push(candidate);
    if (unique.length >= limit) break;
  }
  return unique;
}

function recoveryDecode(decoded, sampledCodewords, erasedMap, context) {
  const erasedCodewords = [...erasedMap.keys()].sort((left, right) => left - right);
  const softDecisionPositions = context.softDecisionCandidates
    ? decoded.recovery.bruteForcePositions
    : [];
  const erasureCorrections = decoded.recovery.erasureCorrections.map((entry) => {
    const evidence = erasedMap.get(entry.codewordIndex) || [];
    if (entry.source !== "damage-erasure-reconstruction") return entry;
    return {
      ...entry,
      source: evidence.some((item) => item.reason === "low-sampling-confidence")
        ? "low-confidence-erasure-reconstruction"
        : "damage-band-erasure-reconstruction",
    };
  });
  return {
    decoded: true,
    mode: decoded.mode,
    modeGuess: `Mode ${decoded.mode}`,
    text: decoded.text,
    bytes: decoded.rawBytes,
    bits: decoded.rawBytes.map((value) => value.toString(2).padStart(8, "0")).join(""),
    density: sampledCodewords.reduce((sum, value) => sum + value.toString(2).replaceAll("0", "").length, 0) / 864,
    errorsCorrected: decoded.errorsCorrected,
    rotation: ((context.transform.angle * 180 / Math.PI) % 360 + 360) % 360,
    sourceRect: {
      centerX: context.center.x,
      centerY: context.center.y,
      ...context.transform,
    },
    recovery: {
      kind: context.softDecisionCandidates
        ? "soft-decision-chase-recovery"
        : "aggressive-erasure-recovery",
      verification: "all Reed-Solomon parity checks satisfied",
      threshold: context.threshold,
      attempts: context.attempts,
      directlySampledCodewords:
        144 - erasedCodewords.length - decoded.recovery.bruteForcePositions.length,
      erasedCodewords,
      damagedModules: Object.fromEntries(erasedMap),
      erasureCorrections,
      bruteForcePositions: decoded.recovery.bruteForcePositions,
      bruteForceAttempts: decoded.recovery.bruteForceAttempts,
      softDecisionPositions,
      softDecisionCandidates: context.softDecisionCandidates || [],
      softDecisionGeometriesTested: context.softDecisionAttempts || 0,
      reedSolomonCorrectionsAfterErasureRecovery:
        decoded.recovery.reedSolomonCorrectionsAfterErasureRecovery,
      damageBand: context.band,
      transform: context.transform,
    },
  };
}

function refineRecoveryGeometry(mask, gray, width, height, center, transform, threshold) {
  let best = { center: { ...center }, transform: { ...transform } };
  const score = (candidate) => scoreOrientedGridContrast(
    gray,
    width,
    height,
    candidate.center,
    candidate.transform,
    threshold,
  );
  best.score = score(best);
  let steps = {
    centerX: transform.modulePitch * 0.16,
    centerY: transform.modulePitch * 0.16,
    modulePitch: transform.modulePitch * 0.035,
    angle: 1.2 * Math.PI / 180,
    verticalScale: 0.045,
    shear: 1.8 * Math.PI / 180,
    perspectiveX: 0.0025,
    perspectiveY: 0.0025,
  };
  for (let iteration = 0; iteration < 4; iteration += 1) {
    for (const [parameter, amount] of Object.entries(steps)) {
      for (const direction of [-1, 1]) {
        const candidate = {
          center: { ...best.center },
          transform: { ...best.transform },
        };
        if (parameter === "centerX") candidate.center.x += amount * direction;
        else if (parameter === "centerY") candidate.center.y += amount * direction;
        else candidate.transform[parameter] += amount * direction;
        const candidateScore = score(candidate);
        if (candidateScore > best.score) best = { ...candidate, score: candidateScore };
      }
    }
    steps = Object.fromEntries(
      Object.entries(steps).map(([parameter, amount]) => [parameter, amount * 0.5]),
    );
  }
  return best;
}

/**
 * Opt-in recovery for visibly destroyed symbols. It performs a bounded search
 * over measured grid transforms and bright damage bands. A candidate is never
 * accepted on readable-looking text; exact Reed-Solomon parity is mandatory.
 */
export function recoverDamagedMaxiCode(imageData, options = {}) {
  const thresholds = options.thresholds || DEFAULT_THRESHOLDS;
  const maxAttempts = options.maxAttempts || 2400;
  let attempts = 0;
  let strongestFailure = null;
  let foundAnyCenter = false;
  const softFailures = [];
  let softDecisionAttempts = 0;

  for (const threshold of thresholds) {
    let thresholdAttempts = 0;
    const maxThresholdAttempts = Math.max(1, Math.floor(maxAttempts / thresholds.length));
    const scanner = new MaxiCodeScanner(imageData, { threshold });
    const center = scanner.findBullseye();
    if (!center.found) continue;
    foundAnyCenter = true;
    scanner.estimateModulePitch(center);
    const mask = scanner.binarize();
    const gray = scanner.grayscale();
    const orientations = scanner.findOrientationCandidates(mask).slice(0, options.maxOrientations || 18);
    if (!orientations.length) continue;
    const bandPitch = orientations[0].modulePitch;
    const detectedBands = options.damageBands || findBrightDamageBands(
      gray,
      imageData.width,
      imageData.height,
      center,
      bandPitch,
      options.maxBands || 8,
    );

    const geometries = [];
    for (const orientation of orientations.slice(0, 4)) {
      geometries.push(refineRecoveryGeometry(
        mask,
        gray,
        imageData.width,
        imageData.height,
        center,
        {
          modulePitch: orientation.modulePitch,
          angle: orientation.angle,
          verticalScale: orientation.verticalScale,
          perspectiveX: 0,
          perspectiveY: 0,
          shear: 0,
        },
        threshold,
      ));
    }
    for (const orientation of orientations.slice(0, 8)) {
      for (const [offsetX, offsetY] of [[0, 0], [-0.18, 0], [0.18, 0], [0, -0.18], [0, 0.18]]) {
        for (const angleOffset of [0, -1, 1]) {
          for (const pitchScale of [1, 0.98, 1.02]) {
            const modulePitch = orientation.modulePitch * pitchScale;
            geometries.push({
              center: {
                x: center.x + offsetX * modulePitch,
                y: center.y + offsetY * modulePitch,
              },
              transform: {
                modulePitch,
                angle: orientation.angle + angleOffset * Math.PI / 180,
                verticalScale: orientation.verticalScale,
                perspectiveX: 0,
                perspectiveY: 0,
                shear: 0,
              },
            });
          }
        }
      }
    }

    for (const geometry of geometries) {
      const adjustedCenter = geometry.center;
      const transform = geometry.transform;
      const codewords = sampleOrientedCodewords(
        mask,
        imageData.width,
        imageData.height,
        adjustedCenter,
        transform,
      );
      const softEvidence = sampleSoftDecisionEvidence(
        gray,
        imageData.width,
        imageData.height,
        adjustedCenter,
        transform,
        threshold,
      );

      for (const detected of detectedBands) {
        for (const widthFactor of options.widthFactors || [0.55, 0.8, 1.05, 1.3, 1.6]) {
          attempts += 1;
          thresholdAttempts += 1;
          if (thresholdAttempts > maxThresholdAttempts) break;
          const normalX = -Math.sin(detected.angle);
          const normalY = Math.cos(detected.angle);
          const band = {
            ...detected,
            offset: detected.offset
              - (adjustedCenter.x - center.x) * normalX
              - (adjustedCenter.y - center.y) * normalY,
            halfWidth: transform.modulePitch * widthFactor,
            halfLength: transform.modulePitch * 15,
          };
          const erasedMap = codewordsIntersectingBand(adjustedCenter, transform, band);
          if (options.useConfidenceErasures !== false) {
            addLowConfidenceErasures(
              gray,
              imageData.width,
              imageData.height,
              adjustedCenter,
              transform,
              threshold,
              erasedMap,
            );
          }
          const erased = [...erasedMap.keys()];
          if (!erased.length || !withinErasureCapacity(erased)) continue;
          try {
            const decoded = decodeMaxiCodeDataWithErasures(codewords, erased, {
              maxUnknownErrorsPerBlock: options.maxUnknownErrorsPerBlock ?? 1,
            });
            return {
              ok: true,
              center: adjustedCenter,
              pitch: transform.modulePitch,
              threshold,
              decode: recoveryDecode(decoded, codewords, erasedMap, {
                center: adjustedCenter,
                transform,
                threshold,
                attempts,
                band,
              }),
            };
          } catch (error) {
            const candidateScore = (detected.score || 0) - Math.abs(erased.length - 28) * 0.08;
            const softDecisionCandidates = rankSoftDecisionCandidates(
              softEvidence,
              codewords,
              erasedMap,
              options.maxSoftCandidatesPerBlock || 7,
            );
            const erasedSet = new Set(erased);
            const failure = {
              error: error?.message || String(error),
              erasedCodewords: erased.length,
              erasedCodewordIndexes: [...erased].sort((left, right) => left - right),
              directlySampledCodewords: Array.from(codewords, (value, index) => (
                erasedSet.has(index) ? null : { index, value }
              )).filter(Boolean),
              sampledCodewords: Array.from(codewords),
              candidateScore,
              threshold,
              center: adjustedCenter,
              damageBand: band,
              transform,
              verification: "failed; payload is not decoded or trusted",
              softDecisionCandidates,
            };
            if (!strongestFailure || candidateScore > strongestFailure.candidateScore) {
              strongestFailure = failure;
            }
            retainBestSoftCandidate(softFailures, {
              ...failure,
              sampledCodewords: Array.from(codewords),
              erasedMap,
              center: adjustedCenter,
              transform,
              threshold,
              band,
            }, options.maxSoftGeometries || 10);
          }
        }
        if (thresholdAttempts > maxThresholdAttempts) break;
      }
      if (thresholdAttempts > maxThresholdAttempts) break;
    }
  }

  // Stage two is reliability-guided and deliberately deferred until the
  // exhaustive geometry/erasure pass has failed. For each RS block it examines
  // only a short list of codewords containing the weakest sampled dots. The RS
  // solver derives replacement values and remains the sole acceptance oracle.
  for (const candidate of softFailures) {
    softDecisionAttempts += 1;
    try {
      const decoded = decodeMaxiCodeDataWithErasures(
        candidate.sampledCodewords,
        candidate.erasedCodewordIndexes,
        {
          maxUnknownErrorsPerBlock: options.maxSoftUnknownErrorsPerBlock ?? 2,
          unknownErrorCodewordCandidates: candidate.softDecisionCandidates.map(
            (entry) => entry.codewordIndex,
          ),
          positionSearchSource: "soft-decision-chase-search",
        },
      );
      return {
        ok: true,
        center: candidate.center,
        pitch: candidate.transform.modulePitch,
        threshold: candidate.threshold,
        decode: recoveryDecode(decoded, candidate.sampledCodewords, candidate.erasedMap, {
          center: candidate.center,
          transform: candidate.transform,
          threshold: candidate.threshold,
          attempts,
          band: candidate.band,
          softDecisionCandidates: candidate.softDecisionCandidates,
          softDecisionAttempts,
        }),
        softDecisionAttempts,
      };
    } catch {
      // Retain the ordinary failure observation; a soft hypothesis is never
      // promoted unless every parity equation succeeds.
    }
  }

  // Full shipping-label images often contain more ink than the symbol itself.
  // Reuse bullseye pattern candidates to form tight symbol crops, but only at
  // the outermost call so recovery remains bounded and deterministic.
  if (!foundAnyCenter && !options._region && options.roiRetry !== false) {
    const candidates = [];
    for (const threshold of [...new Set([...thresholds, 128, 152])]) {
      const locator = new MaxiCodeScanner(imageData, { threshold });
      const center = locator.findBullseye();
      if (Number.isFinite(center.bandWidth) && center.bandWidth > 0) candidates.push(center);
      candidates.push(...findPartialBullseyeCandidates(locator, 10));
      candidates.push(...locator.findBullseyePatternCandidates().slice(0, 12));
    }
    const seen = new Set();
    let triedRegions = 0;
    for (const candidate of candidates) {
      const region = cropRegionForCandidate(imageData, candidate);
      if (!region) continue;
      const key = `${region.left}:${region.top}:${region.width}:${region.height}`;
      if (seen.has(key)) continue;
      seen.add(key);
      triedRegions += 1;
      if (triedRegions > (options.maxRoiCandidates || 16)) break;
      const recovered = recoverDamagedMaxiCode(cropImageData(imageData, region), {
        ...options,
        _region: region,
        roiRetry: false,
      });
      attempts += recovered.attempts || 0;
      if (!recovered.ok) continue;
      recovered.center.x += region.left;
      recovered.center.y += region.top;
      recovered.scanRegion = region;
      if (recovered.decode?.sourceRect) {
        recovered.decode.sourceRect.centerX += region.left;
        recovered.decode.sourceRect.centerY += region.top;
      }
      const damagedModules = recovered.decode?.recovery?.damagedModules || {};
      for (const modules of Object.values(damagedModules)) {
        for (const module of modules) {
          module.x += region.left;
          module.y += region.top;
        }
      }
      return recovered;
    }
  }

  return {
    ok: false,
    attempts,
    softDecisionAttempts,
    error: "No parity-valid recovery was found within the bounded search",
    strongestFailure,
    observations: strongestFailure
      ? {
          ...strongestFailure,
          partialInterpretation: interpretObservedMaxiCode(
            strongestFailure.sampledCodewords,
            strongestFailure.erasedCodewordIndexes,
          ),
        }
      : null,
  };
}
