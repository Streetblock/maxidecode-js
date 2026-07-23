import assert from "node:assert/strict";
import test from "node:test";
import { UpsMaxicodeReader } from "../src/ups/UpsMaxicodeReader.js";

const GS = "\x1d";
const RS = "\x1e";
const EOT = "\x04";
const payload = ")#$X2AFM*\rH&3WA,D4%J,HSH#-6E-%4EX(Z4%BYZIKCL\r";
const routing = [
  "01",
  "9641352",
  "276",
  "068",
  "1Z50147020",
  "UPSN",
  "123A7V",
].join(GS);
const message = `[)>${RS}${routing}${RS}07${payload}${RS}${EOT}`;

test("reads routing and compressed segments without losing payload controls", () => {
  const result = new UpsMaxicodeReader().read(message);

  assert.equal(result.recognized, true);
  assert.equal(result.standardEnvelope, true);
  assert.equal(result.format, "01");
  assert.equal(result.format01Header, "96");
  assert.equal(result.primary.postalCode, "41352");
  assert.equal(result.primary.countryCode, "276");
  assert.equal(result.primary.serviceClass, "068");
  assert.equal(result.secondary.trackingNumberEncoded, "1Z50147020");
  assert.equal(result.secondary.scac, "UPSN");
  assert.equal(result.secondary.shipperId, "123A7V");
  assert.equal(result.secondary.trackingNumberReconstructed, "1Z123A7V6850147020");
  assert.deepEqual(result.secondary.trackingNumberReconstructedFrom, [
    "trackingNumberEncoded",
    "shipperId",
    "serviceClass",
  ]);
  assert.equal(result.secondary.julianDayOfPickup, null);
  assert.equal(result.secondary.shipmentId, null);
  assert.deepEqual(result.secondary.unknownFields, []);
  assert.equal(result.compressed.payload, payload);
  assert.equal(
    result.compressed.transportHex,
    "1241e993b3c8cf87ee5c5d1fd38293beaa0fe89dfbfcaf25513bed05f0281176",
  );
  assert.equal(
    result.compressed.decodedText,
    `KORSCHENBROICH${GS}  ${GS}JOHANN- GEORG- HALSKE- STRASSE 1${GS}`,
  );
  assert.deepEqual(result.compressed.fields.nonEmptySegments, [
    "KORSCHENBROICH",
    "JOHANN- GEORG- HALSKE- STRASSE 1",
  ]);
  assert.equal(result.destination.city, "KORSCHENBROICH");
  assert.equal(result.destination.addressLine1, "JOHANN- GEORG- HALSKE- STRASSE 1");
});

test("reports a carrier-neutral MaxiCode message as unrecognized", () => {
  const result = new UpsMaxicodeReader().read("plain MaxiCode data");

  assert.equal(result.recognized, false);
  assert.equal(result.format01Header, null);
  assert.equal(result.primary, null);
  assert.equal(result.secondary, null);
});

test("requires the fixed 96 literal in the Format 01 header", () => {
  const invalidRouting = ["01", "9541352", "276", "068"].join(GS);

  assert.throws(
    () => new UpsMaxicodeReader().read(`[)>${RS}${invalidRouting}${RS}${EOT}`),
    /fixed 01<GS>96 header/,
  );
});

test("does not fabricate a tracking number from incomplete routing data", () => {
  const reader = new UpsMaxicodeReader();

  assert.equal(
    reader.reconstructTrackingNumber({
      trackingFragment: "1Z50147020",
      shipperId: "",
      serviceClass: "068",
    }),
    null,
  );
});

test("accepts the optional GS after the UPSN carrier SCAC", () => {
  const routingWithoutScacSeparator = [
    "01",
    "9641352",
    "276",
    "068",
    "1Z50147020",
    "UPSN123A7V",
    "196",
  ].join(GS);
  const result = new UpsMaxicodeReader().read(
    `[)>${RS}${routingWithoutScacSeparator}${RS}${EOT}`,
  );

  assert.equal(result.secondary.scac, "UPSN");
  assert.equal(result.secondary.shipperId, "123A7V");
  assert.equal(result.secondary.julianDayOfPickup, "196");
  assert.equal(result.secondary.trackingNumberReconstructed, "1Z123A7V6850147020");
});

test("parses the documented uncompressed UPS detail fields", () => {
  // Field order from the UPS MaxiCode example in the Avery 9433 printer manual.
  const uncompressedRouting = [
    "01",
    "96450660000",
    "840",
    "001",
    "1Z12345678",
    "UPSN",
    "12345A",
    "070",
    "",
    "1/1",
    "15",
    "Y",
    "60 SADDLEBROOK CT.",
    "DAYTON",
    "OH",
  ].join(GS);
  const result = new UpsMaxicodeReader().read(`[)>${RS}${uncompressedRouting}${RS}${EOT}`);

  assert.equal(result.recognized, true);
  assert.equal(result.format01Header, "96");
  assert.deepEqual(result.primary, {
    postalCode: "450660000",
    countryCode: "840",
    serviceClass: "001",
  });
  assert.equal(result.secondary.trackingNumberEncoded, "1Z12345678");
  assert.equal(result.secondary.trackingNumberReconstructed, "1Z12345A0112345678");
  assert.equal(result.secondary.julianDayOfPickup, "070");
  assert.equal(result.secondary.shipmentId, null);
  assert.equal(result.secondary.packageInShipment, "1/1");
  assert.equal(result.secondary.weightPounds, "15");
  assert.equal(result.secondary.addressValidation, "Y");
  assert.equal(result.secondary.shipToStreet, "60 SADDLEBROOK CT.");
  assert.equal(result.secondary.shipToCity, "DAYTON");
  assert.equal(result.secondary.shipToState, "OH");
  assert.deepEqual(result.secondary.unknownFields, []);
  assert.equal(result.compressed, null);
});

test("parses the IDAutomation uncompressed UPS golden message", () => {
  // IDAutomation MaxiCode FAQ example, preserving every GS, RS and EOT.
  const idAutomationMessage = [
    `[)>${RS}01`,
    "96336091062",
    "840",
    "002",
    "1Z14647438",
    "UPSN",
    "410E1W",
    "195",
    "", // Shipment ID intentionally empty.
    "1/1",
    "", // Package weight intentionally empty.
    "Y",
    "135Lightner",
    "TAMPA",
    "FL",
  ].join(GS) + RS + EOT;

  const result = new UpsMaxicodeReader().read(idAutomationMessage);

  assert.equal(result.recognized, true);
  assert.equal(result.standardEnvelope, true);
  assert.equal(result.format, "01");
  assert.equal(result.format01Header, "96");
  assert.deepEqual(result.primary, {
    postalCode: "336091062",
    countryCode: "840",
    serviceClass: "002",
  });
  assert.equal(result.secondary.trackingNumberEncoded, "1Z14647438");
  assert.equal(result.secondary.scac, "UPSN");
  assert.equal(result.secondary.shipperId, "410E1W");
  assert.equal(result.secondary.trackingNumberReconstructed, "1Z410E1W0214647438");
  assert.deepEqual(result.secondary.trackingNumberReconstructedFrom, [
    "trackingNumberEncoded",
    "shipperId",
    "serviceClass",
  ]);
  assert.equal(result.secondary.julianDayOfPickup, "195");
  assert.equal(result.secondary.shipmentId, null);
  assert.equal(result.secondary.packageInShipment, "1/1");
  assert.equal(result.secondary.weightPounds, null);
  assert.deepEqual(result.shipment.weight, {
    raw: null,
    value: null,
    normalizedValue: null,
    scale: null,
    unit: null,
    source: null,
    status: "not-encoded",
  });
  assert.equal(result.secondary.addressValidation, "Y");
  assert.equal(result.secondary.shipToStreet, "135Lightner");
  assert.equal(result.secondary.shipToCity, "TAMPA");
  assert.equal(result.secondary.shipToState, "FL");
  assert.deepEqual(result.secondary.unknownFields, []);
  assert.equal(result.compressed, null);
  assert.equal(result.destination.postalCode, "336091062");
  assert.equal(result.destination.postalCodeFormatted, "33609-1062");
});

test("structures the uncompressed fields from the French label", () => {
  const franceMessage = [
    `[)>${RS}01`,
    "9654250",
    "250",
    "068",
    "1Z84355950",
    "UPSN",
    "E77J06",
    "237",
    "",
    "1/1",
    "1",
    "N",
    "",
    "CHAMPIGNEULLES",
    "",
  ].join(GS) + RS + EOT;

  const result = new UpsMaxicodeReader().read(franceMessage);

  assert.deepEqual(result.destination, {
    postalCode: "54250",
    postalCodeFormatted: "54250",
    countryCode: "250",
    city: "CHAMPIGNEULLES",
    state: null,
    addressLine1: null,
    addressLine2: null,
    addressLine3: null,
    addressLine4: null,
    addressLine5: null,
    addressLines: [null, null, null, null, null],
    addressValidation: "N",
  });
  assert.deepEqual(result.shipment, {
    trackingNumber: "1ZE77J066884355950",
    scac: "UPSN",
    shipperId: "E77J06",
    julianDayOfPickup: "237",
    shipmentId: null,
    packageInShipment: "1/1",
    weightValue: "1",
    weightUnit: null,
    weight: {
      raw: "1",
      value: "1",
      normalizedValue: null,
      scale: null,
      unit: null,
      source: "format01",
      status: "present",
    },
  });
  assert.equal(result.compressed, null);
});

test("maps Format 05 application identifiers to address lines 2 through 5", () => {
  const routingWithAddressLine1 = [
    "01",
    "96336091062",
    "840",
    "002",
    "1Z14647438",
    "UPSN",
    "410E1W",
    "195",
    "",
    "1/1",
    "",
    "Y",
    "135 LIGHTNER",
    "TAMPA",
    "FL",
  ].join(GS);
  const format05 = [
    "05",
    "20LSUITE 2",
    "21LRECEIVING",
    "22LEXAMPLE CORP",
    "23LATTN SAM SMITH",
  ].join(GS);

  const result = new UpsMaxicodeReader().read(
    `[)>${RS}${routingWithAddressLine1}${RS}${format05}${RS}${EOT}`,
  );

  assert.deepEqual(result.destination.addressLines, [
    "135 LIGHTNER",
    "SUITE 2",
    "RECEIVING",
    "EXAMPLE CORP",
    "ATTN SAM SMITH",
  ]);
  assert.deepEqual(result.format05, {
    shipToAddressLine2: "SUITE 2",
    shipToAddressLine3: "RECEIVING",
    shipToAddressLine4: "EXAMPLE CORP",
    shipToAddressLine5: "ATTN SAM SMITH",
    unknownFields: [],
  });
});

test("formats a US nine-digit Mode 2 postal code as ZIP+4", () => {
  const reader = new UpsMaxicodeReader();

  assert.equal(reader.formatPostalCode("954075421", "840"), "95407-5421");
  assert.equal(reader.formatPostalCode("954075421", "250"), "954075421");
  assert.equal(reader.formatPostalCode("902100000", "840"), "90210");
  assert.equal(reader.formatPostalCode("54250", "250"), "54250");
});

test("keeps invalid typed fields from a partial Format 07 decode out of the summary", () => {
  const beverlyHillsPayload = "\rZ\x1cS%XYTSINGVN$3Q S/2G(+:P%2(\"5TW. 3FB\x1dM)3$S\r";
  const beverlyHillsMessage = [
    `[)>${RS}01`,
    "96902100000",
    "840",
    "004",
    "1Z95524105",
    "UPSN",
    "A66899",
  ].join(GS) + `${RS}07${beverlyHillsPayload}${RS}${EOT}`;

  const result = new UpsMaxicodeReader().read(beverlyHillsMessage);

  assert.equal(result.compressed.decoder.complete, false);
  assert.equal(result.compressed.fields.shipToAddressLine1, "905 LOMA VISTA DR");
  assert.equal(result.compressed.fields.julianDayOfPickup, "50");
  assert.equal(result.compressed.fields.shipToAddressLine5, "JOHN SMITH");
  assert.equal(result.compressed.fields.records.weightPounds.status, "unavailable");
  assert.equal(result.destination.postalCodeFormatted, "90210");
  assert.equal(result.destination.addressLine1, "905 LOMA VISTA DR");
  assert.equal(result.destination.addressValidation, null);
  assert.equal(result.shipment.weightValue, null);
  assert.equal(result.shipment.weightUnit, null);
  assert.deepEqual(result.shipment.weight, {
    raw: null,
    value: null,
    normalizedValue: null,
    scale: null,
    unit: null,
    source: null,
    status: "unavailable",
  });
  assert.equal(result.shipment.packageInShipment, null);
});

test("reads the Honolulu Mode 2 sample without inventing a weight unit", () => {
  const message = "[)>\x1e01\x1d96968190000\x1d840\x1d001\x1d1Z90647079"
    + "\x1dUPSN\x1d0715X1\x1e07'Z\x1cA 1/1SN7-V.33\x1d"
    + "O4/MWH/6#+PI-QSK#3(AJ*7KZLP\r\x1e\x04";

  const result = new UpsMaxicodeReader().read(message);

  assert.equal(result.recognized, true);
  assert.equal(result.destination.postalCode, "968190000");
  assert.equal(result.destination.postalCodeFormatted, "96819");
  assert.equal(result.shipment.trackingNumber, "1Z0715X10190647079");
  assert.equal(result.compressed.fields.shipToCity, "0");
  assert.equal(result.destination.addressLine1, "123 BISHOP ROAD");
  assert.equal(result.destination.addressLine4, "RECIPIENT COMPANY & SUCH");
  assert.equal(result.shipment.packageInShipment, null);
  assert.equal(result.shipment.weightValue, null);
  assert.equal(result.shipment.weightUnit, null);
  assert.equal(result.compressed.decoder.complete, false);
});

test("flags an uncompressed Mode 2 payload truncated before RS EOT", () => {
  // bcgen accepts a longer source string, but a Mode 2 symbol only retains
  // data through the first character of the extra UHU field. Reed-Solomon is
  // valid for those retained codewords, so envelope validation must detect
  // the source truncation independently of symbol error correction.
  const truncatedMessage = "[)>\x1e01\x1d96902101000\x1d840\x1d001"
    + "\x1d1Z00004951\x1dUPSN\x1d06X610\x1d001\x1dS1\x1d1/1"
    + "\x1d1\x1dY\x1d1 ARCHER STREET\x1dA\x1dTEST\x1d\x1dU";

  const result = new UpsMaxicodeReader().read(truncatedMessage);

  assert.equal(result.recognized, true);
  assert.equal(result.standardEnvelope, false);
  assert.equal(result.status, "truncated");
  assert.equal(result.secondary.shipToState, "TEST");
  assert.deepEqual(result.secondary.unknownFields, ["", "U"]);
  assert.equal(result.destination.state, null);
  assert.deepEqual(result.warnings, [
    "Format 01 state must contain exactly two uppercase letters.",
    "ANSI message trailer <RS><EOT> is missing.",
    "1 unexpected field(s) follow the Format 01 state field.",
    "The MaxiCode payload appears truncated before the ANSI message trailer.",
  ]);
});

test("does not promote a syntactically valid but truncated Format 07 field", () => {
  const format07Decoder = {
    decode() {
      const fields = new UpsMaxicodeReader().format07Decoder.parseAnsiFields(
        ["CITY", "ST", "STREET", "", "", "", "123"].join(GS),
        { decoderComplete: false },
      );
      return { ok: true, fields, decoder: { complete: false } };
    },
  };
  const reader = new UpsMaxicodeReader({ format07Decoder });
  const result = reader.read(`${message.slice(0, message.indexOf(`${RS}07`))}${RS}07${"A".repeat(45)}${RS}${EOT}`);

  assert.equal(result.compressed.fields.records.julianDayOfPickup.raw, "123");
  assert.equal(result.compressed.fields.records.julianDayOfPickup.status, "partial");
  assert.equal(result.shipment.julianDayOfPickup, null);
});

test("recovers the headerless, mispacked Mode 3 message from label 66034", () => {
  const malformedMessage = [
    `352 )${RS}${GS}641`,
    "027",
    "01",
    "961Z45369427",
    "UPSN",
    "W1622R",
    "196",
    "",
    "1/4",
    "20",
    "N",
    "",
    "KORSCHENBROICH",
    "",
  ].join(GS) + RS + EOT;

  const result = new UpsMaxicodeReader().read(malformedMessage);

  assert.equal(result.recognized, true);
  assert.equal(result.standardEnvelope, false);
  assert.equal(result.variant, "headerless-mode3-with-mispacked-primary");
  assert.equal(result.format01Header, "96");
  assert.deepEqual(result.primary, {
    postalCode: "41352",
    countryCode: "276",
    serviceClass: null,
    recovered: true,
    recovery: "heuristic-mode3-field-boundary-repair",
    raw: {
      postalCode: `352 )${RS}`,
      countryCode: "641",
      serviceClass: "027",
    },
  });
  assert.equal(result.secondary.trackingNumberEncoded, "1Z45369427");
  assert.equal(result.secondary.scac, "UPSN");
  assert.equal(result.secondary.shipperId, "W1622R");
  assert.equal(result.secondary.trackingNumberReconstructed, null);
  assert.equal(result.secondary.julianDayOfPickup, "196");
  assert.equal(result.secondary.shipmentId, null);
  assert.equal(result.secondary.packageInShipment, "1/4");
  assert.equal(result.secondary.weightPounds, "20");
  assert.equal(result.secondary.addressValidation, "N");
  assert.equal(result.secondary.shipToStreet, null);
  assert.equal(result.secondary.shipToCity, "KORSCHENBROICH");
  assert.equal(result.secondary.shipToState, null);
  assert.deepEqual(result.secondary.unknownFields, []);
  assert.equal(result.compressed, null);
  assert.equal(result.warnings.length, 3);
});

test("recovers headerless Mode 3 data without the optional GS after UPSN", () => {
  const malformedMessage = [
    `352 )${RS}${GS}641`,
    "027",
    "01",
    "961Z45369427",
    "UPSNW1622R",
    "196",
    "",
    "1/4",
    "20",
    "N",
    "",
    "KORSCHENBROICH",
    "",
  ].join(GS) + RS + EOT;

  const result = new UpsMaxicodeReader().read(malformedMessage);

  assert.equal(result.secondary.scac, "UPSN");
  assert.equal(result.secondary.shipperId, "W1622R");
  assert.equal(result.secondary.julianDayOfPickup, "196");
});
