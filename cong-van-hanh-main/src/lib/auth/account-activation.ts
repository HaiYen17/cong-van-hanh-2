export const ACCOUNT_ACTIVATION_REQUIRED_MESSAGE =
  "Tài khoản của bạn chưa được kích hoạt. Vui lòng nhấn “Yêu cầu kích hoạt”. Quản trị viên sẽ xác minh và kích hoạt tài khoản trong thời gian sớm nhất.";

export const ACCOUNT_ACTIVATION_PENDING_MESSAGE =
  "Yêu cầu kích hoạt của bạn đã được gửi. Quản trị viên sẽ xác minh và kích hoạt tài khoản trong thời gian sớm nhất.";

export const ACCOUNT_DISABLED_MESSAGE =
  "Tài khoản đã bị khóa hoặc ngừng hoạt động. Vui lòng liên hệ quản trị viên.";

export type AccountActivationStatus =
  | "NOT_REQUESTED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

export function activationStatusLabel(status: AccountActivationStatus) {
  switch (status) {
    case "PENDING":
      return "Chờ kích hoạt";
    case "APPROVED":
      return "Đã kích hoạt";
    case "REJECTED":
      return "Đã từ chối";
    default:
      return "Chưa yêu cầu";
  }
}

export function canRequestAccountActivation(status: AccountActivationStatus) {
  return status === "NOT_REQUESTED" || status === "REJECTED";
}
