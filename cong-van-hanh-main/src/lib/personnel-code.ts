export function normalizedEmployeeCode(value: string): string {
  return value.trim();
}

export function employeeCodeIdentity(value: string): string {
  const code = normalizedEmployeeCode(value);
  if (!/^\d+$/.test(code)) return code.toLowerCase();
  return code.replace(/^0+(?=\d)/, "");
}

export function employeeCodesMatch(left: string, right: string): boolean {
  const leftCode = normalizedEmployeeCode(left);
  const rightCode = normalizedEmployeeCode(right);
  if (!leftCode || !rightCode) return false;
  return employeeCodeIdentity(leftCode) === employeeCodeIdentity(rightCode);
}
