import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { MaxiCodeScanner } from "../src/maxicode/scanner.js";
import { UpsMaxicodeReader } from "../src/ups/UpsMaxicodeReader.js";

function parseArgs(argv) {
  const args = {
    threshold: 128,
    invert: false,
    expectedRings: 5,
    sensitivity: 0.7,
    imagePath: null,
  };

  const rest = [...argv];
  while (rest.length) {
    const value = rest.shift();
    if (!value) continue;
    if (value === "--invert") {
      args.invert = true;
      continue;
    }
    if (value === "--threshold" || value === "-t") {
      args.threshold = Number(rest.shift());
      continue;
    }
    if (value === "--rings" || value === "-r") {
      args.expectedRings = Number(rest.shift());
      continue;
    }
    if (value === "--sensitivity" || value === "-s") {
      args.sensitivity = Number(rest.shift());
      continue;
    }
    if (!args.imagePath) {
      args.imagePath = value;
    }
  }

  return args;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

const args = parseArgs(process.argv.slice(2));

if (!args.imagePath) {
  console.error("Usage: node scan-image.mjs <image> [--threshold 128] [--rings 5] [--sensitivity 0.7] [--invert]");
  process.exit(1);
}

const buffer = await readFile(args.imagePath);
const decoded = PNG.sync.read(buffer);
const width = decoded.width ?? 0;
const height = decoded.height ?? 0;
const imageData = {
  width,
  height,
  data: new Uint8ClampedArray(decoded.data),
};

const scanner = new MaxiCodeScanner(imageData, {
  threshold: args.threshold,
  invert: args.invert,
  expectedRings: args.expectedRings,
  sensitivity: clamp01(args.sensitivity),
});

const center = scanner.findBullseye();
const pitch = scanner.estimateModulePitch(center);
const cells = scanner.sampleHexGrid(center, pitch);
const decode = scanner.decode(cells);
let ups = null;
if (decode.decoded && decode.text) {
  try {
    ups = new UpsMaxicodeReader().read(decode.text);
  } catch (error) {
    ups = { recognized: false, error: error?.message || String(error) };
  }
}

console.log(
  JSON.stringify(
    {
      image: {
        path: args.imagePath,
        width,
        height,
      },
      center,
      pitch,
      decode,
      ups,
    },
    null,
    2,
  ),
);
