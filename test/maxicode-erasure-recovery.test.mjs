import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeMaxiCodeData,
  decodeMaxiCodeDataWithErasures,
} from "../src/maxicode/scanner.js";

// Corrected Mode 2 codewords from the New York golden label. Keeping parity
// symbols here lets the test exercise recovery independently of image geometry.
const GOLDEN_CODEWORDS = [
  2, 4, 57, 33, 31, 17, 2, 18, 35, 4, 49, 10, 61, 63, 55, 51, 39, 5, 20, 0,
  59, 42, 41, 59, 40, 30, 48, 49, 29, 57, 54, 49, 26, 57, 56, 54, 48, 51, 51, 55,
  56, 29, 21, 16, 19, 14, 29, 50, 54, 50, 1, 25, 57, 30, 48, 55, 6, 42, 14, 38,
  0, 23, 26, 19, 39, 20, 19, 32, 47, 39, 13, 28, 28, 15, 37, 8, 14, 21, 15, 12,
  5, 22, 20, 40, 45, 51, 14, 51, 57, 38, 21, 46, 40, 2, 40, 20, 12, 26, 12, 16,
  0, 30, 62, 4, 10, 1, 56, 47, 27, 16, 8, 56, 39, 40, 3, 45, 39, 25, 55, 34,
  54, 63, 42, 39, 26, 55, 53, 40, 20, 10, 60, 3, 1, 44, 0, 6, 4, 11, 20, 32,
  46, 47, 42, 48,
];

test("erasure recovery reconstructs losses beyond unknown-error capacity", () => {
  // Six primary erasures exceed the five unknown-error limit. Eleven losses in
  // each secondary interleave likewise exceed its ten unknown-error limit, but
  // remain within the respective erasure limits of 10 and 20.
  const erased = [1, 3, 6, 9, 12, 17];
  for (let index = 20; index < 42; index += 1) erased.push(index);

  const damaged = [...GOLDEN_CODEWORDS];
  for (const index of erased) damaged[index] = (damaged[index] ^ 0x2D) & 0x3F;

  assert.throws(() => decodeMaxiCodeData(damaged));
  const recovered = decodeMaxiCodeDataWithErasures(damaged, erased);
  const expected = decodeMaxiCodeData(GOLDEN_CODEWORDS);

  assert.equal(recovered.text, expected.text);
  assert.deepEqual(recovered.correctedCodewords, GOLDEN_CODEWORDS);
  assert.deepEqual(recovered.recovery.erasedCodewords, erased);
  assert.equal(recovered.recovery.erasureCorrections.length, erased.length);
  assert.equal(recovered.recovery.erasureCorrections.every((entry) => entry.changed), true);
  assert.equal(recovered.recovery.reedSolomonCorrectionsAfterErasureRecovery, 0);
});

test("erasure recovery refuses an over-capacity primary block", () => {
  assert.throws(
    () => decodeMaxiCodeDataWithErasures(GOLDEN_CODEWORDS, Array.from({ length: 11 }, (_, i) => i)),
    /Too many erasures/,
  );
});

test("bounded position search distinguishes an unmarked error from known damage", () => {
  const erased = [1, 3, 6, 9, 12, 17];
  const damaged = [...GOLDEN_CODEWORDS];
  for (const index of erased) damaged[index] = (damaged[index] ^ 0x2D) & 0x3F;
  damaged[15] ^= 0x11;

  assert.throws(() => decodeMaxiCodeDataWithErasures(damaged, erased));
  const recovered = decodeMaxiCodeDataWithErasures(damaged, erased, {
    maxUnknownErrorsPerBlock: 1,
  });

  assert.deepEqual(recovered.correctedCodewords, GOLDEN_CODEWORDS);
  assert.deepEqual(recovered.recovery.bruteForcePositions, [15]);
  assert.ok(recovered.recovery.bruteForceAttempts > 1);
  assert.equal(
    recovered.recovery.erasureCorrections.find((entry) => entry.codewordIndex === 15)?.source,
    "bounded-error-position-search",
  );
});

test("soft-decision candidates locate two additional wrong codewords", () => {
  const erased = [1, 3, 6, 9, 12, 17];
  const damaged = [...GOLDEN_CODEWORDS];
  for (const index of erased) damaged[index] = (damaged[index] ^ 0x2D) & 0x3F;
  damaged[14] ^= 0x09;
  damaged[15] ^= 0x11;

  assert.throws(() => decodeMaxiCodeDataWithErasures(damaged, erased, {
    maxUnknownErrorsPerBlock: 1,
  }));
  const recovered = decodeMaxiCodeDataWithErasures(damaged, erased, {
    maxUnknownErrorsPerBlock: 2,
    unknownErrorCodewordCandidates: [15, 14],
    positionSearchSource: "soft-decision-chase-search",
  });

  assert.deepEqual(recovered.correctedCodewords, GOLDEN_CODEWORDS);
  assert.deepEqual(recovered.recovery.bruteForcePositions, [14, 15]);
  assert.equal(
    recovered.recovery.erasureCorrections
      .filter((entry) => [14, 15].includes(entry.codewordIndex))
      .every((entry) => entry.source === "soft-decision-chase-search"),
    true,
  );
});

test("soft-decision search does not inspect positions outside its ranked list", () => {
  const erased = [1, 3, 6, 9, 12, 17];
  const damaged = [...GOLDEN_CODEWORDS];
  for (const index of erased) damaged[index] = (damaged[index] ^ 0x2D) & 0x3F;
  damaged[14] ^= 0x09;
  damaged[15] ^= 0x11;

  assert.throws(() => decodeMaxiCodeDataWithErasures(damaged, erased, {
    maxUnknownErrorsPerBlock: 2,
    unknownErrorCodewordCandidates: [10, 11, 13],
    positionSearchSource: "soft-decision-chase-search",
  }));
});
