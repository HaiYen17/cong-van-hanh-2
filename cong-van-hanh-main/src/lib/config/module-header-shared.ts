export const MODULE_HEADER_SETTING_PREFIX = "module.header.";

export type ModuleHeaderContent = {
  eyebrow: string;
  title: string;
};

export type ModuleHeaderUi = ModuleHeaderContent & {
  customized: boolean;
  defaultEyebrow: string;
  defaultTitle: string;
  href: string;
  icon: string;
  key: string;
};

export function moduleHeaderSettingKey(moduleKey: string) {
  return `${MODULE_HEADER_SETTING_PREFIX}${moduleKey}`;
}
