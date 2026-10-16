export type AuthorizationCompany = {
  address: string;
  code: string;
  id: string;
  legalName: string;
  representativeIdentityDate: string;
  representativeIdentityNumber: string;
  representativeIdentityPlace: string;
  representativeName: string;
  representativeTitle: string;
  shortName: string;
  taxCode: string;
};

export type AuthorizationDocumentType = {
  id: string;
  name: string;
};

export type AuthorizationEmployee = {
  birthDate: string;
  companyId: string;
  companyName: string;
  department: string;
  email: string;
  employeeCode: string;
  fullName: string;
  id: string;
  identityDate: string;
  identityNumber: string;
  identityPlace: string;
  title: string;
};

export type AuthorizationPersonMode = "self" | "system" | "manual";

export type AuthorizationPersonSnapshot = {
  birthDate: string;
  companyId: string;
  companyName: string;
  department: string;
  email: string;
  employeeCode: string;
  employeeId: string;
  identityDate: string;
  identityNumber: string;
  identityPlace: string;
  name: string;
  source: AuthorizationPersonMode;
  title: string;
};

export type AuthorizationCartItem = {
  companyIds: string[];
  documentTypeId: string;
  fromDate: string;
  person: AuthorizationPersonSnapshot;
  reason: string;
  toDate: string;
  typeLabel: string;
  uid: string;
  urgent: boolean;
};

export type AuthorizationReceiptRow = {
  companies: string;
  period: string;
  person: string;
  type: string;
};
