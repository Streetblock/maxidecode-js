# maxidecode-js

A lightweight, browser-native MaxiCode scanner and decoder written in vanilla JavaScript.
Images stay in the browser: the scanner locates the bullseye, samples the hexagonal grid,
applies Reed-Solomon error correction, and returns the raw MaxiCode message.

## Project scope

The branches intentionally have different responsibilities:

| Branch | Scope |
| --- | --- |
| [`main`](https://github.com/Streetblock/maxidecode-js/tree/main) | Carrier-neutral MaxiCode recognition and raw message decoding. It does not interpret UPS fields or proprietary UPS Format 07 payloads. |
| [`feat/ups-reader`](https://github.com/Streetblock/maxidecode-js/tree/feat/ups-reader) | Adds structured UPS Format 01 routing fields and UPS Format 07 interpretation on top of the same MaxiCode scanner. |

The published [UPS reader demo](https://streetblock.github.io/maxidecode-js/) currently runs the
`feat/ups-reader` variant. Its structured UPS output is therefore intentionally more extensive
than the raw output provided by `main`.

## Scanner behavior on `main`

- Paste, drop, upload, or capture an image with the camera.
- Detect MaxiCode orientation and perspective.
- Retry multiple binarization thresholds for difficult images.
- Retry tightly cropped regions around alternative bullseye candidates.
- Validate and correct codewords with Reed-Solomon decoding.
- Freeze the successful camera frame after a valid decode.
- Display and copy the raw decoded MaxiCode message and codewords.

A successful decode means that the MaxiCode codewords passed Reed-Solomon processing. It does
not mean that carrier-specific fields have been interpreted or semantically validated.

## Run locally

Install the CLI dependency:

```sh
npm install
```

Serve the repository with any static HTTP server, then open `index.html`. For example:

```sh
python -m http.server 8000
```

The PNG command-line scanner can be run with:

```sh
npm run scan -- path/to/label.png
```

## Tests

```sh
npm test
```

The test suite covers bullseye detection, small one-pixel ring patterns, adaptive thresholds,
alternative bullseye candidates, and region-based retries.

## Dependencies

The browser scanner has no runtime dependencies. The Node.js CLI uses
[`pngjs`](https://www.npmjs.com/package/pngjs) to load PNG files.
