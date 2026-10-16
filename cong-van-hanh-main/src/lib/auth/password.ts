import { compare, hash } from "bcryptjs";

const PASSWORD_COST = 12;

export function getPasswordStrengthError(password: string) {
  if (password.length < 8) {
    return "Mật khẩu cần có ít nhất 8 ký tự.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Mật khẩu cần có ít nhất 1 chữ in hoa.";
  }
  if (!/\d/.test(password)) {
    return "Mật khẩu cần có ít nhất 1 chữ số.";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Mật khẩu cần có ít nhất 1 ký tự đặc biệt.";
  }
  return "";
}

export function hashPassword(password: string) {
  return hash(password, PASSWORD_COST);
}

export function verifyPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}
