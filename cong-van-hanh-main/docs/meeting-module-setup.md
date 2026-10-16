# Thiết lập Module Lịch họp & Đặt phòng

## 1. Google Calendar / Google Meet

- Google Cloud project: `tvg-ops-dev`.
- Calendar API: `calendar-json.googleapis.com`.
- Service account dùng chung Mail Router: `thuan-viet-mail-router@tvg-ops-dev.iam.gserviceaccount.com`.
- OAuth client ID Domain-Wide Delegation: `112696604111770123630`.
- Tài khoản tổ chức mặc định: `admin@nemthuanviet.vn`.
- Scope Workspace cần giữ:
  - `https://www.googleapis.com/auth/gmail.send`
  - `https://www.googleapis.com/auth/calendar.events`

Không tạo hoặc tải service-account JSON key. Cloud Run `cong-van-hanh-web` dùng IAM Credentials `signJwt` và đã được gán `roles/iam.serviceAccountTokenCreator` trên Mail Router service account.

## 2. Recall.ai

Chọn cùng một region khi tạo key và gọi API. Mặc định của hệ thống là Nhật Bản (`ap-northeast-1`) để gần Việt Nam.

1. Mở `https://ap-northeast-1.recall.ai/dashboard/developers/api-keys`.
2. Tạo API key bằng tài khoản dịch vụ của công ty nếu Recall workspace hỗ trợ; không dùng key cá nhân dài hạn.
3. Tạo Workspace Verification Secret (`whsec_...`).
4. Tạo webhook endpoint:
   `https://thuanvietgroup.biz.vn/api/meetings/recall/webhook`
5. Đăng ký các sự kiện bot hiện hành:
   - `bot.joining_call`
   - `bot.in_waiting_room`
   - `bot.in_call_not_recording`
   - `bot.recording_permission_allowed`
   - `bot.recording_permission_denied`
   - `bot.in_call_recording`
   - `bot.call_ended`
   - `bot.done`
   - `bot.fatal`
6. Đăng ký các sự kiện media:
   - `recording.processing`
   - `recording.done`
   - `recording.failed`
   - `recording.deleted`
   - `transcript.processing`
   - `transcript.done`
   - `transcript.failed`
   - `transcript.deleted`
7. Vào `Cấu hình Tổng → Recall.ai`, nhập API key và verification secret đúng một lần. Màn `Cấu hình → Lịch họp` chỉ hiển thị trạng thái kết nối và liên kết về nguồn cấu hình tập trung. Secret được mã hóa trước khi lưu PostgreSQL và không được trả ngược ra trình duyệt.

Bot MVP tham gia Google Meet dưới dạng khách ẩn danh. Người trong phòng phải chấp nhận cho bot vào. Không dùng tài khoản Workspace hiện tại để làm authenticated bot của Recall.

## 3. Gemini

1. Vào `Cấu hình Tổng → AI`, nhập Gemini API key đúng một lần.
2. Giữ model dùng chung là `gemini-3.1-flash-lite` để cân bằng chi phí và chất lượng cho biên bản/todo. Backend ưu tiên `ai.geminiApiKey` và `ai.geminiModel`; các khóa `ai.reviewGemini*` cũ chỉ còn là fallback tương thích.
3. Tài khoản Google AI Studio phải có số dư Prepay dương. Khi hết credits, hệ thống giữ transcript và ghi lỗi rõ ràng để có thể chạy lại, không làm mất dữ liệu cuộc họp.

API key được mã hóa trước khi lưu PostgreSQL và không được trả ngược ra trình duyệt. Bài test tích hợp phải xác nhận biên bản ở trạng thái `DRAFT`, có `generatedByModel = gemini-3.1-flash-lite` và sinh được đầu việc từ transcript mẫu.

## 4. Chính sách lưu trữ tiết kiệm

- Bản ghi âm: Recall tạo mixed MP3, không tạo MP4; mặc định giữ 7 ngày bằng `recording_config.retention` để tránh lưu vô hạn và phí storage. Link tải được lấy mới từ Recall khi chủ cuộc họp mở, không lưu signed URL hết hạn trong PostgreSQL.
- Transcript trong PostgreSQL: mặc định 90 ngày, sau đó xóa `contentText`, segments và speaker map; chỉ giữ metadata trạng thái/checksum.
- Raw webhook payload: xóa sau 30 ngày nếu đã xử lý.
- Biên bản và đầu việc đã duyệt: giữ lại để truy vết nghiệp vụ.
- Không lưu MP4/audio vào PostgreSQL.

Cron retention:

- Route: `/api/cron/meeting-retention`
- Lịch đề xuất: `30 2 * * *`, timezone `Asia/Ho_Chi_Minh`.
- Xác thực bằng `CRON_SECRET` qua `Authorization: Bearer ...` hoặc `x-cron-secret`.

## 5. Kiểm thử nghiệm thu

1. Admin tạo ít nhất hai phòng và đặt buffer trước/sau.
2. Đặt hai lịch trùng phòng: lịch thứ hai phải bị chặn.
3. Đặt lịch trùng người: phải hiện giờ bận nhưng không lộ tên/nội dung cuộc họp; người đặt có thể xác nhận đặt đè.
4. Google Calendar phải tạo event, Google Meet URL và gửi thư mời.
5. Đặt lịch trước ít nhất 10 phút để Recall dùng scheduled bot, tránh phụ thuộc ad-hoc bot pool.
6. Chấp nhận bot vào Google Meet và kiểm tra các trạng thái `WAITING_ROOM`, `IN_CALL`, `COMPLETED`.
7. Sau `transcript.done`, Gemini phải tạo biên bản `DRAFT`.
8. Chủ cuộc họp sửa, duyệt; đầu việc phải xuất hiện trong Module Giao việc đúng theo `assigneeUserId`/`assigneeEmployeeId`.
