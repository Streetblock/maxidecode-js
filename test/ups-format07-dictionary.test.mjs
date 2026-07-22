import assert from "node:assert/strict";
import test from "node:test";
import { FORMAT_07_DICTIONARY } from "../src/ups/format07Dictionary.js";

const byToken = new Map(FORMAT_07_DICTIONARY.map((entry) => [entry.token, entry]));

test("contains every active substitution row from patent figures 4A-4H", () => {
  assert.equal(FORMAT_07_DICTIONARY.length, 378);

  const figureCounts = Object.groupBy(FORMAT_07_DICTIONARY, (entry) => entry.figure);
  assert.deepEqual(
    Object.fromEntries(Object.entries(figureCounts).map(([figure, entries]) => [figure, entries.length])),
    { "4A": 52, "4B": 52, "4C": 52, "4D": 52, "4E": 52, "4F": 51, "4G": 51, "4H": 16 },
  );
});

test("preserves representative and visually verified rows", () => {
  const expected = {
    "\x1d": ["110", "4A"],
    "00": ["11100000", "4A"],
    "BOX": ["1000001000", "4C"],
    "DRS": ["1011000100000100", "4D"],
    "ION": ["101001001", "4E"],
    "PARC": ["001011111100", "4F"],
    "STR": ["00110001", "4G"],
    "UPS": ["10001001000010", "4H"],
  };

  for (const [token, [bits, figure]] of Object.entries(expected)) {
    assert.deepEqual(byToken.get(token), { token, bits, figure });
  }
});

test("assigns one unique bit value to each substitution row", () => {
  assert.equal(new Set(FORMAT_07_DICTIONARY.map((entry) => entry.bits)).size, 378);
});

test("documents why the patent table cannot be decoded as a simple prefix trie", () => {
  const conflicts = FORMAT_07_DICTIONARY.flatMap((shortEntry) =>
    FORMAT_07_DICTIONARY
      .filter(
        (longEntry) =>
          longEntry !== shortEntry && longEntry.bits.startsWith(shortEntry.bits),
      )
      .map((longEntry) => `${shortEntry.token}->${longEntry.token}`),
  );

  assert.deepEqual(conflicts, ["OA->HWY"]);
});
