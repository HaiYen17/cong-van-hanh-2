"use client";

import { useEffect, useState } from "react";
import { FilePicker } from "@/components/ui/file-picker";
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import {
  MAX_SIGNATURE_IMAGE_BYTES,
  type CompanySignatureConfigInput,
  type CompanySignatureSetup,
} from "@/lib/config/company-signature-config-shared";
import {
  authenticateMisaEsignAction,
  loadCompanySignatureSetupAction,
  saveCompanySignatureConfigAction,
  type MisaEsignConnection,
} from "./actions";

const emptyDraft = (companyId = ""): CompanySignatureConfigInput => ({ companyId, certAlias: "", bodUserIds: [] });

export function EsignCompanyConfigEditor() {
  const { toast } = useToast();
  const [setup, setSetup] = useState<CompanySignatureSetup | null>(null);
  const [draft, setDraft] = useState<CompanySignatureConfigInput>(emptyDraft);
  const [busy, setBusy] = useState("Đang tải chứng thư và BOD của các pháp nhân...");
  const [pickerVersion, setPickerVersion] = useState(0);
  const [imageName, setImageName] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [connection, setConnection] = useState<MisaEsignConnection | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpType, setOtpType] = useState<0 | 1>(0);
  const saved = setup?.configs.find((item) => item.companyId === draft.companyId);

  function selectCompany(companyId: string, data = setup) {
    const config = data?.configs.find((item) => item.companyId === companyId);
    setDraft(config ? { companyId, certAlias: config.certAlias, bodUserIds: [...config.bodUserIds] } : emptyDraft(companyId));
    setImageName("");
    setPickerVersion((value) => value + 1);
  }

  useEffect(() => {
    let active = true;
    loadCompanySignatureSetupAction().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setLoadError(true);
        toast({ title: "Không tải được cấu hình ký số", message: result.message, tone: "error" });
        return;
      }
      setSetup(result.data);
      const companyId = result.data.companies[0]?.id || "";
      const config = result.data.configs.find((item) => item.companyId === companyId);
      setDraft(config ? { companyId, certAlias: config.certAlias, bodUserIds: config.bodUserIds } : emptyDraft(companyId));
    }).catch(() => {
      if (!active) return;
      setLoadError(true);
      toast({ title: "Không tải được cấu hình ký số", message: "Vui lòng thử tải lại danh sách.", tone: "error" });
    }).finally(() => { if (active) setBusy(""); });
    return () => { active = false; };
  }, [toast]);

  async function refresh() {
    if (busy) return;
    setBusy("Đang tải cấu hình ký số theo pháp nhân...");
    try {
      const result = await loadCompanySignatureSetupAction();
      if (!result.ok) throw new Error(result.message);
      setSetup(result.data);
      setLoadError(false);
      selectCompany(result.data.companies.some((company) => company.id === draft.companyId) ? draft.companyId : result.data.companies[0]?.id || "", result.data);
      toast({ title: "Đã tải lại cấu hình ký số", tone: "success" });
    } catch (error) {
      toast({ title: "Không tải được cấu hình", message: error instanceof Error ? error.message : "Vui lòng thử lại.", tone: "error" });
    } finally { setBusy(""); }
  }

  async function selectImage(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (file.size > MAX_SIGNATURE_IMAGE_BYTES || !/\.png$/i.test(file.name)) {
      setPickerVersion((value) => value + 1);
      toast({ title: "Ảnh chữ ký chưa hợp lệ", message: "Vui lòng chọn một ảnh PNG tối đa 512 KB.", tone: "error" });
      return;
    }
    setBusy("Đang đọc ảnh chữ ký...");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Không đọc được ảnh chữ ký."));
        reader.readAsDataURL(file);
      });
      setDraft((current) => ({ ...current, clearImage: false, signatureImage: data }));
      setImageName(file.name);
      toast({ title: "Đã chọn ảnh chữ ký", message: "Bấm Lưu pháp nhân để áp dụng ảnh này.", tone: "info" });
    } catch (error) {
      toast({ title: "Không đọc được ảnh", message: error instanceof Error ? error.message : "Vui lòng chọn lại ảnh.", tone: "error" });
    } finally { setBusy(""); }
  }

  async function save(remove = false) {
    if (busy) return;
    if (!draft.companyId || (!remove && (!draft.certAlias.trim() || !draft.bodUserIds.length))) {
      toast({ title: "Chưa đủ cấu hình pháp nhân", message: "Vui lòng chọn pháp nhân, nhập mã chứng thư và chọn ít nhất một BOD duyệt hồ sơ.", tone: "warning" });
      return;
    }
    setBusy(remove ? "Đang ngừng cấu hình ký số của pháp nhân..." : "Đang lưu chứng thư và BOD duyệt hồ sơ...");
    try {
      const result = await saveCompanySignatureConfigAction({ ...draft, remove });
      if (!result.ok) throw new Error(result.message);
      setSetup(result.data);
      selectCompany(draft.companyId, result.data);
      toast({ title: "Đã lưu cấu hình ký số", message: result.message, tone: "success" });
    } catch (error) {
      toast({ title: "Không lưu được cấu hình ký số", message: error instanceof Error ? error.message : "Vui lòng thử lại.", tone: "error" });
    } finally { setBusy(""); }
  }

  async function authenticate(action: "test" | "otp" | "resend") {
    if (busy) return;
    if (action === "otp" && !/^\d{4,10}$/.test(otpCode.trim())) {
      toast({
        title: "OTP chưa hợp lệ",
        message: "Nhập mã OTP MISA gồm 4 đến 10 chữ số.",
        tone: "warning",
      });
      return;
    }
    setBusy(
      action === "resend"
        ? "Đang yêu cầu MISA gửi lại OTP..."
        : action === "otp"
          ? "Đang xác thực OTP MISA..."
          : "Đang kiểm tra kết nối và chứng thư MISA...",
    );
    try {
      const result = await authenticateMisaEsignAction({
        action,
        code: otpCode,
        otpType,
      });
      if (!result.ok) throw new Error(result.message);
      setConnection(result.data);
      if (!result.data.otpRequired) setOtpCode("");
      toast({
        title: result.data.otpRequired
          ? "MISA yêu cầu OTP"
          : "Kết nối MISA eSign thành công",
        message: result.data.otpRequired
          ? result.message
          : `${result.message} Tìm thấy ${result.data.certificates.length} chứng thư.`,
        tone: result.data.otpRequired ? "warning" : "success",
      });
    } catch (error) {
      toast({
        title: "Không kết nối được MISA eSign",
        message: error instanceof Error ? error.message : "Vui lòng kiểm tra lại cấu hình.",
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid gap-4 border-t border-border pt-5">
      <WriteLoadingOverlay message={busy} show={Boolean(busy)} />
      <section className="grid gap-4 border-b border-border pb-5">
        <div className="global-config-panel-head">
          <div>
            <h3 className="global-config-title">Kiểm tra tài khoản và OTP MISA</h3>
            <p className="global-config-note">Lưu Base URL, ClientID, ClientSecret, tài khoản và mật khẩu ở các trường phía trên trước khi kiểm tra.</p>
          </div>
          <button className="ui-button ui-button--primary" disabled={Boolean(busy)} onClick={() => authenticate("test")} type="button">Kiểm tra kết nối</button>
        </div>
        {connection?.otpRequired ? (
          <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto_auto]">
            <label className="ui-module-field global-config-field">
              <span className="ui-module-label">Mã OTP</span>
              <input autoComplete="one-time-code" className="ui-module-input" inputMode="numeric" maxLength={10} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ""))} placeholder="Nhập OTP do MISA gửi" value={otpCode} />
            </label>
            <label className="ui-module-field global-config-field">
              <span className="ui-module-label">Loại OTP</span>
              <select className="ui-module-select" onChange={(event) => setOtpType(event.target.value === "1" ? 1 : 0)} value={otpType}>
                <option value={0}>Kênh mặc định (0)</option>
                <option value={1}>Kênh thay thế (1)</option>
              </select>
            </label>
            <button className="ui-button ui-button--primary" disabled={Boolean(busy)} onClick={() => authenticate("otp")} type="button">Xác thực OTP</button>
            <button className="ui-button ui-button--secondary" disabled={Boolean(busy)} onClick={() => authenticate("resend")} type="button">Gửi lại OTP</button>
          </div>
        ) : null}
        {connection && !connection.otpRequired ? (
          <div className="grid gap-2">
            <h4 className="global-config-module-label">Chứng thư tài khoản MISA ({connection.certificates.length})</h4>
            {connection.certificates.length ? (
              <div className="grid gap-2 lg:grid-cols-2">
                {connection.certificates.map((certificate) => (
                  <div className="global-config-account" key={certificate.alias}>
                    <div className="global-config-account-head">
                      <div className="min-w-0">
                        <h4 className="global-config-account-title">{certificate.label}</h4>
                        <p className="global-config-account-meta break-all">certAlias: {certificate.alias}</p>
                      </div>
                      <span className={`global-config-chip ${certificate.status.toUpperCase() === "ACTIVE" ? "" : "global-config-chip--orange"}`}>{certificate.status}</span>
                    </div>
                    <button className="global-config-mini-button" disabled={!draft.companyId || certificate.status.toUpperCase() !== "ACTIVE"} onClick={() => setDraft((current) => ({ ...current, certAlias: certificate.alias }))} type="button">Dùng cho pháp nhân đang chọn</button>
                  </div>
                ))}
              </div>
            ) : <div className="global-config-empty">Tài khoản MISA chưa trả về chứng thư nào.</div>}
          </div>
        ) : null}
      </section>
      <div className="global-config-panel-head">
        <div>
          <h3 className="global-config-title">Chứng thư và BOD theo pháp nhân</h3>
          <p className="global-config-note">Mỗi pháp nhân dùng đúng chứng thư đã chọn. Có thể giao cùng một BOD duyệt hồ sơ cho nhiều pháp nhân.</p>
        </div>
        <button className="ui-button ui-button--secondary" disabled={Boolean(busy)} onClick={refresh} type="button">Tải lại pháp nhân</button>
      </div>
      {loadError && !setup ? <div className="global-config-empty">Chưa tải được danh sách. Bấm Tải lại pháp nhân để thử lại.</div> : null}
      {setup ? (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <fieldset className="m-0 grid min-w-0 gap-4 border-0 p-0" disabled={Boolean(busy)}>
            <label className="ui-module-field global-config-field">
              <span className="ui-module-label">Pháp nhân</span>
              <select className="ui-module-select" onChange={(event) => selectCompany(event.target.value)} value={draft.companyId}>
                {!setup.companies.length ? <option value="">Chưa có pháp nhân hoạt động</option> : null}
                {setup.companies.map((company) => <option key={company.id} value={company.id}>{company.name} ({company.code})</option>)}
              </select>
              {setup.companies.find((company) => company.id === draft.companyId)?.taxCode ? <small className="global-config-note">Mã số thuế: {setup.companies.find((company) => company.id === draft.companyId)?.taxCode}</small> : null}
            </label>
            <label className="ui-module-field global-config-field">
              <span className="ui-module-label">Mã chứng thư (certAlias)</span>
              <input autoComplete="off" className="ui-module-input" maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, certAlias: event.target.value }))} placeholder="Mã chứng thư do MISA eSign cấp cho pháp nhân" value={draft.certAlias} />
              <small className="global-config-note">Chứng thư phải còn hiệu lực và thuộc đúng pháp nhân này.</small>
            </label>
            <div className="ui-module-field global-config-field">
              <span className="ui-module-label">BOD duyệt hồ sơ</span>
              <MultiSelect name="esignBodUserIds" onValuesChange={(bodUserIds) => setDraft((current) => ({ ...current, bodUserIds }))} options={setup.approvers.map((user) => ({ label: user.name, sub: user.description, value: user.id }))} placeholder="Tìm và chọn BOD..." values={draft.bodUserIds} />
              <small className="global-config-note">Danh sách gồm tài khoản đang hoạt động có quyền BOD hoặc duyệt hồ sơ.</small>
              {draft.bodUserIds.some((id) => !setup.approvers.some((user) => user.id === id)) ? <small className="text-danger">Có BOD đã ngừng hoạt động hoặc mất quyền. Hãy bỏ lựa chọn đó và chọn người thay thế.</small> : null}
            </div>
            <div className="ui-module-field global-config-field">
              <span className="ui-module-label">Ảnh chữ ký hiển thị trên PDF (tùy chọn)</span>
              <FilePicker accept="image/png,.png" disabled={Boolean(busy)} emptyText={saved?.hasImage && !draft.clearImage ? "Đã có ảnh chữ ký được lưu bảo mật." : "Chưa chọn ảnh chữ ký."} key={pickerVersion} onFilesChange={selectImage} triggerLabel="Chọn ảnh PNG" />
              <small className="global-config-note">PNG tối đa 512 KB. Ảnh đã lưu chỉ được dùng phía máy chủ khi ký hồ sơ.</small>
              {imageName ? <span className="global-config-chip global-config-chip--orange">Ảnh mới: {imageName}</span> : null}
              {saved?.hasImage || draft.signatureImage ? <label className="global-config-secret-check"><input checked={Boolean(draft.clearImage)} onChange={(event) => { setDraft((current) => ({ ...current, clearImage: event.target.checked, signatureImage: event.target.checked ? undefined : current.signatureImage })); if (event.target.checked) { setImageName(""); setPickerVersion((value) => value + 1); } }} type="checkbox" />Xóa ảnh đã lưu khi bấm Lưu pháp nhân</label> : null}
            </div>
            <div className="global-config-actions">
              {saved ? <button className="ui-button ui-button--secondary" onClick={() => save(true)} type="button">Ngừng dùng ký số</button> : <span />}
              <button className="ui-button ui-button--primary" disabled={!draft.companyId} onClick={() => save()} type="button">Lưu pháp nhân</button>
            </div>
          </fieldset>
          <div className="grid gap-3">
            <h3 className="global-config-module-label">Pháp nhân đã cấu hình ({setup.configs.length})</h3>
            {setup.configs.length ? setup.configs.map((config) => {
              const company = setup.companies.find((item) => item.id === config.companyId);
              return <article className="global-config-account" key={config.companyId}>
                <div className="global-config-account-head"><div><h4 className="global-config-account-title">{company?.name || config.companyId}</h4><p className="global-config-account-meta break-all">Chứng thư: {config.certAlias || "Chưa chọn"}</p></div><button className="global-config-mini-button" disabled={Boolean(busy)} onClick={() => selectCompany(config.companyId)} type="button">Chỉnh sửa</button></div>
                <div className="global-config-chip-list">{config.bodUserIds.map((id) => <span className="global-config-chip" key={id}>{setup.approvers.find((user) => user.id === id)?.name || "BOD không còn khả dụng"}</span>)}</div>
                <p className="global-config-account-meta">{config.hasImage ? "Đã có ảnh chữ ký" : "Hiển thị chữ ký theo MISA"} · {config.certAlias && config.bodUserIds.length ? "Đã cấu hình" : "Cần bổ sung chứng thư/BOD"}</p>
              </article>;
            }) : <div className="global-config-empty">Chưa có pháp nhân nào được cấu hình ký số.</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
