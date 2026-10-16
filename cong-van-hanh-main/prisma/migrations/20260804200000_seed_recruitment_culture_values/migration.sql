INSERT INTO "RecruitmentConfigRecord" (
  "id",
  "recordType",
  "code",
  "name",
  "status",
  "sourceSheet",
  "sourceRow",
  "content",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'rec_culture_gt1',
    'recruitment-culture-value',
    'GT1',
    'Làm chủ tương lai',
    'ACTIVE',
    '__POSTGRES_RECRUITMENT_CULTURE__',
    1,
    '{"gtKey":"GT1","gtName":"Làm chủ tương lai","order":1,"chips":[{"code":"GT1_KIENTAO","label":"Tập trung vào giải pháp","order":1},{"code":"GT1_CHUDONG","label":"Chủ động với lời cam kết","order":2},{"code":"GT1_TRACHNHIEM","label":"Nhận trách nhiệm","order":3}]}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'rec_culture_gt2',
    'recruitment-culture-value',
    'GT2',
    'Thắng không kiêu - Bại không nản',
    'ACTIVE',
    '__POSTGRES_RECRUITMENT_CULTURE__',
    2,
    '{"gtKey":"GT2","gtName":"Thắng không kiêu - Bại không nản","order":2,"chips":[{"code":"GT2_KIENGCUONG","label":"Kiên cường","order":1},{"code":"GT2_KHIEMNHUONG","label":"Không kiêu ngạo","order":2}]}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'rec_culture_gt3',
    'recruitment-culture-value',
    'GT3',
    'Chân thành là gốc rễ của mối quan hệ tốt đẹp',
    'ACTIVE',
    '__POSTGRES_RECRUITMENT_CULTURE__',
    3,
    '{"gtKey":"GT3","gtName":"Chân thành là gốc rễ của mối quan hệ tốt đẹp","order":3,"chips":[{"code":"GT3_NOIRA","label":"Nói ra","order":1},{"code":"GT3_KHONGXUYENTAC","label":"Không xuyên tạc","order":2},{"code":"GT3_SUTHAT","label":"Tôn trọng sự thật","order":3}]}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'rec_culture_gt4',
    'recruitment-culture-value',
    'GT4',
    'Thấu hiểu - Chia sẻ - Cùng nhau phát triển',
    'ACTIVE',
    '__POSTGRES_RECRUITMENT_CULTURE__',
    4,
    '{"gtKey":"GT4","gtName":"Thấu hiểu - Chia sẻ - Cùng nhau phát triển","order":4,"chips":[{"code":"GT4_DATMINH","label":"Đặt mình vào vị trí người khác","order":1},{"code":"GT4_LOIICHCHUNG","label":"Vì lợi ích chung","order":2},{"code":"GT4_HAILONG","label":"Hướng tới sự hài lòng","order":3}]}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'rec_culture_gt5',
    'recruitment-culture-value',
    'GT5',
    'Cầu thị - Học hỏi - Để tiến lên',
    'ACTIVE',
    '__POSTGRES_RECRUITMENT_CULTURE__',
    5,
    '{"gtKey":"GT5","gtName":"Cầu thị - Học hỏi - Để tiến lên","order":5,"chips":[{"code":"GT5_LANGNGHE","label":"Lắng nghe","order":1},{"code":"GT5_THICHNGHI","label":"Học để hành","order":2},{"code":"GT5_SANGTAO","label":"Sáng tạo đổi mới","order":3}]}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("sourceSheet", "sourceRow") DO UPDATE SET
  "recordType" = EXCLUDED."recordType",
  "code" = EXCLUDED."code",
  "name" = EXCLUDED."name",
  "status" = EXCLUDED."status",
  "content" = EXCLUDED."content",
  "updatedAt" = CURRENT_TIMESTAMP;
