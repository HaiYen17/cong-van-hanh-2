"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

import {
  mailGetPrintLink,
  refreshMyMailStatuses,
} from "./actions";

export function MailStatusRefreshButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    toast({
      message: "Đang hỏi Viettel Post trạng thái các vận đơn gần đây.",
      title: "Đang cập nhật trạng thái",
      tone: "info",
      duration: 2500,
    });
    const result = await refreshMyMailStatuses();
    setLoading(false);
    if (result.message) {
      toast({
        message: result.message,
        title: "Chưa có dữ liệu",
        tone: "info",
      });
      return;
    }
    toast({
      message: `Đã kiểm tra ${result.checked} đơn, thay đổi ${result.changed}${
        result.errors ? `, lỗi ${result.errors}` : ""
      }.`,
      title: "Đã cập nhật trạng thái",
      tone: result.errors ? "warning" : "success",
    });
    router.refresh();
  }

  return (
    <Button
      disabled={loading}
      onClick={refresh}
      size="sm"
      type="button"
      variant="secondary"
    >
      {loading ? "Đang cập nhật..." : "Cập nhật trạng thái"}
    </Button>
  );
}

export function MailOrderPrintButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function print() {
    // Mở tab ngay trong thao tác click để tránh trình duyệt chặn popup sau await.
    const printWindow = window.open("", "_blank");
    setLoading(true);
    const result = await mailGetPrintLink(orderId);
    setLoading(false);
    if (!result.printUrl) {
      printWindow?.close();
      toast({
        message: result.error || "Viettel Post chưa trả link in.",
        title: "Không lấy được nhãn A5",
        tone: "error",
      });
      return;
    }
    if (printWindow) {
      printWindow.opener = null;
      printWindow.location.href = result.printUrl;
    } else {
      toast({
        message: "Trình duyệt đang chặn tab mới. Vui lòng cho phép popup rồi thử lại.",
        title: "Không mở được nhãn A5",
        tone: "warning",
      });
    }
  }

  return (
    <Button
      disabled={loading}
      onClick={print}
      size="sm"
      type="button"
      variant="ghost"
    >
      {loading ? "Đang lấy nhãn..." : "In A5"}
    </Button>
  );
}
