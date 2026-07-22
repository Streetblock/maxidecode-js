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
        routing: null,
        compressed: null,
      };
    }

    const routing = this.parseRoutingSegment(routingSegment);
    return {
      recognized: true,
      standardEnvelope: hasStructuredHeader,
      format: "01",
      routing,
      compressed: compressedSegment ? this.format07Decoder.decode(compressedSegment) : null,
    };
  }

  parseRoutingSegment(segment) {
    if (typeof segment !== "string" || !segment.startsWith("01")) {
      throw new TypeError("UPS routing segment must start with 01.");
    }

    const values = segment.slice(2).split(UpsMaxicodeReader.GS);
    if (values[0] === "") values.shift();

    const [postalField = "", countryCode = "", serviceClass = "", trackingFragment = "", scac = "", shipperId = "", ...additionalFields] = values;
    const postalMatch = /^(\d{2})(.*)$/s.exec(postalField);
    const routingQualifier = postalMatch?.[1] ?? null;
    const postalCode = (postalMatch?.[2] ?? postalField).trimEnd();

    return {
      routingQualifier,
      postalCode,
      countryCode,
      serviceClass,
      trackingFragment,
      scac,
      shipperId,
      trackingNumber: this.reconstructTrackingNumber({
        trackingFragment,
        shipperId,
        serviceClass,
      }),
      additionalFields,
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
