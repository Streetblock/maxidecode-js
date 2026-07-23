import test from "node:test";
import assert from "node:assert/strict";

import { reconstructCarrierAnsiMessage } from "../src/maxicode/scanner.js";

const GS = "\x1d";
const RS = "\x1e";

test("keeps the physical secondary message unchanged while reconstructing carrier ANSI fields", () => {
  const secondaryText = `[)>${RS}01${GS}961Z50978063${GS}UPSN${GS}123123${RS}07PAYLOAD${RS}\x04`;
  const primary = {
    postalCode: "116352242",
    countryCode: "480",
    serviceClass: "003",
  };

  const ansiText = reconstructCarrierAnsiMessage(secondaryText, primary);

  assert.equal(
    ansiText,
    `[)>${RS}01${GS}96116352242${GS}480${GS}003${GS}1Z50978063${GS}UPSN${GS}123123${RS}07PAYLOAD${RS}\x04`,
  );
  assert.equal(secondaryText, `[)>${RS}01${GS}961Z50978063${GS}UPSN${GS}123123${RS}07PAYLOAD${RS}\x04`);
});

test("reconstructs a carrier message without pretending the derived separators were scanned", () => {
  const secondaryText = `1Z45369427${GS}UPSN${GS}W1622R${GS}196`;
  const ansiText = reconstructCarrierAnsiMessage(secondaryText, {
    postalCode: "41352",
    countryCode: "276",
    serviceClass: "068",
  });

  assert.equal(ansiText, `41352${GS}276${GS}068${GS}${secondaryText}`);
  assert.equal(secondaryText.startsWith(`41352${GS}`), false);
});
