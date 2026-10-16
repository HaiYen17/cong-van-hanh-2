"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { Button, Input, Select } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import { autoMapHeaders, PERSONNEL_FIELDS, type PersonnelMappings } from "@/lib/personnel";

import {
  readHeadersAction,
  savePersonnelSourceAction,
  type SourceActionState,
} from "./actions";

const initialState: SourceActionState = {};

type CompanyOpt = { id: string; legalName: string };
export type EditingSource = {
  apiLink: string;
  companyId: string;
  headerRow: number;
  mappings: PersonnelMappings;
  sheetName: string;
  syncMode: string;
};

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="space-y-2 text-sm font-semibold text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function PersonnelSourceForm({
  companies,
  editing,
  readerAccount,
}: {
  companies: CompanyOpt[];
  editing: EditingSource | null;
  readerAccount: string;
}) {
  const [state, action, pending] = useActionState(savePersonnelSourceAction, initialState);
  const { toast } = useToast();
  const seen = useRef<SourceActionState | null>(null);
  const [reading, startRead] = useTransition();

  const [companyId, setCompanyId] = useState(editing?.companyId ?? "");
  const [apiLink, setApiLink] = useState(editing?.apiLink ?? "");
  const [sheetName, setSheetName] = useState(editing?.sheetName ?? "");
  const [headerRow, setHeaderRow] = useState(String(editing?.headerRow ?? 1));
  const [syncMode, setSyncMode] = useState(editing?.syncMode ?? "interval");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<PersonnelMappings>(editing?.mappings ?? {});
  const [preview, setPreview] = useState("Chưa đọc link nguồn.");

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.success) toast({ message: state.success, title: "Đồng bộ nhân sự", tone: "success" });
    else if (state.error) toast({ message: state.error, title: "Lỗi", tone: "error" });
  }, [state, toast]);

  const readLink = () => {
    if (!apiLink || !sheetName || !headerRow) {
      toast({ message: "Nhập link API, sheet và dòng header trước.", title: "Lỗi", tone: "error" });
      return;
    }
    startRead(async () => {
      const res = await readHeadersAction(apiLink, sheetName, Number.parseInt(headerRow, 10) || 1);
      if (res.error) {
        toast({ message: res.error, title: "Lỗi", tone: "error" });
        return;
      }
      const cols = res.headers ?? [];
      setHeaders(cols);
      // Tự nhận diện cột → điền sẵn mapping còn trống (giữ ánh xạ user đã chỉnh).
      const auto = autoMapHeaders(cols);
      setMappings((prev) => ({ ...auto, ...prev }));
      const autoCount = Object.keys(auto).length;
      setPreview(`Đã đọc dòng tiêu đề số ${res.headerRowIndex} của sheet "${sheetName}" — ${cols.length} cột, tự nhận diện ${autoCount} trường.`);
      toast({
        message: `Đã đọc ${cols.length} cột và tự nhận diện ${autoCount} trường.`,
        title: "Đọc nguồn thành công",
        tone: "success",
      });
    });
  };

  const setSingle = (key: string, value: string) =>
    setMappings((p) => ({ ...p, [key]: value }));
  const addMulti = (key: string, value: string) => {
    if (!value) return;
    setMappings((p) => {
      const cur = Array.isArray(p[key]) ? (p[key] as string[]) : [];
      return cur.includes(value) ? p : { ...p, [key]: [...cur, value] };
    });
  };
  const removeMulti = (key: string, value: string) =>
    setMappings((p) => ({ ...p, [key]: (Array.isArray(p[key]) ? (p[key] as string[]) : []).filter((v) => v !== value) }));
  const resetForm = () => {
    setCompanyId(editing?.companyId ?? "");
    setApiLink(editing?.apiLink ?? "");
    setSheetName(editing?.sheetName ?? "");
    setHeaderRow(String(editing?.headerRow ?? 1));
    setSyncMode(editing?.syncMode ?? "interval");
    setHeaders([]);
    setMappings(editing?.mappings ?? {});
    setPreview("Chưa đọc link nguồn.");
  };

  const headerOpts = (
    <>
      <option value="">Chọn cột nguồn</option>
      {headers.map((h) => (
        <option key={h} value={h}>{h}</option>
      ))}
    </>
  );

  return (
    <form action={action} className="space-y-5">
      <WriteLoadingOverlay
        message={reading ? "Hệ thống đang đọc cột từ Google Sheet..." : "Đang lưu cấu hình nguồn nhân sự..."}
        show={reading || pending}
      />
      <input name="companyId" type="hidden" value={companyId} />
      <input name="apiLink" type="hidden" value={apiLink} />
      <input name="sheetName" type="hidden" value={sheetName} />
      <input name="headerRow" type="hidden" value={headerRow} />
      <input name="syncMode" type="hidden" value={syncMode} />
      <input name="mappings" type="hidden" value={JSON.stringify(mappings)} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Công ty set">
          <Select onChange={(e) => setCompanyId(e.target.value)} value={companyId}>
            <option value="">Chọn công ty</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.legalName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Chế độ đồng bộ">
          <Select onChange={(e) => setSyncMode(e.target.value)} value={syncMode}>
            <option value="interval">Định kỳ (mỗi 30 phút)</option>
            <option value="snapshot">Snapshot (thay danh sách 1 lần/ngày)</option>
          </Select>
        </Field>
        <Field label="Link set API">
          <Input onChange={(e) => setApiLink(e.target.value)} placeholder="Link / ID Google Sheet" value={apiLink} />
        </Field>
        <Field label="Sheet lấy danh sách">
          <Input onChange={(e) => setSheetName(e.target.value)} placeholder="VD: DANH SÁCH" value={sheetName} />
        </Field>
        <Field label="Dòng header">
          <Input min={1} onChange={(e) => setHeaderRow(e.target.value)} type="number" value={headerRow} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={reading} onClick={readLink} type="button" variant="secondary">
          {reading ? "Đang đọc..." : "Đọc link"}
        </Button>
        <span className="text-xs text-muted">{preview}</span>
      </div>

      <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm leading-6 text-muted">
        Hệ thống đọc nguồn bằng tài khoản Google{" "}
        <strong className="break-all text-foreground">{readerAccount}</strong>.
        Giữ Sheet ở chế độ <strong>Bị hạn chế</strong>; tài khoản này chỉ cần
        quyền Người xem, không cần bật “Bất kỳ ai có liên kết”.
      </p>

      {headers.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PERSONNEL_FIELDS.map((field) => {
            const value = mappings[field.key];
            if (field.allowMultiple) {
              const chips = Array.isArray(value) ? value : value ? [String(value)] : [];
              return (
                <div className="space-y-2" key={field.key}>
                  <span className="text-sm font-semibold text-foreground">
                    {field.label}{field.required ? " *" : ""}
                  </span>
                  <Select onChange={(e) => { addMulti(field.key, e.target.value); e.target.value = ""; }} value="">
                    {headerOpts}
                  </Select>
                  {chips.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {chips.map((c) => (
                        <button
                          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
                          key={c}
                          onClick={() => removeMulti(field.key, c)}
                          type="button"
                        >
                          {c} <span className="opacity-70">×</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }
            return (
              <Field key={field.key} label={`${field.label}${field.required ? " *" : ""}`}>
                <Select onChange={(e) => setSingle(field.key, e.target.value)} value={typeof value === "string" ? value : ""}>
                  {headerOpts}
                </Select>
              </Field>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-surface-muted px-3 py-2.5 text-sm text-muted">
          Bấm “Đọc link” để nạp danh sách cột rồi ánh xạ sang các trường nhân sự.
        </p>
      )}

      <Button disabled={pending || !companyId} type="submit">
        {pending ? "Đang lưu..." : editing ? "Cập nhật" : "Lưu cấu hình nguồn"}
      </Button>
      <Button disabled={pending || reading} onClick={resetForm} type="button" variant="ghost">
        Đặt lại
      </Button>
    </form>
  );
}
