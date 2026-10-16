# Permission Foundation - Cong van hanh

This file records the permission pattern inherited from the old `Hanh chinh`
folder so Step 2 can build auth/roles without rediscovering it.

## Sources Checked

| Source | Useful pattern |
|---|---|
| `C:\Users\minht\OneDrive\Desktop\Hanh chinh\AGENTS.md` | Permission zones and rules: Super Admin, Admin Hanh chinh, Nguoi Thuan Viet |
| `PermissionModal.html` | UI separates assignment from role setup |
| `PermissionAuthModal.html` | Permission changes require Super Admin password confirmation |
| `admin_auth.js` | Admin checks combine role key and module access |
| `Code.js` | Permission sheet headers, role headers, group/module expansion, Super Admin integrity |

## Old Permission Shape

User assignment:

| Field | Meaning |
|---|---|
| `employeeId` | Stable employee key |
| `name`, `title` | Snapshot for display/history |
| `roleKey` | Assigned role |
| `requiresPassword` | Whether login/password is required |
| `passwordSalt`, `passwordHash` | Password is never stored plain text |
| `updatedAt`, `updatedBy` | Audit fields |

Role definition:

| Field | Meaning |
|---|---|
| `key` | Stable role key, slug-style |
| `label` | Human display name |
| `description` | Short explanation |
| `rank` | Lower number means higher permission level |
| `accessibleGroupKeys` | Open whole module groups |
| `accessibleModuleKeys` | Open specific modules |
| `includeNguoiThuanViet` | Always include default employee modules |
| `status` / `isActive` | Disable role without deleting it |
| `isCore` / `isEditable` | Protect core roles |
| `createdAt`, `updatedAt`, `updatedBy` | Audit fields |

Module grouping:

| Layer | Meaning |
|---|---|
| Collection | Big navigation area, such as `admin-hanh-chinh` or `nguoi-thuan-viet` |
| Group | Functional cluster, such as `admin-config`, `admin-execution`, `nguoi-thuan-viet-admin` |
| Module | Concrete feature, such as `permissions`, `config`, `document-seal`, `support-request` |

## Rules To Carry Into V3

1. Keep `Super Admin` separate from normal `Admin`.
2. Only `Super Admin` can manage permission structure and assign Super Admin.
3. Permission management must ask for password confirmation from Super Admin.
4. The system must always keep at least one active Super Admin.
5. Normal Admin can manage administrative work, but cannot see or edit Super Admin tools by default.
6. Default employee access should be a reusable bundle, not manually duplicated into every role.
7. Roles can open whole module groups and also add individual modules.
8. Inactive roles remain in history but cannot be newly assigned.
9. Hard delete is avoided; archive/inactive plus audit log is the default.

## V3 Initial Roles

| Role key | Rank | Purpose | Default access |
|---|---:|---|---|
| `super-admin` | 1 | System owner and permission manager | All groups/modules |
| `admin` | 20 | Admin Hanh chinh/module owner | Config + execution + employee default modules, not Super Admin tools |
| `bod` | 40 | Leadership review/approval | Overview, approvals, history |
| `employee` | 100 | Normal internal user | Create and follow own requests |

Future roles such as `admin-kho`, `admin-xuong`, or accounting-specific roles
should reuse the same shape: rank, group access, module overrides, active status,
and audit fields.

## V3 Database Direction

The Prisma schema now keeps both layers:

| Model | Purpose |
|---|---|
| `Role` | Role metadata, rank, core/system flags, active/archive state |
| `ModuleGroup` | Group/collection metadata |
| `AppModule` | Concrete module under a group |
| `RoleModuleGroup` | Grants a role a whole module group |
| `RoleAppModule` | Grants a role a specific module |
| `Permission` / `RolePermission` | Fine-grained actions such as read/manage/approve |
| `UserRole` | User-to-role assignment |
| `AuditLog` | Tracks sensitive changes |
