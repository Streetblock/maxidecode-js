import assert from "node:assert/strict";
import test from "node:test";
import {
  FORMAT_07_DICTIONARY,
  FORMAT_07_PADDING_ROW_COUNT,
  FORMAT_07_PATENT_ROW_COUNT,
} from "../src/ups/format07Dictionary.js";

const byToken = new Map(FORMAT_07_DICTIONARY.map((entry) => [entry.token, entry]));
const substitutionIdentity = ({ token, bits, figure }) => ({ token, bits, figure });
const numericColumns = ({ bitLength, patentAuxiliary, unsubstitutedBitLength }) => ({
  bitLength,
  patentAuxiliary,
  unsubstitutedBitLength,
});

test("contains every active substitution row from patent figures 4A-4H", () => {
  assert.equal(FORMAT_07_DICTIONARY.length, 380);
  assert.equal(FORMAT_07_PADDING_ROW_COUNT, 36);
  assert.equal(FORMAT_07_PATENT_ROW_COUNT, 416);

  const figureCounts = Object.groupBy(FORMAT_07_DICTIONARY, (entry) => entry.figure);
  assert.deepEqual(
    Object.fromEntries(Object.entries(figureCounts).map(([figure, entries]) => [figure, entries.length])),
    { "4A": 52, "4B": 52, "4C": 52, "4D": 52, "4E": 52, "4F": 52, "4G": 52, "4H": 16 },
  );
});

test("preserves representative and visually verified rows", () => {
  const expected = {
    "\x1d": ["110", "4A"],
    "00": ["11100000", "4A"],
    "BOX": ["1000001000", "4C"],
    "DRS": ["1011000100000100", "4D"],
    "HWY": ["0011000001", "4E"],
    "ION": ["101001001", "4E"],
    "OA": ["00010000", "4F"],
    "PARC": ["001011111100", "4F"],
    "REET": ["111000010", "4F"],
    "SP": ["000100111", "4G"],
    "STR": ["00110001", "4G"],
    "UPS": ["10001001000010", "4H"],
  };

  for (const [token, [bits, figure]] of Object.entries(expected)) {
    assert.deepEqual(substitutionIdentity(byToken.get(token)), { token, bits, figure });
  }
});

test("preserves every numeric column printed in the patent table", () => {
  assert.equal(byToken.get("HWY").bitLength, 10);
  assert.equal(byToken.get("OA").bitLength, 8);
  assert.deepEqual(
    numericColumns(byToken.get("00")),
    { bitLength: 8, patentAuxiliary: 0, unsubstitutedBitLength: 28 },
  );
  assert.deepEqual(
    numericColumns(byToken.get("ISLE")),
    { bitLength: 15, patentAuxiliary: 0, unsubstitutedBitLength: 23 },
  );
  assert.deepEqual(
    numericColumns(byToken.get("REET")),
    { bitLength: 9, patentAuxiliary: 0, unsubstitutedBitLength: 27 },
  );
  assert.deepEqual(
    numericColumns(byToken.get("SP")),
    { bitLength: 9, patentAuxiliary: 0, unsubstitutedBitLength: 14 },
  );

  for (const entry of FORMAT_07_DICTIONARY) {
    assert.equal(entry.bitLength, entry.bits.length, entry.token);
    assert.equal(entry.patentAuxiliary, 0, entry.token);
    assert.equal(Object.isFrozen(entry), true, entry.token);
  }
});

test("retains the patent's substitution-row order", () => {
  const tokens = FORMAT_07_DICTIONARY.map(({ token }) => token);
  assert.deepEqual(tokens, [...tokens].sort());
  for (const [before, after] of [
    ["CRST", "CSWY"],
    ["DR", "DRS"],
    ["HILL", "HLS"],
    ["IO", "ION"],
    ["IT", "IVE"],
    ["ORCH", "OU"],
    ["P", "PARC"],
    ["V", "VIA"],
  ]) {
    assert.equal(tokens.indexOf(after), tokens.indexOf(before) + 1, `${before} -> ${after}`);
  }
  assert.deepEqual(
    FORMAT_07_DICTIONARY.map(({ patentRow }) => patentRow),
    Array.from({ length: 380 }, (_, index) => index + 1),
  );
});

test("assigns one unique bit value to each substitution row", () => {
  assert.equal(new Set(FORMAT_07_DICTIONARY.map((entry) => entry.bits)).size, 380);
});

test("forms a prefix-free substitution code", () => {
  const conflicts = FORMAT_07_DICTIONARY.flatMap((shortEntry) =>
    FORMAT_07_DICTIONARY
      .filter(
        (longEntry) =>
          longEntry !== shortEntry && longEntry.bits.startsWith(shortEntry.bits),
      )
      .map((longEntry) => `${shortEntry.token}->${longEntry.token}`),
  );

  assert.deepEqual(conflicts, []);
});
