import { LegacyParityFrame } from "@/components/legacy-parity-frame";
import { getModuleHeader } from "@/lib/config/module-header";
import { ModuleIcon } from "@/lib/module-icons";

type LegacyModuleFrameProps = {
  moduleKey: string;
  src: string;
  title: string;
  version?: string;
};

export async function LegacyModuleFrame({
  moduleKey,
  src,
  title,
  version,
}: LegacyModuleFrameProps) {
  const moduleHeader = await getModuleHeader(moduleKey);
  return (
    <LegacyParityFrame
      headerIcon={moduleHeader ? <ModuleIcon name={moduleHeader.icon} /> : null}
      moduleHeader={
        moduleHeader
          ? { eyebrow: moduleHeader.eyebrow, title: moduleHeader.title }
          : undefined
      }
      src={src}
      title={title}
      version={version}
    />
  );
}
