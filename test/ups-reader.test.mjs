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
