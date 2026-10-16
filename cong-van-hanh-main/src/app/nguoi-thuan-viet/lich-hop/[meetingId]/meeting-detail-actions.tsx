"use client";

import { Ban, RefreshCw, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, Input } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

import {
  cancelMeetingAction,
  retryMeetingIntegrationsAction,
} from "../actions";

export function MeetingDetailActions({
  canCancel,
  canRetry,
  googleMeetUrl,
  meetingId,
}: {
  canCancel: boolean;
  canRetry: boolean;
  googleMeetUrl: string;
  meetingId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  function cancelMeeting() {
    startTransition(async () => {
      const result = await cancelMeetingAction({ meetingId, reason });
      toast({
        title: result.error ? "Chưa thể hủy lịch" : "Đã hủy cuộc họp",
        message: result.error || result.success,
        tone: result.error ? "error" : "success",
      });
      if (!result.error) {
        setConfirming(false);
        router.refresh();
      }
    });
  }

  function retryIntegrations() {
    startTransition(async () => {
      const result = await retryMeetingIntegrationsAction(meetingId);
      toast({
        title: result.error ? "Tích hợp chưa sẵn sàng" : "Đã đồng bộ tích hợp",
        message: result.error || result.success,
        tone: result.error ? "error" : "success",
      });
      router.refresh();
    });
  }

  return (
    <>
      <WriteLoadingOverlay message="Đang hủy lịch và giải phóng phòng..." show={pending} />
      <div className="flex flex-wrap gap-2">
        {googleMeetUrl ? (
          <a className="ui-button ui-button--primary" href={googleMeetUrl} rel="noreferrer" target="_blank">
            <Video className="size-4" /> Vào Google Meet
          </a>
        ) : null}
        {canRetry ? (
          <Button onClick={retryIntegrations} variant="secondary">
            <RefreshCw className="size-4" /> Thử lại tích hợp
          </Button>
        ) : null}
        {canCancel ? (
          <Button onClick={() => setConfirming(true)} variant="danger">
            <Ban className="size-4" /> Hủy lịch
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div className="fixed inset-0 z-[170] grid place-items-center bg-[rgba(7,24,21,0.52)] px-4 backdrop-blur-sm">
          <section className="w-full max-w-lg rounded-3xl border border-border bg-surface p-6 shadow-[0_30px_90px_rgba(7,24,21,0.35)]">
            <h2 className="text-xl font-extrabold text-primary">Hủy cuộc họp này?</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Phòng sẽ được giải phóng ngay. Khi Calendar đã đồng bộ, hệ thống cũng sẽ gửi cập nhật hủy đến người tham gia.
            </p>
            <label className="ui-module-field mt-4">
              <span className="ui-module-label">Lý do hủy</span>
              <Input onChange={(event) => setReason(event.target.value)} placeholder="Nhập lý do để mọi người dễ theo dõi" value={reason} />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setConfirming(false)} variant="secondary">Giữ lịch</Button>
              <Button onClick={cancelMeeting} variant="danger">Xác nhận hủy</Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
