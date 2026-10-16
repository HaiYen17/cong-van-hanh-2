import { getCurrentSession } from "@/lib/auth/session";
import {
  importTemplateSource,
  TemplateRuntimeError,
} from "@/lib/templates/runtime";
import type { TemplateImportMode } from "@/lib/templates/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return Response.json(
        { message: "Phiên đăng nhập đã hết hạn.", ok: false },
        { status: 401 },
      );
    }
    const form = await request.formData();
    const importMode =
      String(form.get("importMode") || "") === "file" ? "file" : "link";
    const file = form.get("file");
    const result = await importTemplateSource(session, {
      file: file instanceof File ? file : undefined,
      importMode: importMode as TemplateImportMode,
      sourceLink: String(form.get("sourceLink") || ""),
      templateName: String(form.get("templateName") || ""),
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    if (error instanceof TemplateRuntimeError) {
      return Response.json(
        { message: error.message, ok: false },
        { status: error.status },
      );
    }
    console.error("Template import failed", error);
    return Response.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Không thể nạp và quét biểu mẫu.",
        ok: false,
      },
      { status: 500 },
    );
  }
}
