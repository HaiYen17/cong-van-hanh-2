import "server-only";

import pdfmake from "pdfmake";
import robotoFontContainer from "pdfmake/build/fonts/Roboto";

import { getDb } from "@/lib/db";
import {
  evaluationRecordIdentifiers,
  findEvaluationRecordByIdentifier,
} from "@/lib/evaluation/record-identity";
import {
  evaluationDecisionFieldIsVisible,
  evaluationDecisionQuestionText,
} from "@/lib/evaluation/decision-fields";
import { groupEvaluationWorkspaceScores } from "@/lib/evaluation/workspace-grouping";
import { evaluationReviewAssignments } from "@/lib/evaluation/workflow";
import {
  asRecord,
  numberValue,
  text,
  type JsonRecord,
} from "@/lib/operations/json";
import { formatEvaluationTemplateAnswer } from "@/lib/templates/evaluation-context";

for (const [filename, file] of Object.entries(robotoFontContainer.vfs)) {
  pdfmake.virtualfs.writeFileSync(
    filename,
    Buffer.from(file.data, file.encoding ?? "base64"),
  );
}
pdfmake.setFonts(robotoFontContainer.fonts);
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(() => false);

type PdfScoreRow = {
  content: Record<string, unknown>;
  id: string;
  name: string;
};

type PdfScoreContext = {
  aggregationMode: string;
  roleWeights: Record<string, unknown>;
};

type PdfChartItem = {
  label: string;
  maximum: number;
  score: number | null;
};

type PdfDecisionField = PdfScoreRow & { code: string };
export type EvaluationResultPdfInput = {
  decisionFields?: PdfDecisionField[];
  decisionOptionReferences?: string[];
  instanceContent: Record<string, unknown>;
  instanceName: string;
  resultContent?: Record<string, unknown>;
  scores: PdfScoreRow[];
};

const SCORE_ROLES = [
  {
    commentKey: "employeeComment",
    label: "Bản thân",
    role: "self",
    scoreKey: "employeeScore",
  },
  {
    commentKey: "managerComment",
    label: "Quản lý",
    role: "manager",
    scoreKey: "managerScore",
  },
  {
    commentKey: "peerComment",
    label: "Đồng nghiệp",
    role: "peer",
    scoreKey: "peerScore",
  },
  { commentKey: "hrComment", label: "CnB", role: "hr", scoreKey: "hrScore" },
] as const;

const subtleTableLayout = {
  fillColor: (rowIndex: number) =>
    rowIndex === 0 ? "#e9f4f0" : rowIndex % 2 ? "#ffffff" : "#f8fbfa",
  hLineColor: () => "#d8e4e0",
  hLineWidth: (rowIndex: number) => (rowIndex ? 0.55 : 0),
  paddingBottom: () => 6,
  paddingLeft: () => 7,
  paddingRight: () => 7,
  paddingTop: () => 6,
  vLineWidth: () => 0,
};

function romanNumeral(index: number) {
  const values = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
  return values[index] || String(index + 1);
}

function nonEmpty(value: unknown) {
  return value != null && String(value).trim() !== "";
}

function normalizeRole(value: unknown) {
  const role = text(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["employee", "staff", "nhan_su", "nhan_vien"].includes(role))
    return "self";
  if (["supervisor", "leader", "cap_tren", "quan_ly"].includes(role)) {
    return "manager";
  }
  if (["colleague", "coworker", "dong_nghiep"].includes(role)) return "peer";
  if (["m2", "qlgt"].includes(role)) return "indirect_manager";
  if (["cnb", "human_resources"].includes(role)) return "hr";
  if (["board", "board_of_directors", "ban_giam_doc"].includes(role))
    return "bod";
  return role;
}

function configuredRoles(value: unknown) {
  const values = Array.isArray(value) ? value : text(value).split(/[,;|/\n]+/g);
  return values.map(normalizeRole).filter(Boolean);
}

function roleIsAllowed(content: Record<string, unknown>, role: string) {
  const roles = configuredRoles(
    content.evaluatorRoles || content.roles || content.role,
  );
  return (
    !roles.length ||
    roles.includes("all") ||
    roles.includes("any") ||
    roles.includes(role)
  );
}

function maximumForMethod(value: unknown) {
  const method = text(value).toLowerCase();
  if (method === "scale_5") return 5;
  if (method === "percent") return 100;
  return 10;
}

function roleWeight(context: PdfScoreContext, role: string) {
  if (context.aggregationMode !== "custom") return 1;
  return Math.max(
    0,
    numberValue(
      context.roleWeights[role] ??
        (role === "self" ? context.roleWeights.employee : undefined),
      0,
    ),
  );
}

function combinedScorePercent(
  content: Record<string, unknown>,
  context: PdfScoreContext,
) {
  const available = SCORE_ROLES.flatMap(({ role, scoreKey }) => {
    if (!roleIsAllowed(content, role) || !nonEmpty(content[scoreKey]))
      return [];
    const rawScore = numberValue(content[scoreKey], Number.NaN);
    if (!Number.isFinite(rawScore)) return [];
    return [
      {
        percent: Math.max(
          0,
          Math.min(
            100,
            (rawScore / maximumForMethod(content.scoringMethod)) * 100,
          ),
        ),
        role,
      },
    ];
  });
  if (!available.length) return null;
  let weighted = 0;
  let totalWeight = 0;
  for (const item of available) {
    const weight = roleWeight(context, item.role);
    if (weight <= 0) continue;
    weighted += item.percent * weight;
    totalWeight += weight;
  }
  if (!totalWeight) {
    return (
      available.reduce((sum, item) => sum + item.percent, 0) / available.length
    );
  }
  return weighted / totalWeight;
}

function averageScoreForRows(rows: PdfScoreRow[], context: PdfScoreContext) {
  let weighted = 0;
  let totalWeight = 0;
  for (const row of rows) {
    const percent = combinedScorePercent(row.content, context);
    if (percent == null) continue;
    const weight = Math.max(
      numberValue(row.content.weightPercent ?? row.content.weight, 1),
      0.0001,
    );
    weighted += percent * weight;
    totalWeight += weight;
  }
  return totalWeight
    ? (weighted / totalWeight / 100) * scoreMaximumForRows(rows)
    : null;
}

function scoreMaximumForRows(rows: PdfScoreRow[]) {
  const maxima = Array.from(
    new Set(rows.map((row) => maximumForMethod(row.content.scoringMethod))),
  );
  // Chỉ quy đổi về /10 khi cùng một nhóm thật sự trộn nhiều thang điểm.
  return maxima.length === 1 ? maxima[0] : 10;
}

function formatScore(value: number | null, maximum = 10) {
  if (value == null || !Number.isFinite(value)) return "Chưa chấm";
  return `${Math.round(value * 100) / 100}/${maximum}`;
}

function formatDecisionMeta(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function scoreCell(content: Record<string, unknown>, context: PdfScoreContext) {
  const entries = SCORE_ROLES.filter(({ scoreKey }) =>
    nonEmpty(content[scoreKey]),
  );
  if (!entries.length) {
    return { color: "#8a9a95", italics: true, text: "Chưa chấm" };
  }
  const combined = combinedScorePercent(content, context);
  const maximum = maximumForMethod(content.scoringMethod);
  return {
    stack: [
      ...(combined == null
        ? []
        : [
            {
              bold: true,
              color: "#b65322",
              margin: [0, 0, 0, 3],
              text: `Tổng hợp ${formatScore(
                (combined / 100) * maximum,
                maximum,
              )}`,
            },
          ]),
      ...entries.map(({ label, scoreKey }) => ({
        margin: [0, 0, 0, 2],
        text: [
          { color: "#60736e", fontSize: 7, text: `${label} ` },
          {
            bold: true,
            color: "#114c41",
            text: `${text(content[scoreKey])}/${maximumForMethod(content.scoringMethod)}`,
          },
        ],
      })),
    ],
  };
}

function commentCell(content: Record<string, unknown>) {
  const entries = SCORE_ROLES.filter(({ commentKey }) =>
    nonEmpty(content[commentKey]),
  );
  if (!entries.length) return { color: "#9aa8a4", text: "—" };
  return {
    stack: entries.map(({ commentKey, label }) => ({
      margin: [0, 0, 0, 3],
      text: [
        { bold: true, color: "#60736e", fontSize: 7, text: `${label}: ` },
        { text: text(content[commentKey]) },
      ],
    })),
  };
}

function criteriaTable(rows: PdfScoreRow[], context: PdfScoreContext) {
  const maxima = Array.from(
    new Set(rows.map((row) => maximumForMethod(row.content.scoringMethod))),
  );
  const averageHeading =
    maxima.length === 1 ? `Điểm TB /${maxima[0]}` : "Điểm TB";
  const roles = SCORE_ROLES.filter(({ role, scoreKey }) =>
    rows.some(
      (row) =>
        roleIsAllowed(row.content, role) && nonEmpty(row.content[scoreKey]),
    ),
  );
  return {
    fontSize: 7.4,
    layout: subtleTableLayout,
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      widths: [18, "*", ...roles.map(() => 42), 48, 130],
      body: [
        [
          { bold: true, color: "#114c41", text: "STT" },
          { bold: true, color: "#114c41", text: "Tiêu chí" },
          ...roles.map(({ label }) => ({
            bold: true,
            color: "#114c41",
            text: label,
          })),
          { bold: true, color: "#114c41", text: averageHeading },
          { bold: true, color: "#114c41", text: "Nhận xét" },
        ],
        ...rows.map((row, index) => [
          { text: String(index + 1) },
          {
            bold: true,
            text: text(row.content.criteriaName || row.name || "Tiêu chí"),
          },
          ...roles.map(({ role, scoreKey }) => ({
            text:
              roleIsAllowed(row.content, role) &&
              nonEmpty(row.content[scoreKey])
                ? `${text(row.content[scoreKey])}/${maximumForMethod(row.content.scoringMethod)}`
                : "--",
          })),
          {
            bold: true,
            text: formatScore(
              combinedScorePercent(row.content, context) == null
                ? null
                : (combinedScorePercent(row.content, context)! / 100) *
                    maximumForMethod(row.content.scoringMethod),
              maximumForMethod(row.content.scoringMethod),
            ),
          },
          commentCell(row.content),
        ]),
      ],
    },
  };
}

function activityTable(
  groupName: string,
  activities: Array<{
    activity: string;
    expected: string;
    rows: PdfScoreRow[];
  }>,
  context: PdfScoreContext,
) {
  return {
    stack: [
      {
        fontSize: 9.2,
        layout: {
          hLineWidth: () => 0,
          paddingBottom: () => 7,
          paddingLeft: () => 7,
          paddingRight: () => 7,
          paddingTop: () => 7,
          vLineWidth: () => 0,
        },
        margin: [0, 0, 0, 5],
        table: {
          widths: ["*"],
          body: [
            [
              {
                bold: true,
                color: "#114c41",
                fillColor: "#e9f4f0",
                text: groupName,
              },
            ],
          ],
        },
      },
      ...activities.map((activity, activityIndex) => ({
        fontSize: 7.6,
        layout: {
          fillColor: (rowIndex: number) =>
            rowIndex < 2
              ? "#f0f7f4"
              : rowIndex % 2
                ? "#ffffff"
                : "#f8fbfa",
          hLineColor: () => "#d8e4e0",
          hLineWidth: (rowIndex: number) => (rowIndex ? 0.65 : 0),
          paddingBottom: () => 7,
          paddingLeft: () => 7,
          paddingRight: () => 7,
          paddingTop: () => 7,
          vLineWidth: () => 0,
        },
        margin: [0, activityIndex ? 6 : 0, 0, 0],
        table: {
          dontBreakRows: true,
          // Lặp tên công việc và tiêu đề cột khi khối tiêu chí chạy qua trang mới.
          headerRows: 2,
          keepWithHeaderRows: 1,
          widths: [28, "*", 88, 130],
          body: [
            [
              {
                colSpan: 4,
                fillColor: "#eef6f3",
                stack: [
                  {
                    columns: [
                      {
                        stack: [
                          {
                            bold: true,
                            color: "#183f37",
                            fontSize: 8.4,
                            text: activity.activity,
                          },
                          ...(activity.expected &&
                          activity.expected !== activity.activity
                            ? [
                                {
                                  color: "#70817c",
                                  fontSize: 7,
                                  margin: [0, 4, 0, 0],
                                  text: `Đầu ra: ${activity.expected}`,
                                },
                              ]
                            : []),
                        ],
                        width: "*",
                      },
                      {
                        alignment: "right",
                        stack: [
                          {
                            bold: true,
                            color: "#a76332",
                            fontSize: 6.7,
                            text: "ĐIỂM TB",
                          },
                          {
                            bold: true,
                            color: "#b65322",
                            fontSize: 8.4,
                            margin: [0, 2, 0, 0],
                            text: formatScore(
                              averageScoreForRows(activity.rows, context),
                              scoreMaximumForRows(activity.rows),
                            ),
                          },
                        ],
                        width: 58,
                      },
                    ],
                  },
                ],
              },
              {},
              {},
              {},
            ],
            [
              { bold: true, color: "#60736e", text: "STT" },
              { bold: true, color: "#114c41", text: "Tiêu chí thuộc công việc" },
              { bold: true, color: "#114c41", text: "Điểm" },
              { bold: true, color: "#114c41", text: "Nhận xét" },
            ],
            ...activity.rows.map((row, rowIndex) => [
              {
                alignment: "center",
                color: "#60736e",
                text: `${rowIndex + 1}/${activity.rows.length}`,
              },
              {
                bold: true,
                text: text(row.content.criteriaName || row.name || "Tiêu chí"),
              },
              scoreCell(row.content, context),
              commentCell(row.content),
            ]),
          ],
        },
      })),
    ],
  };
}

function scoreBarChart(title: string, items: PdfChartItem[]) {
  const scoredItems = items.filter((item) => item.score != null);
  return {
    margin: [0, 0, 0, 8],
    stack: [
      {
        bold: true,
        color: "#114c41",
        fillColor: "#eef6f3",
        fontSize: 8.4,
        margin: [0, 0, 0, 4],
        text: title,
      },
      ...(scoredItems.length
        ? [
            {
              layout: {
                hLineWidth: () => 0,
                paddingBottom: () => 3,
                paddingLeft: () => 3,
                paddingRight: () => 3,
                paddingTop: () => 3,
                vLineWidth: () => 0,
              },
              table: {
                widths: ["42%", "*", 48],
                body: scoredItems.map((item) => {
                  const percent = Math.max(
                    0,
                    Math.min(100, (item.score! / item.maximum) * 100),
                  );
                  return [
                    {
                      bold: true,
                      color: "#294942",
                      fontSize: 7.4,
                      text: item.label,
                    },
                    {
                      canvas: [
                        {
                          color: "#e1e9e6",
                          h: 7,
                          r: 3.5,
                          type: "rect",
                          w: 205,
                          x: 0,
                          y: 3,
                        },
                        {
                          color:
                            percent >= 80
                              ? "#228162"
                              : percent >= 60
                                ? "#d99a32"
                                : "#d06b2a",
                          h: 7,
                          r: 3.5,
                          type: "rect",
                          w: Math.max(2, (205 * percent) / 100),
                          x: 0,
                          y: 3,
                        },
                      ],
                    },
                    {
                      alignment: "right",
                      bold: true,
                      color: "#114c41",
                      text: formatScore(item.score, item.maximum),
                    },
                  ];
                }),
              },
            },
          ]
        : [
            {
              color: "#84928e",
              fillColor: "#f7faf9",
              italics: true,
              margin: [5, 5, 5, 5],
              text: "Chưa có điểm để dựng biểu đồ.",
            },
          ]),
    ],
  };
}

function sectionContent(
  section: ReturnType<
    typeof groupEvaluationWorkspaceScores<PdfScoreRow>
  >[number],
  index: number,
  context: PdfScoreContext,
) {
  const heading = {
    columns: [
      {
        stack: [
          {
            bold: true,
            color: "#b65322",
            fontSize: 7.2,
            characterSpacing: 1,
            text: `${romanNumeral(index + 1)}. KẾT QUẢ ${section.name.toLocaleUpperCase("vi")}`,
          },
          { bold: true, color: "#114c41", fontSize: 13, text: section.name },
        ],
      },
      section.weightPercent
        ? {
            alignment: "right",
            bold: true,
            color: "#b65322",
            fontSize: 9,
            text: `${section.weightPercent}%`,
            width: 46,
          }
        : { text: "", width: 0 },
    ],
    margin: [0, index ? 14 : 2, 0, 7],
    ...(index ? { pageBreak: "before" as const } : {}),
  };

  const charts = section.groups.map((group) => {
    const items =
      section.contentMode === "jd_dynamic"
        ? group.activities.map((activity) => ({
            label: activity.activity,
            maximum: scoreMaximumForRows(activity.rows),
            score: averageScoreForRows(activity.rows, context),
          }))
        : group.activities
            .flatMap((activity) => activity.rows)
            .map((row) => ({
              label: text(row.content.criteriaName || row.name || "Tiêu chí"),
              maximum: scoreMaximumForRows([row]),
              score: averageScoreForRows([row], context),
            }));
    return scoreBarChart(group.name, items);
  });

  const groups = section.groups.map((group) => {
    if (section.contentMode !== "jd_dynamic") {
      const rows = group.activities.flatMap((activity) => activity.rows);
      return {
        margin: [0, 0, 0, 8],
        stack: [
          ...(section.groups.length > 1
            ? [
                {
                  bold: true,
                  color: "#114c41",
                  fillColor: "#eef6f3",
                  fontSize: 9,
                  margin: [0, 0, 0, 4],
                  text: group.name,
                },
              ]
            : []),
          criteriaTable(rows, context),
        ],
      };
    }
    return {
      margin: [0, 0, 0, 9],
      stack: [activityTable(group.name, group.activities, context)],
    };
  });

  const sectionRows = section.groups.flatMap((group) =>
    group.activities.flatMap((activity) => activity.rows),
  );

  return {
    stack: [
      heading,
      {
        bold: true,
        color: "#114c41",
        fontSize: 9,
        margin: [0, 0, 0, 8],
        text: `Điểm trung bình nhóm: ${formatScore(
          averageScoreForRows(sectionRows, context),
          scoreMaximumForRows(sectionRows),
        )}`,
      },
      {
        bold: true,
        color: "#b65322",
        fontSize: 7.2,
        characterSpacing: 0.8,
        margin: [0, 0, 0, 5],
        text: "TỔNG QUAN ĐIỂM",
      },
      ...charts,
      {
        bold: true,
        color: "#b65322",
        fontSize: 7.2,
        characterSpacing: 0.8,
        margin: [0, 3, 0, 5],
        text: "ĐIỂM VÀ NHẬN XÉT CHI TIẾT",
      },
      ...groups,
    ],
  };
}

function evaluationInstanceReferences(
  instanceId: string,
  content: Record<string, unknown>,
) {
  return new Set(
    [instanceId, content.id, content.instanceId, content.evaluationInstanceId]
      .map(text)
      .filter(Boolean),
  );
}

function bodDecisionLabel(value: unknown) {
  const decision = text(value).toLowerCase();
  if (decision === "accepted") return "Chấp nhận";
  if (decision === "adjustment") return "Yêu cầu điều chỉnh";
  if (decision === "rejected") return "Từ chối";
  return text(value) || "Chưa có ý kiến";
}

function decisionPanel(options: {
  accent: string;
  background: string;
  body: string;
  meta?: string;
  title: string;
  value: string;
}) {
  return {
    fillColor: options.background,
    layout: {
      hLineWidth: () => 0,
      paddingBottom: () => 10,
      paddingLeft: () => 12,
      paddingRight: () => 12,
      paddingTop: () => 10,
      vLineColor: () => options.accent,
      vLineWidth: (index: number) => (index === 0 ? 4 : 0),
    },
    margin: [0, 10, 0, 0],
    table: {
      widths: ["*"],
      body: [
        [
          {
            stack: [
              {
                bold: true,
                characterSpacing: 1,
                color: options.accent,
                fontSize: 7.4,
                text: options.title,
              },
              {
                bold: true,
                color: "#173e36",
                fontSize: 11.5,
                margin: [0, 4, 0, 0],
                text: options.value,
              },
              ...(options.body
                ? [
                    {
                      color: "#344b45",
                      margin: [0, 5, 0, 0],
                      text: options.body,
                    },
                  ]
                : []),
              ...(options.meta
                ? [
                    {
                      color: "#71817c",
                      fontSize: 7.2,
                      margin: [0, 5, 0, 0],
                      text: options.meta,
                    },
                  ]
                : []),
            ],
          },
        ],
      ],
    },
  };
}

function resultDate(value: unknown) {
  return formatEvaluationTemplateAnswer(value, "date") || "Chưa có";
}

function evaluationContractSummary(
  instanceContent: JsonRecord,
  resultContent: JsonRecord,
) {
  const cnbAnswers = {
    ...asRecord(instanceContent.cnbConclusionAnswers),
    ...asRecord(resultContent.cnbConclusionAnswers),
  };
  const contractStart =
    cnbAnswers.CONTRACT_START_DATE ||
    instanceContent.contractStartDate ||
    instanceContent.employmentContractStartDate;
  const contractEnd =
    cnbAnswers.CONTRACT_END_DATE ||
    instanceContent.contractEndDate ||
    instanceContent.employmentContractEndDate;
  const contractDuration =
    cnbAnswers.CONTRACT_DURATION ||
    cnbAnswers.CONTRACT_TERM ||
    instanceContent.contractDuration;
  return (
    formatEvaluationTemplateAnswer(contractDuration, "duration") ||
    text(instanceContent.contractTerm) ||
    (contractStart || contractEnd
      ? `${resultDate(contractStart)} - ${resultDate(contractEnd)}`
      : "Chưa có")
  );
}

function signatureRows(input: EvaluationResultPdfInput) {
  const content = input.instanceContent;
  const result = input.resultContent || {};
  const assignments = evaluationReviewAssignments(content);
  const byRole = (role: string) =>
    assignments
      .filter((assignment) => assignment.role === role)
      .sort(
        (left, right) =>
          left.stageIndex - right.stageIndex ||
          left.stepIndex - right.stepIndex,
      );
  const preferredAssignment = (role: string, employeeCode = "") => {
    const rows = byRole(role);
    if (!rows.length) return null;
    const exact = employeeCode
      ? rows.find(
          (assignment) =>
            assignment.employeeCode.toLowerCase() === employeeCode.toLowerCase(),
        )
      : null;
    if (exact) return exact;
    const submitted = rows.filter(
      (assignment) => assignment.status === "submitted",
    );
    return submitted[submitted.length - 1] || rows[rows.length - 1];
  };
  const departmentHead = preferredAssignment(
    "indirect_manager",
    text(content.departmentHeadEmployeeCode),
  );
  const signatureRoles = [
    {
      assignment: preferredAssignment("self"),
      hideName: false,
      label: "Nhân viên",
      legacyName: content.employeeName,
    },
    {
      assignment: preferredAssignment("manager"),
      hideName: false,
      label: "Quản lý trực tiếp",
      legacyName: content.managerName,
    },
    {
      assignment: departmentHead,
      hideName: true,
      label: "Trưởng bộ phận / phòng ban",
      legacyName: content.indirectManagerName,
    },
    {
      assignment: preferredAssignment("bod"),
      hideName: true,
      label: "Giám đốc",
      legacyName: content.bodName,
    },
    {
      assignment: preferredAssignment("hr"),
      hideName: true,
      label: "Bộ phận Nhân sự",
      legacyName: result.finalizedBy || content.finalizedBy || content.hrName,
    },
  ];
  return signatureRoles.map((row, index) => [
    { alignment: "center", text: String(index + 1) },
    { bold: true, text: row.label },
    {
      stack: [
        {
          color: "#60736e",
          fontSize: 7,
          italics: true,
          text: "Ký, ghi rõ họ tên",
        },
        {
          margin: [0, 32, 0, 5],
          text: row.hideName
            ? "................................"
            : text(row.assignment?.employeeName || row.legacyName) ||
              "................................",
        },
        {
          color: "#60736e",
          fontSize: 7,
          text: "Ngày ...... / ...... / ............",
        },
      ],
    },
  ]);
}

function conclusionRows(input: EvaluationResultPdfInput) {
  const content = input.instanceContent;
  const result = input.resultContent || {};
  const answers = asRecord(content.decisionAnswers);
  const optionReferences = new Set(
    [
      ...(input.decisionOptionReferences || []),
      result.decisionOptionId || content.decisionOptionId,
      result.decisionOptionCode || content.decisionOptionCode,
    ]
      .map(text)
      .filter(Boolean),
  );
  type ConclusionRoleRow = {
    assignmentId?: string;
    assignmentComment?: string;
    hideName: boolean;
    label: string;
    name: unknown;
    prefix: string;
    role: string;
  };
  const legacyRoleRows: ConclusionRoleRow[] = [
    {
      role: "self",
      label: "Nhân viên",
      prefix: "employee",
      name: content.employeeName,
      hideName: false,
    },
    {
      role: "manager",
      label: "Quản lý trực tiếp",
      prefix: "manager",
      name: content.managerName,
      hideName: false,
    },
    {
      role: "indirect_manager",
      label: "Trưởng bộ phận / phòng ban",
      prefix: "indirectManager",
      name: content.indirectManagerName,
      hideName: true,
    },
    {
      role: "bod",
      label: "Giám đốc",
      prefix: "bod",
      name: content.bodName,
      hideName: true,
    },
    {
      role: "hr",
      label: "Bộ phận Nhân sự",
      prefix: "hr",
      name: result.finalizedBy || content.finalizedBy || content.hrName,
      hideName: true,
    },
  ];
  const assignmentRoleLabels: Record<string, string> = {
    bod: "Giám đốc",
    hr: "Bộ phận Nhân sự",
    indirect_manager: "Trưởng bộ phận / phòng ban",
    manager: "Quản lý trực tiếp",
    peer: "Đồng nghiệp",
    self: "Nhân viên",
  };
  const reviewAssignments = evaluationReviewAssignments(content);
  const roleRows: ConclusionRoleRow[] = reviewAssignments.length
    ? [
        ...reviewAssignments.map((assignment) => ({
          assignmentComment: assignment.overallComment,
          assignmentId: assignment.id,
          hideName: ["bod", "hr", "indirect_manager"].includes(
            assignment.role,
          ),
          label: `${assignmentRoleLabels[assignment.role] || assignment.role}${
            assignment.stepLabel ? ` · ${assignment.stepLabel}` : ""
          }`,
          name: assignment.employeeName,
          prefix:
            assignment.role === "self"
              ? "employee"
              : assignment.role === "indirect_manager"
                ? "indirectManager"
                : assignment.role,
          role: assignment.role,
        })),
        legacyRoleRows[legacyRoleRows.length - 1],
      ]
    : legacyRoleRows;
  return roleRows.map((row, index) => {
    const assignmentAnswers = asRecord(
      asRecord(content.assignmentDecisionAnswers)[row.assignmentId || ""],
    );
    const roleAnswers =
      row.role === "hr"
        ? {
            ...asRecord(answers.hr),
            ...asRecord(content.cnbConclusionAnswers),
            ...asRecord(result.cnbConclusionAnswers),
          }
        : row.assignmentId
          ? assignmentAnswers
          : asRecord(answers[row.role]);
    const body: Array<{
      margin?: number[];
      stack: Array<{
        bold?: boolean;
        color: string;
        fontSize?: number;
        margin?: number[];
        text: string;
      }>;
    }> = [];
    const addEntry = (label: string, value: unknown) => {
      const answer = text(value).normalize("NFC");
      if (!answer) return;
      body.push({
        margin: body.length ? [0, 7, 0, 0] : undefined,
        stack: [
          {
            bold: true,
            color: "#405a53",
            fontSize: 7.2,
            text: label.normalize("NFC"),
          },
          {
            color: "#173f36",
            margin: [0, 2, 0, 0],
            text: answer,
          },
        ],
      });
    };
    const decision = ["bod", "indirect_manager"].includes(row.role)
      ? (!row.assignmentId ? content[`${row.prefix}Decision`] : "") ||
        roleAnswers[
          row.role === "bod" ? "BOD_DECISION" : "INDIRECT_MANAGER_DECISION"
        ]
      : "";
    if (decision) addEntry("Kết luận", bodDecisionLabel(decision));
    if (row.role === "hr")
      addEntry(
        "Kết quả cuối",
        result.decisionOptionLabel || content.decisionOptionLabel,
      );
    const orderedFields = (input.decisionFields || [])
      .map((field, fieldIndex) => ({ field, fieldIndex }))
      .sort((left, right) => {
        const leftOrder = Number(left.field.content.sortOrder);
        const rightOrder = Number(right.field.content.sortOrder);
        const leftRank = Number.isFinite(leftOrder)
          ? leftOrder
          : Number.MAX_SAFE_INTEGER;
        const rightRank = Number.isFinite(rightOrder)
          ? rightOrder
          : Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank || left.fieldIndex - right.fieldIndex;
      })
      .map(({ field }) => field);
    for (const field of orderedFields) {
      if (
        normalizeRole(field.content.role || field.content.answerRole) !==
        row.role
      )
        continue;
      if (row.role === "hr") {
        const fieldOptions = [
          field.content.decisionOptionId,
          field.content.decisionOptionCode,
          field.content.conclusionId,
          field.content.conclusionCode,
        ]
          .map(text)
          .filter(Boolean);
        if (
          fieldOptions.length &&
          !fieldOptions.some((option) => optionReferences.has(option))
        )
          continue;
      }
      if (!evaluationDecisionFieldIsVisible(field.content, roleAnswers))
        continue;
      const value =
        roleAnswers[field.code] ??
        roleAnswers[field.id] ??
        roleAnswers[text(field.content.id)] ??
        roleAnswers[text(field.content.decisionFieldId)];
      if (!nonEmpty(value)) continue;
      const label = evaluationDecisionQuestionText(
        field.content,
        text(field.content.label || field.name || field.code),
      );
      addEntry(
        label,
        formatEvaluationTemplateAnswer(
          value,
          text(field.content.fieldType || field.content.type),
        ),
      );
    }
    const comment =
      row.role === "hr"
        ? text(result.hrComment || content.hrComment)
        : text(
            row.assignmentComment ||
              (!row.assignmentId
                ? content[`${row.prefix}OverallComment`] ||
                  content[`${row.prefix}Feedback`]
                : "") ||
              roleAnswers[
                row.role === "bod"
                  ? "BOD_FEEDBACK"
                  : row.role === "indirect_manager"
                    ? "INDIRECT_MANAGER_FEEDBACK"
                    : ""
              ],
          );
    if (comment) addEntry("Nhận xét chung", comment);
    return [
      { alignment: "center", text: String(index + 1) },
      { bold: true, text: row.label },
      {
        stack: body.length
          ? body
          : [{ color: "#60736e", text: "Chưa có nội dung kết luận." }],
      },
      {
        stack: [
          {
            color: "#60736e",
            fontSize: 7,
            italics: true,
            text: "Ký, ghi rõ họ tên",
          },
          {
            margin: [0, 32, 0, 5],
            text: row.hideName
              ? "................................"
              : text(row.name) || "................................",
          },
          {
            color: "#60736e",
            fontSize: 7,
            text: "Ngày ...... / ...... / ............",
          },
        ],
      },
    ];
  });
}

export function buildEvaluationResultPdfDefinition(
  input: EvaluationResultPdfInput,
) {
  const instanceContent = input.instanceContent;
  const resultContent = input.resultContent || {};
  const finalScore = numberValue(
    resultContent.finalScore ?? instanceContent.finalScore,
    Number.NaN,
  );
  const sections = groupEvaluationWorkspaceScores(input.scores);
  const conclusion = text(
    resultContent.decisionOptionLabel ||
      instanceContent.decisionOptionLabel ||
      "Chưa kết luận",
  );
  const isDraft =
    !Number.isFinite(finalScore) ||
    !(
      ["finalized", "completed"].includes(
        text(instanceContent.status).toLowerCase(),
      ) ||
      nonEmpty(
        resultContent.finalizedAt ||
          instanceContent.finalizedAt ||
          instanceContent.completedAt,
      )
    );
  const scoreContext: PdfScoreContext = {
    aggregationMode: text(instanceContent.scoreAggregationMode) || "equal",
    roleWeights: asRecord(instanceContent.roleScoreWeights),
  };
  const contractTerm = evaluationContractSummary(
    instanceContent,
    resultContent,
  );
  return {
    content: [
      {
        columns: [
          {
            stack: [
              {
                bold: true,
                color: "#114c41",
                fontSize: 16,
                text: `KẾT QUẢ ${text(instanceContent.cycleTypeName || instanceContent.evaluationTypeName || "ĐÁNH GIÁ NHÂN SỰ").toLocaleUpperCase("vi")}`,
              },
              {
                color: "#6f7f7a",
                fontSize: 8,
                margin: [0, 3, 0, 0],
                text: "Cổng vận hành Thuần Việt",
              },
            ],
          },
          {
            layout: {
              hLineWidth: () => 0,
              paddingBottom: () => 8,
              paddingLeft: () => 9,
              paddingRight: () => 9,
              paddingTop: () => 8,
              vLineWidth: () => 0,
            },
            table: {
              widths: [isDraft ? 116 : 62],
              body: [
                [
                  {
                    alignment: "center",
                    bold: true,
                    color: isDraft ? "#a76332" : "#ffffff",
                    fillColor: isDraft ? "#fff2e8" : "#114c41",
                    fontSize: isDraft ? 8 : 15,
                    text: isDraft
                      ? "BẢN NHÁP · CHƯA CHẤM XONG"
                      : `${finalScore}/10`,
                  },
                ],
              ],
            },
            width: isDraft ? 134 : 80,
          },
        ],
        margin: [0, 0, 0, 13],
      },
      {
        bold: true,
        color: "#114c41",
        fontSize: 10,
        margin: [0, 0, 0, 7],
        text: "I. THÔNG TIN CHUNG",
      },
      {
        fillColor: "#f3f7f5",
        layout: {
          hLineWidth: () => 0,
          paddingBottom: () => 7,
          paddingLeft: () => 9,
          paddingRight: () => 9,
          paddingTop: () => 7,
          vLineWidth: () => 0,
        },
        margin: [0, 0, 0, 11],
        table: {
          widths: [70, "*", 70, "*"],
          body: [
            [
              { bold: true, color: "#60736e", text: "Nhân sự" },
              {
                bold: true,
                text: text(
                  instanceContent.employeeName || input.instanceName || "—",
                ),
              },
              { bold: true, color: "#60736e", text: "Mã nhân sự" },
              text(instanceContent.employeeCode || "—"),
            ],
            [
              { bold: true, color: "#60736e", text: "Kỳ đánh giá" },
              text(instanceContent.cycleName || "—"),
              { bold: true, color: "#60736e", text: "Chức danh" },
              text(
                instanceContent.jobTitleName ||
                  instanceContent.jdJobTitleName ||
                  "Chưa có",
              ),
            ],
            [
              { bold: true, color: "#60736e", text: "Phòng ban" },
              text(
                instanceContent.departmentName ||
                  instanceContent.department ||
                  "Chưa có",
              ),
              { bold: true, color: "#60736e", text: "Thời hạn hợp đồng" },
              contractTerm,
            ],
            [
              { bold: true, color: "#60736e", text: "Quản lý trực tiếp" },
              text(
                instanceContent.managerName ||
                  instanceContent.managerEmployeeCode ||
                  "Chưa có",
              ),
              { bold: true, color: "#60736e", text: "Ngày hoàn thành" },
              isDraft
                ? "Chưa hoàn thành"
                : resultDate(
                    resultContent.finalizedAt ||
                      instanceContent.finalizedAt ||
                      instanceContent.completedAt,
                  ),
            ],
            [
              { bold: true, color: "#60736e", text: "Kết luận" },
              { bold: true, color: "#114c41", text: conclusion },
              { bold: true, color: "#60736e", text: "Trạng thái" },
              isDraft ? "Đang đánh giá" : "Đã hoàn tất",
            ],
          ],
        },
      },
      ...(sections.length
        ? sections.map((section, index) =>
            sectionContent(section, index, scoreContext),
          )
        : [
            {
              color: "#70817c",
              italics: true,
              margin: [0, 18, 0, 0],
              text: "Phiếu chưa có tiêu chí đánh giá để tổng hợp.",
            },
          ]),
      {
        pageBreak: "before" as const,
        bold: true,
        color: "#114c41",
        fontSize: 11,
        margin: [0, 0, 0, 10],
        text: `${romanNumeral(sections.length + 1)}. KÝ XÁC NHẬN`,
      },
      {
        fontSize: 8,
        layout: subtleTableLayout,
        table: {
          headerRows: 1,
          keepWithHeaderRows: 1,
          widths: [24, "*", 150],
          body: [
            ["STT", "Đối tượng", "Ký xác nhận"].map(
              (label) => ({ bold: true, color: "#114c41", text: label }),
            ),
            ...signatureRows(input),
          ],
        },
      },
    ],
    defaultStyle: {
      color: "#1d312d",
      font: "Roboto",
      fontSize: 8,
      lineHeight: 1.12,
    },
    footer: (currentPage: number, pageCount: number) => ({
      alignment: "right",
      color: "#7a8985",
      fontSize: 7,
      margin: [24, 0, 24, 0],
      text: `Trang ${currentPage}/${pageCount}`,
    }),
    pageMargins: [24, 24, 24, 24],
    pageOrientation: "portrait" as const,
    pageSize: "A4",
  };
}

export async function createEvaluationResultPdfBuffer(
  input: EvaluationResultPdfInput,
) {
  const definition = buildEvaluationResultPdfDefinition(input);
  const buffer = await pdfmake.createPdf(definition).getBuffer();
  const fileName = `Ket-qua-danh-gia-${text(
    input.instanceContent.employeeCode || input.instanceName,
  )}.pdf`.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_");
  return { buffer, fileName };
}

export async function buildEvaluationResultPdf(instanceId: string) {
  const db = getDb();
  const instance = await findEvaluationRecordByIdentifier(
    "evaluation-instance",
    instanceId,
  );
  if (!instance) {
    throw new Error("Không tìm thấy phiếu đánh giá cần xuất PDF.");
  }
  const instanceContent = asRecord(instance.content);
  const references = evaluationInstanceReferences(instance.id, instanceContent);
  const scores = (
    await db.evaluationRecord.findMany({
      orderBy: [{ name: "asc" }],
      where: { recordType: "evaluation-criteria-score" },
    })
  )
    .filter((row) => {
      const content = asRecord(row.content);
      return (
        pdfRecordIsActive(row) &&
        [content.instanceId, content.evaluationInstanceId, row.parentId]
          .map(text)
          .some((value) => references.has(value))
      );
    })
    .map((row) => ({
      content: asRecord(row.content),
      id: row.id,
      name: text(row.name),
    }));
  const resultRows = await db.evaluationRecord.findMany({
    orderBy: { updatedAt: "desc" },
    where: { recordType: "evaluation-final-result" },
  });
  const result = resultRows.find((row) => {
    const content = asRecord(row.content);
    return (
      pdfRecordIsActive(row) &&
      [row.parentId, content.instanceId, content.evaluationInstanceId]
        .map(text)
        .some((value) => references.has(value))
    );
  });
  const cycle = await findEvaluationRecordByIdentifier(
    "evaluation-cycle",
    instanceContent.cycleId ||
      instanceContent.evaluationCycleId ||
      instance.parentId,
  );
  const cycleContent = asRecord(cycle?.content);
  const cycleType = await findEvaluationRecordByIdentifier(
    "evaluation-cycle-type-template",
    instanceContent.cycleTypeTemplateId ||
      instanceContent.cycleTypeId ||
      cycleContent.cycleTypeTemplateId ||
      cycleContent.cycleTypeId ||
      instanceContent.cycleTypeCode ||
      cycleContent.cycleTypeCode,
  );
  const typeReferences = new Set(
    [
      ...(cycleType ? evaluationRecordIdentifiers(cycleType) : []),
      instanceContent.cycleTypeTemplateId,
      cycleContent.cycleTypeTemplateId,
      instanceContent.cycleTypeId,
      cycleContent.cycleTypeId,
      instanceContent.cycleTypeCode,
      cycleContent.cycleTypeCode,
    ]
      .map(text)
      .filter(Boolean),
  );
  const decisionReferences = new Set(
    [
      instanceContent.decisionTemplateId,
      cycleContent.decisionTemplateId,
      cycleContent.defaultDecisionTemplateId,
      asRecord(cycleType?.content).decisionTemplateId,
      asRecord(cycleType?.content).defaultDecisionTemplateId,
    ]
      .map(text)
      .filter(Boolean),
  );
  for (const reference of Array.from(decisionReferences)) {
    const template = await findEvaluationRecordByIdentifier(
      "evaluation-decision-template",
      reference,
    );
    if (template)
      evaluationRecordIdentifiers(template).forEach((identifier) =>
        decisionReferences.add(identifier),
      );
  }
  const resultContent = asRecord(result?.content);
  const selectedOption = await findEvaluationRecordByIdentifier(
    "evaluation-decision-option",
    resultContent.decisionOptionId ||
      instanceContent.decisionOptionId ||
      resultContent.decisionOptionCode ||
      instanceContent.decisionOptionCode,
  );
  const [fields, values] = await Promise.all([
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-decision-field" },
      orderBy: { createdAt: "asc" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-decision-value" },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const scopedFields = fields
    .filter((field) => {
      if (!pdfRecordIsActive(field)) return false;
      const content = asRecord(field.content);
      const typeKey = text(
        content.cycleTypeTemplateId ||
          content.cycleTypeId ||
          content.cycleTypeCode,
      );
      const decisionKey = text(content.decisionTemplateId);
      if (typeKey && !typeReferences.has(typeKey)) return false;
      if (
        decisionKey &&
        !decisionReferences.has(decisionKey) &&
        !typeReferences.has(decisionKey)
      )
        return false;
      return (
        !field.parentId ||
        typeReferences.has(field.parentId) ||
        decisionReferences.has(field.parentId)
      );
    })
    .sort(
      (left, right) =>
        numberValue(asRecord(left.content).sortOrder) -
        numberValue(asRecord(right.content).sortOrder),
    );
  const answers = Object.fromEntries(
    Object.entries(asRecord(instanceContent.decisionAnswers)).map(
      ([role, value]) => [role, { ...asRecord(value) }],
    ),
  );
  for (const value of values.filter(pdfRecordIsActive)) {
    const content = asRecord(value.content);
    if (
      ![value.parentId, content.instanceId, content.evaluationInstanceId]
        .map(text)
        .some((id) => references.has(id))
    )
      continue;
    const field = scopedFields.find((candidate) => {
      const keys = evaluationRecordIdentifiers(candidate);
      return [content.fieldId, content.decisionFieldId, content.fieldCode]
        .map(text)
        .some((id) => keys.includes(id));
    });
    if (!field) continue;
    const fieldContent = asRecord(field.content);
    const role = normalizeRole(
      content.role || fieldContent.role || fieldContent.answerRole,
    );
    const code = text(
      fieldContent.code || fieldContent.fieldCode || field.code || field.id,
    );
    answers[role] ||= {};
    // The instance snapshot is the most recent review; persisted legacy values are fallback only.
    if (!Object.prototype.hasOwnProperty.call(answers[role], code))
      answers[role][code] = content.value ?? content.fieldValue ?? "";
  }
  return createEvaluationResultPdfBuffer({
    decisionFields: scopedFields.map((field) => ({
      id: field.id,
      code: text(
        asRecord(field.content).code ||
          asRecord(field.content).fieldCode ||
          field.code ||
          field.id,
      ),
      name: text(field.name),
      content: asRecord(field.content),
    })),
    decisionOptionReferences: selectedOption
      ? evaluationRecordIdentifiers(selectedOption)
      : [],
    instanceContent: { ...instanceContent, decisionAnswers: answers },
    instanceName: text(instance.name),
    resultContent,
    scores,
  });
}

function pdfRecordIsActive(row: { content: unknown; status: string }) {
  const content = asRecord(row.content);
  return (
    !["archived", "deleted", "inactive"].includes(
      text(row.status).toLowerCase(),
    ) &&
    !["archived", "deleted", "inactive"].includes(
      text(content.status).toLowerCase(),
    ) &&
    content.isActive !== false &&
    text(content.isActive).toLowerCase() !== "false"
  );
}
