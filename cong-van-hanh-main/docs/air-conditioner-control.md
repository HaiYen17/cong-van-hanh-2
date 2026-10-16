# Quản lý hệ thống điện

Module nằm tại `/nguoi-thuan-viet/dieu-khien-may-lanh`, thuộc nhóm quyền
`tien-ich`. Route và key quyền cũ được giữ để tương thích; giao diện quản lý chung
máy lạnh và công tắc đèn. Thiết bị và nhật ký lệnh được lưu trong PostgreSQL.

## Chế độ vận hành

- Khi chưa có phiên Hunonic, module giữ dữ liệu mẫu trong PostgreSQL nhưng khóa nút
  điều khiển để tránh hiểu nhầm là lệnh thật.
- Khi `Cấu hình → Hunonic` đăng nhập thành công, Cổng đọc thiết bị `irchild` /
  `irchildv2` cùng các dòng công tắc Hunonic tương thích từ mobile API và tự chuyển
  module sang `live`.
- Cổng kiểm tra hub và điều khiển IR trực tiếp qua MQTT-over-WebSocket; không cần
  triển khai bridge ngoài cho luồng cá nhân này.
- URL/secret bridge và biến môi trường cũ chỉ còn là fallback kỹ thuật.
- User, password, bridge secret và token/key được mã hóa AES-256-GCM trước khi
  ghi vào `SystemSetting` trong PostgreSQL.
- Không trả tài khoản, mật khẩu, bridge secret hoặc token đã lưu xuống trình
  duyệt; giao diện chỉ nhận trạng thái và bản xem trước đã che.

## Điều khiển chiếu sáng

- Công tắc được nhận diện theo whitelist loại thiết bị đã kiểm chứng; loại aptomat /
  công tơ tổng `elmeter`, `atmwifi`, `atmwifiv2` bị loại trừ để tránh thao tác cắt
  điện toàn hệ thống ngoài ý muốn.
- Trạng thái REST đọc từ `value.turn`: `1` là bật, `2` là tắt. Module tải lại trạng
  thái khi mở, mỗi 20 giây và khi người dùng bấm `Làm mới`.
- Kênh `N` dùng action MQTT `2N-1` để bật và `2N` để tắt. Field mang tên
  `root_type` luôn có giá trị `0`; payload được mã hóa AES-128-CBC bằng key/iv của
  chính thiết bị rồi publish tới `topicsub`.
- Cổng chờ phản hồi đúng `action` trên `topicpub`, cập nhật trạng thái giao diện và
  ghi nhật ký PostgreSQL. Chống gửi liên tiếp trong 3 giây dùng chung cơ chế với
  máy lạnh.
- Thiết bị mới được tự bổ sung vào registry PostgreSQL khi người dùng mở module;
  không cần đăng nhập lại Hunonic chỉ để thấy công tắc mới.

## Luồng cấu hình Admin

- Màn hình chính chỉ yêu cầu tài khoản/số điện thoại và mật khẩu Hunonic.
- Nút `Lưu & kiểm tra kết nối` đăng nhập server-side, đồng bộ máy lạnh và công tắc
  đèn vào PostgreSQL, đồng thời gửi lệnh kiểm tra hub `irwifiv2:105` không làm đổi
  trạng thái máy.
- Token, topic và khóa AES không được trả xuống trình duyệt. Admin không cần bấm
  nút lấy key riêng.
- URL bridge, bridge secret, token thủ công và chế độ vận hành nằm trong mục
  `Cấu hình nâng cao dành cho kỹ thuật`.

## Luồng điều khiển trực tiếp

Mỗi lệnh chỉ thay đổi đúng trường được yêu cầu và giữ nguyên các trường còn lại:

- Bật/tắt chỉ thay đổi `power`.
- Tăng/giảm nhiệt độ chỉ thay đổi `temp`, trong khoảng `temp_min`–`temp_max`
  do đúng mẫu remote khai báo.
- Chọn chế độ tra `mode` theo bảng mã riêng của từng remote. Giao diện mở
  `auto`, `cool`, `dry`, `fan`; không mở `heat` để tránh bật sưởi ngoài ý muốn.
- Mức gió tra động từ bảng `fan` của từng remote, vì cùng một mức có thể dùng
  mã khác nhau theo hãng. Cổng chuẩn hóa `min`/`low` thành `low`, `med` thành
  `medium`, `high`/`max` thành `high`, và giữ `auto` nếu remote hỗ trợ.
- Giao diện luôn sắp chế độ theo thứ tự `auto → cool → dry → fan`, không phụ
  thuộc thứ tự mã remote trả về. Các thao tác nguồn và chế độ dùng icon kèm
  `aria-label`/tooltip để tránh hai nút chữ Bật/Tắt gây cảm giác đảo chức năng.
- Icon chế độ hoạt động như bộ chọn mode: khi máy tắt, bấm một mode sẽ gửi đồng
  thời `power=1` và mã mode; khi máy đang chạy mode khác, nút chuyển mode. Bốn
  mode `auto`, `cool`, `dry` và `fan` (Chỉ quạt) loại trừ nhau; bấm lại mode đang
  chạy không đổi trạng thái. Icon mode tuyệt đối không gửi `power=0`. Chỉ nút
  Power mới tắt máy.
  Khi máy tắt, không mode nào được tô như đang hoạt động dù Cổng vẫn nhớ mode
  gần nhất.
- `fan` trong bảng mode có nghĩa là **Chỉ quạt**: đây là một mode vận hành và
  loại trừ Làm lạnh/Hút ẩm/Tự động. Tốc độ quạt là thuộc tính riêng, chạy chung
  với cả bốn mode. Ma trận hỗ trợ của Cổng là `auto + mức gió`, `cool + mức gió`,
  `dry + mức gió` và `fan + mức gió`.
- Mức gió có một control riêng. Mỗi lần bấm chạy vòng
  `Thấp → Vừa → Cao → Tự động` theo đúng các mức remote đó có. Ba vạch nhỏ
  trong nút biểu diễn mức 1/2/3; chữ `A` biểu diễn gió Tự động. Vì mode và mức
  gió nằm ở hai hàng độc lập, giao diện có thể đồng thời tô Làm lạnh và nút gió.
  Lệnh đổi mức chỉ thay trường `fan`, giữ nguyên `mode`, `power`, `temp`,
  `swingv`, `swingh` và `brand`.

Payload vẫn giữ `fan`, `swingv`, `swingh` và `brand`, được mã hóa AES-128-CBC
bằng key/iv của thiết bị rồi gửi dưới dạng ciphertext nhị phân đến topic điều
khiển. Cổng chờ phản hồi MQTT, chống gửi lệnh liên tiếp trong 3 giây và ghi nhật
ký thao tác vào PostgreSQL.

## Đồng bộ trạng thái khi mở module

- Power, nhiệt độ và chế độ được đọc từ `device.value` của REST mobile Hunonic.
- Module gọi REST với `cache: no-store` ngay khi mount, không chỉ dùng dữ liệu
  RSC có thể đã được dashboard prefetch. Module tiếp tục đồng bộ mỗi 20 giây và
  khi người dùng bấm `Làm mới`.
- Hub IR chỉ phát hồng ngoại một chiều. MQTT query `{"irwifiv2":105}` chỉ trả
  tình trạng hub/Wi-Fi, không trả power, nhiệt độ hay chế độ vật lý của máy lạnh.
  Vì vậy UI gọi đây là “trạng thái trên Hunonic” (lệnh gần nhất), không tuyên bố
  đây là phản hồi hai chiều từ máy lạnh.

Hợp đồng bridge cũ vẫn được giữ làm fallback và dùng JSON:

```json
{
  "command": "power_on",
  "externalDeviceId": "device-id",
  "requestId": "air-unique-request-id"
}
```

Bridge trả `{ "ok": true, "device": { "online": true, "powerOn": true } }`.
Chỉ triển khai bridge điều khiển thật sau khi có chấp thuận tích hợp doanh nghiệp
bằng văn bản từ nhà cung cấp.
