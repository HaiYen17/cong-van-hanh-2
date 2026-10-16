import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import type { AppSession } from "@/lib/auth/session";
import { brandThemeCssVariables } from "@/lib/config/brand-theme-shared";
import { getBrandTheme } from "@/lib/config/global-config";
import { getModuleHeader } from "@/lib/config/module-header";
import { getGreeting } from "@/lib/greeting";

import { ModulePageHeader } from "../module-page-header";
import { HeaderActions } from "./header-actions";

type AppShellProps = {
  activePath?: string;
  children: ReactNode;
  moduleKey?: string;
  session?: AppSession;
};

export async function AppShell({ children, moduleKey, session }: AppShellProps) {
  const greeting = session ? getGreeting() : "";
  const [brandTheme, moduleHeader] = await Promise.all([
    getBrandTheme(),
    moduleKey ? getModuleHeader(moduleKey) : null,
  ]);

  return (
    <div
      className="app-shell min-h-screen text-foreground"
      style={brandThemeCssVariables(brandTheme)}
    >
      <header
        className="sticky top-0 z-30 text-[var(--header-title-color)] shadow-[0_10px_30px_var(--brand-shadow)]"
        style={{ background: "var(--brand-header-background)" }}
      >
        <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <Link className="flex items-center gap-3" href="/">
            <Image
              alt="Thuần Việt"
              className="rounded-xl bg-white p-1 shadow-[0_8px_20px_rgba(0,0,0,0.18)]"
              height={42}
              priority
              src="/logo.png"
              width={42}
            />
            <div>
              <div className="text-lg font-extrabold tracking-tight text-[var(--header-title-color)]">
                {brandTheme.headerTitle}
              </div>
              <div className="text-xs text-[var(--header-subtitle-color)]">
                {brandTheme.headerSubtitle}
              </div>
            </div>
          </Link>
          {session ? (
            <HeaderActions
              displayName={session.displayName}
              greeting={greeting}
              roles={session.roles}
            />
          ) : null}
        </div>
      </header>
      <main className="app-module-root mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {moduleHeader ? (
          <ModulePageHeader
            eyebrow={moduleHeader.eyebrow}
            icon={moduleHeader.icon}
            title={moduleHeader.title}
          />
        ) : null}
        {children}
      </main>
    </div>
  );
}
