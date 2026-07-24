import assert from "node:assert/strict";
import test from "node:test";
import { UpsMaxicodeReader } from "../src/ups/UpsMaxicodeReader.js";

const GS = "\x1d";
const RS = "\x1e";
const EOT = "\x04";

function format01(fields) {
  return `[)>${RS}${["01", ...fields].join(GS)}${RS}${EOT}`;
}

test("maps a decoded MaxiCode into the source-neutral UPS domain model", () => {
  const message = format01([
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
    "17 RUE CHARLES MARTEL",
    "CHAMPIGNEULLES",
    "",
  ]);

  const result = new UpsMaxicodeReader().read(message);

  assert.deepEqual(result.domain, {
    schemaVersion: "1.0",
    carrier: {
      code: "UPS",
      scac: "UPSN",
    },
    shipment: {
      id: null,
      masterTrackingNumber: null,
      service: {
        code: "068",
        scheme: "ups-maxicode-service-class",
      },
      shipperAccountNumber: "E77J06",
      pickup: {
        date: null,
        dayOfYear: 237,
      },
      packageCount: 1,
    },
    packages: [
      {
        trackingNumber: "1ZE77J066884355950",
        sequence: 1,
        total: 1,
        weight: {
          value: 1,
          unit: null,
        },
      },
    ],
    parties: {
      shipTo: {
        address: {
          lines: ["17 RUE CHARLES MARTEL"],
          city: "CHAMPIGNEULLES",
          region: null,
          postalCode: "54250",
          postalCodeDisplay: "54250",
          country: {
            code: "250",
            scheme: "iso-3166-1-numeric",
          },
          validated: false,
        },
      },
    },
  });
});

test("keeps absent MaxiCode values explicit without guessing a unit or date", () => {
  const message = format01([
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
  ]);

  const result = new UpsMaxicodeReader().read(message);

  assert.deepEqual(result.domain.packages[0].weight, {
    value: null,
    unit: null,
  });
  assert.deepEqual(result.domain.shipment.pickup, {
    date: null,
    dayOfYear: 195,
  });
  assert.equal(result.domain.parties.shipTo.address.postalCode, "336091062");
  assert.equal(result.domain.parties.shipTo.address.postalCodeDisplay, "33609-1062");
  assert.equal(result.domain.parties.shipTo.address.validated, true);
});

test("does not promote a partial MaxiCode tracking fragment into the domain model", () => {
  const message = format01([
    "96116352242",
    "480",
    "003",
    "1Z50978063",
    "UPSN",
    "",
  ]);

  const result = new UpsMaxicodeReader().read(message);

  assert.equal(result.shipment.trackingNumber, "1Z50978063");
  assert.equal(result.domain.packages[0].trackingNumber, null);
  assert.equal(result.domain.shipment.packageCount, null);
  assert.equal(result.domain.packages[0].sequence, null);
});
