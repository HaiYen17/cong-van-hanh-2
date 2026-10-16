export type TemplateFileType = "document" | "spreadsheet";

export type TemplateImportMode = "file" | "link";

export type TemplateDatasetKey =
  | ""
  | "company"
  | "employee"
  | "evaluationResult"
  | "partnerCustomer"
  | "product"
  | "system";

export type TemplateBindingMode =
  | "manual"
  | "scalar-actor"
  | "scalar-company-context"
  | "scalar-linked"
  | "scalar-selector"
  | "scalar-system"
  | "table-linked"
  | "table-manual"
  | "table-selector";

export type TemplateInputType =
  | "date"
  | "email"
  | "formula"
  | "money"
  | "number"
  | "select"
  | "text"
  | "textarea";

export type TemplateTextTransform =
  "lowercase" | "none" | "titlecase" | "uppercase";

export type TemplateContextSource =
  | ""
  | "actor"
  | "actor-company"
  | "evaluation"
  | "evaluation-subject"
  | "manager"
  | "recipient"
  | "selected-company"
  | "subject"
  | "subject-company"
  | "system";

export type TemplateExecutionContext = {
  companyId?: string;
  deadline?: string;
  evaluationInstanceId?: string;
  evaluationLink?: string;
  evaluationType?: string;
  managerEmployeeCode?: string;
  recipientEmployeeCode?: string;
  reviewerRole?: string;
  subjectEmployeeCode?: string;
  cycleName?: string;
};

export type TemplateFieldFormat = {
  alignment?: "center" | "left" | "right";
  backgroundColor?: string;
  bold?: boolean;
  border?: boolean;
  dateFormat?: "dd/mm/yyyy" | "dd-mm-yyyy" | "yyyy-mm-dd";
  fontFamily?: string;
  fontSize?: number;
  italic?: boolean;
  numberFormat?: "decimal" | "integer" | "none" | "percent";
  prefix?: string;
  suffix?: string;
  textColor?: string;
  transform?: TemplateTextTransform;
  underline?: boolean;
};

export type TemplateScanHint = {
  columnIndex: number;
  containerType: string;
  locationKey: string;
  rowIndex: number;
  sheetName: string;
  tableKey: string;
};

export type TemplateFieldConfig = {
  allowOverride: boolean;
  bindingMode: TemplateBindingMode;
  contextSource: TemplateContextSource;
  datasetKey: TemplateDatasetKey;
  fieldId: string;
  format: TemplateFieldFormat;
  formulaExpression: string;
  isSystemField: boolean;
  isTableField: boolean;
  linkGroupKey: string;
  manualInputType: TemplateInputType;
  manualLabel: string;
  options: string[];
  placeholder: string;
  positionLabel: string;
  rawToken: string;
  required: boolean;
  scanHints: TemplateScanHint[];
  scanOrder: number;
  sourceFieldKey: string;
  tableKey: string;
  tableLabel: string;
};

export type TemplateScanOccurrence = TemplateScanHint & {
  detectedTable: boolean;
  detectedTableLikely: boolean;
  placeholder: string;
  rawToken: string;
};

export type TemplateScanField = {
  defaultConfig: TemplateFieldConfig;
  firstOccurrenceIndex: number;
  isTableDetected: boolean;
  occurrenceCount: number;
  placeholder: string;
  rawToken: string;
  scanHints: TemplateScanHint[];
  suggestedTableKey: string;
};

export type TemplateScanResult = {
  fieldCount: number;
  fields: TemplateScanField[];
  fileType: TemplateFileType;
  occurrences: TemplateScanOccurrence[];
  placeholderCount: number;
  tables: Array<{ key: string; label: string }>;
};

export type TemplateSourceInfo = {
  fileType: TemplateFileType;
  importMode: TemplateImportMode;
  sourceFileId: string;
  sourceFileName: string;
  sourceFileUrl: string;
  sourceLink: string;
  workingFileId: string;
  workingFileName: string;
  workingFileUrl: string;
  workingMimeType: string;
};

export type TemplateNumberingConfig = {
  customTextFieldId: string;
  documentNumberFieldId: string;
  documentNumberPlaceholder: string;
  documentTypeId: string;
  documentTypeName: string;
  signDateFieldId: string;
};

export type TemplateNumberingDefinition = {
  companyId: string;
  documentNumberFieldId: string;
  documentNumberPlaceholder: string;
  documentTypeId: string;
  documentTypeName: string;
  enabled: boolean;
  previewNumber: string;
  serial: number | null;
  startIndex: number | null;
};

export type TemplateRecord = TemplateSourceInfo & {
  createdAt?: string;
  fieldConfigs: TemplateFieldConfig[];
  fieldCount: number;
  id: string;
  numbering: TemplateNumberingConfig;
  rowIndex: number;
  scanMeta: TemplateScanResult | Record<string, unknown>;
  status: string;
  templateId: string;
  templateName: string;
  updatedAt: string;
  updatedBy: string;
};

export type TemplateHistoryRecord = {
  createdAt: string;
  createdBy: string;
  employeeCode: string;
  historyId: string;
  id: string;
  documentNumber: string;
  documentRegistryId: string;
  documentTypeName: string;
  outputFileId: string;
  outputUrl: string;
  rowIndex: number;
  templateId: string;
  templateName: string;
};

export type TemplateLookupRecord = {
  key: string;
  label: string;
  searchText: string;
  values: Record<string, string>;
};

export type TemplateFieldDefinition = TemplateFieldConfig & {
  readOnly: boolean;
  value: string;
};

export type TemplateTableGroupDefinition = {
  columns: TemplateFieldDefinition[];
  key: string;
  label: string;
};

export type TemplateFormDefinition = {
  companyOptions: Array<{ label: string; value: string }>;
  context: TemplateExecutionContext;
  evaluationOptions: Array<{
    employeeCode: string;
    label: string;
    value: string;
  }>;
  lookupRecords: Partial<Record<TemplateDatasetKey, TemplateLookupRecord[]>>;
  numbering: TemplateNumberingDefinition | null;
  resolvedCompanyId: string;
  requiresCompanyContext: boolean;
  requiresEvaluationContext: boolean;
  scalarFields: TemplateFieldDefinition[];
  tableGroups: TemplateTableGroupDefinition[];
};

export type TemplateManagementSnapshot = {
  companyFieldOptions: Array<{ key: string; label: string }>;
  contextSourceOptions: Array<{
    datasetKeys: TemplateDatasetKey[];
    description: string;
    key: TemplateContextSource;
    label: string;
  }>;
  datasetOptions: Array<{ key: TemplateDatasetKey; label: string }>;
  documentTypeOptions: Array<{
    companyRuleCount: number;
    cycle: string;
    id: string;
    name: string;
    requiresCustomText: boolean;
  }>;
  employeeFieldOptions: Array<{
    description?: string;
    inputType: TemplateInputType;
    key: string;
    label: string;
    sensitive?: boolean;
  }>;
  evaluationResultFieldOptions: Array<{ key: string; label: string }>;
  history: TemplateHistoryRecord[];
  importModes: Array<{ key: TemplateImportMode; label: string }>;
  manualInputTypes: Array<{ key: TemplateInputType; label: string }>;
  partnerCustomerFieldOptions: Array<{ key: string; label: string }>;
  productFieldOptions: Array<{ key: string; label: string }>;
  scalarBindingModes: Array<{ key: TemplateBindingMode; label: string }>;
  systemFieldOptions: Array<{ key: string; label: string }>;
  tableBindingModes: Array<{ key: TemplateBindingMode; label: string }>;
  templates: TemplateRecord[];
};

export type TemplateWorkspaceSnapshot = {
  templates: TemplateRecord[];
};

export type TemplateOutputPayload = {
  companyId?: string;
  context?: TemplateExecutionContext;
  evaluationContentOverrides?: Record<string, unknown>;
  note?: string;
  previousDraftFileId?: string;
  scalarValues?: Record<string, string>;
  tableRows?: Record<string, Array<Record<string, string>>>;
  templateId: string;
};

export type TemplateOutputResult = {
  documentNumber?: string;
  documentRegistryId?: string;
  documentTypeName?: string;
  generatedAt: string;
  outputFileId: string;
  outputFileName: string;
  outputUrl: string;
  previewUrl: string;
};
