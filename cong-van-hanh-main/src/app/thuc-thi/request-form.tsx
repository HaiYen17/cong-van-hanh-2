"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";

import { Button, Input, Select } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import {
  getServiceFields,
  isNumberingService,
  type RequestServiceDef,
} from "@/lib/requests/services";

import { submitRequestAction, type RequestActionState } from "./actions";

const initialState: RequestActionState = {};
const SEAL_TYPES = ["Đóng chính", "Giáp lai", "Dấu treo", "Sao y"];

type CompanyOption = { id: string; legalName: string; shortName: string | null };
type DocTypeOption = { id: string; name: string };

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="space-y-2 text-sm font-semibold text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

const textareaCls =
  "min-h-24 w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20";

export function RequestForm({
  companies,
  docTypes,
  services,
}: {
  companies: CompanyOption[];
  docTypes: DocTypeOption[];
  services: RequestServiceDef[];
}) {
  const [state, action, pending] = useActionState(submitRequestAction, initialState);
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const seenRef = useRef<RequestActionState | null>(null);

  const [serviceCode, setServiceCode] = useState("");
  const [custom, setCustom] = useState<Record<string, string | boolean>>({});
  const [seal, setSeal] = useState({
    companyId: "",
    documentTypeId: "",
    partnerAbbr: "",
    partnerName: "",
    quantity: "1",
    sealTypes: [] as string[],
    signDate: "",
  });

  useEffect(() => {
    if (state === seenRef.current) return;
    seenRef.current = state;
    if (state.success) {
      toast({ message: state.success, title: "Đã gửi yêu cầu", tone: "success" });
      formRef.current?.reset();
    } else if (state.error) {
      toast({ message: state.error, title: "Không gửi được", tone: "error" });
    }
  }, [state, toast]);

  const isNumbering = isNumberingService(serviceCode);
  const fields = isNumbering ? [] : getServiceFields(serviceCode);

  const payload = isNumbering
    ? JSON.stringify({
        companyId: seal.companyId,
        documentTypeId: seal.documentTypeId,
        partnerAbbr: seal.partnerAbbr || undefined,
        partnerName: seal.partnerName || undefined,
        quantity: Number.parseInt(seal.quantity, 10) || 1,
        sealTypes: seal.sealTypes,
        signDate: seal.signDate,
      })
    : fields.length > 0
      ? JSON.stringify(Object.fromEntries(fields.map((f) => [f.name, custom[f.name] ?? (f.type === "checkbox" ? false : "")])))
      : "";

  const setField = (name: string, value: string | boolean) => setCustom((p) => ({ ...p, [name]: value }));
  const toggleSeal = (s: string) =>
    setSeal((p) => ({ ...p, sealTypes: p.sealTypes.includes(s) ? p.sealTypes.filter((x) => x !== s) : [...p.sealTypes, s] }));

  return (
    <>
      <WriteLoadingOverlay show={pending} />
      <form action={action} className="space-y-4" ref={formRef}>
        <input name="payload" type="hidden" value={payload} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Loại yêu cầu">
            <Select name="serviceCode" onChange={(e) => { setServiceCode(e.target.value); setCustom({}); }} required value={serviceCode}>
              <option value="">Chọn loại yêu cầu</option>
              {services.map((service) => (
                <option key={service.code} value={service.code}>{service.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Mức độ ưu tiên">
            <Select defaultValue="Bình thường" name="priority">
              <option value="Thấp">Thấp</option>
              <option value="Bình thường">Bình thường</option>
              <option value="Cao">Cao</option>
              <option value="Khẩn">Khẩn</option>
            </Select>
          </Field>
          <Field label="Tiêu đề">
            <Input name="title" placeholder="Tóm tắt yêu cầu" required />
          </Field>
          {!isNumbering ? (
            <Field label="Công ty liên quan">
              <Select name="companyId">
                <option value="">Không gắn</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.shortName || company.legalName}</option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>

        {/* Dịch vụ cấp số (đóng dấu / cấp giấy) */}
        {isNumbering ? (
          <div className="space-y-4 rounded-xl border border-accent/30 bg-accent-soft/40 p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-accent">Thông tin cấp số văn bản</div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label="Pháp nhân ký">
                <Select onChange={(e) => setSeal((p) => ({ ...p, companyId: e.target.value }))} required value={seal.companyId}>
                  <option value="">Chọn công ty</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.shortName || c.legalName}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Loại văn bản">
                <Select onChange={(e) => setSeal((p) => ({ ...p, documentTypeId: e.target.value }))} required value={seal.documentTypeId}>
                  <option value="">Chọn loại văn bản</option>
                  {docTypes.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Ngày ký">
                <Input onChange={(e) => setSeal((p) => ({ ...p, signDate: e.target.value }))} required type="date" value={seal.signDate} />
              </Field>
              <Field label="Đối tác / trích yếu">
                <Input onChange={(e) => setSeal((p) => ({ ...p, partnerName: e.target.value }))} value={seal.partnerName} />
              </Field>
              <Field label="Viết tắt đối tác">
                <Input onChange={(e) => setSeal((p) => ({ ...p, partnerAbbr: e.target.value }))} value={seal.partnerAbbr} />
              </Field>
              <Field label="Số lượng bản">
                <Input min={1} onChange={(e) => setSeal((p) => ({ ...p, quantity: e.target.value }))} type="number" value={seal.quantity} />
              </Field>
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Loại dấu</div>
              <div className="flex flex-wrap gap-2">
                {SEAL_TYPES.map((s) => (
                  <label className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm" key={s}>
                    <input checked={seal.sealTypes.includes(s)} className="size-4 accent-[#114c41]" onChange={() => toggleSeal(s)} type="checkbox" />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted">Admin sẽ cấp số khi xử lý, theo quy cách của loại văn bản đã cấu hình.</p>
          </div>
        ) : null}

        {/* Field khai báo theo dịch vụ (không cấp số) */}
        {fields.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((f) =>
              f.type === "checkbox" ? (
                <label className="flex items-center gap-2 self-end rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm font-semibold text-foreground" key={f.name}>
                  <input checked={Boolean(custom[f.name])} className="size-5 accent-[#114c41]" onChange={(e) => setField(f.name, e.target.checked)} type="checkbox" />
                  {f.label}
                </label>
              ) : (
                <Field key={f.name} label={f.label + (f.required ? " *" : "")}>
                  {f.type === "textarea" ? (
                    <textarea className={textareaCls} onChange={(e) => setField(f.name, e.target.value)} value={String(custom[f.name] ?? "")} />
                  ) : f.type === "select" ? (
                    <Select onChange={(e) => setField(f.name, e.target.value)} value={String(custom[f.name] ?? "")}>
                      <option value="">Chọn...</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </Select>
                  ) : (
                    <Input onChange={(e) => setField(f.name, e.target.value)} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={String(custom[f.name] ?? "")} />
                  )}
                </Field>
              ),
            )}
          </div>
        ) : null}

        <Field label="Nội dung chi tiết">
          <textarea className={textareaCls} name="note" placeholder="Mô tả chi tiết yêu cầu..." />
        </Field>
        <Button disabled={pending} type="submit">{pending ? "Đang gửi..." : "Gửi yêu cầu"}</Button>
      </form>
    </>
  );
}
