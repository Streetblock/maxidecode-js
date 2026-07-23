import { FORMAT_07_DICTIONARY } from "./format07Dictionary.js";

/**
 * Decoder core for the compressed UPS MaxiCode "07" format.
 *
 * US7039496B2 supplies the substitution rows (figs. 4A-4H), the 55-symbol
 * transport alphabet and the inverse processing stages. The patent does not
 * spell out digit order, bit framing or the one non-prefix table collision.
 * Those interoperability details are verified below against two independent
 * 45-symbol scans supplied with their original UPS labels.
 * See col. 8, lines 6-21 (Google Patents paragraphs [0071]-[0073]).
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
    this.substitutionDecoder = substitutionDecoder ?? UpsMaxicodeDecoder.decodeSubstitutions;
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
   * Expand the bit stream through the substitution table in figs. 4A-4H.
   *
   * The 32-byte value is read MSB-first. The first four bits are framing; the
   * remaining 252 bits contain table values. The patent does not state that
   * nibble boundary explicitly, so it is verified by both supplied real-world
   * vectors: each begins with header value 1 and the remainder reproduces the
   * printed address in its original spelling and field separators.
   *
   * Fig. 4 has one prefix overlap (OA/HWY). Matching the longest available
   * value is deterministic and reproduces both vectors. Numeric pairs such as
   * `00` are ordinary table tokens and therefore expand without a second pass.
   */
  static decodeSubstitutions(bytes, dictionary = FORMAT_07_DICTIONARY) {
    const validBytes =
      (bytes instanceof Uint8Array || Array.isArray(bytes)) &&
      [...bytes].every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
    if (!validBytes) throw new TypeError("Expected a Uint8Array or an array of byte values.");
    if (bytes.length !== 32) {
      throw new RangeError(`Substitution input must contain 32 bytes; received ${bytes.length}.`);
    }

    const framedBits = [...bytes]
      .map((byte) => byte.toString(2).padStart(8, "0"))
      .join("");
    const headerBits = framedBits.slice(0, 4);
    const payloadBits = framedBits.slice(4);
    const entries = [...dictionary].sort(
      (left, right) => right.bits.length - left.bits.length,
    );
    const tokens = [];
    const tokenTrace = [];
    let offset = 0;

    while (offset < payloadBits.length) {
      const match = entries.find((entry) => payloadBits.startsWith(entry.bits, offset));
      if (!match) break;
      tokens.push(match.token);
      tokenTrace.push({
        token: match.token,
        figure: match.figure ?? null,
        payloadBitStart: offset,
        payloadBitEnd: offset + match.bits.length,
        transportBitStart: offset + 4,
        transportBitEnd: offset + match.bits.length + 4,
      });
      offset += match.bits.length;
    }

    const trailingBits = payloadBits.slice(offset);
    return {
      text: tokens.join(""),
      tokens,
      tokenTrace,
      headerBits,
      headerValue: Number.parseInt(headerBits, 2),
      bitsConsumed: offset,
      bitsAvailable: payloadBits.length,
      trailingBits,
      complete: trailingBits.length === 0,
      reason: trailingBits.length === 0
        ? null
        : {
            stage: "Fig. 4 substitution decoding",
            detail: `${trailingBits.length} trailing bits do not begin a complete table value.`,
            patentReference: "Figs. 4A-4H",
          },
    };
  }

  /**
   * Decode a scanned format-07 substring to a structured JSON-compatible value.
   * The returned interoperability notes distinguish patent-defined operations
   * from framing details established with the supplied label vectors.
   */
  decode(compressedString) {
    const envelope = this.#parseEnvelope(compressedString);

    const bytes = this.transportDecoder(envelope.payload);
    this.#assertByteArray(bytes);
    if (bytes.length !== 32) {
      throw new RangeError(`transportDecoder must return 32 bytes; received ${bytes.length}`);
    }

    const decoded = this.decodeHuffmanBytes(bytes);
    return {
      ok: decoded.text.length > 0,
      version: envelope.version,
      payload: envelope.payload,
      payloadSymbolCount: envelope.payload.length,
      transportBytes: [...bytes],
      transportHex: [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      header: {
        bits: decoded.headerBits,
        value: decoded.headerValue,
        truncation: "unknown: US7039496B2 does not disclose the flag's bit layout",
      },
      truncation: "unknown: header bit layout is not disclosed by US7039496B2",
      decodedText: decoded.text,
      fields: this.parseAnsiFields(decoded.text, {
        decoderComplete: decoded.complete,
        tokenTrace: decoded.tokenTrace,
      }),
      decoder: {
        bitsConsumed: decoded.bitsConsumed,
        bitsAvailable: decoded.bitsAvailable,
        trailingBits: decoded.trailingBits,
        complete: decoded.complete,
        reason: decoded.reason,
        interoperabilityAssumptions: [
          "32-byte stream is read most-significant bit first",
          "first four bits are framing and the remaining 252 bits are substitutions",
          "when table values overlap, the longest matching value wins",
        ],
      },
    };
  }

  /**
   * Inverse substitution using the variable-length values in figs. 4A-4H.
   * A custom decoder can be injected for comparison with a vendor routine.
   */
  decodeHuffmanBytes(bytes) {
    this.#assertByteArray(bytes);
    const result = this.substitutionDecoder(Uint8Array.from(bytes), this.dictionary);
    if (!result || typeof result.text !== "string") {
      throw new TypeError("substitutionDecoder must return an object containing a text string.");
    }
    return {
      text: result.text,
      tokens: result.tokens ?? null,
      tokenTrace: result.tokenTrace ?? null,
      headerBits: result.headerBits ?? null,
      headerValue: result.headerValue ?? null,
      bitsConsumed: result.bitsConsumed ?? null,
      bitsAvailable: result.bitsAvailable ?? null,
      trailingBits: result.trailingBits ?? "",
      complete: result.complete ?? true,
      reason: result.reason ?? null,
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
  parseAnsiFields(text, { decoderComplete = true, tokenTrace = null } = {}) {
    // Patent Table 1: the compressor serializes these fields in priority
    // order. Keep the field-slot names even when a producer puts content in a
    // slot that differs from its intended semantics.
    const priorityOrder = [
      "shipToAddressLine1",
      "shipToAddressLine2",
      "shipToAddressLine3",
      "shipToAddressLine4",
      "julianDayOfPickup",
      "shipToAddressLine5",
      "addressValidation",
      "weightPounds",
      "packageInShipment",
      "shipmentId",
    ];
    const validators = {
      julianDayOfPickup: /^\d{3}$/,
      addressValidation: /^[YN]$/,
      weightPounds: /^\d{1,10}$/,
      packageInShipment: /^\d{1,3}\/\d{1,3}$/,
    };
    const identifiers = {
      "20L": "shipToAddressLine2",
      "21L": "shipToAddressLine3",
      "22L": "shipToAddressLine4",
      "23L": "shipToAddressLine5",
    };
    const segments = text.split(UpsMaxicodeDecoder.GS);
    const segmentTraces = Array.from({ length: segments.length }, () => []);
    if (Array.isArray(tokenTrace)) {
      let segmentIndex = 0;
      for (const trace of tokenTrace) {
        if (trace.token === UpsMaxicodeDecoder.GS) {
          segmentIndex += 1;
        } else if (segmentTraces[segmentIndex]) {
          segmentTraces[segmentIndex].push(trace);
        }
      }
    }
    const unknown = [];
    const values = Object.fromEntries(priorityOrder.map((field, index) => {
      const raw = segments[index] ?? "";
      return [field, raw.trim().length ? raw : null];
    }));
    const identified = {};
    const records = Object.fromEntries(priorityOrder.map((field, index) => {
      const available = index < segments.length;
      const raw = available ? segments[index] : null;
      const finalUndelimitedSegment = available && index === segments.length - 1 && !text.endsWith(UpsMaxicodeDecoder.GS);
      const partial = finalUndelimitedSegment && !decoderComplete;
      const populated = typeof raw === "string" && raw.trim().length > 0;
      const valid = populated && validators[field] ? validators[field].test(raw) : populated;
      const traces = segmentTraces[index] ?? [];
      const bitRange = traces.length ? {
        payloadStart: traces[0].payloadBitStart,
        payloadEnd: traces.at(-1).payloadBitEnd,
        transportStart: traces[0].transportBitStart,
        transportEnd: traces.at(-1).transportBitEnd,
      } : null;
      let status = "present";
      if (!available) status = "unavailable";
      else if (partial) status = "partial";
      else if (!populated) status = "empty";
      else if (!valid) status = "invalid";

      return [field, {
        field,
        priority: index + 1,
        raw,
        value: valid && !partial ? raw : null,
        status,
        valid: valid && !partial,
        source: "format07",
        terminatedByGs: available && index < segments.length - 1,
        bitRange,
      }];
    }));

    for (const raw of segments.filter((segment) => segment.trim().length > 0)) {
      const match = /^(20L|21L|22L|23L)(.*)$/s.exec(raw);
      if (match) {
        const field = identifiers[match[1]];
        values[field] = match[2] || null;
        identified[field] = match[1];
      }
    }
    for (const raw of segments.slice(priorityOrder.length)) {
      if (raw.trim().length > 0 && !/^(20L|21L|22L|23L)/s.test(raw)) unknown.push(raw);
    }
    return {
      ...values,
      records,
      // The patent calls priority slot 8 simply "Weight". Preserve the old
      // property for compatibility, but expose a unit-neutral raw name too.
      weightRaw: records.weightPounds.raw,
      identified,
      segments,
      nonEmptySegments: segments.filter((segment) => segment.trim().length > 0),
      unknown,
    };
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
