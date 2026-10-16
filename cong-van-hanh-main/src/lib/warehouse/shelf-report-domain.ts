export type ShelfReportLine = {
  floor: number;
  name: string;
  quantity: number;
  sku: string;
};

export type ShelfReportSession = {
  entityType?: "SHELF" | "VEHICLE";
  excludedReadCount: number;
  floorCount?: number;
  lines: ShelfReportLine[];
  operatorName: string;
  sessionId: string;
  shelfCode: string;
  shelfId: string;
  shelfName: string;
  submittedAt: string;
};

export type ShelfWarehouseReport = {
  createdAt?: string;
  generatedAt: string;
  name?: string;
  preparedBy: string;
  reportId?: string;
  shelves: ShelfReportSession[];
  sourceSessionIds?: string[];
  warehouse: string;
};

export type ShelfSavedReportSummary = {
  createdAt: string;
  name: string;
  preparedBy: string;
  reportId: string;
  shelfCount: number;
  skuCount: number;
  totalQuantity: number;
  warehouse: string;
};

export type ShelfReportComparisonLine = ShelfReportLine & {
  difference: number;
  inputQuantity: number;
  outputQuantity: number;
};

export type ShelfReportComparisonFloor = {
  difference: number;
  floor: number;
  inputQuantity: number;
  lines: ShelfReportComparisonLine[];
  outputQuantity: number;
};

export type ShelfReportComparisonShelf = {
  configurationChanged: boolean;
  difference: number;
  entityType: "SHELF" | "VEHICLE";
  floorCount: number;
  floors: ShelfReportComparisonFloor[];
  inputPresent: boolean;
  inputQuantity: number;
  outputPresent: boolean;
  outputQuantity: number;
  shelfCode: string;
  shelfId: string;
  shelfName: string;
};

export type ShelfReportComparison = {
  inputReport: ShelfSavedReportSummary;
  outputReport: ShelfSavedReportSummary;
  shelves: ShelfReportComparisonShelf[];
  summary: {
    changedLineCount: number;
    changedShelfCount: number;
    differenceQuantity: number;
    inputQuantity: number;
    inputShelfCount: number;
    outputQuantity: number;
    outputShelfCount: number;
    shelfCount: number;
  };
  warehouse: string;
};

const text = (value: unknown) => String(value ?? "").trim();
const quantity = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};

export function shelfEntityType(shelf: Pick<ShelfReportSession, "entityType">): "SHELF" | "VEHICLE" {
  return shelf.entityType === "VEHICLE" ? "VEHICLE" : "SHELF";
}

export function shelfFloorCount(shelf: Pick<ShelfReportSession, "entityType" | "floorCount">): number {
  if (shelfEntityType(shelf) === "VEHICLE") return 0;
  const parsed = Number(shelf.floorCount);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 3;
}

export function shelfPositions(shelf: Pick<ShelfReportSession, "entityType" | "floorCount">): number[] {
  const count = shelfFloorCount(shelf);
  return count === 0 ? [0] : Array.from({ length: count }, (_, index) => count - index);
}

export function reportSummary(report: ShelfWarehouseReport): ShelfSavedReportSummary {
  const skus = new Set<string>();
  let totalQuantity = 0;
  for (const shelf of report.shelves) {
    for (const line of shelf.lines) {
      skus.add(line.sku.toLocaleUpperCase("vi"));
      totalQuantity += quantity(line.quantity);
    }
  }
  return {
    createdAt: report.createdAt || report.generatedAt,
    name: report.name || `Kiểm kê toàn kho ${report.warehouse}`,
    preparedBy: report.preparedBy,
    reportId: report.reportId || "",
    shelfCount: report.shelves.length,
    skuCount: skus.size,
    totalQuantity,
    warehouse: report.warehouse,
  };
}

export function compareShelfWarehouseReports(
  input: ShelfWarehouseReport,
  output: ShelfWarehouseReport,
): ShelfReportComparison {
  if (!input.reportId || !output.reportId) {
    throw new Error("Báo cáo so sánh chưa có mã lưu trữ.");
  }
  if (input.reportId === output.reportId) {
    throw new Error("Đầu vào và đầu ra phải là hai báo cáo khác nhau.");
  }
  if (text(input.warehouse) !== text(output.warehouse)) {
    throw new Error("Hai báo cáo phải thuộc cùng một kho.");
  }

  type MutableLine = ShelfReportComparisonLine & {
    shelfCode: string;
    shelfId: string;
    shelfName: string;
  };
  const lines = new Map<string, MutableLine>();
  const shelfMap = new Map<string, ShelfReportComparisonShelf>();
  const seedShelves = (report: ShelfWarehouseReport, side: "input" | "output") => {
    for (const source of report.shelves) {
      const current = shelfMap.get(source.shelfId) || {
        configurationChanged: false,
        difference: 0,
        entityType: shelfEntityType(source),
        floorCount: shelfFloorCount(source),
        floors: [],
        inputPresent: false,
        inputQuantity: 0,
        outputPresent: false,
        outputQuantity: 0,
        shelfCode: source.shelfCode,
        shelfId: source.shelfId,
        shelfName: source.shelfName,
      };
      const sourceEntityType = shelfEntityType(source);
      const sourceFloorCount = shelfFloorCount(source);
      const previousType = side === "output" ? (current as typeof current & { inputEntityType?: string }).inputEntityType : undefined;
      const previousFloorCount = side === "output" ? (current as typeof current & { inputFloorCount?: number }).inputFloorCount : undefined;
      if (side === "input") {
        (current as typeof current & { inputEntityType?: string }).inputEntityType = sourceEntityType;
        (current as typeof current & { inputFloorCount?: number }).inputFloorCount = sourceFloorCount;
      } else {
        current.entityType = sourceEntityType;
        current.floorCount = sourceFloorCount;
        current.configurationChanged = previousType !== undefined
          && (previousType !== sourceEntityType || previousFloorCount !== sourceFloorCount);
      }
      for (const floor of shelfPositions(source)) {
        if (!current.floors.some((item) => item.floor === floor)) {
          current.floors.push({ difference: 0, floor, inputQuantity: 0, lines: [], outputQuantity: 0 });
        }
      }
      current.floors.sort((left, right) => right.floor - left.floor);
      current[side === "input" ? "inputPresent" : "outputPresent"] = true;
      if (side === "output") {
        current.shelfCode = source.shelfCode || current.shelfCode;
        current.shelfName = source.shelfName || current.shelfName;
      }
      shelfMap.set(source.shelfId, current);
    }
  };
  seedShelves(input, "input");
  seedShelves(output, "output");
  const add = (
    report: ShelfWarehouseReport,
    field: "inputQuantity" | "outputQuantity",
  ) => {
    for (const shelf of report.shelves) {
      for (const line of shelf.lines) {
        const sku = text(line.sku);
        if (!sku || !Number.isSafeInteger(line.floor) || line.floor < 0 || line.floor > 20) continue;
        const key = `${shelf.shelfId}\u0000${line.floor}\u0000${sku.toLocaleUpperCase("vi")}`;
        const current = lines.get(key) || {
          difference: 0,
          floor: line.floor,
          inputQuantity: 0,
          name: text(line.name) || "Chưa có tên SKU",
          outputQuantity: 0,
          quantity: 0,
          shelfCode: shelf.shelfCode,
          shelfId: shelf.shelfId,
          shelfName: shelf.shelfName,
          sku,
        };
        current[field] += quantity(line.quantity);
        current.quantity = current[field];
        current.name = text(line.name) || current.name;
        current.shelfCode = shelf.shelfCode || current.shelfCode;
        current.shelfName = shelf.shelfName || current.shelfName;
        lines.set(key, current);
      }
    }
  };
  add(input, "inputQuantity");
  add(output, "outputQuantity");

  for (const line of lines.values()) {
    line.difference = line.outputQuantity - line.inputQuantity;
    line.quantity = line.outputQuantity;
    const shelf = shelfMap.get(line.shelfId)!;
    let floor = shelf.floors.find((item) => item.floor === line.floor);
    if (!floor) {
      floor = { difference: 0, floor: line.floor, inputQuantity: 0, lines: [], outputQuantity: 0 };
      shelf.floors.push(floor);
      shelf.floors.sort((left, right) => right.floor - left.floor);
    }
    floor.lines.push({
      difference: line.difference,
      floor: line.floor,
      inputQuantity: line.inputQuantity,
      name: line.name,
      outputQuantity: line.outputQuantity,
      quantity: line.outputQuantity,
      sku: line.sku,
    });
  }

  const shelves = [...shelfMap.values()]
    .map((shelf) => {
      for (const floor of shelf.floors) {
        floor.lines.sort((left, right) => left.sku.localeCompare(right.sku, "vi", { numeric: true }));
        floor.inputQuantity = floor.lines.reduce((sum, line) => sum + line.inputQuantity, 0);
        floor.outputQuantity = floor.lines.reduce((sum, line) => sum + line.outputQuantity, 0);
        floor.difference = floor.outputQuantity - floor.inputQuantity;
      }
      shelf.inputQuantity = shelf.floors.reduce((sum, floor) => sum + floor.inputQuantity, 0);
      shelf.outputQuantity = shelf.floors.reduce((sum, floor) => sum + floor.outputQuantity, 0);
      shelf.difference = shelf.outputQuantity - shelf.inputQuantity;
      return shelf;
    })
    .sort((left, right) => left.shelfCode.localeCompare(right.shelfCode, "vi", { numeric: true, sensitivity: "base" }));
  const inputQuantity = shelves.reduce((sum, shelf) => sum + shelf.inputQuantity, 0);
  const outputQuantity = shelves.reduce((sum, shelf) => sum + shelf.outputQuantity, 0);
  return {
    inputReport: reportSummary(input),
    outputReport: reportSummary(output),
    shelves,
    summary: {
      changedLineCount: shelves.flatMap((shelf) => shelf.floors.flatMap((floor) => floor.lines)).filter((line) => line.difference !== 0).length,
      changedShelfCount: shelves.filter((shelf) => shelf.inputPresent !== shelf.outputPresent || shelf.configurationChanged || shelf.floors.some((floor) => floor.lines.some((line) => line.difference !== 0))).length,
      differenceQuantity: outputQuantity - inputQuantity,
      inputQuantity,
      inputShelfCount: input.shelves.length,
      outputQuantity,
      outputShelfCount: output.shelves.length,
      shelfCount: shelves.length,
    },
    warehouse: input.warehouse,
  };
}
