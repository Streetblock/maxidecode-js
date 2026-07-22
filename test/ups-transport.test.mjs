import assert from "node:assert/strict";
import test from "node:test";
import { UpsMaxicodeDecoder } from "../src/ups/UpsMaxicodeDecoder.js";

const vectors = [
  {
    name: "shared destination payload from labels SAMPLE-A, SAMPLE-D and SAMPLE-E",
    payload: "REDACTED07A\rREDACTED_FORMAT07_PAYLOAD_A\r",
    hex: "REDACTED_FORMAT07_HEX_A",
    // The compressed source contains house number 1 although all three
    // supplied labels visibly print 10. Preserve the encoded value.
    text: `TEST CITY\x1d  \x1dTEST STREET 1\x1d`,
    complete: true,
    bitsConsumed: 252,
    trailingBits: "",
  },
  {
    name: "independent payload from label SAMPLE-C",
    payload: "REDACTED07B\x1dREDACTED_FORMAT07_PAYLOAD_B\r",
    hex: "REDACTED_FORMAT07_HEX_B",
    text: `\x1d\x1dZENTRALLAGER\x1dTEST STREET 10\x1d\x1dMEDILOX G`,
    complete: false,
    bitsConsumed: 247,
    trailingBits: "11100",
  },
];

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

for (const vector of vectors) {
  test(`decodes ${vector.name}`, () => {
    assert.equal(toHex(UpsMaxicodeDecoder.decodeTransport(vector.payload)), vector.hex);
  });
}

test("requires all control characters in the 45-symbol payload", () => {
  assert.throws(
    () => UpsMaxicodeDecoder.decodeTransport(vectors[0].payload.replaceAll("\r", "")),
    /45 symbols/,
  );
});

for (const vector of vectors) {
  test(`expands substitutions for ${vector.name}`, () => {
    const result = new UpsMaxicodeDecoder().decode(`07${vector.payload}`);

    assert.equal(result.ok, true);
    assert.equal(result.version, "07");
    assert.equal(result.payloadSymbolCount, 45);
    assert.equal(result.transportHex, vector.hex);
    assert.deepEqual(result.header, {
      bits: "0001",
      value: 1,
      truncation: "unknown: US7039496B2 does not disclose the flag's bit layout",
    });
    assert.equal(result.decodedText, vector.text);
    assert.equal(result.decoder.complete, vector.complete);
    assert.equal(result.decoder.bitsConsumed, vector.bitsConsumed);
    assert.equal(result.decoder.bitsAvailable, 252);
    assert.equal(result.decoder.trailingBits, vector.trailingBits);
    assert.deepEqual(result.fields.segments, vector.text.split("\x1d"));
  });
}

test("resolves the patent table's OA/HWY prefix overlap by longest match", () => {
  const dictionary = UpsMaxicodeDecoder.FORMAT_07_DICTIONARY;
  const oa = dictionary.find((entry) => entry.token === "OA");
  const hwy = dictionary.find((entry) => entry.token === "HWY");

  assert.equal(hwy.bits.startsWith(oa.bits), true);
  assert.equal(hwy.bits.length > oa.bits.length, true);
});
