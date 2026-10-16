export class RecruitmentRuntimeError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RecruitmentRuntimeError";
    this.status = status;
  }
}
