import assert from "node:assert/strict";
import test from "node:test";
import { UpsMaxicodeDecoder } from "../src/ups/UpsMaxicodeDecoder.js";

const vectors = [
  {
    name: "shared destination payload from labels 66032, 66038 and 66039",
    payload: ")#$X2AFM*\rH&3WA,D4%J,HSH#-6E-%4EX(Z4%BYZIKCL\r",
    hex: "1241e993b3c8cf87ee5c5d1fd38293beaa0fe89dfbfcaf25513bed05f0281176",
    // The compressed source contains house number 1 although all three
    // supplied labels visibly print 10. Preserve the encoded value.
    text: `KORSCHENBROICH\x1d  \x1dJOHANN- GEORG- HALSKE- STRASSE 1\x1d`,
    complete: true,
    bitsConsumed: 252,
    trailingBits: "",
  },
  {
    name: "independent payload from label 66036",
    payload: "/A6SUOREB3-''G3R(\x1dL3\x1c+Q4IBZ9AT2W41)E084EM2ZS\r",
    hex: "1d81c74782531ffae98ba3fa7057d541fd3f7f95e4aa4c58bdb9b01f28ee9f5c",
    text: `\x1d\x1dZENTRALLAGER\x1dJOHANN GEORG HALSKE STR 10\x1d\x1dMEDILOX G`,
    complete: false,
    bitsConsumed: 247,
    trailingBits: "11100",
  },
  {
    name: "New York sample label",
    payload: "F*N&\rWZS'TS /'M\x1c\x1cO%HNUOLEVT(-3N39&U.(B(TLZLP\r",
    hex: "1891b6f412642d089a34116770630848efbd082142c46176e7d82a63c61ec4fa",
    // The printed label says 2ND. The compressed source explicitly ends the
    // field after 2N and continues with later fields, so preserve 2N.
    text: `0\x1d\x1dGROUND FLOOR  4TH CROSS ROAD  2N\x1d\x1dMAIN STREET\x1d-\x1d`,
    complete: false,
    bitsConsumed: 250,
    trailingBits: "10",
  },
  {
    name: "Amazon Teterboro label",
    payload: "FXF/GO*A' 971SO68XK\x1c\x1cDYI8LLX0VSLF7#$\x1dPTEK6\"S\r",
    hex: "1d9e79ea045350df7fe7f07462a12a1eea105bd842622f3ba849bf5373d07eda",
    text: `\x1d\x1d MMU9 E3 AMAZON RETURNS CR\x1d698 ROUTE 46 WEST\x1d\x1d\x1d`,
    complete: false,
    bitsConsumed: 250,
    trailingBits: "10",
  },
  {
    name: "Valentino Returns label",
    payload: "BTD'.F\x1cPSU)YLC)4X58OHC89OFO5PU\"(ZFN7X(ZZN*ZS\r",
    hex: "1d80c1ad2c3d548754fbb56da63f91d1e1d1a12a1eea105bf4f837f04a87ba84",
    text: `\x1d\x1d1620 STATELINE RD E\x1d\x1d\x1dVALENTINO RETURNS\x1d333\x1dRETUR`,
    complete: true,
    bitsConsumed: 252,
    trailingBits: "",
  },
  {
    name: "Los Angeles SurePost label",
    payload: "1$'T7J-YTG \x1c3DS%PC\x1d'+,#L70H%.7%-\rG&VXX\x1d,%H(J\r",
    hex: "1022eda97b30decc74e631479b2db7513ded87c17258bd3b9b0b3b9808ba6702",
    text: `1\x1d\x1d3585 S VERMONT AVE\x1d\x1d\x1dU`,
    complete: false,
    bitsConsumed: 120,
    trailingBits: "000100111101111011011000011111000001011100100101100010111101001110111001101100001011001110111001100000001000101110100110011100000010",
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
    assert.equal(result.fields.records.weightPounds.priority, 8);
    assert.equal(result.fields.records.weightPounds.source, "format07");
    const tracedRecords = Object.values(result.fields.records).filter((record) => record.bitRange);
    for (const record of tracedRecords) {
      assert.equal(record.bitRange.transportStart, record.bitRange.payloadStart + 4);
      assert.equal(record.bitRange.transportEnd, record.bitRange.payloadEnd + 4);
    }
  });
}

test("marks missing and truncated Format 07 slots without inventing values", () => {
  const completeShort = new UpsMaxicodeDecoder({
    transportDecoder: () => new Uint8Array(32),
    substitutionDecoder: () => ({ text: `STREET${UpsMaxicodeDecoder.GS}`, complete: true }),
  }).decode(`07${"A".repeat(45)}`);
  assert.equal(completeShort.fields.records.shipToAddressLine1.status, "present");
  assert.equal(completeShort.fields.records.shipToAddressLine2.status, "empty");
  assert.equal(completeShort.fields.records.weightPounds.status, "unavailable");
  assert.equal(completeShort.fields.records.shipToAddressLine1.bitRange, null);

  const partial = new UpsMaxicodeDecoder({
    transportDecoder: () => new Uint8Array(32),
    substitutionDecoder: () => ({ text: "STREET", complete: false }),
  }).decode(`07${"A".repeat(45)}`);
  assert.equal(partial.fields.records.shipToAddressLine1.status, "partial");
  assert.equal(partial.fields.records.shipToAddressLine1.value, null);
});

test("resolves the patent table's OA/HWY prefix overlap by longest match", () => {
  const dictionary = UpsMaxicodeDecoder.FORMAT_07_DICTIONARY;
  const oa = dictionary.find((entry) => entry.token === "OA");
  const hwy = dictionary.find((entry) => entry.token === "HWY");

  assert.equal(hwy.bits.startsWith(oa.bits), true);
  assert.equal(hwy.bits.length > oa.bits.length, true);
});
