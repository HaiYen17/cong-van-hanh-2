# Release Cấu hình đánh giá — 03/09/2026

Phạm vi: feedback tab **Phản hồi chung**, từ dòng 44, trên V3/PostgreSQL.

- Domain: https://thuanvietgroup.biz.vn
- Project / region: `tvg-ops-dev` / `asia-southeast1`.
- Service: `cong-van-hanh-web`.
- Revision: `cong-van-hanh-web-eval-conclusion-font-0903-1` — 100% traffic.
- Cloud Build: `7403d877-8f21-4e1e-9278-45aebb41f88c` — SUCCESS.
- Image digest: `sha256:167bdfc02fa7af4040733bf104d9e8ea8e0c66273a634650bf739a344e4b5b58`.
- Revision trước: `cong-van-hanh-web-eval-feedback-0903-1`.

## Nội dung

- PDF A4 đứng, thông tin chung, bảng điểm/nhận xét, 5 đối tượng ký xác nhận theo mẫu.
- Hotfix kết luận: sắp câu hỏi theo `sortOrder`, tách nhãn/câu trả lời thành từng khối và giữ đúng xuống dòng của danh sách; không còn chuỗi `câu hỏi: câu trả lời` bị dính.
- Hotfix Theo dõi: câu trả lời luôn nằm sau câu hỏi; bỏ font Carlito/Arial dán kèm khỏi vùng hiển thị và chuẩn hóa toàn bộ nội dung sang Be Vietnam Pro với weight có sẵn.
- Email kết quả luôn kèm PDF kết quả; giữ các biểu mẫu cấu hình bổ sung. PDF lỗi thì không gửi email thiếu tệp.
- Đồng bộ JD Google Docs/DOCX vào PostgreSQL, hỗ trợ shortcut/Shared Drive/phân trang; giữ phân loại và cấu hình chỉnh tay, chống trùng; không báo tác vụ nền không tồn tại.
- Khối vai trò và workflow nhất quán; quyền xem QLGT; CnB xem câu trả lời trực tiếp trong Theo dõi; giữ ba lựa chọn duyệt QLGT.
- Sửa hai assertion trong test cấp phát đang chặn TypeScript; không thay đổi runtime tài sản.
- Loại `tmp`, `output` và dữ liệu QA khỏi gói upload/build. Không xóa file local.

## Kiểm tra

- TypeScript toàn dự án: PASS.
- Test đánh giá 79/79, quyền 20/20, giao diện 8/8 và cấp phát 3/3: PASS.
- Prebuild: encoding, 46 module, nguồn V3 đánh giá/tuyển dụng, xuất biểu mẫu kế toán, Prisma: PASS.
- Cloud Build thực thi `npm run build` từ root V3: PASS.
- Revision tag trước khi chuyển traffic: 46 card Services, 10 route trọng yếu (gồm Hunonic, máy lạnh, Kho, kiểm kê, đánh giá, tuyển dụng), 2 asset đánh giá đúng SHA-256, RPC cấu hình, PDF thực 71.814 byte: PASS.
- Trình duyệt headless độc lập: Services, cấu hình đánh giá desktop/mobile; không lỗi JavaScript: PASS.
- Quyền Nhân viên trên revision tag: 5/5 route PASS.
- Kiểm tra lại domain chính sau chuyển traffic: PASS (46 card, 10 route, asset hash, RPC, PDF, browser desktop/mobile và 5 route Nhân viên).
- Cloud Run xác nhận revision mới nhận 100% traffic; không có log mức ERROR ở revision này trong lượt kiểm tra.

`scripts/qa-evaluation-release.ts` tạo phiên full quyền tạm và thu hồi trong `finally`. Browser QA khóa thao tác ghi/gửi email; heartbeat presence được thay bằng endpoint GET thật, không đánh dấu tài khoản QA online. `scripts/qa-permission-production.ts` kiểm tra thêm streamed redirect để tránh nhầm HTTP 200 của trang đang chuyển về login là thành công.

QA phải dùng đúng các secret/runtime database của service qua proxy Cloud SQL, giữ nguyên byte của secret; không dùng secret local cũ. Không lưu credential hoặc token vào báo cáo, file nguồn hay ảnh.

Không migrate/repair dữ liệu nghiệp vụ, không gửi email thật, không chạy đồng bộ JD thật. Chưa tự sửa 9 hoạt động JD cũ thiếu nhóm. Scheduler JD tự động chưa được bổ sung; giao diện nói rõ bấm tiếp để xử lý phần còn lại.

## Rollback nếu phát hiện lỗi nghiêm trọng

Xác minh traffic hiện tại trước khi chạy để không đè deployment mới của người khác:

```powershell
gcloud run services update-traffic cong-van-hanh-web --project tvg-ops-dev --region asia-southeast1 --to-revisions cong-van-hanh-web-eval-feedback-0903-1=100
```

Không deploy GAS, không thay baseline để bỏ qua guard.
