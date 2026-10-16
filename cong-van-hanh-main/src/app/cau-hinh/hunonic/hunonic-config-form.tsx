"use client";

import {
  ChevronDown,
  CloudCog,
  KeyRound,
  Link2,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, Button, Input, Select } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type { HunonicConfigSnapshot } from "@/lib/air-control/config";

import {
  bootstrapHunonicSessionAction,
  reconnectHunonicSessionAction,
  saveHunonicConfigAction,
  type HunonicDiscoveredDevice,
} from "./actions";

function StatusRow({
  configured,
  label,
  value,
}: {
  configured: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted/60 px-3 py-2.5">
      <span className="text-sm font-semibold text-primary">{label}</span>
      <Badge tone={configured ? "success" : "neutral"}>
        {configured ? value : "Chưa có"}
      </Badge>
    </div>
  );
}

function CredentialField({
  autoComplete,
  clearName,
  configured,
  label,
  name,
  placeholder,
  required = true,
  type,
}: {
  autoComplete: string;
  clearName: string;
  configured: boolean;
  label: string;
  name: string;
  placeholder: string;
  required?: boolean;
  type: "password" | "text";
}) {
  return (
    <div className="ui-module-field">
      <label className="ui-module-label" htmlFor={name}>
        {label}
      </label>
      <Input
        autoComplete={autoComplete}
        data-1p-ignore="true"
        data-lpignore="true"
        id={name}
        name={name}
        placeholder={
          configured ? "Để trống để giữ giá trị đang lưu" : placeholder
        }
        required={required && !configured}
        type={type}
      />
      {configured ? (
        <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-muted">
          <input
            className="size-4 accent-[#114c41]"
            name={clearName}
            type="checkbox"
          />
          Xóa giá trị đang lưu
        </label>
      ) : null}
    </div>
  );
}

function SecretField({
  clearName,
  configured,
  label,
  name,
  placeholder,
}: {
  clearName: string;
  configured: boolean;
  label: string;
  name: string;
  placeholder: string;
}) {
  return (
    <CredentialField
      autoComplete="new-password"
      clearName={clearName}
      configured={configured}
      label={label}
      name={name}
      placeholder={placeholder}
      required={false}
      type="password"
    />
  );
}

export function HunonicConfigForm({
  initial,
}: {
  initial: HunonicConfigSnapshot;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState(initial);
  const [discoveredDevices, setDiscoveredDevices] = useState<
    HunonicDiscoveredDevice[]
  >([]);
  const [busy, setBusy] = useState("");

  async function saveAndConnect(formData: FormData) {
    setBusy("Đang mã hóa và lưu tài khoản Hunonic...");
    try {
      const saved = await saveHunonicConfigAction({
        apiToken: String(formData.get("apiToken") || ""),
        bridgeSecret: String(formData.get("bridgeSecret") || ""),
        bridgeUrl: String(formData.get("bridgeUrl") || ""),
        clearApiToken: formData.get("clearApiToken") === "on",
        clearBridgeSecret: formData.get("clearBridgeSecret") === "on",
        clearPassword: formData.get("clearPassword") === "on",
        clearUsername: formData.get("clearUsername") === "on",
        liveAuthorized: formData.get("liveAuthorized") === "true",
        password: String(formData.get("hunonicPassphrase") || ""),
        username: String(formData.get("hunonicAccount") || ""),
      });
      if (!saved.ok) throw new Error(saved.message);

      let nextSnapshot = saved.data.snapshot;
      setSnapshot(nextSnapshot);

      if (
        !nextSnapshot.usernameConfigured ||
        !nextSnapshot.passwordConfigured
      ) {
        toast({
          message:
            "Tài khoản đã được mã hóa và lưu. Hãy nhập đủ tài khoản và mật khẩu để kiểm tra kết nối.",
          title: "Đã lưu tài khoản Hunonic",
          tone: "success",
        });
        router.refresh();
        return;
      }

      setBusy("Đang đăng nhập Hunonic và đọc danh sách thiết bị thật...");
      const connected = await bootstrapHunonicSessionAction();
      if (!connected.ok) throw new Error(connected.message);
      nextSnapshot = connected.data.snapshot;
      setSnapshot(nextSnapshot);
      setDiscoveredDevices(connected.data.devices || []);
      toast({
        message: connected.message,
        title: "Đã kết nối Hunonic",
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : undefined,
        title: "Chưa kết nối được Hunonic",
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  }

  async function reconnect() {
    setBusy("Đang tái đăng nhập Hunonic và đồng bộ lại thiết bị...");
    try {
      const result = await reconnectHunonicSessionAction();
      if (!result.ok) throw new Error(result.message);
      setSnapshot(result.data.snapshot);
      setDiscoveredDevices(result.data.devices || []);
      toast({
        message: result.message,
        title: "Đã tái kết nối Hunonic",
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : undefined,
        title: "Không thể tái kết nối Hunonic",
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  }

  const connected = snapshot.apiTokenConfigured;
  const canReconnect =
    snapshot.usernameConfigured && snapshot.passwordConfigured;
  const formKey = [
    snapshot.updatedAt,
    snapshot.usernameConfigured,
    snapshot.passwordConfigured,
    snapshot.bridgeReady,
    snapshot.apiTokenConfigured,
  ].join(":");

  return (
    <>
      <WriteLoadingOverlay message={busy} show={Boolean(busy)} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <form
          action={saveAndConnect}
          autoComplete="off"
          className="ui-module-panel space-y-5 p-5"
          key={formKey}
        >
          <div>
            <Badge tone="info">Tài khoản kết nối</Badge>
            <h2 className="mt-2 text-xl font-extrabold text-primary">
              Tài khoản Hunonic của Cổng
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Dùng tài khoản riêng đã được tài khoản chính chia sẻ thiết bị. Tài
              khoản và mật khẩu được mã hóa trước khi lưu vào PostgreSQL.
            </p>
          </div>

          {!connected ? (
            <div className="rounded-lg border border-brand/20 bg-brand-soft/70 p-4 text-sm leading-6 text-brand-strong">
              <div className="flex items-center gap-2 font-bold">
                <CloudCog size={18} />
                Trình kết nối Hunonic phía server đã sẵn sàng
              </div>
              <p className="mt-1">
                Bấm nút bên dưới để Cổng dùng tài khoản đã lưu đăng nhập và đọc
                danh sách thiết bị thật. Bước kiểm tra này chưa gửi lệnh điều khiển.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-[#bfe0d8] bg-[#e4f3ee] p-4 text-sm leading-6 text-primary">
              <div className="flex items-center gap-2 font-bold">
                <Link2 size={18} />
                Đã đăng nhập Hunonic thành công
              </div>
              <p className="mt-1">
                Cổng đã lưu phiên kết nối được mã hóa. Có thể kiểm tra lại bất cứ
                lúc nào để làm mới phiên và đọc lại thiết bị.
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <CredentialField
              autoComplete="off"
              clearName="clearUsername"
              configured={snapshot.usernameConfigured}
              label="Tài khoản / số điện thoại Hunonic"
              name="hunonicAccount"
              placeholder="Nhập tài khoản Hunonic riêng"
              type="text"
            />
            <CredentialField
              autoComplete="new-password"
              clearName="clearPassword"
              configured={snapshot.passwordConfigured}
              label="Mật khẩu Hunonic"
              name="hunonicPassphrase"
              placeholder="Nhập mật khẩu tài khoản riêng"
              type="password"
            />
          </div>

          <details className="group rounded-xl border border-border bg-surface-muted/35">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-bold text-primary [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <CloudCog size={17} />
                Cấu hình nâng cao dành cho kỹ thuật
              </span>
              <ChevronDown
                className="transition-transform group-open:rotate-180"
                size={18}
              />
            </summary>

            <div className="space-y-4 border-t border-border px-4 py-4">
              <p className="text-sm leading-6 text-muted">
                Cổng đang dùng trình kết nối Hunonic trực tiếp phía server. URL và
                secret bridge bên dưới chỉ giữ làm cấu hình dự phòng cho kỹ thuật;
                người dùng thông thường không cần điền.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="ui-module-field md:col-span-2">
                  <label className="ui-module-label" htmlFor="bridgeUrl">
                    URL bridge Hunonic
                  </label>
                  <Input
                    defaultValue={snapshot.bridgeUrl}
                    id="bridgeUrl"
                    name="bridgeUrl"
                    placeholder="Chỉ nhập URL bridge đã triển khai"
                    type="url"
                  />
                </div>
                <SecretField
                  clearName="clearBridgeSecret"
                  configured={snapshot.bridgeSecretConfigured}
                  label="Secret bảo vệ bridge"
                  name="bridgeSecret"
                  placeholder="Secret giữa Cổng và bridge"
                />
                <SecretField
                  clearName="clearApiToken"
                  configured={snapshot.apiTokenConfigured}
                  label="Token Hunonic (không bắt buộc nhập)"
                  name="apiToken"
                  placeholder="Cổng sẽ tự lấy token khi kết nối"
                />
                <div className="ui-module-field md:col-span-2">
                  <label className="ui-module-label" htmlFor="liveAuthorized">
                    Kết nối hiện tại
                  </label>
                  <Select
                    defaultValue={connected ? "direct" : "pending"}
                    disabled
                    id="liveAuthorized"
                  >
                    <option value="pending">
                      Chưa có phiên Hunonic
                    </option>
                    <option value="direct">
                      Kết nối Hunonic trực tiếp · không cần bridge ngoài
                    </option>
                  </Select>
                  <p className="mt-2 text-xs font-semibold text-muted">
                    Trạng thái này được xác định tự động sau khi Cổng đăng nhập và
                    nhận phản hồi từ hub IR.
                  </p>
                </div>
              </div>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={Boolean(busy)} type="submit">
              {connected ? <Link2 size={17} /> : <Save size={17} />}
              Lưu & kiểm tra kết nối
            </Button>
            <span className="text-xs font-semibold leading-5 text-muted">
              Không cần bấm nút lấy key riêng.
            </span>
          </div>
        </form>

        <aside className="ui-module-panel h-fit space-y-4 p-5 xl:sticky xl:top-20">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Badge
                tone={
                  connected
                    ? "success"
                  : "warning"
                }
              >
                {connected
                  ? "Đã kết nối"
                  : "Chờ kiểm tra"}
              </Badge>
              <h2 className="mt-2 text-xl font-extrabold text-primary">
                Trạng thái Hunonic
              </h2>
            </div>
            <ShieldCheck className="text-accent" size={29} />
          </div>

          <div className="space-y-2">
            <StatusRow
              configured={snapshot.usernameConfigured}
              label="Tài khoản"
              value={snapshot.usernamePreview || "Đã lưu"}
            />
            <StatusRow
              configured={snapshot.passwordConfigured}
              label="Mật khẩu"
              value="Đã mã hóa"
            />
            <StatusRow
              configured
              label="Trình kết nối server"
              value="Sẵn sàng"
            />
            <StatusRow
              configured={snapshot.apiTokenConfigured}
              label="Phiên Hunonic"
              value="Đã có"
            />
            <StatusRow
              configured={snapshot.deviceCount > 0}
              label="Thiết bị phát hiện"
              value={String(snapshot.deviceCount)}
            />
          </div>

          <div className="space-y-2">
            <Button
              className="w-full"
              disabled={Boolean(busy) || !canReconnect}
              onClick={reconnect}
              type="button"
              variant="secondary"
            >
              <RefreshCw size={17} />
              Tái kết nối
            </Button>
            <p className="text-center text-xs font-semibold leading-5 text-muted">
              {canReconnect
                ? "Dùng lại tài khoản và mật khẩu đã mã hóa, không cần nhập lại."
                : "Cần lưu đủ tài khoản và mật khẩu trước khi tái kết nối."}
            </p>
          </div>

          {discoveredDevices.length ? (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">
                Thiết bị vừa đọc từ Hunonic
              </p>
              {discoveredDevices.slice(0, 12).map((device) => (
                <div
                  className="rounded-lg border border-border bg-white px-3 py-2"
                  key={device.externalId}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-primary">
                      {device.name}
                    </span>
                    <Badge tone={device.online ? "success" : "neutral"}>
                      {device.online ? "Online" : "Offline"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {[device.homeName, device.roomName, device.rootType]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <details className="mt-2 text-xs text-muted">
                    <summary className="cursor-pointer font-semibold">
                      Dữ liệu kỹ thuật
                    </summary>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-muted p-2">
                      {JSON.stringify(device.diagnostic, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          ) : null}

          <div className="rounded-lg border border-brand/20 bg-brand-soft/70 p-4 text-sm leading-6 text-brand-strong">
            <div className="flex items-center gap-2 font-bold">
              <KeyRound size={17} />
              Luồng kết nối mới
            </div>
            <p className="mt-2">
              Admin chỉ nhập tài khoản và mật khẩu. Cổng đăng nhập trực tiếp từ
              server, lưu token được mã hóa và không đưa mật khẩu hay token xuống
              trình duyệt.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
