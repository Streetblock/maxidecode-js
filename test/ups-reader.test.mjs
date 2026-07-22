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
  assert.equal(result.secondary.addressValidation, "Y");
  assert.equal(result.secondary.shipToStreet, "135Lightner");
  assert.equal(result.secondary.shipToCity, "TAMPA");
  assert.equal(result.secondary.shipToState, "FL");
  assert.deepEqual(result.secondary.unknownFields, []);
  assert.equal(result.compressed, null);
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
