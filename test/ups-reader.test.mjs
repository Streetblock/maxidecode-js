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
  assert.equal(result.structuredCarrierMessageVersion, "96");
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
});

test("reports a carrier-neutral MaxiCode message as unrecognized", () => {
  const result = new UpsMaxicodeReader().read("plain MaxiCode data");

  assert.equal(result.recognized, false);
  assert.equal(result.primary, null);
  assert.equal(result.secondary, null);
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
  assert.equal(result.structuredCarrierMessageVersion, "96");
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
