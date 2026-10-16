import { Sparkles } from "lucide-react";

import type { ModuleHeaderContent } from "@/lib/config/module-header-shared";
import { ModuleIcon } from "@/lib/module-icons";

import styles from "./module-page-header.module.css";

export function ModulePageHeader({
  eyebrow,
  icon,
  title,
}: ModuleHeaderContent & { icon: string }) {
  return (
    <section className={styles.header} data-module-page-header>
      <div className={styles.icon} aria-hidden="true">
        <ModuleIcon name={icon} />
      </div>
      <div className={styles.copy}>
        <div className={styles.eyebrow}>
          <Sparkles size={13} strokeWidth={2.25} />
          {eyebrow}
        </div>
        <h1 className={styles.title}>{title}</h1>
      </div>
    </section>
  );
}
