export type CandidateTimeline = {
  actorName: string;
  createdAt: string;
  detail: string;
  eventType: string;
  title: string;
};

export type CandidateInterview = {
  applicationId?: string;
  assignments: Array<{
    id: string;
    reviewerEmployeeId: string;
    reviewerName: string;
    roleKey: string;
    roleLabel: string;
    status: string;
  }>;
  candidateCode?: string;
  candidateName?: string;
  id: string;
  location: string;
  meetingLink: string;
  note: string;
  position?: string;
  roundKey: string;
  roundLabel: string;
  startAt: string;
  status: string;
};

export type ManagedCandidate = {
  age: number | null;
  applicationCode: string;
  applicationId: string;
  campaignId: string;
  candidateCode: string;
  cvUrl: string;
  department: string;
  dueAt: string;
  email: string;
  interviews: CandidateInterview[];
  isOverdue: boolean;
  level: string;
  name: string;
  nextAction: string;
  outcomeKey: string;
  ownerEmployeeId: string;
  ownerName: string;
  phone: string;
  position: string;
  progressKey: string;
  receivedAt: string;
  requisitionCode: string;
  scoreSummary: {
    completed: number;
    finalScore: number | string;
    total: number;
  };
  source: string;
  stageKey: string;
  stageLabel: string;
  status: string;
  timeline: CandidateTimeline[];
};

export type RecruitmentCampaignView = {
  availableOrder: string;
  block: string;
  campaignName: string;
  code: string;
  company: string;
  cvType: string;
  department: string;
  division: string;
  endDate: string;
  groupName: string;
  id: string;
  location: string;
  position: string;
  source: string;
  startDate: string;
  status: string;
  team: string;
};

export type RecruitmentIntakeView = {
  cvUrl: string;
  email: string;
  fullName: string;
  id: string;
  phone: string;
  position: string;
  raw: Record<string, unknown>;
  requisitionCode: string;
  source: string;
  status: string;
  updatedAt: string;
};

export type RecruitmentRequisitionView = {
  cancellationStage: string;
  company: string;
  department: string;
  id: string;
  intakeStatus: string;
  jobCode: string;
  level: string;
  note: string;
  onboardDueAt: string;
  position: string;
  quarter: string;
  reason: string;
  receivedAt: string;
  recruiter: string;
  recruitmentStatus: string;
  requestedQuantity: number | null;
  requisitionCode: string;
  year: number | null;
};

export type RecruitmentManagementData = {
  campaigns: RecruitmentCampaignView[];
  candidates: ManagedCandidate[];
  dashboard: {
    activeCampaigns: number;
    activeCandidates: number;
    intakePending: number;
    missingScorecards: number;
    needAttention: number;
    upcomingInterviews: number;
  };
  dataQuality: {
    duplicateGroups: Array<{
      field: "phone" | "email";
      items: Array<{
        applicationId: string;
        candidateCode: string;
        name: string;
        position: string;
        receivedAt: string;
        status: string;
      }>;
      value: string;
    }>;
    missingCode: number;
    missingCv: number;
    missingPhone: number;
    missingPosition: number;
  };
  dropdowns: Record<string, string[]>;
  generatedAt: string;
  intake: RecruitmentIntakeView[];
  interviews: CandidateInterview[];
  missingScorecards: Array<{
    applicationId: string;
    candidateName: string;
    reviewerName: string;
    roundLabel: string;
    startAt: string;
  }>;
  outcomeOptions: ReadonlyArray<{ key: string; label: string }>;
  pipeline: Array<{
    count: number;
    key: string;
    label: string;
    locked?: boolean;
    order: number;
    overdue: number;
  }>;
  priority: ManagedCandidate[];
  progressOptions: ReadonlyArray<{ key: string; label: string }>;
  requisitions: RecruitmentRequisitionView[];
  reviewerOptions: Array<{
    department: string;
    employeeCode: string;
    employeeId: string;
    label: string;
    name: string;
    title: string;
  }>;
  snapshotGroups: Array<{ count: number; kind: string }>;
  sources: Array<{
    id: string;
    mapping: Record<string, unknown>;
    name: string;
    status: string;
  }>;
  stages: ReadonlyArray<{
    key: string;
    label: string;
    locked?: boolean;
    order: number;
  }>;
  viewer: { employeeId: string; isAdmin: boolean; name: string };
};

export type ManagementTab =
  | "today"
  | "pipeline"
  | "campaigns"
  | "schedule"
  | "intake"
  | "quality"
  | "tools"
  | "scoring";
