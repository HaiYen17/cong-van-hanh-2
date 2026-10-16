function text(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

const DIMENSION_MARKER =
  /(?:\d+(?:[.,]\d+)?\s*(?:mm|cm|m)(?:\d+)?|\d{2,4}\s*[x×]\s*\d{2,4})/iu;
const TRAILING_DIMENSIONS =
  /\s*(?:[-–—|·,]\s*)?(?:(?:kích\s*thước|size)\s*:?[\s]*)?\d+(?:[.,]\d+)?\s*(?:mm|cm|m)(?:\d+)?(?:\s*[\/x×]\s*\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?(?:\d+)?){0,3}\s*$/iu;
const TRAILING_PLAIN_DIMENSIONS =
  /\s*(?:[-–—|·,]\s*)?\d{2,4}\s*[x×]\s*\d{2,4}(?:\s*[x×]\s*\d{1,4})?\s*$/iu;

/**
 * Keeps the human-readable product line while removing size-only suffixes.
 * Example: "Nệm Latex Premium (5cm/160cmx200cm)" -> "Nệm Latex Premium".
 */
export function skuProductNameWithoutSize(value: unknown) {
  const original = text(value);
  if (!original) return "";

  const withoutDimensionNotes = original.replace(
    /\s*\(([^()]*)\)\s*/gu,
    (match, content: string) => (DIMENSION_MARKER.test(content) ? " " : match),
  );
  const result = text(
    withoutDimensionNotes
      .replace(TRAILING_DIMENSIONS, "")
      .replace(TRAILING_PLAIN_DIMENSIONS, "")
      .replace(/[\s·|,;:/-]+$/u, ""),
  );

  return result || original;
}

export function representativeSkuProductName(values: readonly unknown[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const name = skuProductNameWithoutSize(value);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return (
    [...counts.entries()].sort(
      ([left, leftCount], [right, rightCount]) =>
        rightCount - leftCount ||
        left.length - right.length ||
        left.localeCompare(right, "vi"),
    )[0]?.[0] ?? ""
  );
}
