export type SendMailLocationAddress = {
  address: string;
  districtId: number;
  districtName: string;
  provinceId: number;
  provinceName: string;
  wardId: number;
  wardName: string;
};

export type SendMailLocationOption = {
  key: string;
  label: string;
  lockedAddressMode?: "old";
  newAddress?: SendMailLocationAddress;
  oldAddress?: SendMailLocationAddress;
  preferredAddressMode: "new" | "old";
};

type CompanyLocationRecord = {
  address: string | null;
  branchName: string | null;
  legalName: string;
  oldAddress: string | null;
  oldDistrictId: string | null;
  oldDistrictName: string | null;
  oldProvinceId: string | null;
  oldProvinceName: string | null;
  oldWardId: string | null;
  oldWardName: string | null;
  sendMailAddressPriority: string;
  sendMailLocationKey: string | null;
  shortName: string | null;
};

const BASE_LOCATIONS: SendMailLocationOption[] = [
  {
    key: "q12-main",
    label: "Trụ sở chính Quận 12",
    newAddress: {
      address: "H76-H77 Dương Thị Giang",
      districtId: 0,
      districtName: "",
      provinceId: 2,
      provinceName: "Thành phố Hồ Chí Minh",
      wardId: 49268,
      wardName: "Phường Đông Hưng Thuận",
    },
    preferredAddressMode: "new",
  },
  {
    key: "908-hau-giang",
    label: "908 Hậu Giang",
    newAddress: {
      address: "908 Hậu Giang",
      districtId: 0,
      districtName: "",
      provinceId: 2,
      provinceName: "Thành phố Hồ Chí Minh",
      wardId: 49252,
      wardName: "Phường Phú Lâm",
    },
    preferredAddressMode: "new",
  },
  {
    key: "kho-long-an",
    label: "Kho Long An",
    newAddress: {
      address: "Đường số 8, cụm công nghiệp Hoàng Gia, Ấp Mới 2",
      districtId: 0,
      districtName: "",
      provinceId: 49,
      provinceName: "Tỉnh Tây Ninh",
      wardId: 50705,
      wardName: "Xã Mỹ Hạnh",
    },
    preferredAddressMode: "new",
  },
  {
    key: "bien-hoa",
    label: "Biên Hoà",
    newAddress: {
      address: "Số 1378 Phạm Văn Thuận, Tổ 3, KP 9",
      districtId: 0,
      districtName: "",
      provinceId: 51,
      provinceName: "Tỉnh Đồng Nai",
      wardId: 52404,
      wardName: "Phường Tam Hiệp",
    },
    preferredAddressMode: "new",
  },
  {
    key: "rach-gia",
    label: "Rạch Giá",
    newAddress: {
      address: "251 Nguyễn Trung Trực",
      districtId: 0,
      districtName: "",
      provinceId: 56,
      provinceName: "Tỉnh An Giang",
      wardId: 49575,
      wardName: "Phường Rạch Giá",
    },
    preferredAddressMode: "new",
  },
  {
    key: "long-xuyen",
    label: "Long Xuyên",
    newAddress: {
      address: "1477 Trần Hưng Đạo",
      districtId: 0,
      districtName: "",
      provinceId: 56,
      provinceName: "Tỉnh An Giang",
      wardId: 50106,
      wardName: "Phường Long Xuyên",
    },
    preferredAddressMode: "new",
  },
  {
    key: "ninh-kieu",
    label: "Ninh Kiều",
    newAddress: {
      address: "146 đường Nguyễn Văn Cừ",
      districtId: 0,
      districtName: "",
      provinceId: 5,
      provinceName: "Thành phố Cần Thơ",
      wardId: 50827,
      wardName: "Phường Tân An",
    },
    preferredAddressMode: "new",
  },
  {
    key: "562-3t2",
    label: "562 đường 3 Tháng 2",
    newAddress: {
      address: "562 đường 3 Tháng 2",
      districtId: 0,
      districtName: "",
      provinceId: 2,
      provinceName: "Thành phố Hồ Chí Minh",
      wardId: 49262,
      wardName: "Phường Diên Hồng",
    },
    preferredAddressMode: "new",
  },
];

function numberId(value: string | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalized(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .trim()
    .toLowerCase();
}

function isThanhCongWorkshop(record: CompanyLocationRecord | undefined) {
  if (!record) return false;
  const values = [
    record.sendMailLocationKey,
    record.branchName,
    record.shortName,
    record.legalName,
  ];
  const directMatch = values.some((value) => {
    const text = normalized(value);
    return (
      text.includes("xuong thanh cong") ||
      (text.includes("xuong") && text.includes("nem thanh cong"))
    );
  });
  const combined = normalized(values.filter(Boolean).join(" "));
  return (
    directMatch ||
    (combined.includes("xuong") && combined.includes("thanh cong"))
  );
}

function oldAddressOf(record: CompanyLocationRecord | undefined) {
  const hasOldAddress = Boolean(
    record?.oldAddress &&
      record.oldProvinceId &&
      record.oldProvinceName &&
      record.oldDistrictId &&
      record.oldDistrictName &&
      record.oldWardId &&
      record.oldWardName,
  );
  return hasOldAddress
    ? {
        address: record?.oldAddress || "",
        districtId: numberId(record?.oldDistrictId || null),
        districtName: record?.oldDistrictName || "",
        provinceId: numberId(record?.oldProvinceId || null),
        provinceName: record?.oldProvinceName || "",
        wardId: numberId(record?.oldWardId || null),
        wardName: record?.oldWardName || "",
      }
    : undefined;
}

export function buildSendMailLocationOptions(
  records: CompanyLocationRecord[],
): SendMailLocationOption[] {
  const byKey = new Map(
    records
      .filter((record) => record.sendMailLocationKey)
      .map((record) => [record.sendMailLocationKey as string, record]),
  );

  const base = BASE_LOCATIONS.map((location): SendMailLocationOption => {
    const record = byKey.get(location.key);
    const oldAddress = oldAddressOf(record);
    const forceOld = isThanhCongWorkshop(record) && Boolean(oldAddress);
    return {
      ...location,
      lockedAddressMode: forceOld ? ("old" as const) : undefined,
      oldAddress,
      preferredAddressMode:
        oldAddress &&
        (forceOld || record?.sendMailAddressPriority === "old")
          ? "old"
          : "new",
    };
  });

  const baseKeys = new Set(base.map((location) => location.key));
  const configured = records
    .filter(
      (record) =>
        record.sendMailLocationKey &&
        !baseKeys.has(record.sendMailLocationKey) &&
        oldAddressOf(record),
    )
    .map((record): SendMailLocationOption => {
      const oldAddress = oldAddressOf(record);
      const forceOld = isThanhCongWorkshop(record);
      return {
        key: record.sendMailLocationKey as string,
        label:
          record.branchName ||
          record.shortName ||
          record.legalName ||
          (record.sendMailLocationKey as string),
        lockedAddressMode: forceOld ? "old" : undefined,
        newAddress: forceOld ? undefined : oldAddress,
        oldAddress,
        preferredAddressMode: "old",
      };
    });

  return [...base, ...configured];
}
