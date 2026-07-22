import assert from "node:assert/strict";
import test from "node:test";
import { UpsMaxicodeDecoder } from "../src/ups/UpsMaxicodeDecoder.js";

const vectors = [
  {
    name: "shared destination payload from labels 66032, 66038 and 66039",
    payload: ")#$X2AFM*\rH&3WA,D4%J,HSH#-6E-%4EX(Z4%BYZIKCL\r",
    hex: "1241e993b3c8cf87ee5c5d1fd38293beaa0fe89dfbfcaf25513bed05f0281176",
  },
  {
    name: "independent payload from label 66036",
    payload: "/A6SUOREB3-''G3R(\x1dL3\x1c+Q4IBZ9AT2W41)E084EM2ZS\r",
    hex: "1d81c74782531ffae98ba3fa7057d541fd3f7f95e4aa4c58bdb9b01f28ee9f5c",
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
