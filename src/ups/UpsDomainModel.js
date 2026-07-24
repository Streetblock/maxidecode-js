export const UPS_DOMAIN_SCHEMA_VERSION = "1.0";

function valueOrNull(value) {
  return value == null || value === "" ? null : value;
}

function parsePackagePosition(raw) {
  const match = /^(\d{1,3})\/(\d{1,3})$/.exec(String(raw ?? ""));
  if (!match) {
    return { sequence: null, total: null };
  }

  const sequence = Number(match[1]);
  const total = Number(match[2]);
  if (sequence < 1 || total < 1 || sequence > total) {
    return { sequence: null, total: null };
  }

  return { sequence, total };
}

function parseWeight(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseJulianDay(value) {
  if (!/^\d{3}$/.test(String(value ?? ""))) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 366 ? parsed : null;
}

function fullTrackingNumber(value) {
  const normalized = String(value ?? "").toUpperCase();
  return /^1Z[A-Z0-9]{16}$/.test(normalized) ? normalized : null;
}

function countryReference(countryCode) {
  const code = valueOrNull(countryCode);
  if (!code) return null;

  return {
    code,
    // MaxiCode Modes 2 and 3 carry the three-digit ISO country code. A
    // different source adapter may use another scheme, such as alpha-2.
    scheme: /^\d{3}$/.test(code) ? "iso-3166-1-numeric" : "unknown",
  };
}

/**
 * Builds the source-neutral UPS business view exposed by a source reader.
 *
 * Raw MaxiCode fields, Format 01/05/07 provenance and recovery diagnostics
 * deliberately remain on the reader result rather than leaking into this
 * model. A future PDF417 adapter can therefore emit the same shape while
 * retaining its TAB/CR records separately.
 */
export function createUpsDomainModelFromMaxicode({ destination, shipment, serviceCode }) {
  const position = parsePackagePosition(shipment.packageInShipment);
  const addressLines = destination.addressLines.filter((line) => line != null && line !== "");
  const trackingNumber = fullTrackingNumber(shipment.trackingNumber);
  const weightValue = parseWeight(shipment.weightValue);
  const julianDay = parseJulianDay(shipment.julianDayOfPickup);

  return {
    schemaVersion: UPS_DOMAIN_SCHEMA_VERSION,
    carrier: {
      code: "UPS",
      scac: valueOrNull(shipment.scac),
    },
    shipment: {
      id: valueOrNull(shipment.shipmentId),
      masterTrackingNumber: null,
      service: {
        code: valueOrNull(serviceCode),
        scheme: "ups-maxicode-service-class",
      },
      shipperAccountNumber: valueOrNull(shipment.shipperId),
      pickup: {
        date: null,
        dayOfYear: julianDay,
      },
      packageCount: position.total,
    },
    packages: [
      {
        trackingNumber,
        sequence: position.sequence,
        total: position.total,
        weight: {
          value: weightValue,
          // Neither UPS Format 01 nor Format 07 carries a dependable unit.
          // Do not infer it from the destination or the printed label.
          unit: null,
        },
      },
    ],
    parties: {
      shipTo: {
        address: {
          lines: addressLines,
          city: valueOrNull(destination.city),
          region: valueOrNull(destination.state),
          postalCode: valueOrNull(destination.postalCode),
          postalCodeDisplay: valueOrNull(destination.postalCodeFormatted),
          country: countryReference(destination.countryCode),
          validated: destination.addressValidation === "Y"
            ? true
            : destination.addressValidation === "N"
              ? false
              : null,
        },
      },
    },
  };
}
