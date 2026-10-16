import "server-only";

import {
  MODULE_HEADER_SETTING_PREFIX,
  moduleHeaderSettingKey,
  type ModuleHeaderContent,
  type ModuleHeaderUi,
} from "@/lib/config/module-header-shared";
import { getDb } from "@/lib/db";
import { PORTAL_MODULE_INVENTORY } from "@/lib/legacy-portal-catalog";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function defaultEyebrow(item: (typeof PORTAL_MODULE_INVENTORY)[number]) {
  const values = [item.collectionTitle, item.groupTitle]
    .map(normalizeText)
    .filter(Boolean);
  return [...new Set(values)].join(" · ");
}

function parseStoredContent(
  value: string | null | undefined,
  fallback: ModuleHeaderContent,
) {
  if (!value) return { ...fallback, customized: false };
  try {
    const parsed = JSON.parse(value) as Partial<ModuleHeaderContent>;
    return {
      customized: true,
      eyebrow: normalizeText(parsed.eyebrow) || fallback.eyebrow,
      title: normalizeText(parsed.title) || fallback.title,
    };
  } catch {
    return { ...fallback, customized: false };
  }
}

export async function getModuleHeaders(): Promise<ModuleHeaderUi[]> {
  const rows = await getDb().systemSetting.findMany({
    select: { key: true, value: true },
    where: { key: { startsWith: MODULE_HEADER_SETTING_PREFIX } },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));

  return PORTAL_MODULE_INVENTORY.map((item) => {
    const defaults = {
      eyebrow: defaultEyebrow(item),
      title: item.label,
    };
    const content = parseStoredContent(
      values.get(moduleHeaderSettingKey(item.key)),
      defaults,
    );
    return {
      ...content,
      defaultEyebrow: defaults.eyebrow,
      defaultTitle: defaults.title,
      href: item.href || "",
      icon: item.icon,
      key: item.key,
    };
  });
}

export async function getModuleHeader(moduleKey: string) {
  return (await getModuleHeaders()).find((item) => item.key === moduleKey) ?? null;
}
