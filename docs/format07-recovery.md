# Format 07 bit recovery

The Format 07 recovery path is an opt-in diagnostic mode. It never changes
the result of the standard UPS decoder and it never promotes recovered values
to verified shipment fields.

## Where it runs

The normal decoding pipeline is:

1. Decode the MaxiCode modules and apply Reed-Solomon error correction.
2. Extract the ANSI message and its 45-symbol Format 07 payload.
3. Convert the base-55 payload to 32 bytes (256 bits).
4. Reserve the first four framing bits.
5. Expand the remaining 252 bits with the substitution table from
   US7039496B2, figures 4A-4H.

Recovery runs only after step 5 stops between substitution tokens. Therefore
any changed bit is a post-Reed-Solomon mutation and is explicitly reported as
`reedSolomonVerified: false`.

Patent reference:
https://patents.google.com/patent/US7039496B2/en

## Bounded search

The current implementation performs a one-bit Chase-style search in a narrow
window around the first undecodable payload bit:

- 16 bits before the stop position;
- the stop position itself;
- 16 bits after the stop position.

Each candidate must extend the sequence of valid figure 4 tokens. Candidates
are ranked using both token coverage and conservative UPS-shaped signals such
as a postal code, a Julian day, an address-like segment, or a package-count
prefix. Semantic resemblance affects ranking only; it is not proof.

## Provenance

The result identifies:

- the payload-relative and transport-relative bit offsets;
- the byte and MSB-relative bit positions;
- the original and candidate bit values;
- standard and recovered token coverage;
- whether trailing bits remain;
- candidate fields and the pattern that suggested each field;
- alternative candidates;
- the fact that the candidate is not Reed-Solomon verified.

Example from the Los Angeles SurePost label:

```json
{
  "mode": "single-bit-format07-chase",
  "confidence": "candidate",
  "reedSolomonVerified": false,
  "standardBitsConsumed": 120,
  "candidate": {
    "bitsConsumed": 244,
    "changedBits": [{
      "payloadBitOffset": 124,
      "transportBitOffset": 128,
      "byteIndex": 16,
      "bitIndexFromMsb": 0,
      "from": 0,
      "to": 1
    }],
    "fieldCandidates": {
      "street": { "value": "3585 S VERMONT AVE" },
      "postalCode": { "value": "90006" },
      "julianDayOfPickup": { "value": "144" },
      "addressValidation": { "value": "N" },
      "weightValue": { "value": "4" },
      "packageInShipment": { "value": "1/", "complete": false }
    }
  }
}
```

## API

Standard decoding:

```js
reader.read(message);
```

Opt-in Format 07 recovery:

```js
reader.read(message, { format07Recovery: true });
```

The browser UI exposes the same option as `Format 07 recovery`. It is off by
default. Candidate values are displayed in a separate warning card and never
overwrite the standard UPS interpretation.

## Limitations

- The mode changes at most one Format 07 payload bit.
- It currently does not use image-level module confidence.
- It does not produce a new Reed-Solomon-valid MaxiCode codeword.
- A longer valid token sequence can still be semantically wrong.
- Truncated values such as `1/` remain truncated and are not completed from
  visible label text.
- Recovery output always requires human review.
