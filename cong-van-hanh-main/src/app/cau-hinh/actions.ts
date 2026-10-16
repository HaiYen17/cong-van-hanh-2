"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/generated/prisma/client";
import type {
  CompanyStatus,
  EmployeeStatus,
  UserStatus,
} from "@/generated/prisma/enums";
import { can } from "@/lib/auth/authorization";
import { hashPassword } from "@/lib/auth/password";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  vtpListProvinces,
  vtpListWards,
  type VtpProvince,
  type VtpWard,
} from "@/lib/integrations/viettelpost-mail";

const SETTINGS_PATH = "/cau-hinh";

export type SettingsActionState = {
  error?: string;
  success?: string;
};

export type PersonnelIdentityActionState = SettingsActionState;

function text(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

function optionalText(formData: FormData, name: string) {
  const value = text(formData, name);
  return value ? value : null;
}

function normalizeEmail(value: string | null) {
  return value ? value.toLowerCase() : null;
}

function uniqueErrorMessage(error: unknown, fallback: string) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return "Mã, email hoặc thông tin định danh này đã tồn tại.";
  }

  return fallback;
}

function statusAction(status: CompanyStatus | EmployeeStatus | UserStatus) {
  return status === "ARCHIVED" ? "ARCHIVE" : "UPDATE";
}

export async function saveCompanyAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const session = await requireCurrentSession();

  if (!can(session, "companies.manage")) {
    return { error: "Ông chưa có quyền quản lý công ty." };
  }

  const editId = text(formData, "editId");
  const code = text(formData, "code").toUpperCase();
  const legalName = text(formData, "legalName");
  const oldAddress = optionalText(formData, "oldAddress");
  const oldProvinceId = optionalText(formData, "oldProvinceId");
  const oldProvinceName = optionalText(formData, "oldProvinceName");
  const oldDistrictId = optionalText(formData, "oldDistrictId");
  const oldDistrictName = optionalText(formData, "oldDistrictName");
  const oldWardId = optionalText(formData, "oldWardId");
  const oldWardName = optionalText(formData, "oldWardName");
  const hasAnyOldAddress = Boolean(
    oldAddress ||
      oldProvinceId ||
      oldProvinceName ||
      oldDistrictId ||
      oldDistrictName ||
      oldWardId ||
      oldWardName,
  );
  const hasCompleteOldAddress = Boolean(
    oldAddress &&
      oldProvinceId &&
      oldProvinceName &&
      oldDistrictId &&
      oldDistrictName &&
      oldWardId &&
      oldWardName,
  );
  const sendMailAddressPriority =
    text(formData, "sendMailAddressPriority") === "old" ? "old" : "new";

  if (!code || !legalName) {
    return { error: "Nhập đầy đủ mã công ty và tên pháp lý." };
  }
  if (hasAnyOldAddress && !hasCompleteOldAddress) {
    return {
      error:
        "Địa chỉ cũ cần có đủ số nhà/đường, Tỉnh/Thành, Quận/Huyện và Phường/Xã.",
    };
  }
  if (sendMailAddressPriority === "old" && !hasCompleteOldAddress) {
    return {
      error: "Muốn ưu tiên địa chỉ Cũ, vui lòng cấu hình đầy đủ địa chỉ cũ trước.",
    };
  }

  const data = {
    address: optionalText(formData, "address"),
    branchName: optionalText(formData, "branchName"),
    businessRegistration: optionalText(formData, "businessRegistration"),
    code,
    legalName,
    oldAddress,
    oldDistrictId,
    oldDistrictName,
    oldProvinceId,
    oldProvinceName,
    oldWardId,
    oldWardName,
    representative: optionalText(formData, "representative"),
    sendMailAddressPriority,
    sendMailLocationKey: optionalText(formData, "sendMailLocationKey"),
    shortName: optionalText(formData, "shortName"),
    status:
      text(formData, "status") === "INACTIVE"
        ? ("INACTIVE" as CompanyStatus)
        : ("ACTIVE" as CompanyStatus),
    taxCode: optionalText(formData, "taxCode"),
  };

  const db = getDb();

  try {
    const company = editId
      ? await db.company.update({ data, where: { id: editId } })
      : await db.company.create({ data });

    await db.auditLog.create({
      data: {
        action: editId ? "UPDATE" : "CREATE",
        actorId: session.userId,
        metadata: { code, legalName },
        summary: `${editId ? "Cập nhật" : "Tạo"} công ty ${code}.`,
        targetId: company.id,
        targetType: "Company",
      },
    });
  } catch (error) {
    return {
      error: uniqueErrorMessage(error, "Không lưu được công ty."),
    };
  }

  revalidatePath(SETTINGS_PATH);
  return { success: editId ? "Đã cập nhật công ty." : "Đã tạo công ty." };
}

export async function configListProvincesAction(): Promise<{
  error?: string;
  provinces: VtpProvince[];
}> {
  const session = await requireCurrentSession();
  if (!can(session, "companies.manage")) {
    return { error: "Ông chưa có quyền quản lý công ty.", provinces: [] };
  }
  const response = await vtpListProvinces("PROD");
  return response.ok
    ? { provinces: response.provinces }
    : { error: response.error, provinces: [] };
}

export async function configListWardsAction(
  provinceId: number,
): Promise<{ error?: string; wards: VtpWard[] }> {
  const session = await requireCurrentSession();
  if (!can(session, "companies.manage")) {
    return { error: "Ông chưa có quyền quản lý công ty.", wards: [] };
  }
  if (!provinceId) return { wards: [] };
  const response = await vtpListWards("PROD", provinceId);
  return response.ok
    ? { wards: response.wards }
    : { error: response.error, wards: [] };
}

export async function savePersonnelIdentityLinkAction(
  _state: PersonnelIdentityActionState,
  formData: FormData,
): Promise<PersonnelIdentityActionState> {
  const session = await requireCurrentSession();
  if (!can(session, "employees.manage")) {
    return { error: "Ông chưa có quyền liên kết tài khoản nhân sự." };
  }

  const editId = text(formData, "editId");
  const name = text(formData, "name");
  const note = optionalText(formData, "note");
  const memberIds = [
    ...new Set(
      formData
        .getAll("employeeIds")
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
  const primaryEmployeeId = text(formData, "primaryEmployeeId");

  if (memberIds.length < 2) {
    return { error: "Vui lòng chọn ít nhất 2 tài khoản nhân sự cần liên kết." };
  }
  if (!memberIds.includes(primaryEmployeeId)) {
    return {
      error: "Tài khoản quyền chính phải nằm trong nhóm nhân sự đã chọn.",
    };
  }

  const db = getDb();
  const [employees, conflictingMember] = await Promise.all([
    db.employee.findMany({
      select: { id: true },
      where: { id: { in: memberIds }, status: "ACTIVE" },
    }),
    db.personnelIdentityMember.findFirst({
      include: { link: true },
      where: {
        employeeId: { in: memberIds },
        ...(editId ? { linkId: { not: editId } } : {}),
      },
    }),
  ]);

  if (employees.length !== memberIds.length) {
    return { error: "Có tài khoản nhân sự không còn trong danh sách đang làm." };
  }
  if (conflictingMember) {
    return {
      error: `MNV đã thuộc liên kết “${conflictingMember.link.name}”. Mỗi tài khoản chỉ được thuộc một nhóm liên kết.`,
    };
  }

  try {
    const saved = await db.$transaction(async (tx) => {
      if (editId) {
        const updated = await tx.personnelIdentityLink.update({
          data: {
            name,
            note,
            primaryEmployeeId,
            status: "ACTIVE",
            updatedById: session.userId,
          },
          where: { id: editId },
        });
        await tx.personnelIdentityMember.deleteMany({ where: { linkId: editId } });
        await tx.personnelIdentityMember.createMany({
          data: memberIds.map((employeeId) => ({
            employeeId,
            linkId: editId,
          })),
        });
        return updated;
      }

      return tx.personnelIdentityLink.create({
        data: {
          createdById: session.userId,
          members: {
            create: memberIds.map((employeeId) => ({ employeeId })),
          },
          name,
          note,
          primaryEmployeeId,
          updatedById: session.userId,
        },
      });
    });

    await db.auditLog.create({
      data: {
        action: editId ? "UPDATE" : "CREATE",
        actorId: session.userId,
        metadata: { memberIds, primaryEmployeeId },
        summary: `${editId ? "Cập nhật" : "Tạo"} liên kết nhân sự “${name}”.`,
        targetId: saved.id,
        targetType: "PersonnelIdentityLink",
      },
    });
  } catch (error) {
    return {
      error: uniqueErrorMessage(error, "Không lưu được liên kết nhân sự."),
    };
  }

  return {
    success:
      "Đã lưu liên kết nhân sự. Các tài khoản trong nhóm dùng chung quyền và phạm vi tài liệu.",
  };
}

export async function deletePersonnelIdentityLinkAction(linkId: string) {
  const session = await requireCurrentSession();
  if (!can(session, "employees.manage")) return;
  const db = getDb();
  const link = await db.personnelIdentityLink.findUnique({ where: { id: linkId } });
  if (!link) return;
  await db.$transaction([
    db.personnelIdentityLink.delete({ where: { id: linkId } }),
    db.auditLog.create({
      data: {
        action: "DELETE",
        actorId: session.userId,
        summary: `Xóa liên kết nhân sự “${link.name}”.`,
        targetId: link.id,
        targetType: "PersonnelIdentityLink",
      },
    }),
  ]);
}

export async function setCompanyStatusAction(
  companyId: string,
  status: CompanyStatus,
) {
  const session = await requireCurrentSession();

  if (!can(session, "companies.manage")) {
    return;
  }

  const db = getDb();
  const company = await db.company.update({
    data: {
      archivedAt: status === "ARCHIVED" ? new Date() : null,
      status,
    },
    where: { id: companyId },
  });

  await db.auditLog.create({
    data: {
      action: statusAction(status),
      actorId: session.userId,
      metadata: { code: company.code, status },
      summary: `Updated company ${company.code} status to ${status}.`,
      targetId: company.id,
      targetType: "Company",
    },
  });

  revalidatePath(SETTINGS_PATH);
}

export async function createEmployeeAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const session = await requireCurrentSession();

  if (!can(session, "employees.manage")) {
    return { error: "Ông chưa có quyền tạo nhân viên." };
  }

  const employeeCode = text(formData, "employeeCode").toUpperCase();
  const fullName = text(formData, "fullName");
  const email = normalizeEmail(optionalText(formData, "email"));
  const phone = optionalText(formData, "phone");
  const department = optionalText(formData, "department");
  const title = optionalText(formData, "title");
  const companyId = optionalText(formData, "companyId");

  if (!employeeCode || !fullName) {
    return { error: "Nhập đầy đủ mã nhân viên và họ tên." };
  }

  const db = getDb();

  try {
    const employee = await db.employee.create({
      data: {
        company: companyId ? { connect: { id: companyId } } : undefined,
        department,
        email,
        employeeCode,
        fullName,
        phone,
        title,
      },
    });

    await db.auditLog.create({
      data: {
        action: "CREATE",
        actorId: session.userId,
        metadata: { employeeCode, fullName },
        summary: `Created employee ${employeeCode}.`,
        targetId: employee.id,
        targetType: "Employee",
      },
    });
  } catch (error) {
    return {
      error: uniqueErrorMessage(error, "Không tạo được nhân viên."),
    };
  }

  revalidatePath(SETTINGS_PATH);
  return { success: "Đã tạo nhân viên." };
}

export async function setEmployeeStatusAction(
  employeeId: string,
  status: EmployeeStatus,
) {
  const session = await requireCurrentSession();

  if (!can(session, "employees.manage")) {
    return;
  }

  const db = getDb();
  const employee = await db.employee.update({
    data: {
      archivedAt: status === "ARCHIVED" ? new Date() : null,
      status,
    },
    where: { id: employeeId },
  });

  await db.auditLog.create({
    data: {
      action: statusAction(status),
      actorId: session.userId,
      metadata: { employeeCode: employee.employeeCode, status },
      summary: `Updated employee ${employee.employeeCode} status to ${status}.`,
      targetId: employee.id,
      targetType: "Employee",
    },
  });

  revalidatePath(SETTINGS_PATH);
}

export async function createUserAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const session = await requireCurrentSession();

  if (!can(session, "users.manage")) {
    return { error: "Ông chưa có quyền tạo tài khoản." };
  }

  const username = text(formData, "username").toLowerCase();
  const email = normalizeEmail(optionalText(formData, "email"));
  const displayName = text(formData, "displayName");
  const password = String(formData.get("password") || "");
  const employeeId = optionalText(formData, "employeeId");
  const roleId = text(formData, "roleId");

  if (!username || !email || !displayName || !password || !roleId) {
    return {
      error: "Nhập đầy đủ tài khoản, email, tên hiển thị, mật khẩu và vai trò.",
    };
  }

  if (password.length < 8) {
    return { error: "Mật khẩu cần ít nhất 8 ký tự." };
  }

  const db = getDb();
  const role = await db.role.findFirst({
    where: {
      id: roleId,
      status: "ACTIVE",
    },
  });

  if (!role) {
    return { error: "Vai trò đã chọn không còn hoạt động." };
  }

  if (role.isSystem && !can(session, "system.permissions.manage")) {
    return { error: "Chỉ Super Admin mới được gán vai trò hệ thống." };
  }

  try {
    const passwordHash = await hashPassword(password);

    const user = await db.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          activationReviewedAt: new Date(),
          activationStatus: "APPROVED",
          displayName,
          email,
          employee: employeeId ? { connect: { id: employeeId } } : undefined,
          passwordHash,
          requiresPassword: true,
          username,
        },
      });

      await tx.userRole.create({
        data: {
          assignedById: session.userId,
          roleId: role.id,
          userId: createdUser.id,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "CREATE",
          actorId: session.userId,
          metadata: {
            roleKey: role.key,
            username,
          },
          summary: `Created user ${username}.`,
          targetId: createdUser.id,
          targetType: "User",
        },
      });

      return createdUser;
    });

    revalidatePath(SETTINGS_PATH);
    return { success: `Đã tạo tài khoản ${user.username}.` };
  } catch (error) {
    return {
      error: uniqueErrorMessage(error, "Không tạo được tài khoản."),
    };
  }
}

export async function setUserStatusAction(
  userId: string,
  status: UserStatus,
) {
  const session = await requireCurrentSession();

  if (!can(session, "users.manage")) {
    return;
  }

  if (session.userId === userId && status !== "ACTIVE") {
    return;
  }

  const db = getDb();
  const targetUser = await db.user.findUnique({
    include: {
      userRoles: {
        include: {
          role: true,
        },
      },
    },
    where: { id: userId },
  });

  if (!targetUser) {
    return;
  }

  const isSuperAdmin = targetUser.userRoles.some(
    (userRole) => userRole.role.key === "super-admin",
  );

  if (status !== "ACTIVE" && isSuperAdmin) {
    const activeSuperAdmins = await db.user.count({
      where: {
        status: "ACTIVE",
        userRoles: {
          some: {
            role: {
              key: "super-admin",
              status: "ACTIVE",
            },
          },
        },
      },
    });

    if (activeSuperAdmins <= 1) {
      return;
    }
  }

  await db.$transaction([
    db.user.update({
      data: {
        archivedAt: status === "ARCHIVED" ? new Date() : null,
        status,
      },
      where: { id: userId },
    }),
    db.authSession.updateMany({
      data: {
        revokedAt: new Date(),
      },
      where: {
        revokedAt: null,
        userId,
      },
    }),
    db.auditLog.create({
      data: {
        action: statusAction(status),
        actorId: session.userId,
        metadata: { status, username: targetUser.username },
        summary: `Updated user ${targetUser.username} status to ${status}.`,
        targetId: targetUser.id,
        targetType: "User",
      },
    }),
  ]);

  revalidatePath(SETTINGS_PATH);
}
