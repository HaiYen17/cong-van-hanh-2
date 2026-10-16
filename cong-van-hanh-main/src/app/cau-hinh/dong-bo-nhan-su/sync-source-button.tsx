"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

import {
  syncPersonnelSourceAction,
  type SyncActionState,
} from "./actions";

const initialState: SyncActionState = {};

export function SyncSourceButton({ sourceId }: { sourceId: string }) {
  const actionWithSource = syncPersonnelSourceAction.bind(null, sourceId);
  const [state, action, pending] = useActionState(
    actionWithSource,
    initialState,
  );
  const { toast } = useToast();
  const seen = useRef<SyncActionState | null>(null);

  useEffect(() => {
    if (state === seen.current || !state.message) return;
    seen.current = state;
    toast({
      message: state.message,
      title: state.tone === "error" ? "Không thể đồng bộ" : "Đồng bộ nhân sự",
      tone: state.tone ?? "info",
    });
  }, [state, toast]);

  return (
    <form action={action}>
      <WriteLoadingOverlay
        message="Hệ thống đang đọc và đối chiếu dữ liệu nhân sự..."
        show={pending}
      />
      <Button disabled={pending} size="sm" type="submit">
        {pending ? "Đang đồng bộ..." : "Đồng bộ ngay"}
      </Button>
    </form>
  );
}
