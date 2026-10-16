const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "2331112",
] as const;

function normalizeBarcodeValue(value: string) {
  const source = value.trim();
  const normalized = Array.from(source)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code <= 126 ? character : "-";
    })
    .join("");
  return normalized || "-";
}

export function Code128Barcode({ value }: { value: string }) {
  const source = normalizeBarcodeValue(value);
  const start = 104;
  const values = Array.from(source).map(
    (character) => character.charCodeAt(0) - 32,
  );
  const checksum =
    (start + values.reduce((total, item, index) => total + item * (index + 1), 0)) %
    103;
  const sequence = [start, ...values, checksum, 106];
  let cursor = 0;
  const bars: Array<{ key: string; width: number; x: number }> = [];
  sequence.forEach((code, codeIndex) => {
    const pattern = PATTERNS[code];
    Array.from(pattern).forEach((widthValue, index) => {
      const width = Number(widthValue);
      if (index % 2 === 0) {
        bars.push({ key: `${codeIndex}-${index}`, width, x: cursor });
      }
      cursor += width;
    });
  });
  const totalWidth = cursor;
  return (
    <svg
      aria-label={`Mã vạch ${source}`}
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${totalWidth} 60`}
    >
      {bars.map((bar) => (
        <rect
          fill="#101010"
          height="60"
          key={bar.key}
          width={bar.width}
          x={bar.x}
          y="0"
        />
      ))}
    </svg>
  );
}
