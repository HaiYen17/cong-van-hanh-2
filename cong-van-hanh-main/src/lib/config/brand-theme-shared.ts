import type { CSSProperties } from "react";

export const BRAND_THEME_SETTING_KEYS = {
  brand: "brand.theme.primary",
  brandLight: "brand.theme.light",
  brandSoft: "brand.theme.soft",
  brandStrong: "brand.theme.strong",
  borderColor: "brand.theme.borderColor",
  buttonHoverMode: "brand.button.hoverMode",
  buttonRadius: "brand.button.radius",
  buttonSize: "brand.button.size",
  buttonStyle: "brand.button.style",
  buttonTextColor: "brand.button.textColor",
  cardRadius: "brand.card.radius",
  controlRadius: "brand.control.radius",
  gradientMode: "brand.header.gradientMode",
  headerSubtitle: "brand.header.subtitle",
  headerSubtitleColor: "brand.header.subtitleColor",
  headerTitle: "brand.header.title",
  headerTitleColor: "brand.header.titleColor",
  mutedTextColor: "brand.theme.mutedTextColor",
  pageBackground: "brand.theme.pageBackground",
  shadowMode: "brand.theme.shadowMode",
  surfaceColor: "brand.theme.surfaceColor",
  textColor: "brand.theme.textColor",
} as const;

export type BrandGradientMode =
  | "horizontal"
  | "diagonal"
  | "vertical"
  | "spotlight";

export const BRAND_GRADIENT_OPTIONS: Array<{
  label: string;
  value: BrandGradientMode;
}> = [
  { label: "Ngang", value: "horizontal" },
  { label: "Chéo", value: "diagonal" },
  { label: "Dọc", value: "vertical" },
  { label: "Tỏa sáng", value: "spotlight" },
];

export type BrandButtonStyle = "gradient" | "solid" | "soft" | "outline";
export type BrandRadiusMode = "compact" | "rounded" | "soft" | "pill";
export type BrandButtonSize = "compact" | "standard" | "large";
export type BrandButtonHoverMode = "lift" | "glow" | "flat";
export type BrandShadowMode = "none" | "soft" | "strong";

export const BRAND_BUTTON_STYLE_OPTIONS: Array<{
  label: string;
  value: BrandButtonStyle;
}> = [
  { label: "Chuyển màu", value: "gradient" },
  { label: "Màu đặc", value: "solid" },
  { label: "Nền nhạt", value: "soft" },
  { label: "Viền màu", value: "outline" },
];

export const BRAND_BUTTON_RADIUS_OPTIONS: Array<{
  label: string;
  value: BrandRadiusMode;
}> = [
  { label: "Gọn · 8px", value: "compact" },
  { label: "Bo vừa · 14px", value: "rounded" },
  { label: "Bo mềm · 20px", value: "soft" },
  { label: "Viên thuốc", value: "pill" },
];

export const BRAND_SURFACE_RADIUS_OPTIONS: Array<{
  label: string;
  value: Exclude<BrandRadiusMode, "pill">;
}> = [
  { label: "Gọn · 8px", value: "compact" },
  { label: "Bo vừa · 14px", value: "rounded" },
  { label: "Bo mềm · 20px", value: "soft" },
];

export const BRAND_BUTTON_SIZE_OPTIONS: Array<{
  label: string;
  value: BrandButtonSize;
}> = [
  { label: "Gọn · 40px", value: "compact" },
  { label: "Tiêu chuẩn · 48px", value: "standard" },
  { label: "Rộng · 54px", value: "large" },
];

export const BRAND_BUTTON_HOVER_OPTIONS: Array<{
  label: string;
  value: BrandButtonHoverMode;
}> = [
  { label: "Nâng nhẹ", value: "lift" },
  { label: "Phát sáng", value: "glow" },
  { label: "Tĩnh", value: "flat" },
];

export const BRAND_SHADOW_OPTIONS: Array<{
  label: string;
  value: BrandShadowMode;
}> = [
  { label: "Không bóng", value: "none" },
  { label: "Bóng nhẹ", value: "soft" },
  { label: "Bóng nổi", value: "strong" },
];

export type BrandTheme = {
  brand: string;
  brandLight: string;
  brandSoft: string;
  brandStrong: string;
  borderColor: string;
  buttonHoverMode: BrandButtonHoverMode;
  buttonRadius: BrandRadiusMode;
  buttonSize: BrandButtonSize;
  buttonStyle: BrandButtonStyle;
  buttonTextColor: string;
  cardRadius: Exclude<BrandRadiusMode, "pill">;
  controlRadius: Exclude<BrandRadiusMode, "pill">;
  gradientMode: BrandGradientMode;
  headerSubtitle: string;
  headerSubtitleColor: string;
  headerTitle: string;
  headerTitleColor: string;
  mutedTextColor: string;
  pageBackground: string;
  shadowMode: BrandShadowMode;
  surfaceColor: string;
  textColor: string;
};

export const DEFAULT_BRAND_THEME: BrandTheme = {
  brand: "#d4196a",
  brandLight: "#e01a6f",
  brandSoft: "#fde7f1",
  brandStrong: "#bd1659",
  borderColor: "#e1dccd",
  buttonHoverMode: "lift",
  buttonRadius: "pill",
  buttonSize: "standard",
  buttonStyle: "gradient",
  buttonTextColor: "#ffffff",
  cardRadius: "compact",
  controlRadius: "compact",
  gradientMode: "horizontal",
  headerSubtitle: "Hệ thống nội bộ Thuần Việt",
  headerSubtitleColor: "#fbd6e6",
  headerTitle: "Cổng vận hành",
  headerTitleColor: "#ffffff",
  mutedTextColor: "#506661",
  pageBackground: "#f4efe4",
  shadowMode: "soft",
  surfaceColor: "#ffffff",
  textColor: "#18342f",
};

export type BrandThemeCssProperties = CSSProperties & {
  "--accent": string;
  "--accent-soft": string;
  "--accent-strong": string;
  "--background": string;
  "--border": string;
  "--brand": string;
  "--brand-button-background": string;
  "--brand-button-border": string;
  "--brand-button-color": string;
  "--brand-light": string;
  "--brand-shadow": string;
  "--brand-shadow-medium": string;
  "--brand-shadow-soft": string;
  "--brand-soft": string;
  "--brand-strong": string;
  "--brand-header-background": string;
  "--foreground": string;
  "--header-subtitle-color": string;
  "--header-title-color": string;
  "--line": string;
  "--muted": string;
  "--muted-strong": string;
  "--surface": string;
  "--surface-strong": string;
  "--text": string;
  "--ui-button-height": string;
  "--ui-button-hover-shadow": string;
  "--ui-button-hover-transform": string;
  "--ui-button-radius": string;
  "--ui-button-shadow": string;
  "--ui-card-radius": string;
  "--ui-control-line": string;
  "--ui-control-line-strong": string;
  "--ui-control-muted": string;
  "--ui-control-radius": string;
  "--ui-control-soft-surface": string;
  "--ui-control-surface": string;
  "--ui-menu-shadow": string;
  "--ui-surface-shadow": string;
};

const RADIUS_VALUES: Record<BrandRadiusMode, string> = {
  compact: "8px",
  pill: "999px",
  rounded: "14px",
  soft: "20px",
};

const BUTTON_HEIGHT_VALUES: Record<BrandButtonSize, string> = {
  compact: "40px",
  large: "54px",
  standard: "48px",
};

function brandButtonAppearance(theme: BrandTheme) {
  if (theme.buttonStyle === "solid") {
    return {
      background: theme.brand,
      border: "1px solid transparent",
      color: theme.buttonTextColor,
    };
  }
  if (theme.buttonStyle === "soft") {
    return {
      background: theme.brandSoft,
      border: `1px solid color-mix(in srgb, ${theme.brand} 24%, transparent)`,
      color: theme.brandStrong,
    };
  }
  if (theme.buttonStyle === "outline") {
    return {
      background: "transparent",
      border: `1.5px solid ${theme.brand}`,
      color: theme.brandStrong,
    };
  }
  return {
    background: `linear-gradient(135deg, ${theme.brandLight}, ${theme.brand}, ${theme.brandStrong})`,
    border: "1px solid transparent",
    color: theme.buttonTextColor,
  };
}

function brandShadowAppearance(theme: BrandTheme) {
  if (theme.shadowMode === "none") {
    return { button: "none", surface: "none" };
  }
  if (theme.shadowMode === "strong") {
    return {
      button: `0 16px 34px color-mix(in srgb, ${theme.brand} 30%, transparent)`,
      surface: "0 22px 54px rgba(17, 45, 39, 0.14)",
    };
  }
  return {
    button: `0 12px 26px color-mix(in srgb, ${theme.brand} 20%, transparent)`,
    surface: "0 18px 44px rgba(17, 45, 39, 0.08)",
  };
}

function brandButtonHoverAppearance(theme: BrandTheme, buttonShadow: string) {
  if (theme.buttonHoverMode === "flat") {
    return { shadow: buttonShadow, transform: "none" };
  }
  if (theme.buttonHoverMode === "glow") {
    return {
      shadow: `0 0 0 4px color-mix(in srgb, ${theme.brand} 13%, transparent), 0 16px 36px color-mix(in srgb, ${theme.brand} 34%, transparent)`,
      transform: "scale(1.015)",
    };
  }
  return {
    shadow: buttonShadow,
    transform: "translateY(-2px)",
  };
}

export function brandThemeCssVariables(
  theme: BrandTheme,
): BrandThemeCssProperties {
  const button = brandButtonAppearance(theme);
  const shadow = brandShadowAppearance(theme);
  const hover = brandButtonHoverAppearance(theme, shadow.button);
  return {
    "--accent": theme.brand,
    "--accent-soft": theme.brandSoft,
    "--accent-strong": theme.brandStrong,
    "--background": theme.pageBackground,
    "--border": theme.borderColor,
    "--brand": theme.brand,
    "--brand-button-background": button.background,
    "--brand-button-border": button.border,
    "--brand-button-color": button.color,
    "--brand-light": theme.brandLight,
    "--brand-shadow": `color-mix(in srgb, ${theme.brand} 26%, transparent)`,
    "--brand-shadow-medium": `color-mix(in srgb, ${theme.brand} 20%, transparent)`,
    "--brand-shadow-soft": `color-mix(in srgb, ${theme.brand} 12%, transparent)`,
    "--brand-soft": theme.brandSoft,
    "--brand-strong": theme.brandStrong,
    "--brand-header-background": brandGradientBackground(theme),
    "--foreground": theme.textColor,
    "--header-subtitle-color": theme.headerSubtitleColor,
    "--header-title-color": theme.headerTitleColor,
    "--line": theme.borderColor,
    "--muted": theme.mutedTextColor,
    "--muted-strong": theme.mutedTextColor,
    "--surface": theme.surfaceColor,
    "--surface-strong": theme.surfaceColor,
    "--text": theme.textColor,
    "--ui-button-height": BUTTON_HEIGHT_VALUES[theme.buttonSize],
    "--ui-button-hover-shadow": hover.shadow,
    "--ui-button-hover-transform": hover.transform,
    "--ui-button-radius": RADIUS_VALUES[theme.buttonRadius],
    "--ui-button-shadow": shadow.button,
    "--ui-card-radius": RADIUS_VALUES[theme.cardRadius],
    "--ui-control-line": theme.borderColor,
    "--ui-control-line-strong": `color-mix(in srgb, ${theme.brand} 26%, ${theme.borderColor})`,
    "--ui-control-muted": theme.mutedTextColor,
    "--ui-control-radius": RADIUS_VALUES[theme.controlRadius],
    "--ui-control-soft-surface": `color-mix(in srgb, ${theme.brandSoft} 36%, ${theme.surfaceColor})`,
    "--ui-control-surface": theme.surfaceColor,
    "--ui-menu-shadow": shadow.surface,
    "--ui-surface-shadow": shadow.surface,
  };
}

export function brandGradientBackground(theme: BrandTheme) {
  if (theme.gradientMode === "vertical") {
    return `linear-gradient(180deg, ${theme.brandLight}, ${theme.brand}, ${theme.brandStrong})`;
  }
  if (theme.gradientMode === "diagonal") {
    return `linear-gradient(135deg, ${theme.brandLight}, ${theme.brand}, ${theme.brandStrong})`;
  }
  if (theme.gradientMode === "spotlight") {
    return `radial-gradient(circle at 42% -35%, ${theme.brandLight} 0%, ${theme.brand} 48%, ${theme.brandStrong} 100%)`;
  }
  return `linear-gradient(90deg, ${theme.brandLight}, ${theme.brand}, ${theme.brandStrong})`;
}

export function applyBrandThemeToDocument(theme: BrandTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(brandThemeCssVariables(theme))) {
    root.style.setProperty(key, value);
  }
}
