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
      return {
        recognized: false,
        standardEnvelope: hasStructuredHeader,
        reason: "No UPS 01 routing segment found.",
        structuredCarrierMessageVersion: null,
        primary: null,
        secondary: null,
        compressed: null,
      };
    }

    const routing = this.parseRoutingSegment(routingSegment);
    return {
      recognized: true,
      standardEnvelope: hasStructuredHeader,
      format: "01",
      structuredCarrierMessageVersion: routing.structuredCarrierMessageVersion,
      primary: routing.primary,
      secondary: routing.secondary,
      compressed: compressedSegment ? this.format07Decoder.decode(compressedSegment) : null,
    };
  }

  parseRoutingSegment(segment) {
    if (typeof segment !== "string" || !segment.startsWith("01")) {
      throw new TypeError("UPS routing segment must start with 01.");
    }

    const values = segment.slice(2).split(UpsMaxicodeReader.GS);
    if (values[0] === "") values.shift();

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
    const postalMatch = /^(\d{2})(.*)$/s.exec(postalField);
    const structuredCarrierMessageVersion = postalMatch?.[1] ?? null;
    const postalCode = (postalMatch?.[2] ?? postalField).trimEnd();
    const trackingNumberReconstructed = this.reconstructTrackingNumber({
      trackingFragment: trackingNumberEncoded,
      shipperId,
      serviceClass,
    });

    return {
      structuredCarrierMessageVersion,
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
}
