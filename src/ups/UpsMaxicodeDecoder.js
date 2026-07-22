import { FORMAT_07_DICTIONARY } from "./format07Dictionary.js";

/**
 * Decoder core for the compressed UPS MaxiCode "07" format.
 *
 * Ground truth: US7039496B2 only.  The patent discloses the Huffman-style
 * substitution-table rows (figs. 4A-4H) and enumerates the transport alphabet,
 * but does NOT disclose the algorithm that maps up to 45 symbols from that
 * 55-symbol alphabet back to arbitrary bytes. Nor does it define the framing
 * and padding rules needed to implement that inverse mapping interoperably.
 * The transport direction/order below is additionally verified against two
 * complete 45-symbol scans supplied with their original UPS labels.
 * See col. 8, lines 6-21 (Google Patents paragraphs [0071]-[0073]).
 *
 * Supply a verified substitutionDecoder to complete the Huffman stage. Until
 * then decode() returns the recovered 32 transport bytes and a structured
 * diagnostic instead of fabricating address data.
 */
export class UpsMaxicodeDecoder {
  static FORMAT_VERSION = "07";
  static GS = "\x1d";
  static RS = "\x1e";

  /** Patent col. 5, lines 15-24: format-07's 55 symbols, in printed order. */
  static FORMAT_07_ALPHABET =
    "\rABCDEFGHIJKLMNOPQRSTUVWXYZ\x1c\x1d \"#$%&'()*+,-./0123456789:";

  /** Complete active substitution table from patent figs. 4A-4H. */
  static FORMAT_07_DICTIONARY = FORMAT_07_DICTIONARY;

  constructor({ transportDecoder = null, substitutionDecoder = null, dictionary = [] } = {}) {
    this.transportDecoder = transportDecoder ?? UpsMaxicodeDecoder.decodeTransport;
    this.substitutionDecoder = substitutionDecoder;
    this.dictionary = Object.freeze([
      ...UpsMaxicodeDecoder.FORMAT_07_DICTIONARY,
      ...dictionary
    ]);
  }

  /**
   * Invert format-07's 55-symbol transport representation.
   *
   * Each payload symbol is a base-55 digit using FORMAT_07_ALPHABET as the
   * digit table. The first scanned symbol is the least-significant digit. The
   * resulting unsigned integer is emitted as exactly 32 big-endian bytes.
   *
   * The patent states only the 55 -> 256 mapping (col. 8); digit and byte order
   * were verified with assets/66032.jpg and assets/66036.jpg. Both complete
   * scans map to 32 bytes; dropping their invisible CR symbols does not.
   */
  static decodeTransport(payload) {
    if (typeof payload !== "string") throw new TypeError("payload must be a string.");
    if (payload.length !== 45) {
      throw new RangeError(
        `A complete format-07 transport payload must contain 45 symbols; received ${payload.length}. ` +
        "Preserve CR, FS and GS control characters from the scanner output."
      );
    }

    let value = 0n;
    for (let index = payload.length - 1; index >= 0; index -= 1) {
      const digit = UpsMaxicodeDecoder.FORMAT_07_ALPHABET.indexOf(payload[index]);
      if (digit < 0) {
        throw new RangeError(`Invalid format-07 symbol: ${JSON.stringify(payload[index])}.`);
      }
      value = value * 55n + BigInt(digit);
    }

    const bytes = new Uint8Array(32);
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
      bytes[index] = Number(value & 0xffn);
      value >>= 8n;
    }
    if (value !== 0n) {
      throw new RangeError("The 45-symbol payload lies outside the 256-bit transport range.");
    }
    return bytes;
  }

  /**
   * Decode a scanned format-07 substring to a structured JSON-compatible value.
   * This method never fabricates data.  Patent omissions are reported through
   * `ok: false` and `missingPatentSpecification`.
   */
  decode(compressedString) {
    const envelope = this.#parseEnvelope(compressedString);

    const bytes = this.transportDecoder(envelope.payload);
    this.#assertByteArray(bytes);
    if (bytes.length !== 32) {
      throw new RangeError(`transportDecoder must return 32 bytes; received ${bytes.length}`);
    }

    // US7039496B2: one header byte plus a 31-byte Huffman stream (col. 8).
    const headerByte = bytes[0];
    const decoded = this.decodeHuffmanBytes(bytes.slice(1));
    if (!decoded.complete && decoded.text === null) {
      return {
        ok: false,
        version: envelope.version,
        payload: envelope.payload,
        payloadSymbolCount: envelope.payload.length,
        headerByte,
        transportBytes: [...bytes],
        transportHex: [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        decodedText: null,
        fields: null,
        missingPatentSpecification: [decoded.reason]
      };
    }
    return {
      ok: decoded.complete,
      version: envelope.version,
      payload: envelope.payload,
      payloadSymbolCount: envelope.payload.length,
      headerByte,
      truncation: "unknown: header bit layout is not disclosed by US7039496B2",
      decodedText: decoded.text,
      fields: this.parseAnsiFields(decoded.text),
      decoder: {
        bitsConsumed: decoded.bitsConsumed,
        complete: decoded.complete,
        reason: decoded.reason
      }
    };
  }

  /**
   * Inverse substitution using the variable-length codes in figs. 4A-4H.
   * Pass a complete table via the constructor for production decoding.
   */
  decodeHuffmanBytes(bytes) {
    this.#assertByteArray(bytes);
    if (!this.substitutionDecoder) {
      return {
        text: null,
        bitsConsumed: 0,
        complete: false,
        reason: {
          stage: "Fig. 4 substitution decoding",
          detail:
            "A verified substitutionDecoder(bytes, dictionary) is required because the patent does not define the table's bit order or trailing columns.",
          patentReference: "Figs. 4A-4H"
        }
      };
    }
    const result = this.substitutionDecoder(Uint8Array.from(bytes), this.dictionary);
    if (!result || typeof result.text !== "string") {
      throw new TypeError("substitutionDecoder must return an object containing a text string.");
    }
    return {
      text: result.text,
      bitsConsumed: result.bitsConsumed ?? null,
      complete: result.complete ?? true,
      reason: result.reason ?? null
    };
  }

  /** Expand the numeric pair exactly as represented by a Fig. 4 token. */
  unpackNumericPair(token) {
    if (!/^\d{2}$/.test(token)) {
      throw new TypeError("A numeric pair must contain exactly two decimal digits.");
    }
    return token;
  }

  /**
   * Best-effort representation of the GS-separated fields shown in Fig. 2.
   * Unknown identifiers are retained rather than discarded.
   */
  parseAnsiFields(text) {
    const known = {
      "20": "shipToAddressLine2",
      "21": "shipToAddressLine3",
      "22": "shipToAddressLine4",
      "23": "shipToAddressLine5"
    };
    const values = {};
    const unknown = [];

    for (const raw of text.split(UpsMaxicodeDecoder.GS).filter(Boolean)) {
      const match = /^(20|21|22|23)(.*)$/s.exec(raw);
      if (match) values[known[match[1]]] = match[2];
      else unknown.push(raw);
    }
    return { ...values, unknown };
  }

  #parseEnvelope(value) {
    if (typeof value !== "string") throw new TypeError("compressedString must be a string.");
    if (value.length < 2) throw new RangeError("compressedString is too short.");
    const version = value.slice(0, 2);
    if (version !== UpsMaxicodeDecoder.FORMAT_VERSION) {
      throw new RangeError(`Expected format header 07; received ${JSON.stringify(version)}.`);
    }
    const payload = value.slice(2);
    const invalid = [...payload].find(
      (symbol) => !UpsMaxicodeDecoder.FORMAT_07_ALPHABET.includes(symbol)
    );
    if (invalid !== undefined) {
      throw new RangeError(`Format-07 payload contains an invalid symbol: ${JSON.stringify(invalid)}.`);
    }
    return { version, payload };
  }

  #assertByteArray(value) {
    const valid =
      (value instanceof Uint8Array || Array.isArray(value)) &&
      [...value].every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
    if (!valid) throw new TypeError("Expected a Uint8Array or an array of byte values.");
  }

}
