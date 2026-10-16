import { getCurrentSession } from "@/lib/auth/session";
import { after } from "next/server";
import {
  saveElectronicSignatureInput,
  saveElectronicSignatureOutput,
} from "@/lib/requests/electronic-signature";
import {
  uploadDigitalSignaturePdf,
  workflowForRequest,
} from "@/lib/requests/digital-signature-workflow";
import { runDigitalSignatureQueue } from "@/lib/requests/digital-signature-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function field(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return Response.json(
        { message: "Phiên đăng nhập đã hết hạn.", ok: false },
        { status: 401 },
      );
    }
    const formData = await request.formData();
    const file = formData.get("file");
    const requestId = field(formData, "requestId");
    const itemIndex = Number.parseInt(field(formData, "itemIndex"), 10) - 1;
    const kind = field(formData, "kind");
    if (!(file instanceof File) || !file.size) {
      throw new Error("Vui lòng chọn file cần nạp.");
    }
    if (!requestId || !Number.isInteger(itemIndex) || itemIndex < 0) {
      throw new Error("Thông tin hồ sơ ký điện tử không hợp lệ.");
    }
    const workflow = await workflowForRequest(requestId);
    if (workflow && kind === "output") {
      throw new Error(
        "PDF đầu ra của hồ sơ Ký số chỉ được tạo bởi hàng chờ MISA eSign.",
      );
    }
    const result = workflow
      ? await uploadDigitalSignaturePdf(session, { file, requestId })
      : kind === "output"
        ? await saveElectronicSignatureOutput(session, {
            file,
            itemIndex,
            requestId,
          })
        : await saveElectronicSignatureInput(session, {
            file,
            itemIndex,
            requestId,
          });
    if (workflow && "requestId" in result) {
      const storedRequestId = result.requestId;
      after(async () => {
        await runDigitalSignatureQueue([storedRequestId]);
      });
    }
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("Electronic signature upload failed", error);
    return Response.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Không nạp được file ký số.",
        ok: false,
      },
      { status: 400 },
    );
  }
}
