import { MAXICODE_CHARSETS } from "./scanner.js";

const PRIMARY_FIELDS = Object.freeze({
  postalLength: [39, 40, 41, 42, 31, 32],
  postalNumeric: [33, 34, 35, 36, 25, 26, 27, 28, 29, 30, 19, 20, 21, 22, 23, 24, 13, 14, 15, 16, 17, 18, 7, 8, 9, 10, 11, 12, 1, 2],
  postalAlphaNumeric: [
    [39, 40, 41, 42, 31, 32],
    [33, 34, 35, 36, 25, 26],
    [27, 28, 29, 30, 19, 20],
    [21, 22, 23, 24, 13, 14],
    [15, 16, 17, 18, 7, 8],
    [9, 10, 11, 12, 1, 2],
  ],
  country: [53, 54, 43, 44, 45, 46, 47, 48, 37, 38],
  service: [55, 56, 57, 58, 59, 60, 49, 50, 51, 52],
});

function codewordsForBits(positions) {
  return [...new Set(positions.map((position) => Math.floor((position - 1) / 6)))].sort(
    (left, right) => left - right,
  );
}

function readKnownBits(codewords, erased, positions) {
  const requiredCodewords = codewordsForBits(positions);
  const missingCodewords = requiredCodewords.filter((index) => erased.has(index));
  if (missingCodewords.length) return { known: false, missingCodewords };
  let value = 0;
  for (const position of positions) {
    const bit = position - 1;
    value = (value << 1) | ((codewords[Math.floor(bit / 6)] >> (5 - (bit % 6))) & 1);
  }
  return { known: true, value, requiredCodewords };
}

function primaryInterpretations(codewords, erased) {
  const country = readKnownBits(codewords, erased, PRIMARY_FIELDS.country);
  const service = readKnownBits(codewords, erased, PRIMARY_FIELDS.service);
  const postalLength = readKnownBits(codewords, erased, PRIMARY_FIELDS.postalLength);
  const postalNumeric = readKnownBits(codewords, erased, PRIMARY_FIELDS.postalNumeric);
  const postalAlphaNumeric = PRIMARY_FIELDS.postalAlphaNumeric.map((positions) => (
    readKnownBits(codewords, erased, positions)
  ));

  return {
    countryCode: country.known
      ? { known: true, value: String(country.value).padStart(3, "0") }
      : country,
    serviceClass: service.known
      ? { known: true, value: String(service.value).padStart(3, "0") }
      : service,
    mode2PostalCode: postalLength.known && postalNumeric.known
      ? {
          known: true,
          value: String(postalNumeric.value).padStart(postalLength.value, "0"),
          encodedLength: postalLength.value,
        }
      : {
          known: false,
          missingCodewords: [...new Set([
            ...(postalLength.missingCodewords || []),
            ...(postalNumeric.missingCodewords || []),
          ])].sort((left, right) => left - right),
        },
    mode3PostalCode: postalAlphaNumeric.every((part) => part.known)
      ? {
          known: true,
          value: postalAlphaNumeric
            .map((part) => MAXICODE_CHARSETS[0].charAt(part.value))
            .join(""),
        }
      : {
          known: false,
          missingCodewords: [...new Set(postalAlphaNumeric.flatMap(
            (part) => part.missingCodewords || [],
          ))].sort((left, right) => left - right),
        },
  };
}

function decodeKnownRun(values, initialSet) {
  let text = "";
  let set = initialSet;
  let lastSet = initialSet;
  let shift = -1;
  let complete = true;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index].value;
    const character = MAXICODE_CHARSETS[set].charAt(value);
    switch (character) {
      case "\uFFF7":
        set = 0;
        shift = -1;
        break;
      case "\uFFF8":
        set = 1;
        shift = -1;
        break;
      case "\uFFF0":
      case "\uFFF1":
      case "\uFFF2":
      case "\uFFF3":
      case "\uFFF4":
        lastSet = set;
        set = character.charCodeAt(0) - 0xFFF0;
        shift = 1;
        break;
      case "\uFFF5":
        lastSet = set;
        set = 0;
        shift = 2;
        break;
      case "\uFFF6":
        lastSet = set;
        set = 0;
        shift = 3;
        break;
      case "\uFFFB": {
        if (index + 5 >= values.length) {
          complete = false;
          index = values.length;
          break;
        }
        let numeric = 0;
        for (let count = 0; count < 5; count += 1) numeric = (numeric << 6) + values[++index].value;
        text += String(numeric).padStart(9, "0");
        break;
      }
      case "\uFFF9":
        shift = -1;
        break;
      default:
        text += character;
    }
    if (shift-- === 0) set = lastSet;
  }

  while (text.endsWith("\uFFFC")) text = text.slice(0, -1);
  return { text, complete, finalSet: set };
}

function splitKnownRuns(logicalIndexes, codewords, erased) {
  const runs = [];
  let current = [];
  let gapBefore = false;
  for (const codewordIndex of logicalIndexes) {
    if (erased.has(codewordIndex)) {
      if (current.length) runs.push({ values: current, gapBefore });
      current = [];
      gapBefore = true;
      continue;
    }
    current.push({ codewordIndex, value: codewords[codewordIndex] & 0x3F });
  }
  if (current.length) runs.push({ values: current, gapBefore });
  return runs;
}

function interpretLogicalMessage(logicalIndexes, codewords, erased, label) {
  const runs = splitKnownRuns(logicalIndexes, codewords, erased);
  return {
    label,
    logicalCodewordRange: [logicalIndexes[0], logicalIndexes.at(-1)],
    segments: runs.map((run, index) => {
      const range = [run.values[0].codewordIndex, run.values.at(-1).codewordIndex];
      if (index === 0 && !run.gapBefore) {
        return {
          range,
          synchronized: true,
          confidence: "direct until first erased codeword",
          interpretation: decodeKnownRun(run.values, 0),
        };
      }
      const alternatives = MAXICODE_CHARSETS.map((_, initialSet) => ({
        initialSet,
        ...decodeKnownRun(run.values, initialSet),
      }));
      const uniqueTexts = [...new Set(alternatives.map((candidate) => candidate.text))];
      return {
        range,
        synchronized: uniqueTexts.length === 1,
        confidence: uniqueTexts.length === 1
          ? "same text in every possible starting character set"
          : "starting character set is unknown after an erasure",
        ...(uniqueTexts.length === 1
          ? { consensus: uniqueTexts[0], alternatives }
          : { alternatives }),
      };
    }),
  };
}

export function interpretObservedMaxiCode(codewords, erasedCodewords) {
  const values = Array.from(codewords, (value) => value & 0x3F);
  const erased = new Set(erasedCodewords);
  return {
    verified: false,
    warning: "Diagnostic interpretation only; Reed-Solomon verification failed.",
    primary: primaryInterpretations(values, erased),
    assumptions: [
      interpretLogicalMessage(
        Array.from({ length: 84 }, (_, index) => 20 + index),
        values,
        erased,
        "Modes 2/3 secondary message",
      ),
      interpretLogicalMessage(
        [...Array.from({ length: 9 }, (_, index) => 1 + index), ...Array.from({ length: 84 }, (_, index) => 20 + index)],
        values,
        erased,
        "Mode 4 message",
      ),
      interpretLogicalMessage(
        [...Array.from({ length: 9 }, (_, index) => 1 + index), ...Array.from({ length: 68 }, (_, index) => 20 + index)],
        values,
        erased,
        "Mode 5 message",
      ),
    ],
  };
}

