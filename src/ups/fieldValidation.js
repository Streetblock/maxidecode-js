// UPS Table 1 permits up to ten characters for Weight. Real UPS MaxiCodes
// also use a decimal point (for example "0.5"), so this is a decimal field,
// not an integer-only field. The unit is not encoded alongside the value.
export const UPS_WEIGHT_PATTERN = /^(?=.{1,10}$)\d+(?:\.\d+)?$/;

export function isUpsWeight(value) {
  return UPS_WEIGHT_PATTERN.test(String(value ?? ""));
}
