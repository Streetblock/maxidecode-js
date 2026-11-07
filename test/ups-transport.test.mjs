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

const gsTerminatedPayload = "TKV8NJDE02BNK2X26HF1'GT:7XHJK8FO8**RA0F+Q  J\r";
const gsTerminatedHex = "0ff43fe00db6891a246022edad01176022e99c08bb5ff4fe200c000000000000";
const gsTerminatedGroups = ["A", "CA", "#", "", "", "", "001", "", "Y1", "1/1", "SHIP#"];
const gs = UpsMaxicodeDecoder.GS;
const gsTerminatedText = gsTerminatedGroups.join(gs) + gs;

test("the GS-terminated schema preserves literal # and removes only the padding after the eleventh GS", () => {
  const decoder = new UpsMaxicodeDecoder({ framing: "gs-terminated" });
  const result = decoder.decode("07" + gsTerminatedPayload);

  assert.equal(result.transportHex, gsTerminatedHex);
  assert.equal(result.payloadSymbolCount, 45);
  assert.equal(result.header.bits, "0000");
  assert.equal(result.fieldTermination.status, "complete");
  assert.equal(result.fieldTermination.gsCount, 11);
  assert.equal(result.fieldTermination.endBit, 203);
  assert.equal(result.fieldTermination.paddingBits, 49);
  assert.equal(result.sourceTruncation.status, "not-truncated");
  assert.equal(result.decodedText, gsTerminatedText);
  assert.equal(result.decoder.bitsConsumed, 203);
  assert.equal(result.decoder.trailingBits, "");
  assert.equal(result.decoder.complete, true);
  assert.deepEqual(result.fields.segments, gsTerminatedGroups);

  const { records } = result.fields;
  for (const [field, value, start, end] of [
    ["shipToAddressLine1", "#", 24, 32],
    ["addressValidation", "Y", 94, 101],
    ["weightPounds", "1", 101, 117],
    ["packageInShipment", "1/1", 120, 162],
    ["shipmentId", "SHIP#", 165, 200],
  ]) {
    assert.equal(records[field].value, value, field);
    assert.equal(records[field].terminatedByGs, true, field);
    assert.deepEqual(records[field].bitRange, {
      payloadStart: start,
      payloadEnd: end,
      transportStart: start + 4,
      transportEnd: end + 4,
    }, field);
  }
});

// Extending the shipment ID moves the final GS to the header thresholds.
for (const { bits, header, payload, shipmentId } of [
  {
    bits: 248,
    header: "0000",
    payload: "$JEZ\x1c\"O$78BNK2X26HF1'GT:7XHJK8FO8**RA0F+Q  J\r",
    shipmentId: "SHIPZQQQA#",
  },
  {
    bits: 249,
    header: "0001",
    payload: "5/$G HZD9'\x1c43U\"1TTRA43G2W6KT6+Y5E)E\r)VZES,EU\r",
    shipmentId: "SHIPQQQQA#",
  },
  {
    bits: 252,
    header: "0001",
    payload: "LH0\x1d&S8ZS\"\x1c43U\"1TTRA43G2W6KT6+Y5E)E\r)VZES,EU\r",
    shipmentId: "SHIPZQQQQ#",
  },
]) {
  test("accepts a complete GS-terminated record at bit " + bits, () => {
    const result = new UpsMaxicodeDecoder().decode("07" + payload, { framing: "gs-terminated" });

    assert.equal(result.header.bits, header);
    assert.equal(result.fieldTermination.status, "complete");
    assert.equal(result.fieldTermination.endBit, bits);
    assert.equal(result.fieldTermination.paddingBits, 252 - bits);
    assert.equal(result.sourceTruncation.status, "not-truncated");
    assert.equal(result.decoder.complete, true);
    assert.equal(result.fields.records.shipmentId.value, shipmentId);
  });
}

test("rejects a final GS after bit 248 when the header is 0000", () => {
  const payload = "W5E4US0I\"CCNK2X26HF1'GT:7XHJK8FO8**RA0F+Q  J\r";
  const result = new UpsMaxicodeDecoder({ framing: "gs-terminated" }).decode("07" + payload);

  assert.equal(result.header.bits, "0000");
  assert.equal(result.fieldTermination.status, "header-mismatch");
  assert.equal(result.fieldTermination.endBit, 249);
  assert.equal(result.fieldTermination.paddingBits, null);
  assert.equal(result.decoder.trailingBits, "000");
});

// The final GS is cut inside its codeword in one vector and entirely in the other.
for (const { payload, shipmentId, bitsConsumed, trailingBits } of [
  {
    payload: "Z1*A HZD9'\x1c43U\"1TTRA43G2W6KT6+Y5E)E\r)VZES,EU\r",
    shipmentId: "SHIPQQQQQ#",
    bitsConsumed: 250,
    trailingBits: "11",
  },
  {
    payload: "NF*G HZD9'\x1c43U\"1TTRA43G2W6KT6+Y5E)E\r)VZES,EU\r",
    shipmentId: "SHIPQQQQAA#",
    bitsConsumed: 252,
    trailingBits: "",
  },
]) {
  test("reports the missing final GS after " + bitsConsumed + " decoded bits", () => {
    const result = new UpsMaxicodeDecoder({ framing: "gs-terminated" }).decode("07" + payload);

    assert.equal(result.payloadSymbolCount, 45);
    assert.equal(result.header.bits, "0001");
    assert.equal(result.fieldTermination.status, "missing-final-gs");
    assert.equal(result.fieldTermination.gsCount, 10);
    assert.equal(result.fieldTermination.paddingBits, null);
    assert.ok(result.fieldTermination.reason);
    assert.equal(result.sourceTruncation.status, "possible");
    assert.equal(result.decodedText, gsTerminatedGroups.slice(0, -1).join(gs) + gs + shipmentId);
    assert.equal(result.decoder.bitsConsumed, bitsConsumed);
    assert.equal(result.decoder.trailingBits, trailingBits);
    assert.equal(result.decoder.complete, trailingBits === "");
    assert.equal(result.fields.records.shipmentId.status, "partial");
    assert.equal(result.fields.records.shipmentId.value, null);
  });
}

for (const { status, payload, hex, trailingBits } of [
  {
    status: "nonzero-suffix",
    payload: "UKV8NJDE02BNK2X26HF1'GT:7XHJK8FO8**RA0F+Q  J\r",
    hex: gsTerminatedHex.slice(0, -1) + "1",
    trailingBits: "1",
  },
  {
    status: "header-mismatch",
    payload: "2E5KV:,:KX\x1c43U\"1TTRA43G2W6KT6+Y5E)E\r)VZES,EU\r",
    hex: "1" + gsTerminatedHex.slice(1),
    trailingBits: "0",
  },
  {
    status: "unknown-header",
    payload: "Q\rUZ /V5&A8\x1c 8'01#\"LE%6)6TO\"&\x1c0\x1dN'\x1c(QA2ZT7(#\r",
    hex: "2" + gsTerminatedHex.slice(1),
    trailingBits: "0",
  },
]) {
  test("keeps raw substitutions for GS termination status " + status, () => {
    const result = new UpsMaxicodeDecoder({ framing: "gs-terminated" }).decode("07" + payload);

    assert.equal(result.transportHex, hex);
    assert.equal(result.fieldTermination.status, status);
    assert.equal(result.fieldTermination.paddingBits, null);
    assert.ok(result.fieldTermination.reason);
    assert.equal(result.decodedText, gsTerminatedText + "######");
    assert.equal(result.decoder.bitsConsumed, 251);
    assert.equal(result.decoder.trailingBits, trailingBits);
    assert.equal(result.decoder.complete, false);
  });
}
