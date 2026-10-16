import { Badge } from "@/components/ui";
import { ConfirmButton } from "@/components/ui/confirm-button";
import type { RequestStatus } from "@/generated/prisma/enums";
import { requestStatusMeta } from "@/lib/requests/services";

import { cancelRequestAction } from "./actions";

export type MyRequestRow = {
  code: string;
  createdAt: Date;
  id: string;
  payload: unknown;
  status: RequestStatus;
  title: string;
};

function fmt(d: Date) {
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

// Danh sách đơn của tôi cho 1 dịch vụ. Dùng chung cho Đóng dấu / Cấp giấy / Trích lục.
export function ServiceRequestList({ requests }: { requests: MyRequestRow[] }) {
  if (requests.length === 0) {
    return <p className="text-sm text-muted">Bạn chưa gửi yêu cầu nào.</p>;
  }
  return (
    <div className="space-y-3">
      {requests.map((r) => {
        const payload = (r.payload ?? {}) as {
          issuedNumber?: string;
          items?: { issuedNumber?: string; typeLabel?: string }[];
        };
        const itemNumbers = Array.isArray(payload.items)
          ? payload.items.map((i) => i.issuedNumber).filter(Boolean)
          : [];
        const numberText = payload.issuedNumber || (itemNumbers.length ? itemNumbers.join(", ") : "");
        const itemCount = Array.isArray(payload.items) ? payload.items.length : 0;
        const canCancel = r.status === "SUBMITTED" || r.status === "IN_PROGRESS" || r.status === "NEEDS_INFO";
        return (
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-[0_8px_20px_rgba(17,45,39,0.05)]" key={r.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-accent">{r.code}</span>
                <Badge tone={requestStatusMeta[r.status].tone}>{requestStatusMeta[r.status].label}</Badge>
              </div>
              <span className="text-xs text-muted">{fmt(r.createdAt)}</span>
            </div>
            <div className="mt-1 font-semibold text-foreground">{r.title}</div>
            {itemCount > 1 ? <div className="text-xs text-muted">{itemCount} mục</div> : null}
            {numberText ? (
              <div className="mt-0.5 font-mono text-sm font-bold text-primary">Số: {numberText}</div>
            ) : null}
            {canCancel ? (
              <form action={cancelRequestAction.bind(null, r.id)} className="mt-2">
                <ConfirmButton confirmLabel="Hủy" message="Hủy yêu cầu này?" size="sm" title="Hủy yêu cầu">
                  Hủy
                </ConfirmButton>
              </form>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
