import { getCurrentSession } from "@/lib/auth/session";
import {
  storeSupportToolUpload,
  SupportToolRuntimeError,
} from "@/lib/support-tools/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return Response.json(
        { message: "Phiên đăng nhập đã hết hạn." },
        { status: 401 },
      );
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new SupportToolRuntimeError("Chưa có file để tải lên.");
    }
    const result = await storeSupportToolUpload(session, {
      file,
      fileName: String(form.get("fileName") || ""),
      folderId: String(form.get("folderId") || ""),
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof SupportToolRuntimeError) {
      return Response.json(
        { message: error.message },
        { status: error.status },
      );
    }
    console.error("Support tool upload failed", error);
    return Response.json(
      { message: "Không tải được file vào GCS." },
      { status: 500 },
    );
  }
}
