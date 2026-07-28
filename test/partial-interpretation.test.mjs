import test from "node:test";
import assert from "node:assert/strict";

import { interpretObservedMaxiCode } from "../src/maxicode/partialInterpretation.js";

test("marks only the first uninterrupted secondary run as synchronized", () => {
  const codewords = new Array(144).fill(33);
  codewords[20] = 1; // A in set 0
  codewords[21] = 2; // B in set 0
  codewords[22] = 3;
  codewords[23] = 4;

  const result = interpretObservedMaxiCode(codewords, [22]);
  const mode23 = result.assumptions.find((entry) => entry.label.startsWith("Modes 2/3"));

  assert.equal(result.verified, false);
  assert.equal(mode23.segments[0].synchronized, true);
  assert.equal(mode23.segments[0].interpretation.text, "AB");
  assert.equal(mode23.segments[1].synchronized, false);
  assert.equal(mode23.segments[1].alternatives.length, 5);
});

test("does not fabricate primary fields whose source codewords are erased", () => {
  const result = interpretObservedMaxiCode(new Array(144).fill(0), [0, 1, 8]);

  assert.equal(result.primary.mode2PostalCode.known, false);
  assert.ok(result.primary.mode2PostalCode.missingCodewords.includes(0));
  assert.equal(result.primary.countryCode.known, false);
  assert.ok(result.primary.countryCode.missingCodewords.includes(8));
});

test("extracts structurally plausible UPS carrier fragments without verifying them", () => {
  const codewords = new Array(144).fill(33);
  codewords.splice(20, 11, 59, 42, 41, 59, 40, 30, 48, 49, 29, 57, 54);
  codewords.splice(38, 14, 53, 53, 50, 29, 21, 16, 19, 14, 29, 51, 6, 52, 23, 51);
  codewords.splice(53, 4, 29, 48, 49, 53);

  const result = interpretObservedMaxiCode(codewords, [31, 34, 35, 36, 37, 52]);

  assert.equal(result.carrierEvidence.verified, false);
  assert.equal(result.carrierEvidence.ansiHeader.value, `[)>\x1e01\x1d96`);
  assert.equal(result.carrierEvidence.trackingSuffix.value, "552");
  assert.equal(result.carrierEvidence.scac.value, "UPSN");
  assert.equal(result.carrierEvidence.shipperIdFragment.value, "3F4W3");
  assert.equal(result.carrierEvidence.julianDayFragment.value, "015");
});

