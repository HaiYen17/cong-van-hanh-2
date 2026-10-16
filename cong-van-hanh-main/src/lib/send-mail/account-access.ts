import "server-only";

import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

type AccountScope = {
  company?: {
    code: string;
    legalName: string;
    sendMailLocationKey?: string | null;
    shortName: string | null;
  } | null;
  companyScope: unknown;
  departmentScope: unknown;
};

export type SendMailActorContext = {
  companyCode: string;
  companyName: string;
  department: string;
  employeeId: string;
  fullName: string;
  phone: string;
};

function normalized(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .trim()
    .toLowerCase();
}

function stringList(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function fuzzyMatch(left: string, right: string) {
  const a = normalized(left);
  const b = normalized(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

export function isSendMailAdmin(session: AppSession) {
  return (
    session.fullAccess ||
    session.roles.includes("super-admin") ||
    session.roles.includes("admin")
  );
}

export async function getSendMailActorContext(
  session: AppSession,
): Promise<SendMailActorContext> {
  const user = await getDb().user.findUnique({
    select: {
      employee: {
        select: {
          company: {
            select: { code: true, legalName: true, shortName: true },
          },
          department: true,
          employeeCode: true,
          fullName: true,
          phone: true,
        },
      },
    },
    where: { id: session.userId },
  });
  const employee = user?.employee;
  return {
    companyCode: employee?.company?.code || "",
    companyName:
      employee?.company?.legalName || employee?.company?.shortName || "",
    department: employee?.department || "",
    employeeId: employee?.employeeCode || "",
    fullName: employee?.fullName || session.displayName,
    phone: employee?.phone || "",
  };
}

export function canUseVtpAccount(
  session: AppSession,
  actor: SendMailActorContext,
  account: AccountScope,
) {
  if (isSendMailAdmin(session)) return true;

  const companyScope = stringList(account.companyScope);
  const departmentScope = stringList(account.departmentScope);
  const actorCompanies = [actor.companyCode, actor.companyName].filter(Boolean);
  const linkedCompany = [
    account.company?.code || "",
    account.company?.legalName || "",
    account.company?.shortName || "",
  ].filter(Boolean);
  const companyMatched = companyScope.length
    ? companyScope.some((scope) =>
        actorCompanies.some((candidate) => fuzzyMatch(scope, candidate)),
      )
    : linkedCompany.length
      ? linkedCompany.some((company) =>
          actorCompanies.some((candidate) => fuzzyMatch(company, candidate)),
        )
      : true;
  const departmentMatched =
    departmentScope.length === 0 ||
    departmentScope.some((scope) => fuzzyMatch(scope, actor.department));
  return companyMatched && departmentMatched;
}

export async function listAccessibleVtpAccounts(session: AppSession) {
  const actor = await getSendMailActorContext(session);
  const accounts = await getDb().viettelPostAccount.findMany({
    include: {
      company: {
        select: {
          code: true,
          legalName: true,
          sendMailLocationKey: true,
          shortName: true,
        },
      },
    },
    orderBy: { name: "asc" },
    where: { status: "ACTIVE" },
  });
  return {
    accounts: accounts.filter((account) =>
      canUseVtpAccount(session, actor, account),
    ),
    actor,
  };
}

export async function resolveAccessibleVtpAccount(
  session: AppSession,
  accountId: string,
) {
  if (!accountId) return null;
  const [actor, account] = await Promise.all([
    getSendMailActorContext(session),
    getDb().viettelPostAccount.findUnique({
      include: {
        company: {
          select: {
            code: true,
            legalName: true,
            sendMailLocationKey: true,
            shortName: true,
          },
        },
      },
      where: { id: accountId },
    }),
  ]);
  if (
    !account ||
    account.status !== "ACTIVE" ||
    !canUseVtpAccount(session, actor, account)
  ) {
    return null;
  }
  return account;
}
