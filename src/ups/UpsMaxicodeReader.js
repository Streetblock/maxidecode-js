import { UpsMaxicodeDecoder } from "./UpsMaxicodeDecoder.js";

/**
 * Interprets the ANSI MH10.8.3 envelope returned by the MaxiCode decoder.
 *
 * The MaxiCode layer remains carrier-neutral. This class only recognizes the
 * UPS 01 routing segment and its optional 07 compressed secondary segment.
 */
export class UpsMaxicodeReader {
  static GS = "\x1d";
  static RS = "\x1e";
  static EOT = "\x04";
  static HEADER = "[)>";

  constructor({ format07Decoder = new UpsMaxicodeDecoder() } = {}) {
    this.format07Decoder = format07Decoder;
  }

  read(message) {
    if (typeof message !== "string") {
      throw new TypeError("MaxiCode message must be a string.");
    }

    const segments = message
      .split(UpsMaxicodeReader.RS)
      .map((segment) => segment.replaceAll(UpsMaxicodeReader.EOT, ""));
    const hasStructuredHeader = segments[0] === UpsMaxicodeReader.HEADER;
    const routingSegment = segments.find((segment) => segment.startsWith("01"));
    const compressedSegment = segments.find((segment) => segment.startsWith("07"));

    if (!routingSegment) {
      const recovered = this.parseHeaderlessMode3(message);
      if (recovered) return recovered;
      return {
        recognized: false,
        standardEnvelope: hasStructuredHeader,
        reason: "No UPS 01 routing segment found.",
        format01Header: null,
        primary: null,
        secondary: null,
        compressed: null,
      };
    }

    const routing = this.parseRoutingSegment(routingSegment);
    const compressed = compressedSegment ? this.format07Decoder.decode(compressedSegment) : null;
    const format05 = this.parseFormat05Segments(segments.filter((segment) => segment.startsWith("05")));
    const structured = this.buildStructuredFields({
      primary: routing.primary,
      secondary: routing.secondary,
      compressed,
      format05,
    });
    return {
      recognized: true,
      standardEnvelope: hasStructuredHeader,
      format: "01",
      format01Header: routing.format01Header,
      primary: routing.primary,
      secondary: routing.secondary,
      compressed,
      format05,
      ...structured,
    };
  }

  /**
   * Recovers a producer-specific Mode 3 variant observed on label 66034.
   *
   * Its secondary data begins with `01<GS>96...` instead of the mandatory
   * `[)><RS>01<GS>96...` envelope. The MaxiCode primary fields are also
   * mispacked across their normal boundaries. This is intentionally strict so
   * ordinary malformed messages are not silently reinterpreted as UPS data.
   */
  parseHeaderlessMode3(message) {
    const match = /^([\s\S]{6})\x1d(\d{3})\x1d(\d{3})\x1d(01\x1d[\s\S]*)$/.exec(message);
    if (!match) return null;

    const [, rawPostalCode, rawCountryCode, rawServiceClass, rawSecondary] = match;
    const secondary = rawSecondary
      .replaceAll(UpsMaxicodeReader.EOT, "")
      .replace(new RegExp(`${UpsMaxicodeReader.RS}$`), "");
    let values = secondary.slice(3).split(UpsMaxicodeReader.GS);
    const headerAndTracking = values.shift() || "";
    const headerMatch = /^(96)(1Z[A-Z0-9]{8})$/i.exec(headerAndTracking);
    if (!headerMatch) return null;
    values = this.normalizeOptionalScacSeparator(values, 0);

    const [
      scac = "",
      shipperId = "",
      julianDayOfPickup = "",
      shipmentId = "",
      packageInShipment = "",
      weightPounds = "",
      addressValidation = "",
      shipToStreet = "",
      shipToCity = "",
      shipToState = "",
      ...unknownFields
    ] = values;
    while (unknownFields.at(-1) === "") unknownFields.pop();

    const primary = this.recoverMispackedPrimary({
      rawPostalCode,
      rawCountryCode,
      rawServiceClass,
    });
    if (!primary) return null;

    const structured = this.buildStructuredFields({ primary, secondary: {
      trackingNumberEncoded: headerMatch[2].toUpperCase(),
      scac,
      shipperId,
      trackingNumberReconstructed: null,
      trackingNumberReconstructedFrom: [],
      julianDayOfPickup: julianDayOfPickup || null,
      shipmentId: shipmentId || null,
      packageInShipment: packageInShipment || null,
      weightPounds: weightPounds || null,
      addressValidation: addressValidation || null,
      shipToStreet: shipToStreet || null,
      shipToCity: shipToCity || null,
      shipToState: shipToState || null,
      unknownFields,
    }, compressed: null, format05: null });

    return {
      recognized: true,
      standardEnvelope: false,
      format: "01",
      variant: "headerless-mode3-with-mispacked-primary",
      format01Header: headerMatch[1],
      primary,
      secondary: {
        trackingNumberEncoded: headerMatch[2].toUpperCase(),
        scac,
        shipperId,
        trackingNumberReconstructed: null,
        trackingNumberReconstructedFrom: [],
        julianDayOfPickup: julianDayOfPickup || null,
        shipmentId: shipmentId || null,
        packageInShipment: packageInShipment || null,
        weightPounds: weightPounds || null,
        addressValidation: addressValidation || null,
        shipToStreet: shipToStreet || null,
        shipToCity: shipToCity || null,
        shipToState: shipToState || null,
        unknownFields,
      },
      compressed: null,
      format05: null,
      ...structured,
      warnings: [
        "Recovered a UPS 01 payload without its ANSI structured-message header.",
        "Postal and country codes are heuristic recoveries from mispacked Mode 3 primary fields.",
        "Service class and full tracking number cannot be reconstructed reliably.",
      ],
    };
  }

  parseFormat05Segments(segments) {
    if (!segments.length) return null;
    const identifiers = {
      "20L": "shipToAddressLine2",
      "21L": "shipToAddressLine3",
      "22L": "shipToAddressLine4",
      "23L": "shipToAddressLine5",
    };
    const fields = {};
    const unknownFields = [];
    for (const segment of segments) {
      let values = segment.slice(2).split(UpsMaxicodeReader.GS);
      if (values[0] === "") values.shift();
      for (const raw of values) {
        if (!raw) continue;
        const match = /^(20L|21L|22L|23L)(.*)$/s.exec(raw);
        if (!match) {
          unknownFields.push(raw);
          continue;
        }
        fields[identifiers[match[1]]] = match[2] || null;
      }
    }
    return { ...fields, unknownFields };
  }

  buildStructuredFields({ primary, secondary, compressed, format05 }) {
    const compressedFields = compressed?.ok ? compressed.fields : null;
    const choose = (...candidates) => candidates.find((value) => value != null && value !== "") ?? null;
    const chooseMatching = (pattern, ...candidates) => candidates.find((value) => (
      value != null && pattern.test(String(value))
    )) ?? null;
    const addressLine1 = choose(secondary.shipToStreet, compressedFields?.shipToAddressLine1);
    const addressLine2 = choose(format05?.shipToAddressLine2, compressedFields?.shipToAddressLine2);
    const addressLine3 = choose(format05?.shipToAddressLine3, compressedFields?.shipToAddressLine3);
    const addressLine4 = choose(format05?.shipToAddressLine4, compressedFields?.shipToAddressLine4);
    const addressLine5 = choose(format05?.shipToAddressLine5, compressedFields?.shipToAddressLine5);

    return {
      destination: {
        postalCode: primary.postalCode || null,
        postalCodeFormatted: this.formatPostalCode(primary.postalCode, primary.countryCode),
        countryCode: primary.countryCode || null,
        city: secondary.shipToCity || null,
        state: secondary.shipToState || null,
        addressLine1,
        addressLine2,
        addressLine3,
        addressLine4,
        addressLine5,
        addressLines: [addressLine1, addressLine2, addressLine3, addressLine4, addressLine5],
        addressValidation: chooseMatching(
          /^[YN]$/,
          secondary.addressValidation,
          compressedFields?.addressValidation,
        ),
      },
      shipment: {
        trackingNumber: secondary.trackingNumberReconstructed
          || secondary.trackingNumberEncoded
          || null,
        scac: secondary.scac || null,
        shipperId: secondary.shipperId || null,
        julianDayOfPickup: chooseMatching(
          /^\d{3}$/,
          secondary.julianDayOfPickup,
          compressedFields?.julianDayOfPickup,
        ),
        shipmentId: choose(secondary.shipmentId, compressedFields?.shipmentId),
        packageInShipment: chooseMatching(
          /^\d{1,3}\/\d{1,3}$/,
          secondary.packageInShipment,
          compressedFields?.packageInShipment,
        ),
        weightPounds: chooseMatching(
          /^\d{1,10}$/,
          secondary.weightPounds,
          compressedFields?.weightPounds,
        ),
      },
    };
  }

  formatPostalCode(postalCode, countryCode) {
    const postal = String(postalCode ?? "");
    // Fig. 2 defines Mode 2 as a nine-digit postal field. For the United
    // States (ISO numeric 840), render that field using conventional ZIP+4
    // punctuation while preserving the encoded digits separately.
    if (countryCode === "840" && /^\d{9}$/.test(postal)) {
      return postal.endsWith("0000")
        ? postal.slice(0, 5)
        : `${postal.slice(0, 5)}-${postal.slice(5)}`;
    }
    return postal || null;
  }

  recoverMispackedPrimary({ rawPostalCode, rawCountryCode, rawServiceClass }) {
    const postalMatch = /^(\d{3}) \)\x1e$/.exec(rawPostalCode);
    if (!postalMatch || !/^\d{3}$/.test(rawCountryCode) || !/^\d{3}$/.test(rawServiceClass)) {
      return null;
    }

    const postalCode = `${rawCountryCode.slice(1)}${postalMatch[1]}`;
    const countryCode = `${rawServiceClass.slice(1)}${rawCountryCode[0]}`;
    if (!/^\d{5}$/.test(postalCode) || !/^\d{3}$/.test(countryCode)) return null;

    return {
      postalCode,
      countryCode,
      serviceClass: null,
      recovered: true,
      recovery: "heuristic-mode3-field-boundary-repair",
      raw: {
        postalCode: rawPostalCode,
        countryCode: rawCountryCode,
        serviceClass: rawServiceClass,
      },
    };
  }

  parseRoutingSegment(segment) {
    if (typeof segment !== "string" || !segment.startsWith("01")) {
      throw new TypeError("UPS routing segment must start with 01.");
    }

    let values = segment.slice(2).split(UpsMaxicodeReader.GS);
    if (values[0] === "") values.shift();
    values = this.normalizeOptionalScacSeparator(values, 4);

    const [
      postalField = "",
      countryCode = "",
      serviceClass = "",
      trackingNumberEncoded = "",
      scac = "",
      shipperId = "",
      julianDayOfPickup = "",
      shipmentId = "",
      packageInShipment = "",
      weightPounds = "",
      addressValidation = "",
      shipToStreet = "",
      shipToCity = "",
      shipToState = "",
      ...unknownFields
    ] = values;
    // Patent US7039496B2, Fig. 2: the five-byte Format 01 header is
    // `01<GS>96`. Consequently, `96` is a fixed header literal and not a
    // structured-carrier-message version. The postal code starts after it.
    const headerMatch = /^(96)(.*)$/s.exec(postalField);
    if (!headerMatch) {
      throw new Error("UPS Format 01 routing data must contain the fixed 01<GS>96 header.");
    }
    const format01Header = headerMatch[1];
    const postalCode = headerMatch[2].trimEnd();
    const trackingNumberReconstructed = this.reconstructTrackingNumber({
      trackingFragment: trackingNumberEncoded,
      shipperId,
      serviceClass,
    });

    return {
      format01Header,
      primary: {
        postalCode,
        countryCode,
        serviceClass,
      },
      secondary: {
        trackingNumberEncoded,
        scac,
        shipperId,
        trackingNumberReconstructed,
        trackingNumberReconstructedFrom: trackingNumberReconstructed
          ? ["trackingNumberEncoded", "shipperId", "serviceClass"]
          : [],
        julianDayOfPickup: julianDayOfPickup || null,
        shipmentId: shipmentId || null,
        packageInShipment: packageInShipment || null,
        weightPounds: weightPounds || null,
        addressValidation: addressValidation || null,
        shipToStreet: shipToStreet || null,
        shipToCity: shipToCity || null,
        shipToState: shipToState || null,
        unknownFields,
      },
    };
  }

  reconstructTrackingNumber({ trackingFragment, shipperId, serviceClass }) {
    const fragment = String(trackingFragment ?? "").trim();
    const account = String(shipperId ?? "").trim();
    const service = String(serviceClass ?? "").trim();

    if (/^1Z[A-Z0-9]{16}$/i.test(fragment)) return fragment.toUpperCase();
    if (!/^1Z[A-Z0-9]{8}$/i.test(fragment)) return null;
    if (!/^[A-Z0-9]{6}$/i.test(account)) return null;
    if (!/^\d{3}$/.test(service)) return null;

    return `1Z${account}${service.slice(-2)}${fragment.slice(2)}`.toUpperCase();
  }

  /**
   * Fig. 2 marks the GS following the four-character carrier SCAC as
   * optional. UPS data can therefore contain either `UPSN<GS>123A7V` or the
   * compact `UPSN123A7V`. Normalize the latter before positional parsing.
   */
  normalizeOptionalScacSeparator(values, scacIndex) {
    const normalized = [...values];
    const combined = normalized[scacIndex] ?? "";
    const match = /^(UPSN)([A-Z0-9]{6})$/i.exec(combined);
    if (match) {
      normalized.splice(scacIndex, 1, match[1].toUpperCase(), match[2]);
    }
    return normalized;
  }
}
