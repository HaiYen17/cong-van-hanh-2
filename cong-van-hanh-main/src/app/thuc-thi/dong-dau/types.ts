export type SealCompanyOption = {
  address: string;
  code: string;
  id: string;
  legalName: string;
  shortName: string;
  taxCode: string;
};

export type SealDeclarationMode = "partner" | "period" | "detail";

export type SealDocumentTypeOption = {
  condition: string;
  declarationTypes: SealDeclarationMode[];
  hasCustomNumberingText: boolean;
  id: string;
  name: string;
  numberingPreview: string;
  takesNumber: boolean;
};

export type SealPartnerOption = {
  address: string;
  employeeCode: string;
  id: string;
  issuedDate: string;
  issuedPlace: string;
  label: string;
  meta?: string;
  name: string;
  searchText: string;
  shortName: string;
  sourceLabel: string;
  sourceType: "company" | "customer" | "employee";
  taxId: string;
  type: "business" | "person";
};

export type SealSubmissionOffice = {
  key: "q12" | "thanh-cong";
  label: string;
};

export type SealPartnerInput = {
  address: string;
  issuedDate: string;
  issuedPlace: string;
  name: string;
  shortName: string;
  taxId: string;
  type: "business" | "person";
};
