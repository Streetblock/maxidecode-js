import assert from "node:assert/strict";
import test from "node:test";
import { UpsMaxicodeDecoder } from "../src/ups/UpsMaxicodeDecoder.js";

const vectors = [
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
    text: `1\x1d\x1d3585 S VERMONT AVE\x1d\x1d\x1dUSPS 90006\x1d144\x1d\x1dN4\x1d1/`,
    complete: false,
    bitsConsumed: 244,
    trailingBits: "00000010",
  },
  {
    name: "Avery Monarch compressed MaxiCode sample",
    // Avery 9800 Series Packet Reference Manual, Samples A-5. This is the
    // coherent batch-data vector on the lower half of the printed page.
    payload: "#P36 (AWO'$6,X3&W6HMJAL-7WK0 8YU,)92+'#I%\x1d#S\r",
    hex: "1da2c192fcaa4cefde62944aa6da34796264e9baa6ef1236890b1133bb8bbfb7",
    text: `\x1d\x1d1001 PARCEL LANE\x1dBUNDLE OFFICE PARK\x1dSUITE 500\x1dUPS\x1d348\x1dJA`,
    complete: false,
    bitsConsumed: 244,
    trailingBits: "10110111",
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
      truncationFlag: null,
      interpretation: "unknown: US7039496B2 does not disclose the flag's bit layout",
    });
    assert.deepEqual(result.sourceTruncation, {
      status: "unknown",
      reason: "The four framing bits are isolated, but their truncation-flag layout is not disclosed by US7039496B2.",
    });
    assert.equal(
      result.decoder.substitutionStatus,
      vector.complete ? "expanded" : "unresolved-tail",
    );
    assert.equal(result.decodedText, vector.text);
    assert.equal(result.decoder.complete, vector.complete);
    assert.equal(result.decoder.bitsConsumed, vector.bitsConsumed);
    assert.equal(result.decoder.bitsAvailable, 252);
    assert.equal(result.decoder.trailingBits, vector.trailingBits);
    assert.deepEqual(result.fields.segments, vector.text.split("\x1d"));
    assert.equal(result.fields.records.weightPounds.priority, 8);
    assert.equal(result.fields.records.weightPounds.compressionIndex, 9);
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
  assert.equal(completeShort.fields.records.shipToCity.status, "present");
  assert.equal(completeShort.fields.records.shipToState.status, "empty");
  assert.equal(completeShort.fields.records.shipToAddressLine1.status, "unavailable");
  assert.equal(completeShort.fields.records.weightPounds.status, "unavailable");
  assert.equal(completeShort.fields.records.shipToAddressLine1.bitRange, null);

  const partial = new UpsMaxicodeDecoder({
    transportDecoder: () => new Uint8Array(32),
    substitutionDecoder: () => ({ text: `${UpsMaxicodeDecoder.GS}${UpsMaxicodeDecoder.GS}STREET`, complete: false }),
  }).decode(`07${"A".repeat(45)}`);
  assert.equal(partial.fields.records.shipToAddressLine1.status, "partial");
  assert.equal(partial.fields.records.shipToAddressLine1.value, null);
});

test("accepts a decimal weight in the Format 07 priority field", () => {
  const decoder = new UpsMaxicodeDecoder();
  const text = [
    "HAMBURG",
    "",
    "KARPFANGERSTRASSE 16",
    "",
    "",
    "",
    "209",
    "",
    "N",
    "0.5",
    "1/1",
    "",
  ].join(UpsMaxicodeDecoder.GS);

  const result = decoder.parseCompressionPriorityFields(text);

  assert.equal(result.records.weightPounds.value, "0.5");
  assert.equal(result.records.weightPounds.valid, true);
  assert.equal(result.records.weightPounds.status, "present");
});
