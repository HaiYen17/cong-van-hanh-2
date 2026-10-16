import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import { WORKBENCH_SOURCE_DEFINITIONS, loadWorkbenchRegistry } from "./registry";
import {
  WORKBENCH_COLUMNS,
  WORKBENCH_ROWS,
  WORKBENCH_SOURCE_KEYS,
  type SaveWorkbenchAdminConfigInput,
  type WorkbenchAdminSnapshot,
  type WorkbenchWidgetCatalogItem,
  type WorkbenchWidgetConfigView,
} from "./types";

const VALID_TONES = new Set(["teal", "amber", "coral", "blue", "violet", "slate"]);

function integer(value: unknown, label: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} phải nằm trong khoảng ${min}–${max}.`);
  }
  return parsed;
}

function overlaps(a: WorkbenchWidgetConfigView, b: WorkbenchWidgetConfigView) {
  return !(
    a.defaultX + a.defaultWidth <= b.defaultX ||
    b.defaultX + b.defaultWidth <= a.defaultX ||
    a.defaultY + a.defaultHeight <= b.defaultY ||
    b.defaultY + b.defaultHeight <= a.defaultY
  );
}

function configKey(widget: WorkbenchWidgetCatalogItem) {
  return widget.catalogKey || widget.key;
}

function validateAdminInput(
  input: SaveWorkbenchAdminConfigInput,
  definitions: WorkbenchWidgetConfigView[],
) {
  if (!input || !Array.isArray(input.widgets) || !Array.isArray(input.sources)) {
    throw new Error("Cấu hình Bàn làm việc gửi lên không hợp lệ.");
  }
  const definitionMap = new Map(
    definitions.map((definition) => [configKey(definition), definition]),
  );
  const widgetKeys = new Set(definitionMap.keys());
  const sourceKeys = new Set(WORKBENCH_SOURCE_KEYS);
  if (
    input.widgets.length !== definitions.length ||
    new Set(input.widgets.map(configKey)).size !== definitions.length ||
    input.widgets.some((widget) => !widgetKeys.has(configKey(widget)))
  ) {
    throw new Error("Danh sách widget không đầy đủ hoặc có widget chưa được đăng ký.");
  }
  if (
    input.sources.length !== WORKBENCH_SOURCE_KEYS.length ||
    new Set(input.sources.map((source) => source.key)).size !==
      WORKBENCH_SOURCE_KEYS.length ||
    input.sources.some((source) => !sourceKeys.has(source.key))
  ) {
    throw new Error("Danh sách nguồn sự kiện không hợp lệ.");
  }

  const widgets = input.widgets.map((widget) => {
    const definition = definitionMap.get(configKey(widget));
    if (!definition) {
      throw new Error(`Widget ${widget.label} chưa được đăng ký.`);
    }
    const minWidth = integer(widget.minWidth, `${widget.label}: rộng tối thiểu`, 1, 16);
    const minHeight = integer(widget.minHeight, `${widget.label}: cao tối thiểu`, 1, 10);
    const maxWidth = integer(widget.maxWidth, `${widget.label}: rộng tối đa`, minWidth, 16);
    const maxHeight = integer(widget.maxHeight, `${widget.label}: cao tối đa`, minHeight, 10);
    const defaultWidth = integer(
      widget.defaultWidth,
      `${widget.label}: rộng mặc định`,
      minWidth,
      maxWidth,
    );
    const defaultHeight = integer(
      widget.defaultHeight,
      `${widget.label}: cao mặc định`,
      minHeight,
      maxHeight,
    );
    const defaultX = integer(
      widget.defaultX,
      `${widget.label}: cột mặc định`,
      0,
      WORKBENCH_COLUMNS - defaultWidth,
    );
    const defaultY = integer(
      widget.defaultY,
      `${widget.label}: hàng mặc định`,
      0,
      WORKBENCH_ROWS - defaultHeight,
    );
    if (!VALID_TONES.has(widget.defaultColor)) {
      throw new Error(`Màu mặc định của ${widget.label} không hợp lệ.`);
    }
    return {
      ...widget,
      allowMultiple:
        definition.key === "requests" ? false : Boolean(widget.allowMultiple),
      catalogKey: definition.catalogKey,
      description: definition.description,
      icon: definition.icon,
      key: definition.key,
      label: definition.label,
      defaultHeight,
      defaultWidth,
      defaultX,
      defaultY,
      maxHeight,
      maxWidth,
      minHeight,
      minWidth,
      sortOrder: integer(widget.sortOrder, `${widget.label}: thứ tự`, 0, 9999),
    };
  });
  const visible = widgets.filter((widget) => widget.isEnabled && widget.defaultVisible);
  for (let index = 0; index < visible.length; index += 1) {
    const collision = visible.slice(index + 1).find((item) => overlaps(visible[index], item));
    if (collision) {
      throw new Error(
        `Bố cục mặc định đang chồng nhau giữa ${visible[index].label} và ${collision.label}.`,
      );
    }
  }
  return { sources: input.sources, widgets };
}

export async function getWorkbenchAdminSnapshot(): Promise<WorkbenchAdminSnapshot> {
  const db = getDb();
  const [registry, savedLayouts, indexedItems, indexedOwners] = await Promise.all([
    loadWorkbenchRegistry(),
    db.workbenchLayout.count(),
    db.workbenchItem.count({ where: { isActive: true } }),
    db.workbenchItem.findMany({
      distinct: ["ownerUserId"],
      select: { ownerUserId: true },
      where: { isActive: true },
    }),
  ]);
  return {
    indexedItems,
    indexedUsers: indexedOwners.length,
    savedLayouts,
    sources: registry.sources,
    widgets: [
      ...registry.widgets.filter((widget) => widget.key !== "requests"),
      ...registry.requestWidgets,
    ].sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

export async function saveWorkbenchAdminConfig(
  session: AppSession,
  input: SaveWorkbenchAdminConfigInput,
) {
  const registry = await loadWorkbenchRegistry();
  const definitions = [
    ...registry.widgets.filter((widget) => widget.key !== "requests"),
    ...registry.requestWidgets,
  ];
  const validated = validateAdminInput(input, definitions);
  const db = getDb();
  await db.$transaction(async (tx) => {
    for (const widget of validated.widgets) {
      const data = {
        allowMultiple: widget.allowMultiple,
        defaultColor: widget.defaultColor,
        defaultHeight: widget.defaultHeight,
        defaultVisible: widget.defaultVisible,
        defaultWidth: widget.defaultWidth,
        defaultX: widget.defaultX,
        defaultY: widget.defaultY,
        description: widget.description,
        icon: widget.icon,
        isEnabled: widget.isEnabled,
        label: widget.label,
        maxHeight: widget.maxHeight,
        maxWidth: widget.maxWidth,
        minHeight: widget.minHeight,
        minWidth: widget.minWidth,
        sortOrder: widget.sortOrder,
        updatedById: session.userId,
      };
      await tx.workbenchWidgetConfig.upsert({
        create: { widgetKey: configKey(widget), ...data },
        update: data,
        where: { widgetKey: configKey(widget) },
      });
    }
    for (const source of validated.sources) {
      const definition = WORKBENCH_SOURCE_DEFINITIONS[source.key];
      await tx.workbenchSourceConfig.upsert({
        create: {
          description: definition.description,
          isEnabled: source.isEnabled,
          key: source.key,
          label: definition.label,
          moduleKey: definition.moduleKey,
          sortOrder: definition.sortOrder,
          updatedById: session.userId,
        },
        update: {
          isEnabled: source.isEnabled,
          ...(source.isEnabled
            ? {}
            : { itemCount: 0, lastError: null, lastStatus: "DISABLED" }),
          updatedById: session.userId,
        },
        where: { key: source.key },
      });
      if (!source.isEnabled) {
        await tx.workbenchItem.updateMany({
          data: { isActive: false },
          where: { isActive: true, sourceKey: source.key },
        });
      }
    }
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        metadata: {
          enabledSources: validated.sources.filter((item) => item.isEnabled).map((item) => item.key),
          enabledWidgets: validated.widgets
            .filter((item) => item.isEnabled)
            .map(configKey),
          visibleDefaults: validated.widgets
            .filter((item) => item.isEnabled && item.defaultVisible)
            .map(configKey),
        } as Prisma.InputJsonValue,
        summary: "Cập nhật registry và bố cục gợi ý của Bàn làm việc.",
        targetId: "global",
        targetType: "WorkbenchConfig",
      },
    });
  });
  return getWorkbenchAdminSnapshot();
}
