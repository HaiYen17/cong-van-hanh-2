import { Badge } from "@/components/ui";

import { MailOrderPrintButton } from "./mail-order-controls";

type MailOrderRow = {
  createdAt: Date;
  createdByName: string | null;
  fee: number | null;
  id: string;
  productType: string;
  receiverName: string;
  receiverPhone: string;
  senderName: string;
  serviceName: string | null;
  status: string;
  trackingCode: string | null;
  vtpStatus: string | null;
};

function fmt(d: Date) {
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}
function money(n: number | null) {
  return n ? new Intl.NumberFormat("vi-VN").format(n) + "đ" : "—";
}

export function MailOrderList({ orders }: { orders: MailOrderRow[] }) {
  if (orders.length === 0) {
    return <p className="text-sm text-muted">Chưa có vận đơn nào.</p>;
  }
  return (
    <div className="space-y-3">
      {orders.map((o) => (
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-[0_8px_20px_rgba(17,45,39,0.05)]" key={o.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold text-accent">{o.trackingCode ?? "—"}</span>
              <Badge tone={o.productType === "HH" ? "warning" : "info"}>{o.productType === "HH" ? "Hàng hóa" : "Thư"}</Badge>
              <Badge tone="neutral">{o.vtpStatus ?? o.status}</Badge>
            </div>
            <span className="text-xs text-muted">{fmt(o.createdAt)}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Người gửi</div>
              <div className="font-semibold text-foreground">{o.senderName}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Người nhận</div>
              <div className="font-semibold text-foreground">{o.receiverName}</div>
              <div className="text-xs text-muted">{o.receiverPhone}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Dịch vụ</div>
              <div className="font-semibold text-foreground">{o.serviceName ?? "—"}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Cước</div>
              <div className="font-semibold text-foreground">{money(o.fee)}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
            {o.createdByName ? (
              <div className="text-xs text-muted">Tạo bởi {o.createdByName}</div>
            ) : (
              <span />
            )}
            {o.trackingCode ? <MailOrderPrintButton orderId={o.id} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
