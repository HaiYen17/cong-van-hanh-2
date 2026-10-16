"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { ModuleHeaderContent } from "@/lib/config/module-header-shared";

type LegacyParityFrameProps = {
  headerIcon?: ReactNode;
  moduleHeader?: ModuleHeaderContent;
  src: string;
  title: string;
  version?: string;
};

const MODULE_HEADER_STYLE = `
  .service-modal-header.v3-module-header {
    position: relative !important;
    display: grid !important;
    grid-template-columns: auto minmax(0, 1fr) auto !important;
    gap: 15px !important;
    align-items: center !important;
    min-height: 94px !important;
    padding: 18px 20px !important;
    overflow: hidden !important;
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border, #e1dccd)) !important;
    background: linear-gradient(115deg, color-mix(in srgb, var(--accent-soft) 54%, #fff), #fff 62%) !important;
    color: var(--text, #18342f) !important;
    box-shadow: var(--ui-surface-shadow, 0 12px 30px rgba(17,45,39,.08)) !important;
  }
  .service-modal-header.v3-module-header::after {
    content: "";
    position: absolute;
    width: 170px;
    height: 170px;
    right: -88px;
    top: -108px;
    border: 27px solid color-mix(in srgb, var(--accent) 8%, transparent);
    border-radius: 999px;
    pointer-events: none;
  }
  .v3-module-header-icon {
    position: relative;
    z-index: 1;
    display: grid;
    width: 54px;
    height: 54px;
    place-items: center;
    border-radius: 14px;
    color: var(--brand-button-color, #fff);
    background: var(--brand-button-background, var(--accent));
    box-shadow: var(--ui-button-shadow, 0 10px 24px rgba(212,25,106,.2));
  }
  .v3-module-header-icon svg {
    width: 27px;
    height: 27px;
    stroke-width: 2.1;
  }
  .service-modal-header.v3-module-header .service-modal-copy {
    position: relative;
    z-index: 1;
    min-width: 0;
  }
  .service-modal-header.v3-module-header .service-modal-kicker {
    margin: 0 !important;
    color: var(--accent-strong) !important;
    font-size: .72rem !important;
    font-weight: 900 !important;
    letter-spacing: .075em !important;
    line-height: 1.35 !important;
    text-transform: uppercase !important;
  }
  .service-modal-header.v3-module-header .service-modal-kicker::before {
    content: "✣";
    margin-right: 6px;
  }
  .service-modal-header.v3-module-header .service-modal-title {
    margin: 4px 0 0 !important;
    color: var(--text, #18342f) !important;
    font-family: Montserrat, var(--font-montserrat), sans-serif !important;
    font-size: clamp(1.55rem, 3vw, 2.05rem) !important;
    font-weight: 900 !important;
    letter-spacing: -.035em !important;
    line-height: 1.1 !important;
    overflow-wrap: anywhere;
  }
  .service-modal-header.v3-module-header .service-modal-subtitle {
    display: none !important;
  }
  .service-modal-header.v3-module-header .service-modal-close {
    position: relative;
    z-index: 2;
  }
  @media (max-width: 560px) {
    .service-modal-header.v3-module-header {
      gap: 11px !important;
      min-height: 78px !important;
      padding: 13px !important;
    }
    .v3-module-header-icon {
      width: 44px;
      height: 44px;
    }
    .v3-module-header-icon svg {
      width: 22px;
      height: 22px;
    }
    .service-modal-header.v3-module-header .service-modal-kicker {
      font-size: .62rem !important;
    }
    .service-modal-header.v3-module-header .service-modal-title {
      font-size: 1.35rem !important;
    }
  }
`;

export function LegacyParityFrame({
  headerIcon,
  moduleHeader,
  src,
  title,
  version,
}: LegacyParityFrameProps) {
  const [loading, setLoading] = useState(true);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);

  const syncBrandTheme = useCallback(() => {
    const frameRoot = frameRef.current?.contentDocument?.documentElement;
    if (!frameRoot) return;
    const themeRoot =
      document.querySelector<HTMLElement>(".app-shell") ??
      document.documentElement;
    const styles = window.getComputedStyle(themeRoot);
    [
      "--accent",
      "--accent-soft",
      "--accent-strong",
      "--background",
      "--border",
      "--brand",
      "--brand-button-background",
      "--brand-button-border",
      "--brand-button-color",
      "--brand-light",
      "--brand-shadow",
      "--brand-shadow-medium",
      "--brand-shadow-soft",
      "--brand-soft",
      "--brand-strong",
      "--foreground",
      "--text",
      "--ui-button-shadow",
      "--ui-card-radius",
      "--ui-surface-shadow",
    ].forEach((name) => {
      const value = styles.getPropertyValue(name).trim();
      if (value) frameRoot.style.setProperty(name, value);
    });

    if (moduleHeader) {
      const frameDocument = frameRoot.ownerDocument;
      let style = frameDocument.getElementById("v3-module-header-style");
      if (!style) {
        style = frameDocument.createElement("style");
        style.id = "v3-module-header-style";
        style.textContent = MODULE_HEADER_STYLE;
        frameDocument.head.appendChild(style);
      }
      const expectedTitle = title.trim().toLocaleLowerCase("vi");
      const headers = Array.from(
        frameDocument.querySelectorAll<HTMLElement>(".service-modal-header"),
      );
      const header =
        headers.find((candidate) => {
          const candidateTitle = candidate
            .querySelector<HTMLElement>(".service-modal-title")
            ?.textContent?.trim()
            .toLocaleLowerCase("vi");
          return candidateTitle === expectedTitle;
        }) ||
        headers.find((candidate) => {
          const root = candidate.closest<HTMLElement>(".service-modal-root");
          return root?.classList.contains("is-open") || root?.getAttribute("aria-hidden") === "false";
        });
      if (header) {
        header.classList.add("v3-module-header");
        const kicker = header.querySelector<HTMLElement>(".service-modal-kicker");
        const heading = header.querySelector<HTMLElement>(".service-modal-title");
        if (kicker) kicker.textContent = moduleHeader.eyebrow;
        if (heading) heading.textContent = moduleHeader.title;
        header
          .querySelectorAll<HTMLElement>(".service-modal-subtitle")
          .forEach((item) => item.remove());
        if (!header.querySelector(".v3-module-header-icon") && iconRef.current) {
          const icon = frameDocument.createElement("div");
          icon.className = "v3-module-header-icon";
          icon.setAttribute("aria-hidden", "true");
          icon.innerHTML = iconRef.current.innerHTML;
          header.prepend(icon);
        }
      }
    }
  }, [moduleHeader, title]);

  useEffect(() => {
    const readyCheck = window.setInterval(() => {
      try {
        if (frameRef.current?.contentDocument?.readyState === "complete") {
          syncBrandTheme();
          setLoading(false);
        }
      } catch {
        // onLoad và timeout bên dưới vẫn bảo đảm màn hình không bị kẹt.
      }
    }, 250);
    const fallback = window.setTimeout(() => setLoading(false), 12_000);
    return () => {
      window.clearInterval(readyCheck);
      window.clearTimeout(fallback);
    };
  }, [syncBrandTheme]);

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-[#f2f1ec]">
      <div className="hidden" ref={iconRef}>
        {headerIcon}
      </div>
      {loading ? (
        <div
          aria-live="polite"
          className="absolute inset-0 z-10 grid place-items-center bg-[#f2f1ec]"
          role="status"
        >
          <div className="flex items-center gap-3 rounded-lg border border-[#114c41]/10 bg-white px-5 py-4 text-sm font-extrabold text-[#114c41] shadow-[0_18px_36px_rgba(14,30,26,0.12)]">
            <span
              aria-hidden="true"
              className="size-5 animate-spin rounded-full border-2 border-[#114c41]/20 border-t-brand"
            />
            Đang mở {title}...
          </div>
        </div>
      ) : null}

      <iframe
        className="block h-full w-full border-0 bg-[#f2f1ec]"
        onLoad={() => {
          syncBrandTheme();
          setLoading(false);
        }}
        ref={frameRef}
        src={version ? `${src}${src.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}` : src}
        title={title}
      />
    </div>
  );
}
