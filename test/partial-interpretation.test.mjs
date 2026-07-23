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

