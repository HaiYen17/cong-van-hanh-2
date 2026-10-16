"use client";

import { CheckCircle2, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, Input, Select } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

import {
  approveMeetingMinutesAction,
  saveMeetingMinutesAction,
  type MinutesActionInput,
  type SaveMinutesInput,
} from "./actions";

type EditableAction = MinutesActionInput & { key: string };

function key() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function MeetingMinutesEditor({
  actionItems,
  decisions,
  employees,
  meetingId,
  openQuestions,
  risks,
  summary,
}: {
  actionItems: MinutesActionInput[];
  decisions: string[];
  employees: { id: string; label: string }[];
  meetingId: string;
  openQuestions: string[];
  risks: string[];
  summary: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [summaryValue, setSummaryValue] = useState(summary);
  const [decisionsValue, setDecisionsValue] = useState(decisions.join("\n"));
  const [risksValue, setRisksValue] = useState(risks.join("\n"));
  const [questionsValue, setQuestionsValue] = useState(openQuestions.join("\n"));
  const [actions, setActions] = useState<EditableAction[]>(
    actionItems.map((item) => ({ ...item, key: key() })),
  );

  function lines(value: string) {
    return value.split("\n").map((item) => item.trim()).filter(Boolean);
  }

  function payload(): SaveMinutesInput {
    return {
      actionItems: actions.map((item) => ({
        assigneeEmployeeId: item.assigneeEmployeeId,
        description: item.description,
        dueAt: item.dueAt,
        title: item.title,
      })),
      decisions: lines(decisionsValue),
      meetingId,
      openQuestions: lines(questionsValue),
      risks: lines(risksValue),
      summary: summaryValue,
    };
  }

  function save() {
    startTransition(async () => {
      const result = await saveMeetingMinutesAction(payload());
      toast({
        title: result.error ? "Chưa thể lưu biên bản" : "Đã lưu bản chỉnh sửa",
        message: result.error || result.success,
        tone: result.error ? "error" : "success",
      });
      if (!result.error) router.refresh();
    });
  }

  function approve() {
    startTransition(async () => {
      const saved = await saveMeetingMinutesAction(payload());
      if (saved.error) {
        toast({ title: "Chưa thể duyệt", message: saved.error, tone: "error" });
        return;
      }
      const result = await approveMeetingMinutesAction(meetingId);
      toast({
        title: result.error ? "Chưa thể duyệt" : "Đã duyệt và giao việc",
        message: result.error || result.success,
        tone: result.error ? "error" : "success",
      });
      if (!result.error) router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <WriteLoadingOverlay message="Đang lưu biên bản và đồng bộ đầu việc..." show={pending} />
      <label className="ui-module-field">
        <span className="ui-module-label">Tóm tắt điều hành</span>
        <textarea
          className="ui-module-textarea min-h-36"
          onChange={(event) => setSummaryValue(event.target.value)}
          value={summaryValue}
        />
      </label>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="ui-module-field">
          <span className="ui-module-label">Quyết định đã chốt · mỗi dòng một ý</span>
          <textarea className="ui-module-textarea min-h-28" onChange={(event) => setDecisionsValue(event.target.value)} value={decisionsValue} />
        </label>
        <label className="ui-module-field">
          <span className="ui-module-label">Rủi ro / phụ thuộc · mỗi dòng một ý</span>
          <textarea className="ui-module-textarea min-h-28" onChange={(event) => setRisksValue(event.target.value)} value={risksValue} />
        </label>
        <label className="ui-module-field">
          <span className="ui-module-label">Vấn đề còn mở · mỗi dòng một ý</span>
          <textarea className="ui-module-textarea min-h-28" onChange={(event) => setQuestionsValue(event.target.value)} value={questionsValue} />
        </label>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="ui-module-label">Đầu việc đề xuất</div>
            <p className="mt-1 text-xs text-muted">Chỉ khi duyệt, các dòng này mới được gửi sang Module Giao việc.</p>
          </div>
          <Button
            onClick={() => setActions((current) => [...current, { key: key(), title: "" }])}
            size="sm"
            variant="secondary"
          >
            <Plus className="size-4" /> Thêm đầu việc
          </Button>
        </div>
        <div className="space-y-3">
          {actions.map((action, index) => (
            <article className="grid gap-3 rounded-2xl border border-border bg-surface-muted/40 p-4 md:grid-cols-2" key={action.key}>
              <label className="ui-module-field md:col-span-2">
                <span className="ui-module-label">Đầu việc {index + 1}</span>
                <Input
                  onChange={(event) => setActions((current) => current.map((item) => item.key === action.key ? { ...item, title: event.target.value } : item))}
                  value={action.title}
                />
              </label>
              <label className="ui-module-field md:col-span-2">
                <span className="ui-module-label">Mô tả kết quả cần đạt</span>
                <textarea
                  className="ui-module-textarea min-h-20"
                  onChange={(event) => setActions((current) => current.map((item) => item.key === action.key ? { ...item, description: event.target.value } : item))}
                  value={action.description || ""}
                />
              </label>
              <label className="ui-module-field">
                <span className="ui-module-label">Người phụ trách</span>
                <Select
                  onChange={(event) => setActions((current) => current.map((item) => item.key === action.key ? { ...item, assigneeEmployeeId: event.target.value } : item))}
                  value={action.assigneeEmployeeId || ""}
                >
                  <option value="">Chưa gán</option>
                  {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.label}</option>)}
                </Select>
              </label>
              <label className="ui-module-field">
                <span className="ui-module-label">Hạn hoàn thành</span>
                <Input
                  onChange={(event) => setActions((current) => current.map((item) => item.key === action.key ? { ...item, dueAt: event.target.value } : item))}
                  type="date"
                  value={action.dueAt || ""}
                />
              </label>
              <div className="md:col-span-2 flex justify-end">
                <Button onClick={() => setActions((current) => current.filter((item) => item.key !== action.key))} size="sm" variant="ghost">
                  <Trash2 className="size-4" /> Bỏ đầu việc
                </Button>
              </div>
            </article>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button disabled={pending} onClick={save} variant="secondary"><Save className="size-4" /> Lưu bản nháp</Button>
        <Button disabled={pending} onClick={approve}><CheckCircle2 className="size-4" /> Duyệt và giao việc</Button>
      </div>
    </div>
  );
}
