export type SessionIdentityMember = {
  employeeCode?: string | null;
  employeeId: string;
  userId?: string | null;
  userStatus?: string | null;
};

export type SessionIdentityLink = {
  members: SessionIdentityMember[];
  primaryEmployeeId: string;
  status: string;
};

export type ResolvedSessionIdentity = {
  authenticatedUserId: string;
  employeeId: string | null;
  linkedEmployeeCodes: string[];
  linkedEmployeeIds: string[];
  linkedUserIds: string[];
  primaryEmployeeId: string | null;
  userId: string;
};

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}

function active(value?: string | null) {
  return !value || value.trim().toUpperCase() === "ACTIVE";
}

/**
 * Chuyển nhiều tài khoản đăng nhập của cùng một người thành một danh tính
 * nghiệp vụ. userId là tài khoản chính để toàn bộ code cũ đang lưu dữ liệu
 * theo User tiếp tục dùng chung một chủ thể; authenticatedUserId vẫn giữ tài
 * khoản đã nhập mật khẩu để các thao tác bảo mật không đổi nhầm tài khoản.
 */
export function resolveSessionIdentity(input: {
  authenticatedEmployeeCode?: string | null;
  authenticatedEmployeeId?: string | null;
  authenticatedUserId: string;
  link?: SessionIdentityLink | null;
}): ResolvedSessionIdentity {
  const fallbackMember: SessionIdentityMember | null = input.authenticatedEmployeeId
    ? {
        employeeCode: input.authenticatedEmployeeCode,
        employeeId: input.authenticatedEmployeeId,
        userId: input.authenticatedUserId,
        userStatus: "ACTIVE",
      }
    : null;
  const linkedMembers =
    input.link && active(input.link.status)
      ? input.link.members.filter((member) => member.employeeId?.trim())
      : [];
  const members = linkedMembers.length >= 2
    ? linkedMembers
    : fallbackMember
      ? [fallbackMember]
      : [];
  const primaryEmployeeId =
    linkedMembers.length >= 2 && input.link?.primaryEmployeeId
      ? input.link.primaryEmployeeId
      : (input.authenticatedEmployeeId ?? null);
  const primaryMember = members.find(
    (member) => member.employeeId === primaryEmployeeId,
  );
  const primaryUserId =
    primaryMember?.userId && active(primaryMember.userStatus)
      ? primaryMember.userId
      : input.authenticatedUserId;
  const linkedUserIds = unique([
    primaryUserId,
    ...members.map((member) => member.userId),
    input.authenticatedUserId,
  ]);

  return {
    authenticatedUserId: input.authenticatedUserId,
    employeeId: input.authenticatedEmployeeId ?? null,
    linkedEmployeeCodes: unique(members.map((member) => member.employeeCode)),
    linkedEmployeeIds: unique(members.map((member) => member.employeeId)),
    linkedUserIds,
    primaryEmployeeId,
    userId: primaryUserId,
  };
}

export function sessionOwnsUserId(
  session: { linkedUserIds?: string[]; userId: string },
  candidateUserId?: string | null,
) {
  const userIds = sessionUserIds(session);
  return Boolean(
    candidateUserId &&
      userIds.includes(candidateUserId),
  );
}

export function sessionUserIds(session: {
  linkedUserIds?: string[];
  userId: string;
}) {
  return session.linkedUserIds?.length
    ? session.linkedUserIds
    : [session.userId];
}

export function sessionEmployeeIds(session: {
  employeeId?: string | null;
  linkedEmployeeIds?: string[];
}) {
  return session.linkedEmployeeIds?.length
    ? session.linkedEmployeeIds
    : session.employeeId
      ? [session.employeeId]
      : [];
}
