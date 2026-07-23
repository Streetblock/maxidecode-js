# Damaged MaxiCode recovery mode

Recovery is an explicit, opt-in operation. The normal scanner never invokes it.
It runs in a Web Worker so the camera and result UI remain responsive.

## Recovery pipeline

1. Locate the bullseye and estimate the MaxiCode grid.
2. Detect long, locally bright damage bands without inspecting decoded text.
3. Search a bounded set of center, rotation, pitch, shear and perspective variants.
4. Mark codewords intersecting the damage band as Reed-Solomon erasures.
5. Optionally mark the least reliable sampled codewords as confidence erasures.
6. Reconstruct the erased symbols over GF(64).
7. Accept a result only when every remaining Reed-Solomon parity equation is satisfied.

The search never scores candidates by readable-looking text. A failed parity check
cannot be promoted to a result by the UPS interpreter.

## Safety reserve

MaxiCode has 10 primary parity symbols and 20 parity symbols in each secondary
interleave for Modes 2, 3 and 4. Using all of them as erasure equations would leave
no independent verification: an arbitrary wrong grid could be interpolated into a
different, formally valid codeword.

Recovery therefore uses at most 8 primary and 16 erasures in each secondary
interleave. The unused equations are an independent parity reserve. A bounded search
may additionally locate one unknown error per block only when the Reed-Solomon bound
`2 * unknownErrors + erasures <= paritySymbols` still holds.

## Provenance

A successful `decode.recovery` object distinguishes:

- `directlySampledCodewords`: symbols retained from the image;
- `erasedCodewords`: symbols deliberately excluded from direct sampling;
- `damagedModules`: image modules intersecting the detected band, or codewords marked
  because of low sampling confidence;
- `erasureCorrections`: before/after values reconstructed from parity;
- `bruteForcePositions`: unknown error locations found by the bounded position search;
- `bruteForceAttempts`: parity trials used by that search;
- `reedSolomonCorrectionsAfterErasureRecovery`: corrections performed by the normal
  decoder after aggressive reconstruction;
- `verification`: the final parity verdict.

If recovery fails, `observations` contains the strongest geometric attempt and the
directly sampled raw codewords. Those values are explicitly unverified. No partial
text or UPS fields are emitted as a successful result. An experimental diagnostic
view may split uninterrupted codeword runs and show character-set alternatives:
only the first run before an erasure is synchronized to MaxiCode Set 0; later runs
remain marked as charset hypotheses unless all five possible starting sets agree.

## Current destroyed SurePost sample

`assets/online findings/destroyed MaxiCode Scanner.png` yields a stable bullseye near
`(404, 393)`, a grid rotation near `+4 degrees`, and a bright damage band near
`-27 degrees`. The bounded recovery currently does **not** find a parity-valid payload
while retaining the required parity reserve. The UI therefore reports the observed
raw symbols and damage map, but correctly refuses to claim decoded shipment data.
