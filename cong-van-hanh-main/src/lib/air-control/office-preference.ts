export const LONG_AN_OFFICE = "Văn phòng Long An";
export const QUAN_12_OFFICE = "Văn phòng Quận 12";

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("vi-VN");
}

export function preferredElectricalOfficeForCompany(company: {
  code?: string | null;
  legalName?: string | null;
  shortName?: string | null;
} | null | undefined) {
  const companyText = normalize(
    [company?.code, company?.legalName, company?.shortName]
      .filter(Boolean)
      .join(" "),
  );
  const companyCode = normalize(company?.code);
  return companyText.includes("nem thanh cong") || companyCode === "ntc"
    ? LONG_AN_OFFICE
    : QUAN_12_OFFICE;
}

export function resolvePreferredElectricalOffice(
  buildings: string[],
  preferredOffice: string,
) {
  if (!buildings.length) return "";
  const target = normalize(preferredOffice);
  const exact = buildings.find((building) => normalize(building) === target);
  if (exact) return exact;

  const locationHint = target.includes("long an")
    ? "long an"
    : target.includes("quan 12")
      ? "quan 12"
      : target;
  return (
    buildings.find((building) => normalize(building).includes(locationHint)) ||
    buildings[0]
  );
}

export function compareElectricalFloors(left: string, right: string) {
  function rank(value: string) {
    const normalized = normalize(value);
    if (normalized.includes("tret") || normalized.includes("ground")) return 0;
    const numeric = normalized.match(/\d+/)?.[0];
    return numeric ? Number(numeric) + 1 : 10_000;
  }

  return (
    rank(left) - rank(right) ||
    left.localeCompare(right, "vi", { numeric: true })
  );
}
