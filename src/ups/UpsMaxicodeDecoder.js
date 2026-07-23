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
    let offset = 0;

    while (offset < payloadBits.length) {
      const match = entries.find((entry) => payloadBits.startsWith(entry.bits, offset));
      if (!match) break;
      tokens.push(match.token);
      offset += match.bits.length;
    }

    const trailingBits = payloadBits.slice(offset);
    return {
      text: tokens.join(""),
      tokens,
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
  decode(compressedString, { recovery = false } = {}) {
    const envelope = this.#parseEnvelope(compressedString);

    const bytes = this.transportDecoder(envelope.payload);
    this.#assertByteArray(bytes);
    if (bytes.length !== 32) {
      throw new RangeError(`transportDecoder must return 32 bytes; received ${bytes.length}`);
    }

    const decoded = this.decodeHuffmanBytes(bytes);
    const recoveryOptions = recovery === true ? {} : recovery;
    const recovered = recovery && !decoded.complete
      ? UpsMaxicodeDecoder.recoverSingleBit(bytes, this.dictionary, {
          baseline: decoded,
          ...recoveryOptions,
        })
      : null;
    if (recovered?.candidate) {
      recovered.candidate.fields = this.parseAnsiFields(recovered.candidate.decodedText);
    }

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
      fields: this.parseAnsiFields(decoded.text),
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
      ...(recovery ? {
        recovery: recovered ?? {
          attempted: false,
          applied: false,
          reason: decoded.complete ? "standard-decode-complete" : "no-candidate",
        },
      } : {}),
    };
  }

  /**
   * Bounded post-RS diagnostic recovery for a substitution stream that stops
   * between patent tokens. This is deliberately opt-in: changing a decoded
   * payload bit invalidates Reed-Solomon provenance, even when the resulting
   * stream consists entirely of Fig. 4 tokens.
   */
  static recoverSingleBit(bytes, dictionary = FORMAT_07_DICTIONARY, {
    baseline = null,
    searchBefore = 16,
    searchAfter = 16,
    maxCandidates = 5,
  } = {}) {
    const standard = baseline ?? UpsMaxicodeDecoder.decodeSubstitutions(bytes, dictionary);
    if (standard.complete) {
      return {
        attempted: false,
        applied: false,
        reason: "standard-decode-complete",
      };
    }

    const start = Math.max(0, standard.bitsConsumed - searchBefore);
    const end = Math.min(252, standard.bitsConsumed + searchAfter + 1);
    const candidates = [];

    for (let payloadBitOffset = start; payloadBitOffset < end; payloadBitOffset += 1) {
      // The substitution payload begins after the four framing bits.
      const transportBitOffset = payloadBitOffset + 4;
      const byteIndex = Math.floor(transportBitOffset / 8);
      const bitIndexFromMsb = transportBitOffset % 8;
      const mask = 1 << (7 - bitIndexFromMsb);
      const mutated = Uint8Array.from(bytes);
      const originalBit = (mutated[byteIndex] & mask) === 0 ? 0 : 1;
      mutated[byteIndex] ^= mask;

      const decoded = UpsMaxicodeDecoder.decodeSubstitutions(mutated, dictionary);
      if (decoded.bitsConsumed <= standard.bitsConsumed) continue;

      const assessment = UpsMaxicodeDecoder.scoreRecoveryCandidate(decoded);
      candidates.push({
        decodedText: decoded.text,
        tokens: decoded.tokens,
        bitsConsumed: decoded.bitsConsumed,
        bitsAvailable: decoded.bitsAvailable,
        trailingBits: decoded.trailingBits,
        complete: decoded.complete,
        changedBits: [{
          payloadBitOffset,
          transportBitOffset,
          byteIndex,
          bitIndexFromMsb,
          from: originalBit,
          to: originalBit ^ 1,
        }],
        score: assessment.score,
        rankScore: decoded.bitsConsumed + assessment.score,
        signals: assessment.signals,
        fieldCandidates: UpsMaxicodeDecoder.extractRecoveryFieldCandidates(decoded.text),
      });
    }

    candidates.sort((left, right) => (
      right.rankScore - left.rankScore
      || right.bitsConsumed - left.bitsConsumed
      || right.score - left.score
      || left.changedBits[0].payloadBitOffset - right.changedBits[0].payloadBitOffset
    ));
    const candidate = candidates[0] ?? null;

    return {
      attempted: true,
      applied: Boolean(candidate),
      mode: "single-bit-format07-chase",
      confidence: candidate ? "candidate" : "none",
      reedSolomonVerified: false,
      standardBitsConsumed: standard.bitsConsumed,
      searchRange: {
        payloadBitStart: start,
        payloadBitEndExclusive: end,
      },
      candidate,
      alternatives: candidates.slice(1, maxCandidates).map((entry) => ({
        decodedText: entry.decodedText,
        bitsConsumed: entry.bitsConsumed,
        complete: entry.complete,
        changedBits: entry.changedBits,
        score: entry.score,
        rankScore: entry.rankScore,
        signals: entry.signals,
        fieldCandidates: entry.fieldCandidates,
      })),
      warning: candidate
        ? "Candidate mutates post-Reed-Solomon data and requires review."
        : "No single-bit candidate extends the patent-token stream.",
    };
  }

  /** Rank recovery candidates without treating semantic resemblance as proof. */
  static scoreRecoveryCandidate(decoded) {
    const text = decoded.text;
    const segments = text.split(UpsMaxicodeDecoder.GS);
    const signals = [];
    let score = 0;

    const postalMatches = text.match(/(?:^|\s)\d{5}(?:-\d{4})?(?=\s|\x1d|$)/g) ?? [];
    if (postalMatches.length) {
      score += postalMatches.length * 30;
      signals.push("postal-like-token");
    }
    if (segments.some((segment) => /^\d{3}$/.test(segment))) {
      score += 12;
      signals.push("julian-day-like-segment");
    }
    if (segments.some((segment) => /^[YN]\d{1,10}$/.test(segment))) {
      score += 8;
      signals.push("validation-and-weight-like-segment");
    }
    if (segments.some((segment) => /^\d{1,3}\/\d{0,3}$/.test(segment))) {
      score += 12;
      signals.push("package-count-like-segment");
    }
    if (segments.some((segment) => /\d+\s+[A-Z].*(?:AVE|BLVD|DR|HWY|RD|ST|STR|STRASSE)\b/.test(segment))) {
      score += 15;
      signals.push("street-like-segment");
    }

    // Prefer dictionary phrases over many isolated characters when coverage
    // is otherwise equal. Penalize identifier-like gibberish inside words.
    score += (decoded.tokens ?? []).reduce(
      (total, token) => total + (token.length > 1 ? token.length - 1 : 0),
      0,
    );
    for (const segment of segments) {
      if (/^(?:[YN]\d+|\d{1,3}\/\d{0,3})$/.test(segment)) continue;
      const mixedRuns = segment.match(/[A-Z]+\d+[A-Z\d]*|\d+[A-Z]+[A-Z\d]*/g) ?? [];
      score -= mixedRuns.length * 6;
    }

    return { score, signals };
  }

  /** Extract schema-shaped hints without promoting them to verified fields. */
  static extractRecoveryFieldCandidates(text) {
    const candidate = (value, evidence) => ({
      value,
      status: "recovered-candidate",
      evidence,
    });
    const segments = text.split(UpsMaxicodeDecoder.GS);
    const fields = {};
    const street = segments.find((segment) => (
      /\d+\s+[A-Z].*(?:AVE|BLVD|DR|HWY|RD|ST|STR|STRASSE)\b/.test(segment)
    ));
    if (street) fields.street = candidate(street, "street-pattern");

    const postalSegment = segments.find((segment) => /\b\d{5}(?:-\d{4})?\b/.test(segment));
    const postal = postalSegment?.match(/\b\d{5}(?:-\d{4})?\b/)?.[0];
    if (postal) fields.postalCode = candidate(postal, "postal-pattern-inside-segment");

    const julian = segments.find((segment) => {
      if (!/^\d{3}$/.test(segment)) return false;
      const value = Number(segment);
      return value >= 1 && value <= 366;
    });
    if (julian) fields.julianDayOfPickup = candidate(julian, "julian-day-range");

    const combinedValidationWeight = segments
      .map((segment) => /^([YN])(\d{1,10})$/.exec(segment))
      .find(Boolean);
    if (combinedValidationWeight) {
      fields.addressValidation = candidate(
        combinedValidationWeight[1],
        "combined-validation-weight-segment",
      );
      fields.weightValue = candidate(
        combinedValidationWeight[2],
        "combined-validation-weight-segment",
      );
    }

    const packageSegment = segments.find((segment) => /^\d{1,3}\/\d{0,3}$/.test(segment));
    if (packageSegment) {
      fields.packageInShipment = {
        ...candidate(packageSegment, "package-count-pattern"),
        complete: /^\d{1,3}\/\d{1,3}$/.test(packageSegment),
      };
    }
    return fields;
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
  parseAnsiFields(text) {
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
    const identifiers = {
      "20L": "shipToAddressLine2",
      "21L": "shipToAddressLine3",
      "22L": "shipToAddressLine4",
      "23L": "shipToAddressLine5",
    };
    const segments = text.split(UpsMaxicodeDecoder.GS);
    const unknown = [];
    const values = Object.fromEntries(priorityOrder.map((field, index) => {
      const raw = segments[index] ?? "";
      return [field, raw.trim().length ? raw : null];
    }));
    const identified = {};

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
