"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Button, Input, Select } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

import { submitRequestAction, type RequestActionState } from "../actions";

const initialState: RequestActionState = {};
const FORMATS = [
  { label: "Bản gốc", qty: false },
  { label: "Bản scan", qty: false },
  { label: "Sao y công ty", qty: true },
  { label: "Sao y công chứng", qty: true },
];

type Company = { id: string; legalName: string; shortName: string | null };
type DocType = { id: string; name: string };
type ArchivedRecord = {
  companyId: string;
  documentTypeId: string;
  id: string;
  meta: string;
  recordName: string;
};
type Fmt = { label: string; qty?: number };
type ArchiveItem = {
  companyShort: string;
  content: string;
  documentType: string;
  formats: Fmt[];
  mode: "Trích lục" | "Lưu trữ";
  partner: string;
  reason: string;
  recordName: string;
  revision: string;
  signDate: string;
  uid: string;
};

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="space-y-2 text-sm font-semibold text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
const textareaCls =
  "min-h-20 w-full rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export function TrichLucForm({ archivedRecords, companies, docTypes }: { archivedRecords: ArchivedRecord[]; companies: Company[]; docTypes: DocType[] }) {
  const [state, action, pending] = useActionState(submitRequestAction, initialState);
  const { toast } = useToast();
  const seen = useRef<RequestActionState | null>(null);
  const uid = useRef(0);

  const [cart, setCart] = useState<ArchiveItem[]>([]);
  const [mode, setMode] = useState<"Trích lục" | "Lưu trữ">("Trích lục");
  const [recordName, setRecordName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [documentTypeId, setDocumentTypeId] = useState("");
  const [reason, setReason] = useState("");
  const [formats, setFormats] = useState<Record<string, boolean>>({});
  const [qtys, setQtys] = useState<Record<string, string>>({});
  // Lưu trữ
  const [partner, setPartner] = useState("");
  const [content, setContent] = useState("");
  const [revision, setRevision] = useState("");
  const [signDate, setSignDate] = useState("");

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.success) toast({ message: state.success, title: "Trích lục / lưu trữ", tone: "success" });
    else if (state.error) toast({ message: state.error, title: "Không gửi được", tone: "error" });
  }, [state, toast]);

  const isArchive = mode === "Lưu trữ";
  const company = companies.find((c) => c.id === companyId) || null;
  const docTypeName = docTypes.find((d) => d.id === documentTypeId)?.name ?? "";

  const updateRecordName = (value: string) => {
    setRecordName(value);
    if (mode !== "Trích lục") return;
    const normalized = value.trim().toLocaleLowerCase("vi-VN");
    const matched = archivedRecords.find(
      (item) => item.recordName.toLocaleLowerCase("vi-VN") === normalized,
    );
    if (!matched) return;
    if (matched.companyId) setCompanyId(matched.companyId);
    if (matched.documentTypeId) setDocumentTypeId(matched.documentTypeId);
  };

  const addItem = () => {
    if (!recordName.trim()) return;
    const selFormats: Fmt[] = isArchive
      ? []
      : FORMATS.filter((f) => formats[f.label]).map((f) => ({ label: f.label, ...(f.qty ? { qty: Number.parseInt(qtys[f.label], 10) || 1 } : {}) }));
    setCart((p) => [
      ...p,
      {
        companyShort: company ? company.shortName || company.legalName : "",
        content,
        documentType: docTypeName,
        formats: selFormats,
        mode,
        partner,
        reason,
        recordName: recordName.trim(),
        revision,
        signDate,
        uid: String(uid.current++),
      },
    ]);
    setRecordName(""); setReason(""); setFormats({}); setQtys({}); setPartner(""); setContent(""); setRevision(""); setSignDate("");
  };

  const title = cart.length === 1 ? `${cart[0].mode}: ${cart[0].recordName}` : `${mode} ${cart.length} hồ sơ`;
  const payload = JSON.stringify({
    items: cart.map((i) => ({
      content: i.content || undefined,
      documentType: i.documentType || undefined,
      formats: i.formats,
      mode: i.mode,
      partner: i.partner || undefined,
      reason: i.reason || undefined,
      recordName: i.recordName,
      revision: i.revision || undefined,
      signDate: i.signDate || undefined,
    })),
  });

  return (
    <>
      <WriteLoadingOverlay show={pending} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <div className="flex gap-1.5">
            {(["Trích lục", "Lưu trữ"] as const).map((m) => (
              <button className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${mode === m ? "border-accent bg-accent text-white" : "border-border bg-surface text-primary hover:bg-surface-muted"}`} key={m} onClick={() => setMode(m)} type="button">{m}</button>
            ))}
          </div>

          <Field label={mode === "Trích lục" ? "Hồ sơ cần trích lục" : "Tên hồ sơ"}>
            <Input
              list={mode === "Trích lục" ? "archived-dossier-options" : undefined}
              onChange={(e) => updateRecordName(e.target.value)}
              placeholder={mode === "Trích lục" ? "Gõ để tìm trong toàn bộ hồ sơ đã lưu" : "Gõ tên hồ sơ cần lưu trữ"}
              value={recordName}
            />
            {mode === "Trích lục" ? (
              <datalist id="archived-dossier-options">
                {archivedRecords.map((item) => (
                  <option key={item.id} label={item.meta} value={item.recordName} />
                ))}
              </datalist>
            ) : null}
            {mode === "Trích lục" ? (
              <span className="block text-xs font-normal text-muted">
                {archivedRecords.length.toLocaleString("vi-VN")} hồ sơ đã lưu sẵn sàng để tìm.
              </span>
            ) : null}
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Công ty">
              <Select onChange={(e) => setCompanyId(e.target.value)} value={companyId}>
                <option value="">Chọn công ty</option>
                {companies.map((c) => (<option key={c.id} value={c.id}>{c.shortName || c.legalName}</option>))}
              </Select>
            </Field>
            <Field label="Loại hồ sơ">
              <Select onChange={(e) => setDocumentTypeId(e.target.value)} value={documentTypeId}>
                <option value="">Chọn loại hồ sơ</option>
                {docTypes.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
              </Select>
            </Field>
          </div>

          {isArchive ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Đối tượng ký kết"><Input onChange={(e) => setPartner(e.target.value)} value={partner} /></Field>
              <Field label="Ngày ký"><Input onChange={(e) => setSignDate(e.target.value)} type="date" value={signDate} /></Field>
              <Field label="Lần sửa"><Input min={1} onChange={(e) => setRevision(e.target.value)} placeholder="Nếu có" type="number" value={revision} /></Field>
              <label className="space-y-2 text-sm font-semibold text-foreground md:col-span-2">
                <span>Nội dung</span>
                <textarea className={textareaCls} onChange={(e) => setContent(e.target.value)} placeholder="Nội dung tóm tắt, thay đổi hoặc cập nhật" value={content} />
              </label>
            </div>
          ) : (
            <div>
              <div className="mb-2 text-sm font-semibold text-foreground">Định dạng yêu cầu</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FORMATS.map((f) => {
                  const on = !!formats[f.label];
                  return (
                    <div className={`rounded-2xl border px-4 py-3 transition ${on ? "border-accent bg-accent-soft" : "border-border bg-surface"}`} key={f.label}>
                      <button className="flex w-full items-center justify-between text-sm font-semibold text-foreground" onClick={() => setFormats((p) => ({ ...p, [f.label]: !p[f.label] }))} type="button">
                        <span>{f.label}</span>
                        <span className={`grid size-5 place-items-center rounded-full border-2 ${on ? "border-accent bg-accent" : "border-border"}`}>{on ? <span className="size-2 rounded-full bg-white" /> : null}</span>
                      </button>
                      {on && f.qty ? (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-muted">Số lượng</span>
                          <input className="h-9 w-20 rounded-lg border border-border bg-surface px-2 text-sm" min={1} onChange={(e) => setQtys((p) => ({ ...p, [f.label]: e.target.value }))} type="number" value={qtys[f.label] ?? "1"} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <Field label="Lý do">
            <textarea className={textareaCls} onChange={(e) => setReason(e.target.value)} placeholder={isArchive ? "Ghi chú lưu trữ (nếu có)" : "Nhập lý do cần trích lục"} value={reason} />
          </Field>

          <div className="flex justify-end">
            <Button disabled={!recordName.trim()} onClick={addItem} type="button">Thêm mục</Button>
          </div>
          {isArchive ? <p className="text-xs text-muted">Tải tệp lưu trữ sẽ bổ sung khi nối tích hợp Drive.</p> : null}
        </div>

        <div className="space-y-3 rounded-2xl border border-border bg-surface-muted/50 p-4">
          <div className="text-sm font-bold text-primary">Đơn đã lên ({cart.length})</div>
          {cart.length === 0 ? (
            <p className="text-sm text-muted">Chưa có mục nào.</p>
          ) : (
            <ul className="space-y-3">
              {cart.map((i) => {
                const rows: { label: string; value: string }[] = [
                  { label: "Hình thức", value: i.mode },
                  { label: "Công ty", value: i.companyShort },
                  { label: "Loại hồ sơ", value: i.documentType },
                  { label: "Định dạng", value: i.formats.map((f) => `${f.label}${f.qty ? ` ×${f.qty}` : ""}`).join(", ") },
                  { label: "Đối tượng ký", value: i.partner },
                  { label: "Ngày ký", value: i.signDate },
                ].filter((r) => r.value);
                return (
                  <li className="rounded-2xl border border-border bg-surface p-4 shadow-[0_8px_20px_rgba(17,45,39,0.05)]" key={i.uid}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-extrabold text-primary">{i.recordName}</span>
                      <button className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted transition hover:border-danger hover:text-danger" onClick={() => setCart((p) => p.filter((x) => x.uid !== i.uid))} type="button">Xóa</button>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                      {rows.map((r) => (
                        <div key={r.label}>
                          <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">{r.label}</dt>
                          <dd className="font-semibold text-foreground">{r.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
          <form action={action}>
            <input name="serviceCode" type="hidden" value="document-archive" />
            <input name="title" type="hidden" value={title} />
            <input name="payload" type="hidden" value={payload} />
            <Button className="w-full" disabled={pending || cart.length === 0} type="submit">{pending ? "Đang nộp..." : "Nộp đăng ký"}</Button>
          </form>
        </div>
      </div>
    </>
  );
}
