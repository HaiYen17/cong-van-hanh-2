# Đối chiếu khôi phục Phân Xưởng 1:1 — 2026-08-05

## Phạm vi và nguồn chuẩn

- Nguồn giao diện chỉ đọc: `Hành chính - Module lưu trữ/Phan-xuong/*.html` và `Admin-Kho/WorkshopOrderModal.html`.
- Nguồn nghiệp vụ chỉ đọc: các hàm `Workshop*` trong `Hành chính/Code.js`.
- Đích thực thi: Next.js V3, Prisma và PostgreSQL trong `Hành chính v3`.
- Không sửa, push hoặc deploy Google Apps Script.

## Ma trận module

| Module V3 | Nguồn 1:1 | Trường/khối chính | Thao tác và trạng thái | Kết luận trước code |
| --- | --- | --- | --- | --- |
| Cấu hình Xưởng | `WorkshopConfigModal.html` | Tab Nhân sự; tab Nguyên vật liệu; tìm kiếm; SKU, tên SKU, SL SKU, mã/tên/ĐVT/SL NVL | Làm mới, chọn Excel, nạp dữ liệu; popup tiến trình/kết quả | CÓ UI; Nhân sự là placeholder trong nguồn; THIẾU backend V3 |
| Đặt hàng Xưởng | `WorkshopOrderModal.html` | Tuần; catalog theo tên/SKU; biến thể độ dày/kích thước; ngoại cỡ; SL đặt; lý do sửa | Lập/thu nhỏ, thêm/xóa, sửa đơn hiện hữu; Chờ tiếp nhận/Đang xử lý/Hoàn thành | CÓ source 1:1; THIẾU route/RPC/PostgreSQL V3 |
| Kế hoạch Xưởng | `WorkshopAllocationModal.html` | Danh sách đơn; wizard Mút/Cao su → Gối → May; 7 ngày; SL đặt/tổng KH | Tiếp nhận, phân bổ, map May theo BOM, hoàn thành, in NVL tuần | CÓ source 1:1; THIẾU route/RPC/PostgreSQL V3 |
| Phân bổ thủ công | `WorkshopPlanModal.html` | Tuần, tổ; bảng SX và bảo hành; sản phẩm/độ dày/kích thước/SKU; 7 ngày | Nạp đơn nguồn, map phụ thuộc May, thêm ngoại cỡ, nộp kế hoạch | CÓ source 1:1; THIẾU route/RPC/PostgreSQL V3 |
| Duyệt KH Xưởng | `WorkshopPlanApprovalModal.html` | Tuần; thẻ kế hoạch; tổng hợp; bảng 7 ngày; phụ thuộc May; ghi chú | Duyệt, yêu cầu điều chỉnh, từ chối; ghi chú bắt buộc với điều chỉnh/từ chối | CÓ source 1:1; THIẾU route/RPC/PostgreSQL V3 |
| Đề xuất Xưởng | `WorkshopProposalModal.html` | Tuần, ngày, tổ; dòng KH; thay đổi SL; lý do; tổ ảnh hưởng; hướng đề xuất; lịch sử | Đảo ngày hoặc thay hàng; tự thêm Tổ May khi Mút/Cao su bị ảnh hưởng; Chờ duyệt | CÓ source 1:1; THIẾU route/RPC/PostgreSQL V3 |
| Báo cáo Xưởng | `WorkshopReportModal.html` | Tuần, ngày, tổ; KH ngày; SX thực tế; lỗi nhẹ/vừa/nặng; ghi chú | Làm mới và lưu upsert theo dòng/ngày | CÓ source 1:1; THIẾU route/RPC/PostgreSQL V3 |
| Kiểm kê Xưởng | `WorkshopInventoryModal.html` | Tổng lượt kiểm, đã ghi nhận, chênh lệch; bảng; mã NVL, số lượng | Nút làm mới; ô nhập bị khóa và thông báo “sẵn sàng kết nối dữ liệu” | CÓ placeholder chủ ý trong nguồn; giữ đúng 1:1, thêm nền bảng PostgreSQL |

## Hợp đồng RPC phải giữ

`getWorkshopConfigData`, `importWorkshopMaterialsFromExcel`, `getWorkshopOrderPlanData`, `submitWorkshopOrderPlan`, `updateWorkshopOrderPlan`, `getWorkshopAllocationData`, `acceptWorkshopOrder`, `getWorkshopAllocationSewingPlanData`, `submitWorkshopAllocationPlan`, `previewWorkshopAllocationMaterialWeekPrintHtml`, `getWorkshopPlanData`, `getWorkshopPlanSewingDependencyData`, `getWorkshopOrderSourcePlanData`, `submitWorkshopPlan`, `getWorkshopPlanApprovalData`, `getWorkshopPlanApprovalSewingDependencyData`, `reviewWorkshopPlan`, `getWorkshopProposalData`, `submitWorkshopProposal`, `getWorkshopReportData`, `saveWorkshopReport`.

## Quy tắc dữ liệu bất biến

- Tổ mặc định: Đặt hàng TV, Tổ Mút, Tổ Cao su, Tổ May, Tổ Gối.
- Bảo hành: Bảo hành thường, Bảo hành sửa chữa, Bảo hành đổi mới.
- Đơn đặt hàng: một đơn/tuần; tuần quá hạn chỉ xem; mọi dòng sửa/xóa phải có lý do.
- Kế hoạch tổ: tổng kế hoạch không được thấp hơn tổng đơn/đơn nhận.
- Duyệt: không xử lý lại kế hoạch đã duyệt/điều chỉnh/từ chối.
- Báo cáo: upsert duy nhất theo dòng kế hoạch và ngày báo cáo.
- Inbox V3: đơn đặt dùng `workshop-order`/`18DAT_HANG_XUONG`; kế hoạch duyệt dùng `workshop-plan`/`17KE_HOACH_XUONG_DA_DUYET`.

