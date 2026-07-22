function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
}

function bitsToBytes(bits) {
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    const slice = bits.slice(i, i + 8);
    bytes.push(parseInt(slice.padEnd(8, "0"), 2));
  }
  return bytes;
}

function bytesToPrintableText(bytes) {
  return bytes
    .map((value) => (value >= 32 && value <= 126 ? String.fromCharCode(value) : "."))
    .join("");
}

function sampleMask(mask, width, height, x, y) {
  const ix = clamp(Math.round(x), 0, width - 1);
  const iy = clamp(Math.round(y), 0, height - 1);
  return mask[iy * width + ix];
}

function sampleGray(gray, width, height, x, y) {
  const x0 = clamp(Math.floor(x), 0, width - 1);
  const y0 = clamp(Math.floor(y), 0, height - 1);
  const x1 = clamp(x0 + 1, 0, width - 1);
  const y1 = clamp(y0 + 1, 0, height - 1);
  const tx = clamp(x - x0, 0, 1);
  const ty = clamp(y - y0, 0, 1);
  const idx = (yy, xx) => yy * width + xx;
  const a = gray[idx(y0, x0)];
  const b = gray[idx(y0, x1)];
  const c = gray[idx(y1, x0)];
  const d = gray[idx(y1, x1)];
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function buildHexLayout({ rows = 33, cols = 30, pitch = 18, centerX = 0, centerY = 0 }) {
  const points = [];
  const rowHalf = (rows - 1) / 2;

  for (let row = 0; row < rows; row += 1) {
    const rowT = Math.abs((row - rowHalf) / rowHalf);
    const rowWidth = Math.max(8, Math.round(cols - rowT * 8));
    const colHalf = (rowWidth - 1) / 2;
    const y = centerY + (row - rowHalf) * pitch * 0.8660254037844386;
    const xShift = row % 2 ? pitch * 0.5 : 0;

    for (let col = 0; col < rowWidth; col += 1) {
      const x = centerX + (col - colHalf) * pitch + xShift;
      points.push({
        row,
        col,
        x,
        y,
        rowWidth,
        rowT,
      });
    }
  }

  return points;
}

const MAXICODE_WIDTH = 30;
const MAXICODE_HEIGHT = 33;
const MAXICODE_BITNR = [
  [121, 120, 127, 126, 133, 132, 139, 138, 145, 144, 151, 150, 157, 156, 163, 162, 169, 168, 175, 174, 181, 180, 187, 186, 193, 192, 199, 198, -2, -2],
  [123, 122, 129, 128, 135, 134, 141, 140, 147, 146, 153, 152, 159, 158, 165, 164, 171, 170, 177, 176, 183, 182, 189, 188, 195, 194, 201, 200, 816, -3],
  [125, 124, 131, 130, 137, 136, 143, 142, 149, 148, 155, 154, 161, 160, 167, 166, 173, 172, 179, 178, 185, 184, 191, 190, 197, 196, 203, 202, 818, 817],
  [283, 282, 277, 276, 271, 270, 265, 264, 259, 258, 253, 252, 247, 246, 241, 240, 235, 234, 229, 228, 223, 222, 217, 216, 211, 210, 205, 204, 819, -3],
  [285, 284, 279, 278, 273, 272, 267, 266, 261, 260, 255, 254, 249, 248, 243, 242, 237, 236, 231, 230, 225, 224, 219, 218, 213, 212, 207, 206, 821, 820],
  [287, 286, 281, 280, 275, 274, 269, 268, 263, 262, 257, 256, 251, 250, 245, 244, 239, 238, 233, 232, 227, 226, 221, 220, 215, 214, 209, 208, 822, -3],
  [289, 288, 295, 294, 301, 300, 307, 306, 313, 312, 319, 318, 325, 324, 331, 330, 337, 336, 343, 342, 349, 348, 355, 354, 361, 360, 367, 366, 824, 823],
  [291, 290, 297, 296, 303, 302, 309, 308, 315, 314, 321, 320, 327, 326, 333, 332, 339, 338, 345, 344, 351, 350, 357, 356, 363, 362, 369, 368, 825, -3],
  [293, 292, 299, 298, 305, 304, 311, 310, 317, 316, 323, 322, 329, 328, 335, 334, 341, 340, 347, 346, 353, 352, 359, 358, 365, 364, 371, 370, 827, 826],
  [409, 408, 403, 402, 397, 396, 391, 390, 79, 78, -2, -2, 13, 12, 37, 36, 2, -1, 44, 43, 109, 108, 385, 384, 379, 378, 373, 372, 828, -3],
  [411, 410, 405, 404, 399, 398, 393, 392, 81, 80, 40, -2, 15, 14, 39, 38, 3, -1, -1, 45, 111, 110, 387, 386, 381, 380, 375, 374, 830, 829],
  [413, 412, 407, 406, 401, 400, 395, 394, 83, 82, 41, -3, -3, -3, -3, -3, 5, 4, 47, 46, 113, 112, 389, 388, 383, 382, 377, 376, 831, -3],
  [415, 414, 421, 420, 427, 426, 103, 102, 55, 54, 16, -3, -3, -3, -3, -3, -3, -3, 20, 19, 85, 84, 433, 432, 439, 438, 445, 444, 833, 832],
  [417, 416, 423, 422, 429, 428, 105, 104, 57, 56, -3, -3, -3, -3, -3, -3, -3, -3, 22, 21, 87, 86, 435, 434, 441, 440, 447, 446, 834, -3],
  [419, 418, 425, 424, 431, 430, 107, 106, 59, 58, -3, -3, -3, -3, -3, -3, -3, -3, -3, 23, 89, 88, 437, 436, 443, 442, 449, 448, 836, 835],
  [481, 480, 475, 474, 469, 468, 48, -2, 30, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, 0, 53, 52, 463, 462, 457, 456, 451, 450, 837, -3],
  [483, 482, 477, 476, 471, 470, 49, -1, -2, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -2, -1, 465, 464, 459, 458, 453, 452, 839, 838],
  [485, 484, 479, 478, 473, 472, 51, 50, 31, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, 1, -2, 42, 467, 466, 461, 460, 455, 454, 840, -3],
  [487, 486, 493, 492, 499, 498, 97, 96, 61, 60, -3, -3, -3, -3, -3, -3, -3, -3, -3, 26, 91, 90, 505, 504, 511, 510, 517, 516, 842, 841],
  [489, 488, 495, 494, 501, 500, 99, 98, 63, 62, -3, -3, -3, -3, -3, -3, -3, -3, 28, 27, 93, 92, 507, 506, 513, 512, 519, 518, 843, -3],
  [491, 490, 497, 496, 503, 502, 101, 100, 65, 64, 17, -3, -3, -3, -3, -3, -3, -3, 18, 29, 95, 94, 509, 508, 515, 514, 521, 520, 845, 844],
  [559, 558, 553, 552, 547, 546, 541, 540, 73, 72, 32, -3, -3, -3, -3, -3, -3, 10, 67, 66, 115, 114, 535, 534, 529, 528, 523, 522, 846, -3],
  [561, 560, 555, 554, 549, 548, 543, 542, 75, 74, -2, -1, 7, 6, 35, 34, 11, -2, 69, 68, 117, 116, 537, 536, 531, 530, 525, 524, 848, 847],
  [563, 562, 557, 556, 551, 550, 545, 544, 77, 76, -2, 33, 9, 8, 25, 24, -1, -2, 71, 70, 119, 118, 539, 538, 533, 532, 527, 526, 849, -3],
  [565, 564, 571, 570, 577, 576, 583, 582, 589, 588, 595, 594, 601, 600, 607, 606, 613, 612, 619, 618, 625, 624, 631, 630, 637, 636, 643, 642, 851, 850],
  [567, 566, 573, 572, 579, 578, 585, 584, 591, 590, 597, 596, 603, 602, 609, 608, 615, 614, 621, 620, 627, 626, 633, 632, 639, 638, 645, 644, 852, -3],
  [569, 568, 575, 574, 581, 580, 587, 586, 593, 592, 599, 598, 605, 604, 611, 610, 617, 616, 623, 622, 629, 628, 635, 634, 641, 640, 647, 646, 854, 853],
  [727, 726, 721, 720, 715, 714, 709, 708, 703, 702, 697, 696, 691, 690, 685, 684, 679, 678, 673, 672, 667, 666, 661, 660, 655, 654, 649, 648, 855, -3],
  [729, 728, 723, 722, 717, 716, 711, 710, 705, 704, 699, 698, 693, 692, 687, 686, 681, 680, 675, 674, 669, 668, 663, 662, 657, 656, 651, 650, 857, 856],
  [731, 730, 725, 724, 719, 718, 713, 712, 707, 706, 701, 700, 695, 694, 689, 688, 683, 682, 677, 676, 671, 670, 665, 664, 659, 658, 653, 652, 858, -3],
  [733, 732, 739, 738, 745, 744, 751, 750, 757, 756, 763, 762, 769, 768, 775, 774, 781, 780, 787, 786, 793, 792, 799, 798, 805, 804, 811, 810, 860, 859],
  [735, 734, 741, 740, 747, 746, 753, 752, 759, 758, 765, 764, 771, 770, 777, 776, 783, 782, 789, 788, 795, 794, 801, 800, 807, 806, 813, 812, 861, -3],
  [737, 736, 743, 742, 749, 748, 755, 754, 761, 760, 767, 766, 773, 772, 779, 778, 785, 784, 791, 790, 797, 796, 803, 802, 809, 808, 815, 814, 863, 862],
];

// ZXing leaves fixed modules out of the payload map. In that map -2 denotes
// black orientation modules and -1 denotes their white counter-pattern.
const MAXICODE_ORIENTATION_MODULES = [];
for (let y = 0; y < MAXICODE_HEIGHT; y += 1) {
  for (let x = 0; x < MAXICODE_WIDTH; x += 1) {
    const marker = MAXICODE_BITNR[y][x];
    if (marker === -2 || marker === -1) {
      MAXICODE_ORIENTATION_MODULES.push({ x, y, bit: marker === -2 ? 1 : 0 });
    }
  }
}

function canonicalModulePosition(x, y) {
  return {
    x: x + 0.5 + (y & 1) * 0.5 - 14.5,
    y: (y - 16) * 0.8660254037844386,
  };
}

function orientedImagePosition(
  center,
  modulePitch,
  angle,
  x,
  y,
  verticalScale = 1,
  perspectiveX = 0,
  perspectiveY = 0,
  shear = 0,
) {
  const canonical = canonicalModulePosition(x, y);
  const dx = canonical.x * modulePitch;
  const dy = canonical.y * modulePitch * verticalScale;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const verticalAngle = angle + Math.PI / 2 + shear;
  const denominator = Math.max(0.55, 1 + canonical.x * perspectiveX + canonical.y * perspectiveY);
  return {
    x: center.x + (dx * cos + dy * Math.cos(verticalAngle)) / denominator,
    y: center.y + (dx * sin + dy * Math.sin(verticalAngle)) / denominator,
  };
}

function sampleMaskVote(mask, width, height, x, y, radius) {
  if (radius < 0.75) return sampleMask(mask, width, height, x, y);
  let black = 0;
  let samples = 0;
  const step = Math.max(1, radius);
  for (const oy of [-step, 0, step]) {
    for (const ox of [-step, 0, step]) {
      black += sampleMask(mask, width, height, x + ox, y + oy);
      samples += 1;
    }
  }
  return black >= Math.ceil(samples / 2) ? 1 : 0;
}

function scoreOrientation(mask, width, height, center, modulePitch, angle, verticalScale = 1) {
  let matches = 0;
  let valid = 0;
  const sampleRadius = Math.max(0.6, modulePitch * 0.12);

  for (const marker of MAXICODE_ORIENTATION_MODULES) {
    const point = orientedImagePosition(center, modulePitch, angle, marker.x, marker.y, verticalScale);
    if (point.x < 1 || point.y < 1 || point.x >= width - 1 || point.y >= height - 1) continue;
    matches += sampleMaskVote(mask, width, height, point.x, point.y, sampleRadius) === marker.bit ? 1 : 0;
    valid += 1;
  }

  return valid === MAXICODE_ORIENTATION_MODULES.length ? matches / valid : 0;
}

function sampleOrientedBitMatrix(
  mask,
  width,
  height,
  center,
  modulePitch,
  angle,
  verticalScale = 1,
  perspectiveX = 0,
  perspectiveY = 0,
  shear = 0,
) {
  const bits = createBitMatrix(MAXICODE_WIDTH, MAXICODE_HEIGHT);
  const sampleRadius = Math.max(0.5, modulePitch * 0.1);
  for (let y = 0; y < MAXICODE_HEIGHT; y += 1) {
    for (let x = 0; x < MAXICODE_WIDTH; x += 1) {
      const point = orientedImagePosition(
        center,
        modulePitch,
        angle,
        x,
        y,
        verticalScale,
        perspectiveX,
        perspectiveY,
        shear,
      );
      if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) continue;
      if (sampleMaskVote(mask, width, height, point.x, point.y, sampleRadius)) bits.set(x, y);
    }
  }
  return bits;
}

function sampleOrientedCodewords(
  mask,
  width,
  height,
  center,
  transform,
  maxBit = 863,
) {
  const result = new Uint8Array(144);
  const sampleRadius = Math.max(0.5, transform.modulePitch * 0.1);
  for (let y = 0; y < MAXICODE_HEIGHT; y += 1) {
    for (let x = 0; x < MAXICODE_WIDTH; x += 1) {
      const bit = MAXICODE_BITNR[y][x];
      if (bit < 0 || bit > maxBit) continue;
      const point = orientedImagePosition(
        center,
        transform.modulePitch,
        transform.angle,
        x,
        y,
        transform.verticalScale,
        transform.perspectiveX || 0,
        transform.perspectiveY || 0,
        transform.shear || 0,
      );
      if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) continue;
      if (sampleMaskVote(mask, width, height, point.x, point.y, sampleRadius)) {
        result[Math.floor(bit / 6)] |= 1 << (5 - (bit % 6));
      }
    }
  }
  return result;
}

function scoreOrientedGridContrast(gray, width, height, center, transform, threshold) {
  const dark = [];
  const light = [];
  for (let y = 0; y < MAXICODE_HEIGHT; y += 1) {
    for (let x = 0; x < MAXICODE_WIDTH; x += 1) {
      if (MAXICODE_BITNR[y][x] < 0) continue;
      const point = orientedImagePosition(
        center,
        transform.modulePitch,
        transform.angle,
        x,
        y,
        transform.verticalScale,
        transform.perspectiveX || 0,
        transform.perspectiveY || 0,
        transform.shear || 0,
      );
      if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return -Infinity;
      const value = sampleGray(gray, width, height, point.x, point.y);
      (value < threshold ? dark : light).push(value);
    }
  }
  const density = dark.length / Math.max(dark.length + light.length, 1);
  if (!dark.length || !light.length || density < 0.25 || density > 0.62) return -Infinity;
  const separation = mean(light) - mean(dark);
  const spread = standardDeviation(dark) + standardDeviation(light);
  return separation - spread * 0.22 - Math.abs(density - 0.42) * 90;
}

function refineGridTransform(mask, gray, width, height, center, transform, threshold) {
  let best = {
    center: { ...center },
    transform: {
      ...transform,
      perspectiveX: transform.perspectiveX || 0,
      perspectiveY: transform.perspectiveY || 0,
      shear: transform.shear || 0,
    },
  };
  const scoreCandidate = (candidate) => {
    const primary = sampleOrientedCodewords(
      mask,
      width,
      height,
      candidate.center,
      candidate.transform,
      119,
    );
    if (!canDecodeMaxiCodePrimary(primary)) return -Infinity;
    return scoreOrientedGridContrast(gray, width, height, candidate.center, candidate.transform, threshold);
  };
  best.score = scoreCandidate(best);

  let steps = {
    centerX: Math.max(0.35, transform.modulePitch * 0.18),
    centerY: Math.max(0.35, transform.modulePitch * 0.18),
    modulePitch: transform.modulePitch * 0.045,
    angle: 1.5 * Math.PI / 180,
    verticalScale: 0.055,
    shear: 2.5 * Math.PI / 180,
    perspectiveX: 0.0035,
    perspectiveY: 0.0035,
  };

  const parameters = Object.keys(steps);
  for (let iteration = 0; iteration < 5; iteration += 1) {
    for (const parameter of parameters) {
      for (const direction of [-1, 1]) {
        const candidate = {
          center: { ...best.center },
          transform: { ...best.transform },
        };
        if (parameter === "centerX") candidate.center.x += steps[parameter] * direction;
        else if (parameter === "centerY") candidate.center.y += steps[parameter] * direction;
        else candidate.transform[parameter] += steps[parameter] * direction;
        const score = scoreCandidate(candidate);
        if (score > best.score) best = { ...candidate, score };
      }
    }
    steps = Object.fromEntries(Object.entries(steps).map(([key, value]) => [key, value * 0.52]));
  }
  return best;
}

function createBitMatrix(width, height) {
  const bits = new Uint8Array(width * height);
  return {
    width,
    height,
    bits,
    get(x, y) {
      return Boolean(bits[y * width + x]);
    },
    set(x, y) {
      bits[y * width + x] = 1;
    },
    count() {
      return bits.reduce((sum, value) => sum + value, 0);
    },
  };
}

function getEnclosingRectangle(mask, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (!mask[row + x]) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) {
    return null;
  }

  return [left, top, right - left + 1, bottom - top + 1];
}

function extractPureBitsFromMask(mask, width, height) {
  const rect = getEnclosingRectangle(mask, width, height);
  if (!rect) {
    throw new Error("NotFound");
  }
  return extractPureBitsFromRect(mask, width, height, rect[0], rect[1], rect[2], rect[3]);
}

function extractPureBitsFromRect(mask, width, height, left, top, rectWidth, rectHeight) {
  const bits = createBitMatrix(MAXICODE_WIDTH, MAXICODE_HEIGHT);

  for (let y = 0; y < MAXICODE_HEIGHT; y += 1) {
    const iy = top + Math.min(Math.floor((y * rectHeight + rectHeight / 2) / MAXICODE_HEIGHT), rectHeight - 1);
    for (let x = 0; x < MAXICODE_WIDTH; x += 1) {
      const ix = left + Math.min(Math.floor((x * rectWidth + rectWidth / 2 + (y & 1) * rectWidth / 2) / MAXICODE_WIDTH), rectWidth - 1);
      if (ix >= 0 && ix < width && iy >= 0 && iy < height && mask[iy * width + ix]) {
        bits.set(x, y);
      }
    }
  }

  return bits;
}

function cropMask(mask, width, height, left, top, rectWidth, rectHeight) {
  const cropLeft = clamp(Math.round(left), 0, width - 1);
  const cropTop = clamp(Math.round(top), 0, height - 1);
  const cropRight = clamp(Math.round(left + rectWidth), cropLeft + 1, width);
  const cropBottom = clamp(Math.round(top + rectHeight), cropTop + 1, height);
  const cropWidth = cropRight - cropLeft;
  const cropHeight = cropBottom - cropTop;
  const cropped = new Uint8Array(cropWidth * cropHeight);

  for (let y = 0; y < cropHeight; y += 1) {
    const sourceStart = (cropTop + y) * width + cropLeft;
    cropped.set(mask.subarray(sourceStart, sourceStart + cropWidth), y * cropWidth);
  }

  return { mask: cropped, width: cropWidth, height: cropHeight };
}

function rotateMask(mask, width, height, quarterTurns) {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return { mask, width, height };

  let source = mask;
  let sourceWidth = width;
  let sourceHeight = height;
  for (let turn = 0; turn < turns; turn += 1) {
    const rotated = new Uint8Array(source.length);
    const targetWidth = sourceHeight;
    const targetHeight = sourceWidth;
    for (let y = 0; y < sourceHeight; y += 1) {
      for (let x = 0; x < sourceWidth; x += 1) {
        const targetX = sourceHeight - 1 - y;
        const targetY = x;
        rotated[targetY * targetWidth + targetX] = source[y * sourceWidth + x];
      }
    }
    source = rotated;
    sourceWidth = targetWidth;
    sourceHeight = targetHeight;
  }
  return { mask: source, width: sourceWidth, height: sourceHeight };
}

function extractPureBitsAtRotation(mask, width, height, rect, quarterTurns) {
  if (quarterTurns === 0) {
    return rect
      ? extractPureBitsFromRect(mask, width, height, rect.left, rect.top, rect.width, rect.height)
      : extractPureBitsFromMask(mask, width, height);
  }

  const region = rect
    ? cropMask(mask, width, height, rect.left, rect.top, rect.width, rect.height)
    : { mask, width, height };
  const rotated = rotateMask(region.mask, region.width, region.height, quarterTurns);
  return extractPureBitsFromMask(rotated.mask, rotated.width, rotated.height);
}

function readCodewordsFromBitMatrix(bitMatrix) {
  const result = new Uint8Array(144);
  for (let y = 0; y < MAXICODE_HEIGHT; y += 1) {
    const row = MAXICODE_BITNR[y];
    for (let x = 0; x < MAXICODE_WIDTH; x += 1) {
      const bit = row[x];
      if (bit >= 0 && bitMatrix.get(x, y)) {
        result[Math.floor(bit / 6)] |= 1 << (5 - (bit % 6));
      }
    }
  }
  return result;
}

class ReedSolomonError extends Error {}

class GenericGFPoly {
  constructor(field, coefficients) {
    if (!coefficients.length) {
      throw new Error("Empty polynomial");
    }
    this.field = field;
    if (coefficients.length > 1 && coefficients[0] === 0) {
      let firstNonZero = 1;
      while (firstNonZero < coefficients.length && coefficients[firstNonZero] === 0) firstNonZero += 1;
      this.coefficients = firstNonZero === coefficients.length ? [0] : coefficients.slice(firstNonZero);
    } else {
      this.coefficients = coefficients;
    }
  }

  getDegree() {
    return this.coefficients.length - 1;
  }

  isZero() {
    return this.coefficients[0] === 0;
  }

  getCoefficient(degree) {
    return this.coefficients[this.coefficients.length - 1 - degree];
  }

  evaluateAt(a) {
    if (a === 0) return this.getCoefficient(0);
    if (a === 1) {
      let result = 0;
      for (const coefficient of this.coefficients) {
        result = GenericGF.addOrSubtract(result, coefficient);
      }
      return result;
    }
    let result = this.coefficients[0];
    for (let i = 1; i < this.coefficients.length; i += 1) {
      result = GenericGF.addOrSubtract(this.field.multiply(a, result), this.coefficients[i]);
    }
    return result;
  }

  addOrSubtract(other) {
    if (this.field !== other.field) throw new Error("Field mismatch");
    if (this.isZero()) return other;
    if (other.isZero()) return this;

    let smaller = this.coefficients;
    let larger = other.coefficients;
    if (smaller.length > larger.length) {
      [smaller, larger] = [larger, smaller];
    }

    const diff = new Array(larger.length).fill(0);
    const lengthDiff = larger.length - smaller.length;
    for (let i = 0; i < lengthDiff; i += 1) diff[i] = larger[i];
    for (let i = lengthDiff; i < larger.length; i += 1) {
      diff[i] = GenericGF.addOrSubtract(smaller[i - lengthDiff], larger[i]);
    }
    return new GenericGFPoly(this.field, diff);
  }

  multiply(other) {
    if (this.field !== other.field) throw new Error("Field mismatch");
    if (this.isZero() || other.isZero()) return this.field.getZero();
    const product = new Array(this.coefficients.length + other.coefficients.length - 1).fill(0);
    for (let i = 0; i < this.coefficients.length; i += 1) {
      const aCoeff = this.coefficients[i];
      for (let j = 0; j < other.coefficients.length; j += 1) {
        product[i + j] = GenericGF.addOrSubtract(product[i + j], this.field.multiply(aCoeff, other.coefficients[j]));
      }
    }
    return new GenericGFPoly(this.field, product);
  }

  multiplyScalar(scalar) {
    if (scalar === 0) return this.field.getZero();
    if (scalar === 1) return this;
    return new GenericGFPoly(this.field, this.coefficients.map((coefficient) => this.field.multiply(coefficient, scalar)));
  }

  multiplyByMonomial(degree, coefficient) {
    if (degree < 0) throw new Error("degree < 0");
    if (coefficient === 0) return this.field.getZero();
    const product = new Array(this.coefficients.length + degree).fill(0);
    for (let i = 0; i < this.coefficients.length; i += 1) {
      product[i] = this.field.multiply(this.coefficients[i], coefficient);
    }
    return new GenericGFPoly(this.field, product);
  }
}

class GenericGF {
  constructor(primitive, size, generatorBase) {
    this.primitive = primitive;
    this.size = size;
    this.generatorBase = generatorBase;
    this.expTable = new Array(size);
    this.logTable = new Array(size);
    let x = 1;
    for (let i = 0; i < size; i += 1) {
      this.expTable[i] = x;
      x *= 2;
      if (x >= size) {
        x ^= primitive;
        x &= size - 1;
      }
    }
    for (let i = 0; i < size - 1; i += 1) {
      this.logTable[this.expTable[i]] = i;
    }
    this.zero = new GenericGFPoly(this, [0]);
    this.one = new GenericGFPoly(this, [1]);
  }

  static addOrSubtract(a, b) {
    return a ^ b;
  }

  getZero() {
    return this.zero;
  }

  getOne() {
    return this.one;
  }

  buildMonomial(degree, coefficient) {
    if (degree < 0) throw new Error("degree < 0");
    if (coefficient === 0) return this.zero;
    const coefficients = new Array(degree + 1).fill(0);
    coefficients[0] = coefficient;
    return new GenericGFPoly(this, coefficients);
  }

  exp(a) {
    return this.expTable[a];
  }

  log(a) {
    if (a === 0) throw new Error("log(0)");
    return this.logTable[a];
  }

  inverse(a) {
    if (a === 0) throw new Error("inverse(0)");
    return this.expTable[this.size - this.logTable[a] - 1];
  }

  multiply(a, b) {
    if (a === 0 || b === 0) return 0;
    return this.expTable[(this.logTable[a] + this.logTable[b]) % (this.size - 1)];
  }
}

const MAXICODE_FIELD_64 = new GenericGF(0b1000011, 64, 1);

class ReedSolomonDecoder {
  constructor(field) {
    this.field = field;
  }

  decodeWithECCount(received, twoS) {
    const poly = new GenericGFPoly(this.field, received);
    const syndromeCoefficients = new Array(twoS).fill(0);
    let noError = true;
    for (let i = 0; i < twoS; i += 1) {
      const evalValue = poly.evaluateAt(this.field.exp(i + this.field.generatorBase));
      syndromeCoefficients[syndromeCoefficients.length - 1 - i] = evalValue;
      if (evalValue !== 0) noError = false;
    }
    if (noError) return 0;

    const syndrome = new GenericGFPoly(this.field, syndromeCoefficients);
    const [sigma, omega] = this.runEuclideanAlgorithm(this.field.buildMonomial(twoS, 1), syndrome, twoS);
    const errorLocations = this.findErrorLocations(sigma);
    const errorMagnitudes = this.findErrorMagnitudes(omega, errorLocations);
    for (let i = 0; i < errorLocations.length; i += 1) {
      const position = received.length - 1 - this.field.log(errorLocations[i]);
      if (position < 0) throw new ReedSolomonError("Bad error location");
      received[position] = GenericGF.addOrSubtract(received[position], errorMagnitudes[i]);
    }
    return errorLocations.length;
  }

  runEuclideanAlgorithm(a, b, R) {
    if (a.getDegree() < b.getDegree()) {
      [a, b] = [b, a];
    }
    let rLast = a;
    let r = b;
    let tLast = this.field.getZero();
    let t = this.field.getOne();

    while (2 * r.getDegree() >= R) {
      const rLastLast = rLast;
      const tLastLast = tLast;
      rLast = r;
      tLast = t;
      if (rLast.isZero()) throw new ReedSolomonError("r_{i-1} was zero");
      r = rLastLast;
      let q = this.field.getZero();
      const denominatorLeadingTerm = rLast.getCoefficient(rLast.getDegree());
      const dltInverse = this.field.inverse(denominatorLeadingTerm);
      while (r.getDegree() >= rLast.getDegree() && !r.isZero()) {
        const degreeDiff = r.getDegree() - rLast.getDegree();
        const scale = this.field.multiply(r.getCoefficient(r.getDegree()), dltInverse);
        q = q.addOrSubtract(this.field.buildMonomial(degreeDiff, scale));
        r = r.addOrSubtract(rLast.multiplyByMonomial(degreeDiff, scale));
      }
      t = q.multiply(tLast).addOrSubtract(tLastLast);
      if (r.getDegree() >= rLast.getDegree()) {
        throw new ReedSolomonError("Division algorithm failed");
      }
    }

    const sigmaTildeAtZero = t.getCoefficient(0);
    if (sigmaTildeAtZero === 0) throw new ReedSolomonError("sigmaTilde(0) was zero");
    const inverse = this.field.inverse(sigmaTildeAtZero);
    return [t.multiplyScalar(inverse), r.multiplyScalar(inverse)];
  }

  findErrorLocations(errorLocator) {
    const numErrors = errorLocator.getDegree();
    if (numErrors === 1) return [errorLocator.getCoefficient(1)];
    const result = new Array(numErrors);
    let e = 0;
    for (let i = 1; i < this.field.size && e < numErrors; i += 1) {
      if (errorLocator.evaluateAt(i) === 0) {
        result[e] = this.field.inverse(i);
        e += 1;
      }
    }
    if (e !== numErrors) throw new ReedSolomonError("Error locator degree does not match number of roots");
    return result;
  }

  findErrorMagnitudes(errorEvaluator, errorLocations) {
    const result = new Array(errorLocations.length);
    for (let i = 0; i < errorLocations.length; i += 1) {
      const xiInverse = this.field.inverse(errorLocations[i]);
      let denominator = 1;
      for (let j = 0; j < errorLocations.length; j += 1) {
        if (i !== j) {
          const term = this.field.multiply(errorLocations[j], xiInverse);
          const termPlus1 = (term & 1) === 0 ? term | 1 : term & ~1;
          denominator = this.field.multiply(denominator, termPlus1);
        }
      }
      result[i] = this.field.multiply(errorEvaluator.evaluateAt(xiInverse), this.field.inverse(denominator));
      if (this.field.generatorBase !== 0) {
        result[i] = this.field.multiply(result[i], xiInverse);
      }
    }
    return result;
  }
}

const MAXICODE_CHARSETS = [
  "\rABCDEFGHIJKLMNOPQRSTUVWXYZ" + "\uFFFA" + "\u001C" + "\u001D" + "\u001E" + "\uFFFB" + " " + "\uFFFC" + "\"#$%&'()*+,-./0123456789:" + "\uFFF1" + "\uFFF2" + "\uFFF3" + "\uFFF4" + "\uFFF8",
  "`abcdefghijklmnopqrstuvwxyz" + "\uFFFA" + "\u001C" + "\u001D" + "\u001E" + "\uFFFB" + "{" + "\uFFFC" + "}~\u007F;<=>?[\\]^_ ,./:@!|" + "\uFFFC" + "\uFFF5" + "\uFFF6" + "\uFFFC" + "\uFFF0" + "\uFFF2" + "\uFFF3" + "\uFFF4" + "\uFFF7",
  "\u00C0\u00C1\u00C2\u00C3\u00C4\u00C5\u00C6\u00C7\u00C8\u00C9\u00CA\u00CB\u00CC\u00CD\u00CE\u00CF\u00D0\u00D1\u00D2\u00D3\u00D4\u00D5\u00D6\u00D7\u00D8\u00D9\u00DA" + "\uFFFA" + "\u001C" + "\u001D" + "\u001E" + "\uFFFB" + "\u00DB\u00DC\u00DD\u00DE\u00DF\u00AA\u00AC\u00B1\u00B2\u00B3\u00B5\u00B9\u00BA\u00BC\u00BD\u00BE\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087\u0088\u0089" + "\uFFF7" + " " + "\uFFF9" + "\uFFF3" + "\uFFF4" + "\uFFF8",
  "\u00E0\u00E1\u00E2\u00E3\u00E4\u00E5\u00E6\u00E7\u00E8\u00E9\u00EA\u00EB\u00EC\u00ED\u00EE\u00EF\u00F0\u00F1\u00F2\u00F3\u00F4\u00F5\u00F6\u00F7\u00F8\u00F9\u00FA" + "\uFFFA" + "\u001C" + "\u001D" + "\u001E" + "\uFFFB" + "\u00FB\u00FC\u00FD\u00FE\u00FF\u00A1\u00A8\u00AB\u00AF\u00B0\u00B4\u00B7\u00B8\u00BB\u00BF\u008A\u008B\u008C\u008D\u008E\u008F\u0090\u0091\u0092\u0093\u0094" + "\uFFF7" + " " + "\uFFF2" + "\uFFF9" + "\uFFF4" + "\uFFF8",
  "\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u0009\n\u000B\u000C\r\u000E\u000F\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001A" + "\uFFFA" + "\uFFFC" + "\uFFFC" + "\u001B" + "\uFFFB" + "\u001C" + "\u001D" + "\u001E" + "\u001F\u009F\u00A0\u00A2\u00A3\u00A4\u00A5\u00A6\u00A7\u00A9\u00AD\u00AE\u00B6\u0095\u0096\u0097\u0098\u0099\u009A\u009B\u009C\u009D\u009E" + "\uFFF7" + " " + "\uFFF2" + "\uFFF3" + "\uFFF9" + "\uFFF8",
];

function getBitFromBytes(bit, bytes) {
  bit -= 1;
  return (bytes[Math.floor(bit / 6)] & (1 << (5 - (bit % 6)))) === 0 ? 0 : 1;
}

function getIntFromBytes(bytes, positions) {
  let value = 0;
  for (let i = 0; i < positions.length; i += 1) {
    value += getBitFromBytes(positions[i], bytes) << (positions.length - i - 1);
  }
  return value;
}

function canDecodeMaxiCodePrimary(codewords) {
  const primary = Array.from(codewords.slice(0, 20), (value) => value & 0x3F);
  try {
    new ReedSolomonDecoder(MAXICODE_FIELD_64).decodeWithECCount(primary, 10);
    const mode = primary[0] & 0x0F;
    return mode >= 2 && mode <= 5;
  } catch {
    return false;
  }
}

function decodeMaxiCodeData(codewords) {
  const rsDecoder = new ReedSolomonDecoder(MAXICODE_FIELD_64);

  const correctErrors = (codewordBytes, start, dataCodewords, ecCodewords, mode) => {
    const total = dataCodewords + ecCodewords;
    const divisor = mode === 0 ? 1 : 2;
    const ints = new Array(total / divisor);
    for (let i = 0; i < total; i += 1) {
      if (mode === 0 || i % 2 === (mode - 1)) {
        ints[Math.floor(i / divisor)] = codewordBytes[i + start] & 0x3F;
      }
    }
    const errorsCorrected = rsDecoder.decodeWithECCount(ints, ecCodewords / divisor);
    for (let i = 0; i < dataCodewords; i += 1) {
      if (mode === 0 || i % 2 === (mode - 1)) {
        codewordBytes[i + start] = ints[Math.floor(i / divisor)] & 0x3F;
      }
    }
    return errorsCorrected;
  };

  const data = Uint8Array.from(codewords);
  let errorsCorrected = correctErrors(data, 0, 10, 10, 0);
  const mode = data[0] & 0x0F;
  let payload;
  switch (mode) {
    case 2:
    case 3:
    case 4:
      errorsCorrected += correctErrors(data, 20, 84, 40, 1);
      errorsCorrected += correctErrors(data, 20, 84, 40, 2);
      payload = new Uint8Array(94);
      break;
    case 5:
      errorsCorrected += correctErrors(data, 20, 68, 56, 1);
      errorsCorrected += correctErrors(data, 20, 68, 56, 2);
      payload = new Uint8Array(78);
      break;
    default:
      throw new Error("Unsupported MaxiCode mode");
  }

  payload.set(data.slice(0, 10), 0);
  payload.set(data.slice(20, 20 + payload.length - 10), 10);

  const decodeMessage = (bytes, start, length) => {
    let result = "";
    let shift = -1;
    let set = 0;
    let lastSet = 0;
    for (let i = start; i < start + length; i += 1) {
      const c = MAXICODE_CHARSETS[set].charAt(bytes[i]);
      switch (c) {
        case "\uFFF7":
          set = 0;
          shift = -1;
          break;
        case "\uFFF8":
          set = 1;
          shift = -1;
          break;
        case "\uFFF0":
        case "\uFFF1":
        case "\uFFF2":
        case "\uFFF3":
        case "\uFFF4":
          lastSet = set;
          set = c.charCodeAt(0) - 0xfff0;
          shift = 1;
          break;
        case "\uFFF5":
          lastSet = set;
          set = 0;
          shift = 2;
          break;
        case "\uFFF6":
          lastSet = set;
          set = 0;
          shift = 3;
          break;
        case "\uFFFB":
          if (i + 5 >= start + length) throw new Error("Format");
          {
            const nsval = (bytes[++i] << 24) + (bytes[++i] << 18) + (bytes[++i] << 12) + (bytes[++i] << 6) + bytes[++i];
            result += String(nsval).padStart(9, "0");
          }
          break;
        case "\uFFF9":
          shift = -1;
          break;
        default:
          result += c;
      }
      if (shift-- === 0) {
        set = lastSet;
      }
    }
    while (result.length > 0 && result.charAt(result.length - 1) === "\uFFFC") {
      result = result.slice(0, -1);
    }
    return result;
  };

  let text;
  switch (mode) {
    case 2:
    case 3: {
      const country = String(getIntFromBytes(payload, [53, 54, 43, 44, 45, 46, 47, 48, 37, 38])).padStart(3, "0");
      const service = String(getIntFromBytes(payload, [55, 56, 57, 58, 59, 60, 49, 50, 51, 52])).padStart(3, "0");
      const postcodeLength = getIntFromBytes(payload, [39, 40, 41, 42, 31, 32]);
      const postcode = mode === 2
        ? String(getIntFromBytes(payload, [33, 34, 35, 36, 25, 26, 27, 28, 29, 30, 19, 20, 21, 22, 23, 24, 13, 14, 15, 16, 17, 18, 7, 8, 9, 10, 11, 12, 1, 2])).padStart(postcodeLength, "0")
        : [
            [39, 40, 41, 42, 31, 32],
            [33, 34, 35, 36, 25, 26],
            [27, 28, 29, 30, 19, 20],
            [21, 22, 23, 24, 13, 14],
            [15, 16, 17, 18, 7, 8],
            [9, 10, 11, 12, 1, 2],
          ]
            .map((positions) => MAXICODE_CHARSETS[0].charAt(getIntFromBytes(payload, positions)))
            .join("");
      text = decodeMessage(payload, 10, 84);
      if (text.startsWith(`[)>\u001E01\u001D`)) {
        text = text.slice(0, 9) + postcode + "\u001D" + country + "\u001D" + service + "\u001D" + text.slice(9);
      } else {
        text = `${postcode}\u001D${country}\u001D${service}\u001D${text}`;
      }
      break;
    }
    case 4:
      text = decodeMessage(payload, 1, 93);
      break;
    case 5:
      text = decodeMessage(payload, 1, 77);
      break;
    default:
      throw new Error("Unsupported MaxiCode mode");
  }

  return {
    mode,
    errorsCorrected,
    rawBytes: Array.from(payload),
    text,
  };
}

export class MaxiCodeScanner {
  constructor(imageData, options = {}) {
    this.width = imageData.width;
    this.height = imageData.height;
    this.data = imageData.data;
    this.options = {
      threshold: 128,
      invert: false,
      expectedRings: 5,
      sensitivity: 0.7,
      ...options,
    };
    this._gray = null;
    this._mask = null;
  }

  grayscale() {
    if (this._gray) return this._gray;
    const gray = new Float32Array(this.width * this.height);
    for (let i = 0, p = 0; i < this.data.length; i += 4, p += 1) {
      const r = this.data[i];
      const g = this.data[i + 1];
      const b = this.data[i + 2];
      const a = this.data[i + 3] ?? 255;
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      // Composite transparent pixels over a white background so PNG transparency does not
      // collapse the whole image into a false "black" field.
      gray[p] = (luminance * a + 255 * (255 - a)) / 255;
    }
    this._gray = gray;
    return gray;
  }

  binarize() {
    if (this._mask) return this._mask;
    const gray = this.grayscale();
    const mask = new Uint8Array(gray.length);
    const threshold = this.options.threshold;
    for (let i = 0; i < gray.length; i += 1) {
      const dark = gray[i] < threshold ? 1 : 0;
      mask[i] = this.options.invert ? 1 - dark : dark;
    }
    this._mask = mask;
    return mask;
  }

  estimateBackgroundLevel() {
    const gray = this.grayscale();
    const samplePoints = [
      [8, 8],
      [this.width - 8, 8],
      [8, this.height - 8],
      [this.width - 8, this.height - 8],
      [this.width / 2, 8],
      [this.width / 2, this.height - 8],
    ];
    const values = samplePoints.map(([x, y]) => sampleGray(gray, this.width, this.height, x, y));
    return mean(values);
  }

  estimateDarkCentroid() {
    const gray = this.grayscale();
    const threshold = this.options.threshold;
    let sumX = 0;
    let sumY = 0;
    let sumW = 0;

    for (let y = 0; y < this.height; y += 2) {
      for (let x = 0; x < this.width; x += 2) {
        const value = gray[y * this.width + x];
        const darkness = this.options.invert
          ? clamp((value - threshold) / 255, 0, 1)
          : clamp((threshold - value) / 255, 0, 1);
        if (darkness <= 0) continue;
        const weight = darkness * darkness;
        sumX += x * weight;
        sumY += y * weight;
        sumW += weight;
      }
    }

    if (!sumW) {
      return { x: this.width / 2, y: this.height / 2 };
    }

    return { x: sumX / sumW, y: sumY / sumW };
  }

  findBullseyePatternCandidates() {
    const mask = this.binarize();
    const minDim = Math.min(this.width, this.height);
    const lineStep = Math.max(1, Math.round(minDim / 480));
    const horizontal = [];
    const vertical = [];

    const scanLine = (length, read, cross, target) => {
      const runs = [];
      let value = read(0);
      let start = 0;
      for (let position = 1; position <= length; position += 1) {
        const next = position < length ? read(position) : 1 - value;
        if (next === value) continue;
        runs.push({ value, start, length: position - start });
        value = next;
        start = position;
      }

      for (let index = 0; index <= runs.length - 11; index += 1) {
        if (runs[index].value !== 1) continue;
        const widths = runs.slice(index, index + 11).map((run) => run.length);
        const ringWidths = widths.filter((_, widthIndex) => widthIndex !== 5);
        const bandWidth = median(ringWidths);
        if (bandWidth < 1.2 || bandWidth > minDim * 0.065) continue;

        const centerRatio = widths[5] / bandWidth;
        if (centerRatio < 1.05 || centerRatio > 3.6) continue;

        let symmetryError = 0;
        for (let pair = 0; pair < 5; pair += 1) {
          symmetryError += Math.abs(widths[pair] - widths[10 - pair]) /
            Math.max(widths[pair] + widths[10 - pair], 1);
        }
        symmetryError /= 5;

        const widthError = mean(ringWidths.map((width) => Math.abs(width - bandWidth) / bandWidth));
        const centerError = Math.abs(centerRatio - 2) / 2;
        const patternScore = clamp(1 - symmetryError * 0.9 - widthError * 0.42 - centerError * 0.22, 0, 1);
        if (patternScore < 0.45) continue;

        const centerRun = runs[index + 5];
        target.push({
          axis: centerRun.start + centerRun.length / 2,
          cross,
          bandWidth,
          patternScore,
        });
      }
    };

    for (let y = 0; y < this.height; y += lineStep) {
      scanLine(this.width, (x) => mask[y * this.width + x], y, horizontal);
    }
    for (let x = 0; x < this.width; x += lineStep) {
      scanLine(this.height, (y) => mask[y * this.width + x], x, vertical);
    }

    const horizontalBest = horizontal.sort((a, b) => b.patternScore - a.patternScore).slice(0, 220);
    const verticalBest = vertical.sort((a, b) => b.patternScore - a.patternScore).slice(0, 220);
    const paired = [];

    for (const h of horizontalBest) {
      for (const v of verticalBest) {
        const maxBand = Math.max(h.bandWidth, v.bandWidth);
        const minBand = Math.min(h.bandWidth, v.bandWidth);
        if (maxBand / minBand > 1.85) continue;
        const tolerance = Math.max(3, maxBand * 2.4);
        const dx = Math.abs(h.axis - v.cross);
        const dy = Math.abs(h.cross - v.axis);
        if (dx > tolerance || dy > tolerance) continue;

        const alignmentError = (dx + dy) / (tolerance * 2);
        const scaleError = Math.abs(Math.log(h.bandWidth / v.bandWidth));
        paired.push({
          x: (h.axis + v.cross) / 2,
          y: (h.cross + v.axis) / 2,
          bandWidth: Math.sqrt(h.bandWidth * v.bandWidth),
          patternScore: clamp((h.patternScore + v.patternScore) / 2 - alignmentError * 0.28 - scaleError * 0.16, 0, 1),
        });
      }
    }

    const candidates = [];
    for (const candidate of paired.sort((a, b) => b.patternScore - a.patternScore)) {
      const duplicate = candidates.some((existing) =>
        Math.hypot(existing.x - candidate.x, existing.y - candidate.y) <
          Math.max(existing.bandWidth, candidate.bandWidth) * 1.5,
      );
      if (!duplicate) candidates.push(candidate);
      if (candidates.length >= 40) break;
    }
    return candidates;
  }

  estimateSymbolBandWidth() {
    const rect = getEnclosingRectangle(this.binarize(), this.width, this.height);
    if (!rect) return null;
    const horizontalPitch = rect[2] / MAXICODE_WIDTH;
    const verticalPitch = rect[3] / (MAXICODE_HEIGHT * 0.8660254037844386);
    return median([horizontalPitch, verticalPitch]) * 0.78;
  }

  bullseyeBandWidths(expectedBandWidth = null) {
    const minDim = Math.min(this.width, this.height);
    const broadMinimum = Math.max(1.25, minDim / 240);
    const broadMaximum = Math.max(broadMinimum, minDim * 0.075);
    const minBandWidth = expectedBandWidth
      ? Math.max(broadMinimum, expectedBandWidth * 0.5)
      : broadMinimum;
    const maxBandWidth = expectedBandWidth
      ? Math.min(broadMaximum, Math.max(minBandWidth, expectedBandWidth * 1.55))
      : broadMaximum;
    const widths = [];

    for (let width = minBandWidth; width <= maxBandWidth * 1.001; width *= 1.18) {
      widths.push(width);
    }

    if (!widths.length || widths[widths.length - 1] < maxBandWidth * 0.92) {
      widths.push(maxBandWidth);
    }

    return widths;
  }

  scoreBullseyeAtScale(x, y, bandWidth, anchor) {
    const gray = this.grayscale();
    const expectedBands = Math.max(6, (Number(this.options.expectedRings) || 5) + 1);
    const outerRadius = bandWidth * expectedBands;
    const edgeClearance = Math.min(x, y, this.width - 1 - x, this.height - 1 - y);
    if (edgeClearance < outerRadius * 1.03) {
      return { score: -Infinity, contrast: 0, outerRadius, bandWidth, anchorAgreement: 0 };
    }

    const threshold = this.options.threshold;
    const angleCount = 16;
    const bandMeans = [];
    const spokeMatches = new Uint8Array(angleCount);
    let matchingSamples = 0;
    let totalSamples = 0;
    let uniformity = 0;
    let symmetry = 0;

    const isInk = (value) => (this.options.invert ? value >= threshold : value < threshold);
    const inkLevel = (value) => (this.options.invert ? value : 255 - value);

    for (let band = 0; band < expectedBands; band += 1) {
      const radius = (band + 0.5) * bandWidth;
      const values = [];
      const expectedInk = band % 2 === 1;

      for (let angleIndex = 0; angleIndex < angleCount; angleIndex += 1) {
        const angle = (angleIndex / angleCount) * Math.PI * 2;
        const value = sampleGray(
          gray,
          this.width,
          this.height,
          x + Math.cos(angle) * radius,
          y + Math.sin(angle) * radius,
        );
        values.push(value);
        const matches = isInk(value) === expectedInk;
        matchingSamples += matches ? 1 : 0;
        spokeMatches[angleIndex] += matches ? 1 : 0;
        totalSamples += 1;
      }

      bandMeans.push(mean(values.map(inkLevel)));
      uniformity += clamp(1 - standardDeviation(values) / 96, 0, 1);

      for (let angleIndex = 0; angleIndex < angleCount / 2; angleIndex += 1) {
        symmetry += 1 - Math.abs(values[angleIndex] - values[angleIndex + angleCount / 2]) / 255;
      }
    }

    const inkBands = bandMeans.filter((_, index) => index % 2 === 1);
    const paperBands = bandMeans.filter((_, index) => index % 2 === 0);
    const contrast = clamp((mean(inkBands) - mean(paperBands)) / 112, 0, 1);
    const classification = matchingSamples / Math.max(totalSamples, 1);
    const spokeConsistency = spokeMatches.reduce(
      (sum, matches) => sum + (matches === expectedBands ? 1 : 0),
      0,
    ) / angleCount;
    uniformity /= expectedBands;
    symmetry /= expectedBands * (angleCount / 2);

    let quietMatches = 0;
    for (let angleIndex = 0; angleIndex < angleCount; angleIndex += 1) {
      const angle = (angleIndex / angleCount) * Math.PI * 2;
      const value = sampleGray(
        gray,
        this.width,
        this.height,
        x + Math.cos(angle) * outerRadius * 1.1,
        y + Math.sin(angle) * outerRadius * 1.1,
      );
      quietMatches += isInk(value) ? 0 : 1;
    }
    const quietZone = quietMatches / angleCount;

    const centerTone = sampleGray(gray, this.width, this.height, x, y);
    const centerStrength = clamp((160 - inkLevel(centerTone)) / 128, 0, 1);
    let anchorAgreement = 0;
    if (anchor) {
      const anchorDistance = Math.hypot(x - anchor.x, y - anchor.y);
      const anchorMax = Math.max(this.width, this.height) * 0.5;
      anchorAgreement = clamp(1 - anchorDistance / anchorMax, 0, 1);
    }

    const score =
      classification * 0.28 +
      spokeConsistency * 0.24 +
      contrast * 0.22 +
      uniformity * 0.08 +
      symmetry * 0.1 +
      quietZone * 0.04 +
      centerStrength * 0.04;

    return { score, contrast, outerRadius, bandWidth, anchorAgreement };
  }

  scoreBullseyeAt(x, y, anchor, bandWidth = null) {
    const widths = bandWidth ? [bandWidth] : this.bullseyeBandWidths();
    let bestScore = -Infinity;
    for (const width of widths) {
      bestScore = Math.max(bestScore, this.scoreBullseyeAtScale(x, y, width, anchor).score);
    }
    return bestScore;
  }

  findBullseye() {
    const anchor = this.estimateDarkCentroid();
    const minDim = Math.min(this.width, this.height);
    const gray = this.grayscale();
    const expectedBandWidth = this.estimateSymbolBandWidth();
    if (!expectedBandWidth) {
      return {
        x: this.width / 2,
        y: this.height / 2,
        score: -Infinity,
        confidence: 0,
        radius: 0,
        bandWidth: 0,
        found: false,
      };
    }
    const widths = this.bullseyeBandWidths(expectedBandWidth);
    const patternCandidates = this.findBullseyePatternCandidates();
    const step = Math.max(3, Math.round(minDim / (52 + this.options.sensitivity * 18)));
    const threshold = this.options.threshold;
    const isInk = (value) => (this.options.invert ? value >= threshold : value < threshold);
    let best = {
      x: anchor.x,
      y: anchor.y,
      score: -Infinity,
      contrast: 0,
      bandWidth: minDim / 30,
      outerRadius: minDim / 6,
      rankScore: -Infinity,
    };

    const rankCandidate = (candidate, patternScore = null) => {
      if (patternScore !== null) {
        return {
          ...candidate,
          patternScore,
          scaleAgreement: patternScore,
          rankScore: candidate.score + patternScore * 0.2,
        };
      }
      const scaleAgreement = expectedBandWidth
        ? Math.exp(-Math.abs(Math.log(candidate.bandWidth / expectedBandWidth)) * 2.2)
        : 0.5;
      return {
        ...candidate,
        scaleAgreement,
        rankScore: candidate.score + candidate.anchorAgreement * 0.12 + scaleAgreement * 0.12,
      };
    };
    const passesRingProbe = (x, y, bandWidth) => {
      let middleInk = 0;
      let outerInk = 0;
      const probes = 8;
      for (let index = 0; index < probes; index += 1) {
        const angle = (index / probes) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        middleInk += isInk(sampleGray(gray, this.width, this.height, x + cos * bandWidth * 1.5, y + sin * bandWidth * 1.5)) ? 1 : 0;
        outerInk += isInk(sampleGray(gray, this.width, this.height, x + cos * bandWidth * 5.5, y + sin * bandWidth * 5.5)) ? 1 : 0;
      }
      return middleInk >= probes / 2 && outerInk >= probes / 2;
    };

    for (const seed of patternCandidates) {
      for (const scaleFactor of [0.82, 0.9, 0.97, 1.04, 1.12, 1.22]) {
        const candidate = rankCandidate(
          this.scoreBullseyeAtScale(seed.x, seed.y, seed.bandWidth * scaleFactor, anchor),
          seed.patternScore,
        );
        if (candidate.rankScore > best.rankScore) {
          best = { x: seed.x, y: seed.y, ...candidate };
        }
      }
    }

    if (!Number.isFinite(best.score) || best.rankScore < 0.78) {
      for (let y = Math.floor(step / 2); y < this.height; y += step) {
        for (let x = Math.floor(step / 2); x < this.width; x += step) {
          if (isInk(sampleGray(gray, this.width, this.height, x, y))) continue;
          for (const bandWidth of widths) {
            if (!passesRingProbe(x, y, bandWidth)) continue;
            const candidate = rankCandidate(this.scoreBullseyeAtScale(x, y, bandWidth, anchor));
            if (candidate.rankScore > best.rankScore) {
              best = { x, y, ...candidate };
            }
          }
        }
      }
    }

    if (Number.isFinite(best.score)) {
      const refineSteps = [Math.max(1, Math.round(step / 3)), 1];
      for (const refineStep of refineSteps) {
        const origin = best;
        const scaleFactors = [0.9, 0.95, 1, 1.05, 1.1];
        for (let y = origin.y - step; y <= origin.y + step; y += refineStep) {
          for (let x = origin.x - step; x <= origin.x + step; x += refineStep) {
            for (const scaleFactor of scaleFactors) {
              const candidate = rankCandidate(
                this.scoreBullseyeAtScale(x, y, origin.bandWidth * scaleFactor, anchor),
                origin.patternScore ?? null,
              );
              if (candidate.rankScore > best.rankScore) {
                best = { x, y, ...candidate };
              }
            }
          }
        }
      }

      // The alternating rings provide the scale; the white center disc gives the most
      // stable sub-grid center after the coarse radial search has converged.
      const discRadius = best.bandWidth * 1.45;
      let sumX = 0;
      let sumY = 0;
      let sumWeight = 0;
      for (let y = Math.floor(best.y - discRadius); y <= Math.ceil(best.y + discRadius); y += 1) {
        if (y < 0 || y >= this.height) continue;
        for (let x = Math.floor(best.x - discRadius); x <= Math.ceil(best.x + discRadius); x += 1) {
          if (x < 0 || x >= this.width || Math.hypot(x - best.x, y - best.y) > discRadius) continue;
          const value = gray[y * this.width + x];
          if (isInk(value)) continue;
          const weight = this.options.invert ? (255 - value) / 255 : value / 255;
          sumX += x * weight;
          sumY += y * weight;
          sumWeight += weight;
        }
      }

      if (sumWeight) {
        const discX = sumX / sumWeight;
        const discY = sumY / sumWeight;
        if (Math.hypot(discX - best.x, discY - best.y) <= best.bandWidth * 0.65) {
          const centered = rankCandidate(
            this.scoreBullseyeAtScale(discX, discY, best.bandWidth, anchor),
            best.patternScore ?? null,
          );
          best = { x: discX, y: discY, ...centered };
        }
      }
    }

    const confidence = Number.isFinite(best.rankScore) ? clamp((best.rankScore - 0.67) / 0.3, 0, 1) : 0;
    const found = confidence >= 0.35 && best.contrast >= 0.22;
    const radius = best.outerRadius;

    this._lastBullseyeBandWidth = best.bandWidth;

    return {
      x: best.x,
      y: best.y,
      score: best.score,
      confidence,
      radius,
      bandWidth: best.bandWidth,
      found,
    };
  }

  estimateModulePitch(center) {
    const gray = this.grayscale();
    const threshold = this.options.threshold;
    const maxRadius = center?.radius
      ? Math.min(center.radius * 1.3, Math.min(this.width, this.height) * 0.3)
      : Math.min(this.width, this.height) * 0.3;
    const angles = 24;
    const transitionDistances = [];
    const isInk = (value) => (this.options.invert ? value >= threshold : value < threshold);

    for (let a = 0; a < angles; a += 1) {
      const angle = (a / angles) * Math.PI * 2;
      const samples = [];
      for (let r = 0; r <= maxRadius; r += 1) {
        samples.push(sampleGray(gray, this.width, this.height, center.x + Math.cos(angle) * r, center.y + Math.sin(angle) * r));
      }

      const transitions = [];
      let prev = isInk(samples[0]);
      for (let r = 1; r < samples.length; r += 1) {
        const current = isInk(samples[r]);
        if (current !== prev) transitions.push(r);
        prev = current;
      }

      if (transitions.length >= 4) {
        const gaps = [];
        for (let i = 1; i < Math.min(transitions.length, 5); i += 1) {
          gaps.push(transitions[i] - transitions[i - 1]);
        }
        if (gaps.length) transitionDistances.push(median(gaps));
      }
    }

    const pitchGuess = median(transitionDistances) || this._lastBullseyeBandWidth || Math.min(this.width, this.height) / 54;
    const pitch = clamp(pitchGuess, 2, Math.min(this.width, this.height) / 8);
    this._lastCenter = center;
    this._lastPitch = pitch;
    return pitch;
  }

  findOrientationCandidates(mask) {
    const center = this._lastCenter;
    const ringBand = this._lastBullseyeBandWidth;
    if (!center || !ringBand) return [];

    const coarse = [];
    const pitchFactors = [1.24, 1.32, 1.4, 1.46, 1.52, 1.6, 1.68];
    const verticalScales = [0.88, 1, 1.12];
    for (const pitchFactor of pitchFactors) {
      const modulePitch = ringBand * pitchFactor;
      for (const verticalScale of verticalScales) {
        for (let degrees = 0; degrees < 360; degrees += 3) {
          const angle = degrees * Math.PI / 180;
          coarse.push({
            angle,
            modulePitch,
            verticalScale,
            score: scoreOrientation(
              mask,
              this.width,
              this.height,
              center,
              modulePitch,
              angle,
              verticalScale,
            ),
          });
        }
      }
    }

    coarse.sort((a, b) => b.score - a.score);
    const refined = [];
    for (const candidate of coarse.slice(0, 18)) {
      for (const angleOffset of [-2, -1, 0, 1, 2]) {
        for (const pitchScale of [0.97, 1, 1.03]) {
          for (const verticalScale of [candidate.verticalScale * 0.97, candidate.verticalScale, candidate.verticalScale * 1.03]) {
            const angle = candidate.angle + angleOffset * Math.PI / 180;
            const modulePitch = candidate.modulePitch * pitchScale;
            refined.push({
              angle,
              modulePitch,
              verticalScale,
              score: scoreOrientation(
                mask,
                this.width,
                this.height,
                center,
                modulePitch,
                angle,
                verticalScale,
              ),
            });
          }
        }
      }
    }

    refined.sort((a, b) => b.score - a.score);
    const unique = [];
    for (const candidate of refined) {
      const duplicate = unique.some((other) => (
        Math.abs(other.angle - candidate.angle) < Math.PI / 360
        && Math.abs(other.modulePitch - candidate.modulePitch) < ringBand * 0.015
        && Math.abs(other.verticalScale - candidate.verticalScale) < 0.015
      ));
      if (!duplicate) unique.push(candidate);
      if (unique.length >= 60) break;
    }
    return unique;
  }

  sampleHexGrid(center, pitch) {
    const mask = this.binarize();
    this._lastOrientationCandidates = this.findOrientationCandidates(mask);
    const orientation = this._lastOrientationCandidates[0];

    if (!orientation || orientation.score < 0.6) {
      const layout = buildHexLayout({
        rows: MAXICODE_HEIGHT,
        cols: MAXICODE_WIDTH,
        pitch,
        centerX: center.x,
        centerY: center.y,
      });
      return layout.map((cell) => ({
        ...cell,
        bit: sampleMask(mask, this.width, this.height, cell.x, cell.y) ? 1 : 0,
      }));
    }

    const cells = [];
    for (let row = 0; row < MAXICODE_HEIGHT; row += 1) {
      for (let col = 0; col < MAXICODE_WIDTH; col += 1) {
        const point = orientedImagePosition(
          center,
          orientation.modulePitch,
          orientation.angle,
          col,
          row,
          orientation.verticalScale,
        );
        cells.push({
          row,
          col,
          rowWidth: MAXICODE_WIDTH,
          rowT: Math.abs((row - 16) / 16),
          x: point.x,
          y: point.y,
          bit: sampleMask(mask, this.width, this.height, point.x, point.y) ? 1 : 0,
        });
      }
    }
    return cells;
  }

  decode(cells) {
    const mask = this.binarize();
    const gray = this.grayscale();
    const candidateRects = [];
    let decodeFailure = null;

    const center = this._lastCenter || null;
    const pitch = this._lastPitch || null;
    if (center && pitch) {
      const widthGuess = pitch * 30.5;
      const heightGuess = pitch * 33;
      const offsets = [-2, -1, 0, 1, 2];
      const scales = [0.86, 0.94, 1, 1.06, 1.14];
      for (const scale of scales) {
        for (const ox of offsets) {
          for (const oy of offsets) {
            candidateRects.push({
              left: Math.round(center.x - (widthGuess * scale) / 2 + ox * pitch * 0.45),
              top: Math.round(center.y - (heightGuess * scale) / 2 + oy * pitch * 0.45),
              width: Math.max(1, Math.round(widthGuess * scale)),
              height: Math.max(1, Math.round(heightGuess * scale)),
            });
          }
        }
      }
    }

    try {
      let decoded = null;
      let pureBits = null;
      let source = null;
      let rotation = 0;

      // A tightly cropped, axis-aligned symbol is common and remains the fastest path.
      for (const quarterTurns of [0, 1, 2, 3]) {
        try {
          pureBits = extractPureBitsAtRotation(mask, this.width, this.height, null, quarterTurns);
          decoded = decodeMaxiCodeData(readCodewordsFromBitMatrix(pureBits));
          source = { left: 0, top: 0, width: this.width, height: this.height };
          rotation = (360 - quarterTurns * 90) % 360;
          break;
        } catch (error) {
          decodeFailure = error;
          decoded = null;
          pureBits = null;
        }
      }

      let orientationScore = null;
      if (!decoded && center && pitch) {
        const orientations = this._lastOrientationCandidates || this.findOrientationCandidates(mask);
        for (const orientation of orientations) {
          try {
            pureBits = sampleOrientedBitMatrix(
              mask,
              this.width,
              this.height,
              center,
              orientation.modulePitch,
              orientation.angle,
              orientation.verticalScale,
            );
            const codewords = readCodewordsFromBitMatrix(pureBits);
            if (!canDecodeMaxiCodePrimary(codewords)) throw new Error("Primary checksum");
            decoded = decodeMaxiCodeData(codewords);
            rotation = ((orientation.angle * 180 / Math.PI) % 360 + 360) % 360;
            orientationScore = orientation.score;
            source = {
              centerX: center.x,
              centerY: center.y,
              modulePitch: orientation.modulePitch,
              angle: orientation.angle,
              verticalScale: orientation.verticalScale,
            };
            break;
          } catch (error) {
            decodeFailure = error;
            decoded = null;
            pureBits = null;
          }
        }

        if (!decoded) {
          const base = orientations[0];
          const primaryCandidates = [];
          const pitchScales = [0.9, 0.96, 1.02, 1.08, 1.14];
          const angleOffsets = [-3, 0, 3];
          const verticalScales = [0.88, 1, 1.12];
          const shears = [-6, 0, 6];
          const centerOffsets = [[0, 0], [-0.22, 0], [0.22, 0], [0, -0.22], [0, 0.22]];

          for (const pitchScale of pitchScales) {
            for (const angleOffset of angleOffsets) {
              for (const verticalScale of verticalScales) {
                for (const shearDegrees of shears) {
                  for (const [offsetX, offsetY] of centerOffsets) {
                    const transform = {
                      modulePitch: base.modulePitch * pitchScale,
                      angle: base.angle + angleOffset * Math.PI / 180,
                      verticalScale: base.verticalScale * verticalScale,
                      shear: shearDegrees * Math.PI / 180,
                      perspectiveX: 0,
                      perspectiveY: 0,
                    };
                    const adjustedCenter = {
                      x: center.x + offsetX * transform.modulePitch,
                      y: center.y + offsetY * transform.modulePitch,
                    };
                    const primary = sampleOrientedCodewords(
                      mask,
                      this.width,
                      this.height,
                      adjustedCenter,
                      transform,
                      119,
                    );
                    if (canDecodeMaxiCodePrimary(primary)) {
                      primaryCandidates.push({ center: adjustedCenter, transform });
                    }
                  }
                }
              }
            }
          }
          const affinePrimaryCandidates = [...primaryCandidates];
          for (const candidate of affinePrimaryCandidates) {
            for (const perspectiveX of [-0.006, 0, 0.006]) {
              for (const perspectiveY of [-0.006, 0, 0.006]) {
                if (perspectiveX === 0 && perspectiveY === 0) continue;
                const transform = { ...candidate.transform, perspectiveX, perspectiveY };
                const primary = sampleOrientedCodewords(
                  mask,
                  this.width,
                  this.height,
                  candidate.center,
                  transform,
                  119,
                );
                if (canDecodeMaxiCodePrimary(primary)) {
                  primaryCandidates.push({ center: candidate.center, transform });
                }
              }
            }
          }
          const rankedPrimaryCandidates = primaryCandidates.map((candidate) => ({
            ...candidate,
            score: scoreOrientedGridContrast(
              gray,
              this.width,
              this.height,
              candidate.center,
              candidate.transform,
              this.options.threshold,
            ),
          })).sort((a, b) => b.score - a.score);
          const refinedCandidates = [];

          for (const initialCandidate of rankedPrimaryCandidates.slice(0, 8)) {
            const candidate = refineGridTransform(
              mask,
              gray,
              this.width,
              this.height,
              initialCandidate.center,
              initialCandidate.transform,
              this.options.threshold,
            );
            refinedCandidates.push(candidate);
            try {
              const primary = sampleOrientedCodewords(
                mask,
                this.width,
                this.height,
                candidate.center,
                candidate.transform,
                119,
              );
              if (!canDecodeMaxiCodePrimary(primary)) continue;
              const codewords = sampleOrientedCodewords(
                mask,
                this.width,
                this.height,
                candidate.center,
                candidate.transform,
              );
              decoded = decodeMaxiCodeData(codewords);
              pureBits = sampleOrientedBitMatrix(
                mask,
                this.width,
                this.height,
                candidate.center,
                candidate.transform.modulePitch,
                candidate.transform.angle,
                candidate.transform.verticalScale,
                candidate.transform.perspectiveX,
                candidate.transform.perspectiveY,
                candidate.transform.shear,
              );
              rotation = ((candidate.transform.angle * 180 / Math.PI) % 360 + 360) % 360;
              orientationScore = base.score;
              source = {
                centerX: candidate.center.x,
                centerY: candidate.center.y,
                modulePitch: candidate.transform.modulePitch,
                angle: candidate.transform.angle,
                verticalScale: candidate.transform.verticalScale,
                shear: candidate.transform.shear,
                perspectiveX: candidate.transform.perspectiveX,
                perspectiveY: candidate.transform.perspectiveY,
              };
              break;
            } catch (error) {
              decodeFailure = error;
              decoded = null;
              pureBits = null;
            }
          }
        }
      }

      for (const rect of decoded ? [] : candidateRects) {
        for (const quarterTurns of [0, 1, 2, 3]) {
          try {
            pureBits = extractPureBitsAtRotation(mask, this.width, this.height, rect, quarterTurns);
            const codewords = readCodewordsFromBitMatrix(pureBits);
            decoded = decodeMaxiCodeData(codewords);
            source = rect || { left: 0, top: 0, width: this.width, height: this.height };
            rotation = (360 - quarterTurns * 90) % 360;
            break;
          } catch (error) {
            decodeFailure = error;
            decoded = null;
            pureBits = null;
          }
        }
        if (decoded) break;
      }

      if (decoded && pureBits) {
        if (Number.isFinite(source?.centerX) && Number.isFinite(source?.angle)) {
          const decodedCenter = { x: source.centerX, y: source.centerY };
          for (const cell of cells) {
            const point = orientedImagePosition(
              decodedCenter,
              source.modulePitch,
              source.angle,
              cell.col,
              cell.row,
              source.verticalScale,
              source.perspectiveX || 0,
              source.perspectiveY || 0,
              source.shear || 0,
            );
            cell.x = point.x;
            cell.y = point.y;
            cell.bit = sampleMask(mask, this.width, this.height, point.x, point.y) ? 1 : 0;
          }
        }
        const bits = decoded.rawBytes.map((byte) => byte.toString(2).padStart(8, "0")).join("");
        const density = pureBits.count() / (MAXICODE_WIDTH * MAXICODE_HEIGHT);
        const modeGuess = `Mode ${decoded.mode}`;

        return {
          bits,
          bytes: decoded.rawBytes,
          text: decoded.text,
          density,
          modeGuess,
          mode: decoded.mode,
          errorsCorrected: decoded.errorsCorrected,
          rotation,
          orientationScore,
          decoded: true,
          sourceRect: source,
        };
      }
    } catch (error) {
      // fall through to heuristic fallback below
    }

    try {
      const ordered = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
      const bits = ordered.map((cell) => String(cell.bit)).join("");
      const bytes = bitsToBytes(bits);
      const text = bytesToPrintableText(bytes);

      const black = ordered.reduce((sum, cell) => sum + cell.bit, 0);
      const density = black / Math.max(ordered.length, 1);
      const modeGuess = density > 0.53 ? "Mode 2 / 3" : "Mode 4 / 5";

      return {
        bits,
        bytes,
        text,
        density,
        modeGuess,
        decoded: false,
        error: decodeFailure ? String(decodeFailure?.message || decodeFailure) : "Decode unavailable",
      };
    } catch (error) {
      return {
        bits: "",
        bytes: [],
        text: "",
        density: 0,
        modeGuess: "Unknown",
        decoded: false,
        error: decodeFailure ? String(decodeFailure?.message || decodeFailure) : String(error?.message || error),
      };
    }
  }
}

export {
  bitsToBytes,
  buildHexLayout,
  bytesToPrintableText,
  clamp,
  decodeMaxiCodeData,
  extractPureBitsFromMask,
  extractPureBitsFromRect,
  mean,
  median,
  readCodewordsFromBitMatrix,
  sampleGray,
  sampleMask,
};
