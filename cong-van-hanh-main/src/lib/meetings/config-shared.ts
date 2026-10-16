export const RECALL_REGIONS = [
  { key: "ap-northeast-1", label: "Nhật Bản (khuyến nghị cho Việt Nam)" },
  { key: "us-west-2", label: "Hoa Kỳ — Oregon" },
  { key: "us-east-1", label: "Hoa Kỳ — Virginia" },
  { key: "eu-central-1", label: "Châu Âu — Frankfurt" },
] as const;

export type MeetingConfigSnapshot = {
  audioRetentionDays: number;
  botJoinLeadMinutes: number;
  defaultTimezone: string;
  googleOrganizerEmail: string;
  googleServiceAccountEmail: string;
  recallApiKeyConfigured: boolean;
  recallEnabled: boolean;
  recallRegion: string;
  recallVerificationSecretConfigured: boolean;
  transcriptRetentionDays: number;
};
