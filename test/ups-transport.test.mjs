import assert from "node:assert/strict";
import test from "node:test";
import { UpsMaxicodeDecoder } from "../src/ups/UpsMaxicodeDecoder.js";

const vectors = [
  {
    name: "shared destination payload from labels SAMPLE-A, SAMPLE-D and SAMPLE-E",
    payload: "REDACTED07A\rREDACTED_FORMAT07_PAYLOAD_A\r",
    hex: "REDACTED_FORMAT07_HEX_A",
  },
  {
    name: "independent payload from label SAMPLE-C",
    payload: "REDACTED07B\x1dREDACTED_FORMAT07_PAYLOAD_B\r",
    hex: "REDACTED_FORMAT07_HEX_B",
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

test("returns an explicit diagnostic for the unresolved substitution stage", () => {
  const result = new UpsMaxicodeDecoder().decode(`07${vectors[0].payload}`);

  assert.equal(result.ok, false);
  assert.equal(result.version, "07");
  assert.equal(result.payloadSymbolCount, 45);
  assert.equal(result.transportHex, vectors[0].hex);
  assert.equal(result.decodedText, null);
  assert.equal(result.missingPatentSpecification[0].stage, "Fig. 4 substitution decoding");
});
