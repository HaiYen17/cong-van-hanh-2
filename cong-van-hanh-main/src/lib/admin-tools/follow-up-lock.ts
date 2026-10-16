export function blockedModuleKeys(value: unknown) {
  if (value === true) return ["*"];
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

export function followUpBlocksAnyModule(value: unknown) {
  return blockedModuleKeys(value).length > 0;
}
