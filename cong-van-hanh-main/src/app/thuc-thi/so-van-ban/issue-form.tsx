"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { Button, Input, Select } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import { type FormatToken } from "@/lib/document-numbering";
import { renderNumber } from "@/lib/document-registry";

import { issueDocumentNumberAction, type IssueActionState } from "./actions";

const initialState: IssueActionState = {};
const SEAL_TYPES = ["Đóng chính", "Giáp lai", "Dấu treo", "Sao y"];

type CompanyOpt = { code: string; id: string; legalName: string; shortName: string | null };
export type DocTypeOpt = {
  cycle: string | null;
  formatTokens: FormatToken[];
  id: string;
  name: string;
  startIndex: number;
};

function Field({ children, hint, label }: { children: React.ReactNode; hint?: string; label: string }) {
  return (
    <label className="space-y-2 text-sm font-semibold text-foreground">
      <span>{label}</span>
      {children}
      {hint ? <span className="block text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

export function IssueForm({ companies, docTypes }: { companies: CompanyOpt[]; docTypes: DocTypeOpt[] }) {
  const [state, action, pending] = useActionState(issueDocumentNumberAction, initialState);
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef<IssueActionState | null>(null);

  const [companyId, setCompanyId] = useState("");
  const [documentTypeId, setDocumentTypeId] = useState("");
  const [signDate, setSignDate] = useState("");

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.success) {
      toast({ message: state.success, title: "Cấp số văn bản", tone: "success" });
      formRef.current?.reset();
    } else if (state.error) {
      toast({ message: state.error, title: "Lỗi", tone: "error" });
    }
  }, [state, toast]);

  const company = companies.find((c) => c.id === companyId) || null;
  const docType = docTypes.find((d) => d.id === documentTypeId) || null;

  const preview = useMemo(() => {
    if (!company || !docType || !signDate) return "";
    const d = new Date(signDate);
    if (Number.isNaN(d.getTime())) return "";
    return renderNumber(docType.formatTokens, docType.startIndex, company.shortName || company.code, d);
  }, [company, docType, signDate]);

  return (
    <>
      <WriteLoadingOverlay message="Đang cấp số..." show={pending} />
      <form action={action} className="space-y-5" ref={formRef}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Pháp nhân ký">
            <Select name="companyId" onChange={(e) => setCompanyId(e.target.value)} required value={companyId}>
              <option value="">Chọn công ty</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.shortName || c.legalName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Loại văn bản">
            <Select name="documentTypeId" onChange={(e) => setDocumentTypeId(e.target.value)} required value={documentTypeId}>
              <option value="">Chọn loại văn bản</option>
              {docTypes.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Ngày ký">
            <Input name="signDate" onChange={(e) => setSignDate(e.target.value)} required type="date" value={signDate} />
          </Field>
          <Field label="Đối tác / trích yếu" hint="Tên đối tác hoặc nội dung ngắn">
            <Input name="partnerName" placeholder="VD: Công ty ABC" />
          </Field>
          <Field label="Viết tắt đối tác" hint="Tuỳ loại (vd giấy giới thiệu)">
            <Input name="partnerAbbr" />
          </Field>
          <Field label="Số lượng bản">
            <Input defaultValue="1" min={1} name="quantity" type="number" />
          </Field>
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold text-foreground">Loại dấu</div>
          <div className="flex flex-wrap gap-2">
            {SEAL_TYPES.map((s) => (
              <label className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm" key={s}>
                <input className="size-4 accent-[#114c41]" name="sealTypes" type="checkbox" value={s} />
                {s}
              </label>
            ))}
          </div>
        </div>

        <Field label="Ghi chú">
          <Input name="note" />
        </Field>

        <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
          <span className="text-xs font-bold uppercase tracking-wide text-accent">Số dự kiến</span>
          <div className="mt-0.5 font-mono text-base font-bold text-primary">{preview || "— chọn công ty, loại, ngày ký —"}</div>
          {preview ? <div className="mt-0.5 text-xs text-muted">STT thực tế cấp khi lưu (có thể khác nếu đã có số trong kỳ).</div> : null}
        </div>

        <Button disabled={pending} type="submit">{pending ? "Đang cấp số..." : "Cấp số"}</Button>
      </form>
    </>
  );
}
