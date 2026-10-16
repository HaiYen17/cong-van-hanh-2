<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# QUY TẮC SỐ 1 — BÁM SÁT TỪNG CHI TIẾT APP HÀNH CHÍNH CŨ

App này là bản dựng lại của app Google Apps Script "Hành chính" ở
`C:\Users\minht\OneDrive\Desktop\Hành chính`. Mục tiêu: **tái hiện đúng UI và
hành vi bản cũ**, chỉ khác ở nền tảng (Next.js + Postgres) và hiệu năng.

**Trước khi viết / sửa BẤT KỲ module nào, BẮT BUỘC:**

1. **Đọc HẾT** file nguồn bản cũ của module đó — không lướt, không đoán. Điển hình:
   - UI: `*Modal.html` (ví dụ `PermissionModal.html`, `GlobalConfigModal.html`,
     `ConfigModal.html`), và phần markup liên quan.
   - Logic + backend: `AppScripts.html` và các file `.gs` (grep theo tên hàm /
     id phần tử / nhãn tiếng Việt của tính năng).
2. **Liệt kê đầy đủ** mọi tab / trường nhập / nút / cột bảng / trạng thái /
   validation / hành vi đặc biệt của bản cũ, rồi đối chiếu 1-1 với bản v3.
   Đánh dấu CÓ / THIẾU / KHÁC trước khi code.
3. **Không tự ý đơn giản hoá.** Nếu bản cũ có 12 trường thì bản mới phải có đủ
   12 trường (trừ khi user chốt bỏ bớt — ghi rõ lý do). Phản hồi lặp lại của
   user: *"ông lười không đọc hết file"*, *"thiếu rất nhiều"* → đây là lỗi cần
   tránh tuyệt đối.
4. **Folder gốc `Hành chính` chỉ ĐỌC** — tuyệt đối không Edit/Write/xoá. Code
   mới luôn nằm trong `Hành chính v3`.
5. Nếu một tính năng cố ý hoãn (placeholder) → phải do user chốt, và ghi chú rõ
   trong code + báo cáo, không âm thầm bỏ.

Khi đối chiếu module lớn nên fan-out subagent đọc song song bản cũ vs v3 và xuất
danh sách THIẾU/KHÁC.

# QUY TẮC SỐ 2 — DEPLOY KHÔNG ĐƯỢC LÀM MẤT MODULE

Mỗi lần build hoặc deploy V3 bắt buộc bảo toàn toàn bộ module đã có trên màn
Services. Không được deploy từ folder tạm, snapshot cũ hoặc `.next` cũ.

1. Nguồn danh mục hiện hành là `src/lib/legacy-portal-catalog.ts`.
2. Baseline module đã được user chốt nằm tại
   `docs/deploy-module-baseline.json`.
3. Trước build/deploy phải chạy `npm run check:deploy-modules`. Lệnh này kiểm
   tra card, route và page thực thi; thiếu một module là phải dừng deploy.
4. `npm run build` đã tự chạy guard này trong `prebuild`. Không được bỏ qua,
   tắt hoặc sửa baseline chỉ để build qua.
5. Chỉ cập nhật baseline khi user thật sự yêu cầu thêm, đổi route hoặc bỏ
   module. Mọi thay đổi baseline phải đi cùng thay đổi catalog/route tương ứng.
6. Sau deploy phải kiểm tra revision mới nhận 100% traffic, mở Services bằng
   tài khoản có full quyền, kiểm tra card mới/sửa và ít nhất các module trọng
   yếu: Cấu hình (phải còn tab Hunonic), Điều khiển máy lạnh, Cấu hình Kho,
   Kiểm kê Kho, Đánh giá nhân sự, Tuyển dụng và CnB.
7. Nếu smoke test thiếu module hoặc lỗi route, chuyển traffic về revision gần
   nhất đã kiểm chứng; không tiếp tục vá trực tiếp trên production.

# QUY TẮC SỐ 3 — QUYỀN NHÓM VÀ QUYỀN MODULE PHẢI ĐỒNG NHẤT

1. Một `ModuleGroup` được cấp cho vai trò là quyền sử dụng thật đối với mọi
   `AppModule` đang hoạt động trong nhóm, không chỉ là điều kiện hiện thẻ ở Services.
2. Khi dựng session, bắt buộc bung quyền nhóm vào `session.modules` để thẻ Services,
   page guard và server action cùng dùng một kết quả quyền duy nhất.
3. Mọi thay đổi session, vai trò, nhóm module hoặc Cấp quyền phải chạy
   `npm run test:permissions` và `npm run qa:permissions` trước khi deploy.
4. Sau deploy, chạy `npm run qa:permissions:production` để kiểm tra bằng một phiên
   Nhân viên tạm; script phải thu hồi phiên trong `finally` và không được ghi dữ liệu
   nghiệp vụ của người dùng.
