export type AirControlMode = "demo" | "live";

export type AirControlRuntimeConfig = {
  accountReady: boolean;
  bridgeSecret: string;
  bridgeUrl: string;
  hunonicPassword: string;
  hunonicToken: string;
  hunonicUsername: string;
  liveAuthorized: boolean;
  mode: AirControlMode;
  warning: string;
};

export function resolveAirControlRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AirControlRuntimeConfig {
  const liveAuthorized = env.AIR_CONTROL_LIVE_AUTHORIZED === "true";
  const bridgeUrl = (env.AIR_CONTROL_BRIDGE_URL || "").trim().replace(/\/+$/, "");
  const bridgeSecret = (env.AIR_CONTROL_BRIDGE_SECRET || "").trim();
  const bridgeReady = Boolean(bridgeUrl && bridgeSecret);
  const hunonicUsername = (env.AIR_CONTROL_HUNONIC_USERNAME || "").trim();
  const hunonicPassword = (env.AIR_CONTROL_HUNONIC_PASSWORD || "").trim();
  const hunonicToken = (env.AIR_CONTROL_HUNONIC_TOKEN || "").trim();
  const accountReady = Boolean(
    hunonicUsername && (hunonicPassword || hunonicToken),
  );
  const mode: AirControlMode =
    liveAuthorized && bridgeReady && accountReady ? "live" : "demo";

  let warning =
    "Đây là dữ liệu mẫu được tạo trong PostgreSQL để thử giao diện. Hệ thống chưa đăng nhập Hunonic, chưa đọc thiết bị thật và không dò thiết bị qua Wi-Fi.";
  if (liveAuthorized && !bridgeReady) {
    warning =
      "Đã bật quyền điều khiển thật nhưng bridge chưa được cấu hình đủ URL và secret.";
  } else if (liveAuthorized && !accountReady) {
    warning =
      "Đã bật quyền điều khiển thật nhưng tài khoản Hunonic chưa có đủ user và password/token.";
  } else if (mode === "live") {
    warning =
      "Kết nối bridge đã được bật. Phiên bản hiện tại chỉ hỗ trợ bật/tắt nguồn; nhiệt độ và chế độ chờ driver IR tương thích.";
  }

  return {
    accountReady,
    bridgeSecret,
    bridgeUrl,
    hunonicPassword,
    hunonicToken,
    hunonicUsername,
    liveAuthorized,
    mode,
    warning,
  };
}
