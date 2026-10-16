export const RECRUITMENT_ADMIN_ROLE_KEY = "admin-tuyen-dung";

type RecruitmentAccessSubject = {
  isAdmin: boolean;
  roles?: string[];
};

export function isRecruitmentAdministrator(
  subject: RecruitmentAccessSubject,
) {
  return (
    subject.isAdmin ||
    (subject.roles || []).includes(RECRUITMENT_ADMIN_ROLE_KEY)
  );
}
