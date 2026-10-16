export type PermissionAction = "view" | "edit" | "delete";

export type PermissionActionMap = Record<string, PermissionAction[]>;

export type PermissionEmployee = {
  department: string;
  employeeCode: string;
  fullName: string;
  id: string;
  title: string;
};

export type PermissionRoleOption = {
  id: string;
  key: string;
  name: string;
};

export type PermissionAssignment = {
  activationRequestedAt: string | null;
  activationStatus: "NOT_REQUESTED" | "PENDING" | "APPROVED" | "REJECTED";
  activationStatusLabel: string;
  accessibleGroupLabels: string[];
  employeeCode: string;
  employeeDisplayName: string;
  employeeId: string;
  hasPassword: boolean;
  passwordStatusLabel: string;
  requiresPassword: boolean;
  roleId: string;
  roleKey: string;
  roleLabel: string;
  userId: string;
};

export type PermissionGroup = {
  collectionTitle: string;
  description: string;
  key: string;
  title: string;
};

export type PermissionModule = {
  description: string;
  groupKey: string;
  groupTitle: string;
  key: string;
  label: string;
};

export type PermissionRole = {
  accessibleGroupKeys: string[];
  accessibleGroupLabels: string[];
  accessibleModuleKeys: string[];
  accessibleModuleLabels: string[];
  description: string;
  id: string;
  includeDefaultEmployeeAccess: boolean;
  isActive: boolean;
  isCore: boolean;
  isEditable: boolean;
  key: string;
  moduleActionMap: PermissionActionMap;
  name: string;
  rank: number;
  status: string;
  userCount: number;
};

export type PermissionConsoleData = {
  assignments: PermissionAssignment[];
  employees: PermissionEmployee[];
  groups: PermissionGroup[];
  modules: PermissionModule[];
  roles: PermissionRole[];
  roleOptions: PermissionRoleOption[];
};

export type PermissionMutation =
  | {
      actorPassword: string;
      decision: "approve" | "reject";
      type: "activation-review";
      userId: string;
    }
  | {
      actorPassword: string;
      employeeId: string;
      requiresPassword: boolean;
      roleId: string;
      type: "assignment-save";
    }
  | {
      actorPassword: string;
      userId: string;
      type: "assignment-delete";
    }
  | {
      actorPassword: string;
      confirmPassword: string;
      newPassword: string;
      userId: string;
      type: "password-save";
    }
  | {
      actorPassword: string;
      description: string;
      groupKeys: string[];
      includeDefaultEmployeeAccess: boolean;
      isActive: boolean;
      moduleActionMap: PermissionActionMap;
      name: string;
      originalKey: string;
      rank: number;
      roleKey: string;
      type: "role-save";
    }
  | {
      actorPassword: string;
      roleKey: string;
      type: "role-delete";
    };

export type PermissionMutationResult = {
  error?: string;
  success?: string;
};
